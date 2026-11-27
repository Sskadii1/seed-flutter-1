import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'apps', 'mobile', 'dist-web');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-hotfix');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0];
      let filePath = path.join(DIST_DIR, reqPath === '/' ? 'index.html' : reqPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function evalJs(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`JS error: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result?.value;
}

async function snap(cdp, filename) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const target = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(target, Buffer.from(data, 'base64'));
  return target;
}

async function dragMouseStroke(cdp, points) {
  const first = points[0];
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: first.x,
    y: first.y,
    button: 'left',
    clickCount: 1,
  });
  for (let i = 1; i < points.length; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: points[i].x,
      y: points[i].y,
      button: 'left',
    });
    await new Promise((r) => setTimeout(r, 12));
  }
  const last = points[points.length - 1];
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: last.x,
    y: last.y,
    button: 'left',
    clickCount: 1,
  });
}

async function checkDomZeroCollisions(cdp, label) {
  const res = await evalJs(
    cdp,
    `(() => {
      const anns = Array.from(document.querySelectorAll('[data-testid^="ann-"]'));
      const issues = [];
      const overlaps = (a, b, tol = 2) =>
        a.right - tol > b.left && a.left + tol < b.right && a.bottom - tol > b.top && a.top + tol < b.bottom;
      const allTextUnions = [];
      for (const annEl of anns) {
        const corrEl = annEl.querySelector('[data-testid^="chalk-corr-"]');
        const explEls = Array.from(annEl.querySelectorAll('text')).filter((t) => t !== corrEl);
        const textBoxes = [corrEl, ...explEls]
          .filter(Boolean)
          .map((t) => t.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        if (textBoxes.length > 0) {
          allTextUnions.push({
            id: annEl.getAttribute('data-testid'),
            rect: {
              left: Math.min(...textBoxes.map((r) => r.left)),
              top: Math.min(...textBoxes.map((r) => r.top)),
              right: Math.max(...textBoxes.map((r) => r.right)),
              bottom: Math.max(...textBoxes.map((r) => r.bottom)),
            },
          });
        }
      }
      for (const annEl of anns) {
        const id = annEl.getAttribute('data-testid');
        const cloudEl = annEl.querySelector('[data-testid^="cloud-path-"]');
        const arrowEl = annEl.querySelector('[data-testid^="arrow-path-"]');
        const headEl = annEl.querySelector('[data-testid^="arrow-head-"]');
        for (const tEntry of allTextUnions) {
          if (arrowEl && overlaps(arrowEl.getBoundingClientRect(), tEntry.rect, 3)) {
            issues.push({ id, vs: tEntry.id, type: 'arrow_vs_text' });
          }
          if (headEl && overlaps(headEl.getBoundingClientRect(), tEntry.rect, 3)) {
            issues.push({ id, vs: tEntry.id, type: 'arrowhead_vs_text' });
          }
          if (cloudEl && overlaps(cloudEl.getBoundingClientRect(), tEntry.rect, 2)) {
            issues.push({ id, vs: tEntry.id, type: 'cloud_vs_text' });
          }
        }
      }
      return { annCount: anns.length, issues };
    })()`
  );
  assert.equal(
    res.issues.length,
    0,
    `${label}: Found ${res.issues.length} SVG collision(s): ${JSON.stringify(res.issues)}`
  );
  return res;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { server: staticSrv, port: webPort } = await startStaticServer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-hotfix-'));
  const cdpPort = 9650 + Math.floor(Math.random() * 250);

  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${tmpDir}`,
      '--window-size=1360,920',
      `http://127.0.0.1:${webPort}`,
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  const trace = { timings: [], zooms: [], checks: {} };

  try {
    let targetWs = null;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((r) => r.json());
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          targetWs = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!targetWs) throw new Error('Chrome CDP endpoint did not start');

    cdp = new CdpClient(targetWs);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    let ready = false;
    for (let i = 0; i < 60; i++) {
      ready = await evalJs(
        cdp,
        `(() => {
          const btn = Array.from(document.querySelectorAll('*')).find((el) => el.childElementCount === 0 && el.textContent && el.textContent.trim() === 'Wonder Board');
          if (btn) btn.click();
          return Boolean(window.__WONDER_BOARD_TEST__);
        })()`
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(ready, true, 'Wonder Board test hook must initialize');
    await new Promise((r) => setTimeout(r, 500));

    // Inject all 6 required mixed-language annotations BEFORE explicitly awaiting document.fonts
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.injectMixedLanguageAnnotations([
          {
            targetText: '아',
            suggestedCorrection: '아 [a]',
            explanation: 'Âm tiết 아 = ㅇ (âm câm đầu) + ㅏ [a]. Ví dụ: 아이 (đứa trẻ), 아버지 (bố).',
            severity: 'info',
            box: { minX: 70, minY: 45, maxX: 165, maxY: 118, width: 95, height: 73 }
          },
          {
            targetText: '저는 한국어를 공부해요.',
            suggestedCorrection: '저는 한국어를 공부해요.',
            explanation: '받침 — phụ âm cuối. Ví dụ: 한 + 국 → nhận dạng rõ từng chữ.',
            severity: 'praise',
            box: { minX: 520, minY: 45, maxX: 810, maxY: 118, width: 290, height: 73 }
          },
          {
            targetText: '학생예요',
            suggestedCorrection: '학생이에요',
            explanation: '학생예요 → 학생이에요. Dùng -이에요 sau phụ âm cuối (받침).',
            severity: 'error',
            box: { minX: 70, minY: 365, maxX: 250, maxY: 440, width: 180, height: 75 }
          }
        ]);
      })()`
    );
    await new Promise((r) => setTimeout(r, 150));
    await snap(cdp, '01_mixed_typography_initial.png');

    // Verify font load completes, explicit <tspan> runs exist, and completed cloud count did NOT replay (A07)
    const preEpoch = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getFontEpoch()`);
    await evalJs(cdp, `document.fonts.ready.then(() => true)`);
    await new Promise((r) => setTimeout(r, 450));
    const postFontState = await evalJs(
      cdp,
      `(() => {
        const tspans = Array.from(document.querySelectorAll('[data-testid="wonder-svg-overlay"] tspan'));
        const anns = Array.from(document.querySelectorAll('[data-testid^="ann-"]'));
        return {
          epoch: window.__WONDER_BOARD_TEST__.getFontEpoch(),
          tspanCount: tspans.length,
          families: Array.from(new Set(tspans.map((t) => t.getAttribute('font-family')))),
          cloudsClosed: anns.map((a) => a.getAttribute('data-anim-cloud')),
        };
      })()`
    );
    assert.ok(postFontState.tspanCount >= 12, 'Expected explicit <tspan> font runs');
    assert.ok(
      postFontState.families.some((f) => f && f.includes('Playpen Sans')) &&
        postFontState.families.some((f) => f && f.includes('Gaegu')),
      `Expected separated VI & KO chalk font families, got ${JSON.stringify(postFontState.families)}`
    );
    assert.ok(
      postFontState.cloudsClosed.every((v) => v === '1.00'),
      `A07: Font load must never replay completed animations (${JSON.stringify(postFontState.cloudsClosed)})`
    );
    trace.checks.fontLoaded = { preEpoch, ...postFontState };
    await checkDomZeroCollisions(cdp, 'Mixed-Language Loaded Layout (A06)');
    await snap(cdp, '02_mixed_typography_fonts_loaded.png');

    // Test PNG export produces valid image with actual drawing bytes
    const exportedPngUrl = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.exportPngDataUrl()`);
    assert.ok(exportedPngUrl.startsWith('data:image/png;base64,') && exportedPngUrl.length > 5000);
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, '03_exported_board_canvas.png'),
      Buffer.from(exportedPngUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
    );

    // Zoom regression matrix: 45%, 75%, 100%, 150%, 200%
    for (const z of [0.45, 0.75, 1.0, 1.5, 2.0]) {
      await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setViewport(${z}, ${z === 2.0 ? -40 : 10}, 10)`);
      await new Promise((r) => setTimeout(r, 150));
      const metrics = await evalJs(
        cdp,
        `(() => {
          const p = document.querySelector('[data-testid^="cloud-path-"]');
          const corr = document.querySelector('[data-testid^="chalk-corr-"]');
          const expl = document.querySelector('[data-testid^="chalk-expl-"]');
          return {
            strokeWidth: p ? Number(p.getAttribute('stroke-width')) : 0,
            corrSize: corr ? Number(corr.getAttribute('font-size')) : 0,
            explSize: expl ? Number(expl.getAttribute('font-size')) : 0,
          };
        })()`
      );
      assert.ok(metrics.strokeWidth >= 2.5, `Zoom ${z}: cloud strokeWidth=${metrics.strokeWidth}`);
      assert.ok(metrics.corrSize >= 20, `Zoom ${z}: corrSize=${metrics.corrSize}`);
      assert.ok(metrics.explSize >= 15, `Zoom ${z}: explSize=${metrics.explSize}`);
      trace.zooms.push({ zoom: z, ...metrics });
      await checkDomZeroCollisions(cdp, `Zoom ${z}`);
      if (z === 0.45) await snap(cdp, '04_zoom_45.png');
      if (z === 2.0) await snap(cdp, '05_zoom_200.png');
    }

    // Reset viewport and measure A01-A03 Natural Cloud Timings & A04/A05/A08/A10
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.setViewport(1, 0, 0);
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('natural');
      })()`
    );
    await new Promise((r) => setTimeout(r, 100));

    // A01 Small cloud + A02 Medium cloud + A03 Large cloud
    const testClouds = [
      { label: 'A01_small', box: { minX: 120, minY: 90, maxX: 195, maxY: 165, width: 75, height: 75 } },
      { label: 'A02_medium', box: { minX: 120, minY: 90, maxX: 300, maxY: 185, width: 180, height: 95 } },
      { label: 'A03_large', box: { minX: 80, minY: 80, maxX: 540, maxY: 250, width: 460, height: 170 } },
    ];
    for (const tc of testClouds) {
      await evalJs(
        cdp,
        `(() => {
          window.__WONDER_BOARD_TEST__.clearBoard();
          window.__WONDER_BOARD_TEST__.setAnimationSpeed('natural');
          window.__WONDER_BOARD_TEST__.injectMixedLanguageAnnotations([{
            targetText: '학교에',
            suggestedCorrection: '학교에서',
            explanation: 'Dùng -에서 cho nơi hành động diễn ra.',
            severity: 'error',
            box: ${JSON.stringify(tc.box)}
          }]);
        })()`
      );
      // Sample mid-cloud frame for A04/A05 check
      await new Promise((r) => setTimeout(r, 320));
      const midSample = await evalJs(
        cdp,
        `(() => {
          const p = document.querySelector('[data-testid^="cloud-path-"]');
          const c = document.querySelector('[data-testid^="chalk-cursor-"]');
          return {
            d: p ? p.getAttribute('d') : '',
            hasCursor: Boolean(c),
          };
        })()`
      );
      if (midSample.d) {
        assert.equal(midSample.d.endsWith(' Z'), false, `${tc.label}: mid-animation path must stay open (A04)`);
        assert.equal(midSample.hasCursor, true, `${tc.label}: chalk nib must track active path (A05)`);
      }

      // Poll until done
      for (let k = 0; k < 50; k++) {
        const done = await evalJs(
          cdp,
          `Object.values(window.__WONDER_BOARD_TEST__.getAnimationTimings()).some((t) => typeof t.actualCloudMs === 'number')`
        );
        if (done) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const timed = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getAnimationTimings()`);
      const entry = Object.values(timed)[0];
      assert.ok(entry, `${tc.label}: Expected animation timing record`);
      if (tc.label === 'A01_small') {
        assert.ok(entry.cloudMs >= 600 && entry.cloudMs <= 900, `A01 expected 600-900ms, got ${entry.cloudMs}`);
      } else if (tc.label === 'A02_medium') {
        assert.ok(entry.cloudMs >= 900 && entry.cloudMs <= 1300, `A02 expected 900-1300ms, got ${entry.cloudMs}`);
      } else if (tc.label === 'A03_large') {
        assert.ok(entry.cloudMs <= 1800, `A03 expected <= 1800ms, got ${entry.cloudMs}`);
      }
      trace.timings.push({ label: tc.label, ...entry });
    }

    // A08 & A09 & A10: Multi-annotation queue adaptive speed + continuous writing during active animation
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('natural');
        window.__WONDER_BOARD_TEST__.injectMixedLanguageAnnotations([
          { targetText: '가요.', suggestedCorrection: '갔어요', explanation: 'Thì quá khứ cho 어제.', severity: 'error', box: { minX: 80, minY: 65, maxX: 180, maxY: 135, width: 100, height: 70 } },
          { targetText: '사과가', suggestedCorrection: '사과를', explanation: 'Tân ngữ dùng -을/를.', severity: 'error', box: { minX: 460, minY: 65, maxX: 590, maxY: 135, width: 130, height: 70 } },
          { targetText: '학교에', suggestedCorrection: '학교에서', explanation: 'Nơi xảy ra hành động.', severity: 'error', box: { minX: 80, minY: 320, maxX: 210, maxY: 390, width: 130, height: 70 } },
          { targetText: '학생예요', suggestedCorrection: '학생이에요', explanation: 'Danh từ có 받침.', severity: 'error', box: { minX: 460, minY: 320, maxX: 600, maxY: 390, width: 140, height: 70 } },
        ]);
      })()`
    );

    const canvasRect = await evalJs(
      cdp,
      `document.querySelector('[data-testid="wonder-canvas"]').getBoundingClientRect().toJSON()`
    );
    // Write a live stroke with mouse while animations are actively playing (A10 + A12)
    await new Promise((r) => setTimeout(r, 250));
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 860, y: canvasRect.top + 120 },
      { x: canvasRect.left + 920, y: canvasRect.top + 120 },
      { x: canvasRect.left + 920, y: canvasRect.top + 190 },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    await snap(cdp, '06_queue_and_writing_mid_anim.png');

    for (let k = 0; k < 70; k++) {
      const doneCount = await evalJs(
        cdp,
        `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter((a) => a.lifecycle_state === 'completed').length`
      );
      if (doneCount === 4) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    const queueRes = await evalJs(
      cdp,
      `({
        timings: window.__WONDER_BOARD_TEST__.getAnimationTimings(),
        strokes: window.__WONDER_BOARD_TEST__.getState().board.strokes.length,
        completed: window.__WONDER_BOARD_TEST__.getState().board.annotations.filter((a) => a.lifecycle_state === 'completed').length,
      })`
    );
    assert.equal(queueRes.completed, 4, 'A09: All 4 queued annotations must finish sequentially');
    assert.ok(queueRes.strokes >= 1, 'A10/A12: Live stroke drawn mid-animation must be preserved');
    assert.ok(
      Object.values(queueRes.timings)[0].queueMultiplier < 1.0,
      'A09: Queue multiplier must accelerate when multiple annotations are queued'
    );
    trace.checks.queueAndInkDuringAnim = queueRes;
    await checkDomZeroCollisions(cdp, 'Multi-Annotation Queue Completed (A06)');
    await snap(cdp, '07_queue_completed_zero_collisions.png');

    // A11: Reduced Motion + A12 Reload persistence
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.injectMixedLanguageAnnotations([
        { targetText: '아', suggestedCorrection: '아 [a]', explanation: 'Kiểm tra reduced motion.', severity: 'info', box: { minX: 120, minY: 120, maxX: 200, maxY: 200, width: 80, height: 80 } }
      ])`
    );
    await new Promise((r) => setTimeout(r, 180));
    const reducedDone = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.every((a) => a.lifecycle_state === 'completed')`
    );
    assert.equal(reducedDone, true, 'A11: prefers-reduced-motion must complete immediately');
    trace.checks.reducedMotion = reducedDone;

    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.send('Page.reload', { ignoreCache: true });
    let reloadReady = false;
    for (let i = 0; i < 60; i++) {
      reloadReady = await evalJs(
        cdp,
        `(() => {
          const btn = Array.from(document.querySelectorAll('*')).find((el) => el.childElementCount === 0 && el.textContent && el.textContent.trim() === 'Wonder Board');
          if (btn) btn.click();
          return Boolean(window.__WONDER_BOARD_TEST__);
        })()`
      );
      if (reloadReady) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(reloadReady, true, 'Wonder Board test hook must initialize after reload');
    await new Promise((r) => setTimeout(r, 350));
    const reloaded = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.ok(reloaded.annotations.length >= 1, 'A12: Reload must preserve completed annotation history');
    trace.checks.reloadPreserved = {
      annotations: reloaded.annotations.length,
      strokes: reloaded.strokes.length,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'animation-trace.json'),
      JSON.stringify(trace, null, 2)
    );
    console.log('HOTFIX VISUAL, TYPOGRAPHY, SPATIAL COLLISION & ANIMATION VERIFICATION PASSED.');
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
    staticSrv.close();
    await new Promise((r) => setTimeout(r, 250));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows Crashpad lock during headless exit
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
