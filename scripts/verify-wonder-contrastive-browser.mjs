import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Use the local export and a fresh browser profile with Vision and Tutor offline.
for (const variable of ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) process.env[variable] = '';
const { startLocalFullstackServer } = await import('./dev-local-server.mjs');
const server = await startLocalFullstackServer(0);
const url = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'seed-contrastive-test-'));
const chrome = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=0', '--window-size=1440,920',
  `--user-data-dir=${profile}`, url,
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

const evidenceDir = fileURLToPath(new URL('../docs/visual-evidence-contrastive/', import.meta.url));
let socket;
let commandId = 0;
const pending = new Map();
function command(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const reply = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
  return reply.result.value;
}

async function waitFor(expression, limit = 10_000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const value = await evaluate(expression);
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(name) {
  const { data } = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(evidenceDir, name), Buffer.from(data, 'base64'));
}

function measureFrame(label) {
  const hook = window.__WONDER_BOARD_TEST__;
  const { board } = hook.getState();
  const layouts = hook.getMeasuredLayouts();
  const anns = board.annotations.filter((a) => a.status === 'active');
  const contains = (b, p) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
  const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  const textBoxes = [...document.querySelectorAll('[data-testid^="ann-"] text')].map((text) => {
    const b = text.getBBox();
    return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
  });
  const visibleClouds = Object.entries(layouts).filter(([, layout]) => layout.cloudVisible)
    .map(([id, layout]) => ({ id, box: layout.cloudBounds }));
  const routes = anns.flatMap((ann) => {
    const id = ann.annotation_id;
    const layout = layouts[id];
    const shaft = document.querySelector(`[data-testid="arrow-path-${CSS.escape(id)}"]`);
    const head = document.querySelector(`[data-testid="arrow-head-${CSS.escape(id)}"]`);
    const shell = document.querySelector(`[data-testid="cloud-path-${CSS.escape(id)}"]`);
    if (!shaft || !head || !shell) return [];
    const pointsOnPath = (path) => {
      const length = path.getTotalLength();
      const steps = Math.max(1, Math.ceil(length / 2));
      return Array.from({ length: steps + 1 }, (_, i) => path.getPointAtLength(length * i / steps));
    };
    const points = [...pointsOnPath(shaft), ...pointsOnPath(head)];
    const first = shaft.getPointAtLength(0);
    const end = shaft.getPointAtLength(shaft.getTotalLength());
    const note = layout.noteBox;
    const distanceFromNote = Math.hypot(
      Math.max(0, note.minX - end.x, end.x - note.maxX),
      Math.max(0, note.minY - end.y, end.y - note.maxY));
    const distanceFromCloud = Math.min(...pointsOnPath(shell).map((p) => Math.hypot(p.x - first.x, p.y - first.y)));
    return [{
      id, sourceStrokeIds: ann.source_stroke_ids, route: layout.arrow,
      inkCollision: points.some((p) => board.strokes.some((s) => !s.deleted && contains(s.bbox, p))),
      cloudCollision: points.some((p) => visibleClouds.some((c) => c.id !== id && contains(c.box, p))),
      textCollision: points.some((p) => textBoxes.some((b) => contains(b, p))),
      incorrectBinding: distanceFromNote > 14 || distanceFromCloud > 9 || !layout.noteVisible,
      tooLong: shaft.getTotalLength() * board.viewport.scale > 161,
      length: shaft.getTotalLength(),
    }];
  });
  return {
    label, viewport: board.viewport, routes,
    cloudOverlaps: visibleClouds.flatMap((a, i) => visibleClouds.slice(i + 1)
      .filter((b) => overlap(a.box, b.box)).map((b) => [a.id, b.id])),
    visibleCloudCount: visibleClouds.length,
    visibleNoteCount: Object.values(layouts).filter((l) => l.noteVisible).length,
    completedIds: anns.filter((a) => a.animation_progress.completed).map((a) => a.annotation_id),
    targets: anns.map((a) => ({ id: a.annotation_id, text: a.target_text, strokeIds: a.source_stroke_ids })),
  };
}

