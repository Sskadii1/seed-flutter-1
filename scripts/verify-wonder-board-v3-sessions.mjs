import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayServer } from '../services/ai-gateway/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'apps', 'mobile', 'dist-web');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-v3');
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
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const trace = [];
  const { server: staticSrv, port: webPort } = await startStaticServer();

  // Real HTTP AI Gateway configured with NO upstream keys -> proves authentic 503 PROVIDER_UNAVAILABLE handling
  const gatewaySrv = createGatewayServer({ geminiKey: '', openaiKey: '' });
  await new Promise((r) => gatewaySrv.listen(0, '127.0.0.1', r));
  const gatewayUrl = `http://127.0.0.1:${gatewaySrv.address().port}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-v3-'));
  const cdpPort = 9335;
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${tmpDir}`,
      '--window-size=1280,820',
      `http://127.0.0.1:${webPort}`,
    ],
    { stdio: 'ignore' }
  );

  let cdp;
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 2,
      mobile: false,
    });

    await new Promise((r) => setTimeout(r, 1500));
    await evalJs(
      cdp,
      `new Promise(resolve => {
        const poll = () => {
          const all = Array.from(document.querySelectorAll('*'));
          const leaf = all.find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Wonder Board');
          if (leaf) {
            const target = leaf.closest('[tabindex="0"], [role="button"], button') || leaf;
            target.click();
            resolve(true);
          } else {
            setTimeout(poll, 150);
          }
        };
        poll();
      })`
    );
    await new Promise((r) => setTimeout(r, 600));

    // PHASE 0 + SESSION D: Real Freehand Mouse Drawing on Canvas -> Zero fake errors!
    const canvasRect = await evalJs(
      cdp,
      `(() => {
        const c = document.querySelector('[data-testid="wonder-canvas"]');
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()`
    );
    assert.ok(canvasRect.width > 500);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await new Promise((r) => setTimeout(r, 200));

    // Draw ambiguous crossing strokes ('X') with actual mouse drag events
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 120, y: canvasRect.top + 150 },
      { x: canvasRect.left + 175, y: canvasRect.top + 210 },
    ]);
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 175, y: canvasRect.top + 150 },
      { x: canvasRect.left + 120, y: canvasRect.top + 210 },
    ]);
    await new Promise((r) => setTimeout(r, 1500));
    const phase0State = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.equal(phase0State.strokes.length, 2, 'Phase 0: Freehand mouse strokes captured cleanly');
    assert.equal(
      phase0State.annotations.filter((a) => a.status === 'active').length,
      0,
      'Session D: Unknown freehand strokes must produce ZERO fake error clouds'
    );
    await snap(cdp, 'phase0_session_d_freehand_silent.png');
    trace.push({ session: 'Phase0+D', strokes: phase0State.strokes.length, activeAnns: 0 });

    // SESSION E: Connect live gateway (unconfigured upstream -> HTTP 503) -> strokes intact, 0 crashes, 0 fake feedback
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setGatewayConfig(${JSON.stringify(gatewayUrl)}, '');`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 600));
    const sessE = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.equal(sessE.strokes.length, 2, 'Session E: Strokes remain intact on HTTP 503 gateway failure');
    assert.equal(
      sessE.annotations.filter((a) => a.status === 'active').length,
      0,
      'Session E: Gateway failure must never invent fallback fake errors'
    );
    assert.equal(
      sessE.regions[0]?.recognitionStatus,
      'PROVIDER_UNAVAILABLE',
      `Session E: Expected PROVIDER_UNAVAILABLE, got ${sessE.regions[0]?.recognitionStatus}`
    );
    await snap(cdp, 'session_e_gateway_unavailable.png');
    trace.push({ session: 'E', regionStatus: sessE.regions[0]?.recognitionStatus, apiCalls: sessE.telemetry.apiCallCount });

    // Reset gateway URL for offline adaptive sessions A, B, C, F, G
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setGatewayConfig('', '');`);

    // SESSION A: Continuous writing during active chalk animation
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('natural');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가요.', 'tutor', 80, 90);
      })()`
    );
    await new Promise((r) => setTimeout(r, 550));
    // Learner writes 2nd sentence while 1st cloud is animating
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.appendStrokeIncremental('저는 사과가 먹어요.', 80, 250);
      })()`
    );
    await new Promise((r) => setTimeout(r, 3200));
    const sessA = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    const activeA = sessA.annotations.filter((a) => a.status === 'active');
    assert.equal(activeA.length, 2, 'Session A: Both errors discovered seamlessly across continuous session');
    await snap(cdp, 'session_a_continuous_writing.png');
    trace.push({ session: 'A', activeAnnotations: activeA.map((a) => a.target_text) });

    // SESSION B: Zero-Knowledge Beginner Micro-Teaching Loop
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setGuidanceLevel('beginner_friendly');
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('Tôi muốn học cách giới thiệu bản thân.', 'discovery', 70, 70);
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.appendStrokeIncremental('저는 학생예요.', 70, 390);
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
    const sessB = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.equal(sessB.teachingCards[0]?.koreanPhrase, '안녕하세요.', 'Session B: Teaches 안녕하세요 first');
    assert.equal(sessB.beginnerLoop?.active, true, 'Session B: Beginner loop stays active');
    assert.ok(
      sessB.annotations.some((a) => a.status === 'active' && a.suggested_correction === '학생이에요'),
      'Session B: Catches learner attempt 학생예요 -> 학생이에요'
    );
    await snap(cdp, 'session_b_beginner_loop.png');
    trace.push({
      session: 'B',
      teachingPhrase: sessB.teachingCards[0]?.koreanPhrase,
      stepIndex: sessB.beginnerLoop?.stepIndex,
    });

    // SESSION C: Context Revision (editing "어제" -> "오늘" invalidates/removes tense error)
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가요.', 'tutor', 80, 100);
      })()`
    );
    await new Promise((r) => setTimeout(r, 350));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.editFirstRegionStrokes('저는 오늘 학교에 가요.');`);
    await new Promise((r) => setTimeout(r, 400));
    const sessC = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.equal(
      sessC.annotations.filter((a) => a.status === 'active' && a.severity === 'error').length,
      0,
      'Session C: Context revision retracts stale tense error'
    );
    await snap(cdp, 'session_c_context_revision.png');
    trace.push({ session: 'C', activeErrorsAfterEdit: 0 });

    // SESSION F & G: Self-Correction -> BKT/Elo Update Once -> Page Reload Idempotency
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저는 학생예요.', 'tutor', 80, 90);
      })()`
    );
    await new Promise((r) => setTimeout(r, 400));
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.appendStrokeIncremental('저는 학생이에요.', 80, 260);
      })()`
    );
    await new Promise((r) => setTimeout(r, 450));
    const sessF = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.ok(
      sessF.annotations.some((a) => a.status === 'resolved'),
      'Session F: Evidence-based self-correction resolves initial error'
    );
    await snap(cdp, 'session_f_self_correction.png');

    // Read persisted learningState before reload (Session G)
    const preReloadLearning = await evalJs(
      cdp,
      `JSON.parse(localStorage.getItem('seed_korean_learning_state_v1') || '{}')`
    );
    const eloBeforeReload = preReloadLearning?.aiProfile?.eloRating ?? 1000;
    const responsesBeforeReload = preReloadLearning?.aiProfile?.totalResponses ?? 0;

    await cdp.send('Page.reload', { ignoreCache: false });
    await new Promise((r) => setTimeout(r, 1500));
    await evalJs(
      cdp,
      `new Promise(resolve => {
        const poll = () => {
          const all = Array.from(document.querySelectorAll('*'));
          const leaf = all.find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Wonder Board');
          if (leaf) {
            const target = leaf.closest('[tabindex="0"], [role="button"], button') || leaf;
            target.click();
            resolve(true);
          } else {
            setTimeout(poll, 150);
          }
        };
        poll();
      })`
    );
    await new Promise((r) => setTimeout(r, 600));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 350));

    const postReloadLearning = await evalJs(
      cdp,
      `JSON.parse(localStorage.getItem('seed_korean_learning_state_v1') || '{}')`
    );
    const sessG = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    assert.ok(sessG.strokes.length > 0, 'Session G: Ink restored after reload');
    assert.equal(
      postReloadLearning?.aiProfile?.eloRating,
      eloBeforeReload,
      'Session G: Elo MUST NOT double-count after reload'
    );
    assert.equal(
      postReloadLearning?.aiProfile?.totalResponses,
      responsesBeforeReload,
      'Session G: Total responses MUST NOT double-count after reload'
    );
    await snap(cdp, 'session_g_reload_idempotent.png');
    trace.push({ session: 'F+G', eloBeforeReload, eloAfterReload: postReloadLearning?.aiProfile?.eloRating });

    // LARGE FREEHAND '아' EXPLAIN VISUAL CHECK: draw ~340px-tall freehand 아 -> AI Lasso "Giải thích"
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));
    const cxOval = canvasRect.left + 320;
    const cyOval = canvasRect.top + 330;
    const ovalScreenPts = Array.from({ length: 16 }, (_, k) => {
      const a = -0.35 + (k / 15) * (Math.PI * 1.82);
      return { x: cxOval + Math.cos(a) * 65, y: cyOval + Math.sin(a) * 145 };
    });
    await dragMouseStroke(cdp, ovalScreenPts);
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 440, y: canvasRect.top + 175 },
      { x: canvasRect.left + 436, y: canvasRect.top + 485 },
    ]);
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 436, y: canvasRect.top + 335 },
      { x: canvasRect.left + 515, y: canvasRect.top + 338 },
    ]);
    await new Promise((r) => setTimeout(r, 400));

    // Click "Khoanh hỏi AI", lasso around 아, then click "Giải thích"
    await evalJs(
      cdp,
      `(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const clickText = (label) => {
          const leaf = all.find(el => el.children.length === 0 && (el.textContent || '').trim() === label);
          if (leaf) (leaf.closest('[tabindex="0"], [role="button"], button') || leaf).click();
        };
        clickText('Khoanh hỏi AI');
      })()`
    );
    await new Promise((r) => setTimeout(r, 150));
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 210, y: canvasRect.top + 140 },
      { x: canvasRect.left + 560, y: canvasRect.top + 140 },
      { x: canvasRect.left + 560, y: canvasRect.top + 520 },
      { x: canvasRect.left + 210, y: canvasRect.top + 520 },
      { x: canvasRect.left + 210, y: canvasRect.top + 140 },
    ]);
    await new Promise((r) => setTimeout(r, 250));
    await evalJs(
      cdp,
      `(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const leaf = all.find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Giải thích');
        if (leaf) (leaf.closest('[tabindex="0"], [role="button"], button') || leaf).click();
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
    const freehandAState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    const annA = freehandAState.annotations.find((a) => a.status === 'active');
    assert.ok(annA, 'Freehand 아 must generate an active explanation annotation');
    assert.equal(annA.target_text, '아', `Expected "아", got "${annA.target_text}"`);
    await snap(cdp, 'freehand_large_a_explained.png');

    // MULTI-SYLLABLE FREEHAND '고마워' VISUAL CHECK (switch back to 'Phấn' chalk tool first!)
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        const all = Array.from(document.querySelectorAll('*'));
        const leaf = all.find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Phấn');
        if (leaf) (leaf.closest('[tabindex="0"], [role="button"], button') || leaf).click();
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));
    const ox = canvasRect.left + 260;
    const oy = canvasRect.top + 200;
    // 고
    await dragMouseStroke(cdp, [{ x: ox, y: oy }, { x: ox + 70, y: oy }, { x: ox + 70, y: oy + 85 }]);
    await dragMouseStroke(cdp, [{ x: ox + 35, y: oy + 85 }, { x: ox + 35, y: oy + 135 }]);
    await dragMouseStroke(cdp, [{ x: ox - 15, y: oy + 135 }, { x: ox + 90, y: oy + 135 }]);
    // 마
    await dragMouseStroke(cdp, [{ x: ox + 120, y: oy + 15 }, { x: ox + 120, y: oy + 120 }, { x: ox + 162, y: oy + 122 }]);
    await dragMouseStroke(cdp, [{ x: ox + 122, y: oy + 15 }, { x: ox + 165, y: oy + 15 }, { x: ox + 165, y: oy + 120 }]);
    await dragMouseStroke(cdp, [{ x: ox + 182, y: oy - 5 }, { x: ox + 182, y: oy + 155 }]);
    await dragMouseStroke(cdp, [{ x: ox + 182, y: oy + 75 }, { x: ox + 210, y: oy + 75 }]);
    // 워
    await dragMouseStroke(
      cdp,
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ox + 260 + Math.cos(a) * 24, y: oy + 20 + Math.sin(a) * 22 };
      })
    );
    await dragMouseStroke(cdp, [{ x: ox + 225, y: oy + 64 }, { x: ox + 295, y: oy + 64 }]);
    await dragMouseStroke(cdp, [{ x: ox + 260, y: oy + 64 }, { x: ox + 260, y: oy + 152 }]);
    await dragMouseStroke(cdp, [{ x: ox + 315, y: oy - 5 }, { x: ox + 315, y: oy + 155 }]);
    await dragMouseStroke(cdp, [{ x: ox + 290, y: oy + 110 }, { x: ox + 335, y: oy + 112 }]);
    await new Promise((r) => setTimeout(r, 1500));

    const gomawoState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    const gomawoAnns = gomawoState.annotations.filter((a) => a.status === 'active');
    assert.equal(gomawoAnns.length, 1, `Expected 1 ambient annotation for 고마워, got ${gomawoAnns.length}`);
    assert.equal(gomawoAnns[0].target_text, '고마워', `Expected "고마워", got "${gomawoAnns[0].target_text}"`);
    await snap(cdp, 'freehand_gomawo_explained.png');

    // DIAGONAL FREEHAND '어디야' + '나도야' VISUAL CHECK
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));
    const ex1 = canvasRect.left + 80;
    const ey1 = canvasRect.top + 100;
    // 어디야
    await dragMouseStroke(
      cdp,
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ex1 + 28 + Math.cos(a) * 24, y: ey1 + 70 + Math.sin(a) * 42 };
      })
    );
    await dragMouseStroke(cdp, [{ x: ex1 + 54, y: ey1 + 70 }, { x: ex1 + 78, y: ey1 + 70 }]);
    await dragMouseStroke(cdp, [{ x: ex1 + 78, y: ey1 + 15 }, { x: ex1 + 78, y: ey1 + 135 }]);
    await dragMouseStroke(cdp, [
      { x: ex1 + 152, y: ey1 + 28 },
      { x: ex1 + 108, y: ey1 + 28 },
      { x: ex1 + 108, y: ey1 + 112 },
      { x: ex1 + 154, y: ey1 + 112 },
    ]);
    await dragMouseStroke(cdp, [{ x: ex1 + 172, y: ey1 + 15 }, { x: ex1 + 172, y: ey1 + 135 }]);
    await dragMouseStroke(
      cdp,
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ex1 + 222 + Math.cos(a) * 22, y: ey1 + 68 + Math.sin(a) * 38 };
      })
    );
    await dragMouseStroke(cdp, [{ x: ex1 + 262, y: ey1 + 15 }, { x: ex1 + 262, y: ey1 + 135 }]);
    await dragMouseStroke(cdp, [{ x: ex1 + 262, y: ey1 + 52 }, { x: ex1 + 290, y: ey1 + 52 }]);
    await dragMouseStroke(cdp, [{ x: ex1 + 262, y: ey1 + 94 }, { x: ex1 + 290, y: ey1 + 94 }]);

    const ex2 = canvasRect.left + 430;
    const ey2 = canvasRect.top + 240;
    // 나도야
    await dragMouseStroke(cdp, [{ x: ex2, y: ey2 + 15 }, { x: ex2, y: ey2 + 105 }, { x: ex2 + 42, y: ey2 + 105 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 58, y: ey2 + 5 }, { x: ex2 + 58, y: ey2 + 130 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 58, y: ey2 + 66 }, { x: ex2 + 82, y: ey2 + 66 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 105, y: ey2 + 10 }, { x: ex2 + 155, y: ey2 + 10 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 105, y: ey2 + 10 }, { x: ex2 + 105, y: ey2 + 78 }, { x: ex2 + 160, y: ey2 + 78 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 132, y: ey2 + 78 }, { x: ex2 + 132, y: ey2 + 122 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 96, y: ey2 + 122 }, { x: ex2 + 172, y: ey2 + 122 }]);
    await dragMouseStroke(
      cdp,
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ex2 + 215 + Math.cos(a) * 22, y: ey2 + 58 + Math.sin(a) * 38 };
      })
    );
    await dragMouseStroke(cdp, [{ x: ex2 + 255, y: ey2 + 5 }, { x: ex2 + 255, y: ey2 + 130 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 255, y: ey2 + 45 }, { x: ex2 + 282, y: ey2 + 45 }]);
    await dragMouseStroke(cdp, [{ x: ex2 + 255, y: ey2 + 88 }, { x: ex2 + 282, y: ey2 + 88 }]);
    await new Promise((r) => setTimeout(r, 1500));

    const diagState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board`);
    const diagAnns = diagState.annotations.filter((a) => a.status === 'active');
    assert.equal(diagAnns.length, 2, `Expected 2 active annotations for 어디야 + 나도야, got ${diagAnns.length}`);
    assert.deepEqual(
      diagAnns.map((a) => a.target_text),
      ['어디야', '나도야']
    );
    assert.ok(diagAnns.every((a) => a.annotation_type !== 'ambiguity_check'));
    await snap(cdp, 'freehand_eodiya_nadoya_explained.png');

    // P0.3 UNKNOWN / ILLEGIBLE INK: zero "Xác nhận chữ viết" cloud when ambiguous strokes are drawn or queried
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
      })()`
    );
    await new Promise((r) => setTimeout(r, 150));
    await dragMouseStroke(cdp, [
      { x: canvasRect.left + 220, y: canvasRect.top + 200 },
      { x: canvasRect.left + 290, y: canvasRect.top + 265 },
      { x: canvasRect.left + 230, y: canvasRect.top + 280 },
      { x: canvasRect.left + 310, y: canvasRect.top + 215 },
    ]);
    await new Promise((r) => setTimeout(r, 1400));
    const unkState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    assert.equal(
      unkState.board.annotations.filter((a) => a.status === 'active').length,
      0,
      'Unknown/illegible strokes must produce 0 clouds on board'
    );
    assert.ok(Array.isArray(unkState.diagnostics) && unkState.diagnostics.length >= 1, 'Developer diagnostics must record honest blocker');
    await snap(cdp, 'freehand_unknown_silent.png');

    // P0 UNSEEN FREEHAND SENTENCE WITH ERROR ("저는 한국어가 공부해요." -> pinpoints ONLY "한국어가")
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
      })()`
    );
    await new Promise((r) => setTimeout(r, 150));
    const sx = canvasRect.left + 60;
    const sy = canvasRect.top + 150;
    // Word 1: 저는 (저 + 는)
    await dragMouseStroke(cdp, [{ x: sx + 8, y: sy + 14 }, { x: sx + 48, y: sy + 14 }]); // ㅈ top
    await dragMouseStroke(cdp, [{ x: sx + 32, y: sy + 20 }, { x: sx + 8, y: sy + 72 }]); // /
    await dragMouseStroke(cdp, [{ x: sx + 28, y: sy + 42 }, { x: sx + 50, y: sy + 72 }]); // \
    await dragMouseStroke(cdp, [{ x: sx + 56, y: sy + 44 }, { x: sx + 68, y: sy + 44 }]); // ㅓ tick
    await dragMouseStroke(cdp, [{ x: sx + 68, y: sy + 6 }, { x: sx + 68, y: sy + 84 }]); // |
    // 는 (ㄴ + ㅡ + ㄴ)
    await dragMouseStroke(cdp, [{ x: sx + 104, y: sy + 10 }, { x: sx + 104, y: sy + 42 }, { x: sx + 158, y: sy + 42 }]);
    await dragMouseStroke(cdp, [{ x: sx + 92, y: sy + 56 }, { x: sx + 170, y: sy + 56 }]);
    await dragMouseStroke(cdp, [{ x: sx + 104, y: sy + 64 }, { x: sx + 104, y: sy + 92 }, { x: sx + 162, y: sy + 92 }]);

    // Word 2: 한국어가 (한 + 국 + 어 + 가)
    const w2x = sx + 225;
    // 한
    await dragMouseStroke(cdp, [{ x: w2x + 14, y: sy + 6 }, { x: w2x + 36, y: sy + 6 }]);
    await dragMouseStroke(cdp, [{ x: w2x + 6, y: sy + 16 }, { x: w2x + 44, y: sy + 16 }]);
    await dragMouseStroke(
      cdp,
      Array.from({ length: 10 }, (_, k) => {
        const a = (k / 9) * Math.PI * 1.9;
        return { x: w2x + 25 + Math.cos(a) * 14, y: sy + 36 + Math.sin(a) * 14 };
      })
    );
    await dragMouseStroke(cdp, [{ x: w2x + 56, y: sy + 6 }, { x: w2x + 56, y: sy + 54 }]);
    await dragMouseStroke(cdp, [{ x: w2x + 56, y: sy + 30 }, { x: w2x + 70, y: sy + 30 }]);
    await dragMouseStroke(cdp, [{ x: w2x + 12, y: sy + 64 }, { x: w2x + 12, y: sy + 92 }, { x: w2x + 62, y: sy + 92 }]);
    // 국 (ㄱ + ㅜ + ㄱ)
    const gukx = w2x + 90;
    await dragMouseStroke(cdp, [{ x: gukx + 12, y: sy + 8 }, { x: gukx + 64, y: sy + 8 }, { x: gukx + 64, y: sy + 36 }]);
    await dragMouseStroke(cdp, [{ x: gukx + 4, y: sy + 44 }, { x: gukx + 72, y: sy + 44 }]);
    await dragMouseStroke(cdp, [{ x: gukx + 38, y: sy + 44 }, { x: gukx + 38, y: sy + 58 }]);
    await dragMouseStroke(cdp, [{ x: gukx + 14, y: sy + 66 }, { x: gukx + 66, y: sy + 66 }, { x: gukx + 66, y: sy + 94 }]);
    // 어
    const eox = gukx + 92;
    await dragMouseStroke(
      cdp,
      Array.from({ length: 10 }, (_, k) => {
        const a = (k / 9) * Math.PI * 1.9;
        return { x: eox + 22 + Math.cos(a) * 18, y: sy + 48 + Math.sin(a) * 28 };
      })
    );
    await dragMouseStroke(cdp, [{ x: eox + 42, y: sy + 48 }, { x: eox + 58, y: sy + 48 }]);
    await dragMouseStroke(cdp, [{ x: eox + 58, y: sy + 6 }, { x: eox + 58, y: sy + 90 }]);
    // 가
    const gax = eox + 82;
    await dragMouseStroke(cdp, [{ x: gax + 6, y: sy + 12 }, { x: gax + 42, y: sy + 12 }, { x: gax + 42, y: sy + 76 }]);
    await dragMouseStroke(cdp, [{ x: gax + 58, y: sy + 6 }, { x: gax + 58, y: sy + 90 }]);
    await dragMouseStroke(cdp, [{ x: gax + 58, y: sy + 48 }, { x: gax + 74, y: sy + 48 }]);

    // Word 3: 공부해요. (공 + 부 + 해 + 요 + .)
    const w3x = gax + 125;
    // 공
    await dragMouseStroke(cdp, [{ x: w3x + 10, y: sy + 6 }, { x: w3x + 56, y: sy + 6 }, { x: w3x + 56, y: sy + 32 }]);
    await dragMouseStroke(cdp, [{ x: w3x + 34, y: sy + 34 }, { x: w3x + 34, y: sy + 48 }]);
    await dragMouseStroke(cdp, [{ x: w3x + 4, y: sy + 48 }, { x: w3x + 64, y: sy + 48 }]);
    await dragMouseStroke(
      cdp,
      Array.from({ length: 10 }, (_, k) => {
        const a = (k / 9) * Math.PI * 1.9;
        return { x: w3x + 34 + Math.cos(a) * 18, y: sy + 76 + Math.sin(a) * 18 };
      })
    );
    // 부 (ㅂ + ㅜ)
    const bux = w3x + 86;
    await dragMouseStroke(cdp, [{ x: bux + 12, y: sy + 8 }, { x: bux + 12, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: bux + 56, y: sy + 8 }, { x: bux + 56, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: bux + 12, y: sy + 30 }, { x: bux + 56, y: sy + 30 }]);
    await dragMouseStroke(cdp, [{ x: bux + 12, y: sy + 52 }, { x: bux + 56, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: bux + 4, y: sy + 68 }, { x: bux + 66, y: sy + 68 }]);
    await dragMouseStroke(cdp, [{ x: bux + 35, y: sy + 68 }, { x: bux + 35, y: sy + 92 }]);
    // 해 (ㅎ + ㅏ + ㅣ)
    const haex = bux + 88;
    await dragMouseStroke(cdp, [{ x: haex + 12, y: sy + 6 }, { x: haex + 32, y: sy + 6 }]);
    await dragMouseStroke(cdp, [{ x: haex + 4, y: sy + 18 }, { x: haex + 40, y: sy + 18 }]);
    await dragMouseStroke(
      cdp,
      Array.from({ length: 10 }, (_, k) => {
        const a = (k / 9) * Math.PI * 1.9;
        return { x: haex + 22 + Math.cos(a) * 14, y: sy + 56 + Math.sin(a) * 20 };
      })
    );
    await dragMouseStroke(cdp, [{ x: haex + 50, y: sy + 6 }, { x: haex + 50, y: sy + 90 }]);
    await dragMouseStroke(cdp, [{ x: haex + 50, y: sy + 48 }, { x: haex + 66, y: sy + 48 }]);
    await dragMouseStroke(cdp, [{ x: haex + 66, y: sy + 6 }, { x: haex + 66, y: sy + 90 }]);
    // 요
    const yox = haex + 86;
    await dragMouseStroke(
      cdp,
      Array.from({ length: 10 }, (_, k) => {
        const a = (k / 9) * Math.PI * 1.9;
        return { x: yox + 34 + Math.cos(a) * 20, y: sy + 24 + Math.sin(a) * 18 };
      })
    );
    await dragMouseStroke(cdp, [{ x: yox + 22, y: sy + 54 }, { x: yox + 22, y: sy + 76 }]);
    await dragMouseStroke(cdp, [{ x: yox + 46, y: sy + 54 }, { x: yox + 46, y: sy + 76 }]);
    await dragMouseStroke(cdp, [{ x: yox + 4, y: sy + 76 }, { x: yox + 64, y: sy + 76 }]);
    await dragMouseStroke(cdp, [{ x: yox + 72, y: sy + 88 }, { x: yox + 76, y: sy + 88 }]); // .

    await new Promise((r) => setTimeout(r, 1500));
    const unseenErrState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const unseenErrAnns = unseenErrState.board.annotations.filter((a) => a.status === 'active' && a.severity === 'error');
    assert.equal(
      unseenErrAnns.length,
      1,
      `Expected 1 precise error annotation on 한국어가, got ${unseenErrAnns.length}. Strokes=${unseenErrState.board.strokes.length}, Regions=${JSON.stringify(
        unseenErrState.board.regions.map((r) => ({ text: r.recognizedText, status: r.recognitionStatus, p: r.providerId, spans: r.spans.length }))
      )}, Diag=${JSON.stringify(unseenErrState.diagnostics)}`
    );
    assert.equal(unseenErrAnns[0].target_text, '한국어가');
    assert.equal(unseenErrAnns[0].suggested_correction, '한국어를');
    await snap(cdp, 'freehand_unseen_error_pinpointed.png');

    // MULTI-ZOOM VISUAL CHECK (45%, 75%, 100%, 150%, 200%)
    for (const z of [0.45, 0.75, 1.0, 1.5, 2.0]) {
      await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setZoomScale(${z})`);
      await new Promise((r) => setTimeout(r, 120));
      const metrics = await evalJs(
        cdp,
        `(() => {
          const path = document.querySelector('[data-testid^="cloud-path-"]');
          const corr = document.querySelector('[data-testid^="chalk-corr-"]');
          return {
            strokeWidth: path ? Number(path.getAttribute('stroke-width')) : 0,
            fontSize: corr ? Number(corr.getAttribute('font-size')) : 0,
          };
        })()`
      );
      assert.ok(metrics.strokeWidth >= 2.5, `Zoom ${z}: cloud strokeWidth too thin (${metrics.strokeWidth})`);
      assert.ok(metrics.fontSize >= 20, `Zoom ${z}: header fontSize too small (${metrics.fontSize})`);
      if (z === 0.45) await snap(cdp, 'zoom_45_percent_check.png');
      if (z === 1.5) await snap(cdp, 'zoom_150_percent_check.png');
    }

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'session-trace.json'),
      JSON.stringify({ capturedAt: new Date().toISOString(), trace }, null, 2)
    );
    console.log('ALL V3 CONTINUOUS SESSIONS A-G PASSED & SAVED.');
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
    staticSrv.close();
    gatewaySrv.close();
    try {
      execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', tmpDir], { stdio: 'ignore' });
    } catch {
      // best-effort temp cleanup
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
