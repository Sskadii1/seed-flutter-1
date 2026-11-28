import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'apps', 'mobile', 'dist-web');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-hierarchy');
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
  fs.writeFileSync(path.join(EVIDENCE_DIR, filename), Buffer.from(data, 'base64'));
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
    await new Promise((r) => setTimeout(r, 10));
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-hier-'));
  const cdpPort = 9336;
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

    await new Promise((r) => setTimeout(r, 1400));
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

    const canvasRect = await evalJs(
      cdp,
      `(() => {
        const c = document.querySelector('[data-testid="wonder-canvas"]');
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()`
    );
    assert.ok(canvasRect.width > 500);

    // -------------------------------------------------------------------------
    // H1: Progressive T1..T4 (사 -> 사랑 -> 사랑해 -> 사랑해요) with Child Retraction
    // -------------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('사', 'tutor', 120, 180);
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 500));

    const t1 = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const t1Tree = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getSemanticTree()`);
    const t1Active = t1.board.annotations.filter((a) => a.status === 'active');
    assert.equal(t1Active.length, 1, 'T1: isolated "사" should produce 1 CHARACTER cloud');
    assert.equal(t1Active[0].target_text, '사');
    assert.equal(t1Active[0].granularity, 'CHARACTER');
    assert.ok(t1Tree && t1Tree.nodes.length >= 2, 'T1: semanticTree populated');
    await snap(cdp, 't1_sa.png');
    trace.push({
      step: 'T1_sa',
      activeTexts: t1Active.map((a) => a.target_text),
      granularities: t1Active.map((a) => a.granularity),
      nodeCount: t1Tree.nodes.length,
    });

    for (const [stageName, stageText] of [
      ['T2_sarang', '사랑'],
      ['T3_saranghae', '사랑해'],
      ['T4_saranghaeyo', '사랑해요'],
    ]) {
      await evalJs(cdp, `window.__WONDER_BOARD_TEST__.editFirstRegionStrokes(${JSON.stringify(stageText)});`);
      await new Promise((r) => setTimeout(r, 550));
      const st = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
      const tree = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getSemanticTree()`);
      const active = st.board.annotations.filter((a) => a.status === 'active');
      assert.ok(
        !active.some((a) => a.target_text === '사' && a.severity === 'info'),
        `${stageName}: child cloud "사" must NOT remain active`
      );
      assert.ok(
        tree?.nodes?.some((n) => n.normalizedCandidateText === stageText),
        `${stageName}: semanticTree must include node "${stageText}"`
      );
      trace.push({
        step: stageName,
        activeTexts: active.map((a) => a.target_text),
        staleCount: st.board.annotations.filter((a) => a.status !== 'active').length,
        treeTexts: tree.nodes.filter((n) => n.level === 'sentence').map((n) => n.normalizedCandidateText),
      });
    }
    await snap(cdp, 't4_saranghaeyo.png');

    // -------------------------------------------------------------------------
    // H2: Real Freehand Progressive Multi-Word Sentence ("저는 한국어가 공부해요.")
    // -------------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));

    const sx = canvasRect.left + 60;
    const sy = canvasRect.top + 150;
    // Word 1: 저는
    await dragMouseStroke(cdp, [{ x: sx + 8, y: sy + 14 }, { x: sx + 48, y: sy + 14 }]);
    await dragMouseStroke(cdp, [{ x: sx + 32, y: sy + 20 }, { x: sx + 8, y: sy + 72 }]);
    await dragMouseStroke(cdp, [{ x: sx + 28, y: sy + 42 }, { x: sx + 50, y: sy + 72 }]);
    await dragMouseStroke(cdp, [{ x: sx + 56, y: sy + 44 }, { x: sx + 68, y: sy + 44 }]);
    await dragMouseStroke(cdp, [{ x: sx + 68, y: sy + 6 }, { x: sx + 68, y: sy + 84 }]);
    await dragMouseStroke(cdp, [{ x: sx + 104, y: sy + 10 }, { x: sx + 104, y: sy + 42 }, { x: sx + 158, y: sy + 42 }]);
    await dragMouseStroke(cdp, [{ x: sx + 92, y: sy + 56 }, { x: sx + 170, y: sy + 56 }]);
    await dragMouseStroke(cdp, [{ x: sx + 104, y: sy + 64 }, { x: sx + 104, y: sy + 92 }, { x: sx + 162, y: sy + 92 }]);

    // Word 2: 한국어가
    const w2x = sx + 225;
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

    const gukx = w2x + 90;
    await dragMouseStroke(cdp, [{ x: gukx + 12, y: sy + 8 }, { x: gukx + 64, y: sy + 8 }, { x: gukx + 64, y: sy + 36 }]);
    await dragMouseStroke(cdp, [{ x: gukx + 4, y: sy + 44 }, { x: gukx + 72, y: sy + 44 }]);
    await dragMouseStroke(cdp, [{ x: gukx + 38, y: sy + 44 }, { x: gukx + 38, y: sy + 58 }]);
    await dragMouseStroke(cdp, [{ x: gukx + 14, y: sy + 66 }, { x: gukx + 66, y: sy + 66 }, { x: gukx + 66, y: sy + 94 }]);

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

    const gax = eox + 82;
    await dragMouseStroke(cdp, [{ x: gax + 6, y: sy + 12 }, { x: gax + 42, y: sy + 12 }, { x: gax + 42, y: sy + 76 }]);
    await dragMouseStroke(cdp, [{ x: gax + 58, y: sy + 6 }, { x: gax + 58, y: sy + 90 }]);
    await dragMouseStroke(cdp, [{ x: gax + 58, y: sy + 48 }, { x: gax + 74, y: sy + 48 }]);

    // Word 3: 공부해요.
    const w3x = gax + 125;
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
    const bux = w3x + 86;
    await dragMouseStroke(cdp, [{ x: bux + 12, y: sy + 8 }, { x: bux + 12, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: bux + 56, y: sy + 8 }, { x: bux + 56, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: bux + 12, y: sy + 30 }, { x: bux + 56, y: sy + 30 }]);
    await dragMouseStroke(cdp, [{ x: bux + 12, y: sy + 52 }, { x: bux + 56, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: bux + 4, y: sy + 68 }, { x: bux + 66, y: sy + 68 }]);
    await dragMouseStroke(cdp, [{ x: bux + 35, y: sy + 68 }, { x: bux + 35, y: sy + 92 }]);
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
    await dragMouseStroke(cdp, [{ x: yox + 72, y: sy + 88 }, { x: yox + 76, y: sy + 88 }]);

    await new Promise((r) => setTimeout(r, 1700));
    const fhState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const fhTree = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getSemanticTree()`);
    const fhActive = fhState.board.annotations.filter((a) => a.status === 'active');
    assert.equal(fhActive.length, 1, 'Freehand sentence must emit ONLY 1 targeted error cloud');
    assert.equal(fhActive[0].target_text, '한국어가');
    assert.equal(fhActive[0].granularity, 'SENTENCE');
    assert.ok(fhTree.nodes.some((n) => n.level === 'paragraph'));
    await snap(cdp, 'freehand_progressive_sentence.png');
    trace.push({
      step: 'H2_freehand_sentence',
      activeCount: fhActive.length,
      target: fhActive[0].target_text,
      granularity: fhActive[0].granularity,
    });

    // -------------------------------------------------------------------------
    // H3: Case C Excessive Character Spacing ("저 는 한 국 어 를 공 부 해 요.")
    // -------------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저 는 한 국 어 를 공 부 해 요.', 'tutor', 70, 160);
      })()`
    );
    await new Promise((r) => setTimeout(r, 450));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 450));

    const caseCState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const caseCTree = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getSemanticTree()`);
    const caseCActive = caseCState.board.annotations.filter((a) => a.status === 'active');
    const caseCCharSpam = caseCActive.filter((a) => a.target_text.length === 1 && a.severity === 'info');
    assert.equal(caseCCharSpam.length, 0, 'Case C sentence must have ZERO per-syllable clouds');
    assert.ok(
      caseCTree.nodes.some((n) => n.normalizedCandidateText === '저는 한국어를 공부해요.'),
      `Case C semanticTree expected decoded sentence, got ${JSON.stringify(
        caseCTree.nodes.filter((n) => n.level === 'sentence').map((n) => n.normalizedCandidateText)
      )}`
    );
    await snap(cdp, 'case_c_sentence.png');
    trace.push({
      step: 'H3_case_c',
      activeCount: caseCActive.length,
      perCharSpam: caseCCharSpam.length,
      decoded: caseCTree.nodes.find((n) => n.level === 'sentence')?.normalizedCandidateText,
    });

    // -------------------------------------------------------------------------
    // H4: Targeted Multi-Error Sentence ("저는 어제 학교에서 사과가 먹어요.")
    // -------------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에서 사과가 먹어요.', 'tutor', 80, 180);
      })()`
    );
    await new Promise((r) => setTimeout(r, 450));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 450));

    const targetedState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const targetedErrors = targetedState.board.annotations.filter(
      (a) => a.status === 'active' && a.severity === 'error'
    );
    assert.equal(targetedErrors.length, 2, 'Expected exact 2 targeted errors (사과가, 먹어요)');
    assert.ok(targetedErrors.every((a) => a.granularity === 'SENTENCE'));
    await snap(cdp, 'targeted_errors.png');
    trace.push({
      step: 'H4_targeted_errors',
      errors: targetedErrors.map((a) => `${a.target_text}->${a.suggested_correction}`),
    });

    // -------------------------------------------------------------------------
    // H5: Zoom Invariance Check (25%, 45%, 100%, 200%)
    // -------------------------------------------------------------------------
    for (const z of [0.25, 0.45, 1.0, 2.0]) {
      await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setZoomScale(${z})`);
      await new Promise((r) => setTimeout(r, 150));
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
      assert.ok(metrics.strokeWidth >= 2.2, `Zoom ${z}: cloud strokeWidth too thin (${metrics.strokeWidth})`);
      assert.ok(metrics.fontSize >= 18, `Zoom ${z}: correction fontSize too small (${metrics.fontSize})`);
      if (z === 0.25) await snap(cdp, 'zoom_25_percent.png');
      if (z === 2.0) await snap(cdp, 'zoom_200_percent.png');
    }

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'hierarchy-trace.json'),
      JSON.stringify({ capturedAt: new Date().toISOString(), trace }, null, 2)
    );
    console.log('ALL HIERARCHICAL WONDER BOARD BROWSER CHECKS PASSED.');
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
    staticSrv.close();
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