try {
  await mkdir(evidenceDir, { recursive: true });
  const address = await new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('Chrome debug port did not open')), 10_000);
    chrome.once('error', reject);
    chrome.stderr.on('data', (chunk) => {
      const match = chunk.toString().match(/DevTools listening on ws:\/\/([^/]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const targets = await fetch(`http://${address}/json/list`).then((res) => res.json());
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(String(data));
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if (reply.error) request.reject(new Error(reply.error.message));
    else request.resolve(reply.result);
  });
  await command('Page.enable');
  await waitFor(`(() => {
    if (window.__WONDER_BOARD_TEST__) return true;
    const link = [...document.querySelectorAll('*')].find((el) =>
      el.children.length === 0 && el.textContent.trim() === 'Wonder Board');
    if (link) (link.closest('[role="button"], [tabindex="0"], button') ?? link).click();
    return false;
  })()`);
  await evaluate('document.fonts.ready.then(() => true)');
  const hook = 'window.__WONDER_BOARD_TEST__';
  const finished = '{cloud:1,arrow:1,correction:1,explanation:1,completed:true}';
  const snapshot = async (label) => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    return evaluate(`(${measureFrame.toString()})(${JSON.stringify(label)})`);
  };

  for (const [x, y, label] of [[100, 155, '아'], [215, 155, '어'], [330, 155, '아'], [445, 155, '어']]) {
    await evaluate(`${hook}.insertSample(${JSON.stringify(label)}, 'tutor', ${x}, ${y})`);
    await delay(120);
  }
  try {
    await waitFor(`(() => {
      const { board } = ${hook}.getState();
      const active = board.annotations.filter(a => a.status === 'active');
      return board.regions.length === 4 && active.length === 1 &&
        active[0].teaching_activity_id && active[0].explanation.includes('어 = ㅇ + ㅓ');
    })()`);
  } catch (failure) {
    const state = await evaluate(`(() => {
      const { board, diagnostics } = ${hook}.getState();
      return {
        revision: board.revision,
        regions: board.regions.map(r => [r.recognizedText, r.recognitionStatus, r.spans.map(s => s.text)]),
        annotations: board.annotations.map(a => [a.target_text, a.status, a.explanation]),
        diagnostics: diagnostics.map(d => [d.recognizedText, d.annotationDecision, d.learningIntent]),
      };
    })()`);
    throw new Error(`${failure.message}\n${JSON.stringify(state)}`);
  }
  await evaluate(`${hook}.scrubAllAnnotations(${finished})`);
  const grouped = await snapshot('grouped-typed-reference');
  assert.equal(grouped.targets.length, 1);
  assert.equal(grouped.visibleNoteCount, 1);
  await screenshot('grouped-practice.png');

  const boxes = [
    [100, 145, 70, 73], [320, 147, 72, 75], [647, 140, 65, 74], [320, 374, 70, 72],
  ].map(([minX, minY, width, height]) => ({ minX, minY, maxX: minX + width, maxY: minY + height, width, height }));
  await evaluate(`${hook}.injectMixedLanguageAnnotations(${JSON.stringify(
    boxes.map((box, i) => ({
      box, targetText: ['가', '거', '오', '우'][i], suggestedCorrection: ['가', '거', '오', '우'][i],
      explanation: ['Nét giữa nằm bên phải.', 'Nét giữa nằm bên trái.', 'Nhánh ở phía trên.', 'Nhánh ở phía dưới.'][i],
    })),
  )})`);
  await waitFor(`Object.keys(${hook}.getMeasuredLayouts()).length === 4`);
  await evaluate(`${hook}.scrubAllAnnotations(${finished})`);
  const initial = await snapshot('four-adjacent-annotations');
  assert.equal(initial.targets.length, 4);
  assert.ok(initial.routes.length > 0, 'Safe paths must remain visible');
  await screenshot('four-regions.png');

  const first = initial.routes[0];
  const inkPosition = await evaluate(`(() => {
    const shaft = document.querySelector('[data-testid="arrow-path-${first.id}"]');
    const point = shaft.getPointAtLength(shaft.getTotalLength() * 0.52);
    const canvas = document.querySelector('[data-testid="wonder-canvas"]').getBoundingClientRect();
    return { x: canvas.left + point.x, y: canvas.top + point.y };
  })()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...inkPosition });
  await delay(100);
  const during = await snapshot('pointer-down-over-old-arrow');
  assert.notDeepEqual(during.routes.find((r) => r.id === first.id)?.route, first.route);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: inkPosition.x, y: inkPosition.y + 23 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: inkPosition.x, y: inkPosition.y + 23 });
  await delay(100);
  const after = await snapshot('new-unassigned-ink');
  assert.notDeepEqual(after.routes.find((r) => r.id === first.id)?.route, first.route);
  assert.deepEqual(after.completedIds, initial.completedIds);
  await screenshot('new-ink-rerouted.png');

  const frames = [grouped, initial, during, after];
  for (const [scale, x, y] of [[0.25, 70, 60], [0.5, 100, 35], [1.5, -33, -45], [2, -50, -75], [2, -290, -160]]) {
    await evaluate(`${hook}.setViewport(${scale}, ${x}, ${y})`);
    const frame = await snapshot(`view-${scale}-${x}-${y}`);
    assert.deepEqual(frame.targets, initial.targets);
    assert.deepEqual(frame.completedIds, initial.completedIds);
    frames.push(frame);
  }
  await screenshot('zoom-200-percent.png');
  assert.ok(frames.slice(4).some((frame) =>
    frame.routes.some((route) => initial.routes.some((original) =>
      original.id === route.id && (original.route.toX !== route.route.toX || original.route.toY !== route.route.toY)))),
  'The same annotation must acquire a new anchor when the viewport moves its note');
  const routes = frames.flatMap((frame) => frame.routes);
  const metric = (hits, samples) => ({ hits, samples, rate: samples ? hits / samples : null });
  const metrics = {
    arrowToInkCollisionRate: metric(routes.filter((r) => r.inkCollision).length, routes.length),
    arrowToCloudCollisionRate: metric(routes.filter((r) => r.cloudCollision).length, routes.length),
    arrowToTextCollisionRate: metric(routes.filter((r) => r.textCollision).length, routes.length),
    incorrectArrowTargetBindingRate: metric(routes.filter((r) => r.incorrectBinding).length, routes.length),
    unnecessaryLongArrowRate: metric(routes.filter((r) => r.tooLong).length, routes.length),
    groupedFeedbackAnnotationDensity: metric(grouped.visibleNoteCount, 4),
  };
  assert.ok(frames.every((frame) => frame.cloudOverlaps.length === 0));
  const failures = frames.flatMap((frame) => frame.routes
    .filter((r) => r.inkCollision || r.cloudCollision || r.textCollision || r.incorrectBinding || r.tooLong)
    .map((route) => ({ frame: frame.label, ...route })));
  assert.deepEqual(failures, []);
  const viewport = await evaluate('({width: innerWidth, height: innerHeight})');
  const trace = { provenance: 'isolated Chrome profile, typed and geometry fixtures, no live providers', viewport, frames, metrics };
  await writeFile(join(evidenceDir, 'browser-trace.json'), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ frames: frames.length, routes: routes.length, metrics }, null, 2));
} finally {
  socket?.close();
  chrome.kill();
  server.close();
}
