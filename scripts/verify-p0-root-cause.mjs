import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recognizeHandwritingRegions,
  recognizeWithHybridPipeline,
} from '../packages/learning-engine/src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-p0');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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

function ovalArcPts(cx, cy, rx, ry, startAngle = -Math.PI * 0.35, endAngle = Math.PI * 1.4, steps = 12) {
  return Array.from({ length: steps }, (_, i) => {
    const a = startAngle + (i / (steps - 1)) * (endAngle - startAngle);
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
}

async function drawFreehandSentenceWithError(cdp, sx, sy) {
  // 저는
  await dragMouseStroke(cdp, [{ x: sx + 8, y: sy + 14 }, { x: sx + 48, y: sy + 14 }]);
  await dragMouseStroke(cdp, [{ x: sx + 32, y: sy + 20 }, { x: sx + 8, y: sy + 72 }]);
  await dragMouseStroke(cdp, [{ x: sx + 28, y: sy + 42 }, { x: sx + 50, y: sy + 72 }]);
  await dragMouseStroke(cdp, [{ x: sx + 56, y: sy + 44 }, { x: sx + 68, y: sy + 44 }]);
  await dragMouseStroke(cdp, [{ x: sx + 68, y: sy + 6 }, { x: sx + 68, y: sy + 84 }]);
  await dragMouseStroke(cdp, [{ x: sx + 104, y: sy + 10 }, { x: sx + 104, y: sy + 42 }, { x: sx + 158, y: sy + 42 }]);
  await dragMouseStroke(cdp, [{ x: sx + 92, y: sy + 56 }, { x: sx + 170, y: sy + 56 }]);
  await dragMouseStroke(cdp, [{ x: sx + 104, y: sy + 64 }, { x: sx + 104, y: sy + 92 }, { x: sx + 162, y: sy + 92 }]);

  // 한국어가
  const w2x = sx + 225;
  await dragMouseStroke(cdp, [{ x: w2x + 14, y: sy + 6 }, { x: w2x + 36, y: sy + 6 }]);
  await dragMouseStroke(cdp, [{ x: w2x + 6, y: sy + 16 }, { x: w2x + 44, y: sy + 16 }]);
  await dragMouseStroke(cdp, ovalArcPts(w2x + 25, sy + 36, 14, 14, 0, Math.PI * 1.85, 10));
  await dragMouseStroke(cdp, [{ x: w2x + 56, y: sy + 6 }, { x: w2x + 56, y: sy + 54 }]);
  await dragMouseStroke(cdp, [{ x: w2x + 56, y: sy + 30 }, { x: w2x + 70, y: sy + 30 }]);
  await dragMouseStroke(cdp, [{ x: w2x + 12, y: sy + 64 }, { x: w2x + 12, y: sy + 92 }, { x: w2x + 62, y: sy + 92 }]);

  const gukx = w2x + 90;
  await dragMouseStroke(cdp, [{ x: gukx + 12, y: sy + 8 }, { x: gukx + 64, y: sy + 8 }, { x: gukx + 64, y: sy + 36 }]);
  await dragMouseStroke(cdp, [{ x: gukx + 4, y: sy + 44 }, { x: gukx + 72, y: sy + 44 }]);
  await dragMouseStroke(cdp, [{ x: gukx + 38, y: sy + 44 }, { x: gukx + 38, y: sy + 58 }]);
  await dragMouseStroke(cdp, [{ x: gukx + 14, y: sy + 66 }, { x: gukx + 66, y: sy + 66 }, { x: gukx + 66, y: sy + 94 }]);

  const eox = gukx + 92;
  await dragMouseStroke(cdp, ovalArcPts(eox + 22, sy + 48, 18, 28, 0, Math.PI * 1.85, 10));
  await dragMouseStroke(cdp, [{ x: eox + 42, y: sy + 48 }, { x: eox + 58, y: sy + 48 }]);
  await dragMouseStroke(cdp, [{ x: eox + 58, y: sy + 6 }, { x: eox + 58, y: sy + 90 }]);

  const gax = eox + 82;
  await dragMouseStroke(cdp, [{ x: gax + 6, y: sy + 12 }, { x: gax + 42, y: sy + 12 }, { x: gax + 42, y: sy + 76 }]);
  await dragMouseStroke(cdp, [{ x: gax + 58, y: sy + 6 }, { x: gax + 58, y: sy + 90 }]);
  await dragMouseStroke(cdp, [{ x: gax + 58, y: sy + 48 }, { x: gax + 74, y: sy + 48 }]);

  // 공부해요.
  const w3x = gax + 125;
  await dragMouseStroke(cdp, [{ x: w3x + 10, y: sy + 6 }, { x: w3x + 56, y: sy + 6 }, { x: w3x + 56, y: sy + 32 }]);
  await dragMouseStroke(cdp, [{ x: w3x + 34, y: sy + 34 }, { x: w3x + 34, y: sy + 48 }]);
  await dragMouseStroke(cdp, [{ x: w3x + 4, y: sy + 48 }, { x: w3x + 64, y: sy + 48 }]);
  await dragMouseStroke(cdp, ovalArcPts(w3x + 34, sy + 76, 18, 18, 0, Math.PI * 1.85, 10));

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
  await dragMouseStroke(cdp, ovalArcPts(haex + 22, sy + 56, 14, 20, 0, Math.PI * 1.85, 10));
  await dragMouseStroke(cdp, [{ x: haex + 50, y: sy + 6 }, { x: haex + 50, y: sy + 90 }]);
  await dragMouseStroke(cdp, [{ x: haex + 50, y: sy + 48 }, { x: haex + 66, y: sy + 48 }]);
  await dragMouseStroke(cdp, [{ x: haex + 66, y: sy + 6 }, { x: haex + 66, y: sy + 90 }]);

  const yox = haex + 86;
  await dragMouseStroke(cdp, ovalArcPts(yox + 34, sy + 24, 20, 18, 0, Math.PI * 1.85, 10));
  await dragMouseStroke(cdp, [{ x: yox + 22, y: sy + 54 }, { x: yox + 22, y: sy + 76 }]);
  await dragMouseStroke(cdp, [{ x: yox + 46, y: sy + 54 }, { x: yox + 46, y: sy + 76 }]);
  await dragMouseStroke(cdp, [{ x: yox + 4, y: sy + 76 }, { x: yox + 64, y: sy + 76 }]);
  await dragMouseStroke(cdp, [{ x: yox + 72, y: sy + 88 }, { x: yox + 76, y: sy + 88 }]);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const baseUrl = 'http://127.0.0.1:4173';
  const health = await fetch(`${baseUrl}/api/wonder/health`).then((r) => r.json());
  assert.equal(health.ok, true, 'localhost:4173 local fullstack server must be up');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-p0-'));
  const cdpPort = 9339;
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${tmpDir}`,
      '--window-size=1280,820',
      baseUrl,
    ],
    { stdio: 'ignore' }
  );

  const report = {
    capturedAt: new Date().toISOString(),
    serverHealth: health,
    providerComparison: [],
    reproScreenshots3And4: {},
    partialRestraint: {},
    toolbarCollisionChecks: [],
    continuousSession: [],
  };

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
    await cdp.send('Network.enable');

    const networkLog = [];
    cdp.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Network.responseReceived') {
        const url = msg.params?.response?.url || '';
        if (url.includes('/api/wonder/')) {
          networkLog.push({
            url,
            status: msg.params.response.status,
            mime: msg.params.response.mimeType,
          });
        }
      }
    });

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
    await new Promise((r) => setTimeout(r, 700));

    const canvasRect = await evalJs(
      cdp,
      `(() => {
        const c = document.querySelector('[data-testid="wonder-canvas"]');
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()`
    );

    // -----------------------------------------------------------------------
    // 1. Repro Screenshot 3 (25% zoom: open-top human oval 아 + 어) & Screenshot 4 (34%: 사 + 아)
    // -----------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.setZoomScale(0.25);
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));

    // Left large open-top oval '아' (matching Screenshot 3 top-left!)
    const lx = canvasRect.left + 210;
    const ly = canvasRect.top + 130;
    await dragMouseStroke(cdp, ovalArcPts(lx + 18, ly + 42, 16, 36, -Math.PI * 0.28, Math.PI * 1.48, 12));
    await dragMouseStroke(cdp, [{ x: lx + 44, y: ly + 4 }, { x: lx + 44, y: ly + 88 }]);
    await dragMouseStroke(cdp, [{ x: lx + 44, y: ly + 42 }, { x: lx + 58, y: ly + 42 }]);

    // Right '어' (clearly spaced ㅇ + left-pointing tick + vertical ㅣ)
    const rx = canvasRect.left + 490;
    const ry = canvasRect.top + 180;
    await dragMouseStroke(cdp, ovalArcPts(rx + 18, ry + 42, 16, 28, -Math.PI * 0.25, Math.PI * 1.5, 12));
    await dragMouseStroke(cdp, [{ x: rx + 44, y: ry + 42 }, { x: rx + 62, y: ry + 42 }]);
    await dragMouseStroke(cdp, [{ x: rx + 62, y: ry + 6 }, { x: rx + 62, y: ry + 84 }]);

    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    let repro3State = null;
    let repro3Texts = [];
    for (let w = 0; w < 40; w++) {
      await new Promise((r) => setTimeout(r, 200));
      repro3State = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
      repro3Texts = repro3State.board.regions.map((r) => r.recognizedText);
      if (repro3Texts.includes('아') && repro3Texts.includes('어')) break;
    }
    assert.ok(repro3Texts.includes('아'), `Screenshot 3 open-oval 아 failed, got ${JSON.stringify(repro3Texts)}`);
    assert.ok(repro3Texts.includes('어'), `Screenshot 3 어 failed, got ${JSON.stringify(repro3Texts)}`);
    await snap(cdp, 'repro_screenshot3_25pct_fixed.png');

    // Screenshot 4 repro at 34%: '사' (completes & stays static) -> then add independent '아' (ONLY '아' animates, '사' never reloads!)
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('fast');
        window.__WONDER_BOARD_TEST__.setZoomScale(0.34);
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));
    const sx4 = canvasRect.left + 260;
    const sy4 = canvasRect.top + 170;
    await dragMouseStroke(cdp, [{ x: sx4 + 28, y: sy4 + 14 }, { x: sx4 + 6, y: sy4 + 64 }]);
    await dragMouseStroke(cdp, [{ x: sx4 + 24, y: sy4 + 36 }, { x: sx4 + 42, y: sy4 + 64 }]);
    await dragMouseStroke(cdp, [{ x: sx4 + 54, y: sy4 + 8 }, { x: sx4 + 54, y: sy4 + 84 }]);
    await dragMouseStroke(cdp, [{ x: sx4 + 54, y: sy4 + 44 }, { x: sx4 + 70, y: sy4 + 44 }]);

    let saBeforeState = null;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 200));
      saBeforeState = await evalJs(
        cdp,
        `(() => {
          const st = window.__WONDER_BOARD_TEST__.getState();
          const ann = st.board.annotations.find(a => a.status === 'active' && a.target_text === '사');
          const gEl = ann ? document.querySelector('[data-testid="ann-' + ann.annotation_id + '"]') : null;
          return {
            ann,
            domAnimCloud: gEl ? gEl.getAttribute('data-anim-cloud') : null,
          };
        })()`
      );
      if (saBeforeState.ann?.animation_progress?.completed && saBeforeState.domAnimCloud === '1.00') break;
    }
    assert.ok(saBeforeState?.ann, '사 cloud must exist after writing 사 independently');
    assert.equal(saBeforeState.ann.animation_progress?.completed, true, '사 cloud animation must finish before writing 아');

    const ax4 = sx4 + 175;
    await dragMouseStroke(cdp, ovalArcPts(ax4 + 18, sy4 + 42, 16, 36, -Math.PI * 0.25, Math.PI * 1.48, 12));
    await dragMouseStroke(cdp, [{ x: ax4 + 46, y: sy4 + 6 }, { x: ax4 + 46, y: sy4 + 88 }]);
    await dragMouseStroke(cdp, [{ x: ax4 + 46, y: sy4 + 44 }, { x: ax4 + 60, y: sy4 + 44 }]);

    let repro4Check = null;
    let saCloudEverReset = false;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 200));
      repro4Check = await evalJs(
        cdp,
        `(() => {
          const st = window.__WONDER_BOARD_TEST__.getState();
          const active = st.board.annotations.filter(a => a.status === 'active');
          const saAnn = active.find(a => a.target_text === '사');
          const aAnn = active.find(a => a.target_text === '아');
          const saDom = saAnn ? document.querySelector('[data-testid="ann-' + saAnn.annotation_id + '"]') : null;
          return {
            regions: st.board.regions.map(r => r.recognizedText),
            activeTexts: active.map(a => a.target_text),
            saAnn,
            aAnn,
            saDomAnimCloud: saDom ? saDom.getAttribute('data-anim-cloud') : null,
          };
        })()`
      );
      if (!repro4Check.saAnn || repro4Check.saDomAnimCloud !== '1.00' || !repro4Check.saAnn.animation_progress?.completed) {
        saCloudEverReset = true;
      }
      if (repro4Check.aAnn?.animation_progress?.completed) break;
    }
    assert.equal(saCloudEverReset, false, 'Completed cloud on 사 must NEVER reset/reload at any frame while writing 아');
    const repro4Texts = repro4Check.regions;
    const repro4Joined = repro4Texts.join(' ');
    assert.ok(repro4Joined.includes('사') && repro4Joined.includes('아'), `Screenshot 4 사+아 failed, got ${JSON.stringify(repro4Texts)}`);
    assert.ok(repro4Check.saAnn && repro4Check.aAnn, `Expected active clouds for both 사 and 아, got ${JSON.stringify(repro4Check.activeTexts)}`);
    assert.equal(
      repro4Check.saAnn.annotation_id,
      saBeforeState.ann.annotation_id,
      'Completed cloud on 사 must preserve exact annotation_id when adding 아 next to it'
    );
    assert.equal(
      repro4Check.saAnn.animation_progress?.completed,
      true,
      'Completed cloud on 사 must remain completed (NOT reloaded/re-animated)'
    );
    assert.equal(repro4Check.saDomAnimCloud, '1.00', 'DOM cloud progress for 사 must stay 1.00');
    await snap(cdp, 'repro_screenshot4_34pct_fixed.png');
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');`);
    report.reproScreenshots3And4 = {
      repro3Texts,
      repro4Texts,
      independentCloudPreserved: {
        saAnnIdBefore: saBeforeState.ann.annotation_id,
        saAnnIdAfter: repro4Check.saAnn.annotation_id,
        saCompletedAfter: repro4Check.saAnn.animation_progress?.completed,
        activeClouds: repro4Check.activeTexts,
      },
    };

    // -----------------------------------------------------------------------
    // 2. Direct Provider Comparison (A: Local, B: Live /api/wonder/recognize, C: Hybrid)
    // -----------------------------------------------------------------------
    const freehandStrokesSample = JSON.parse(
      JSON.stringify(repro3State.board.strokes)
    );
    const localRegs = recognizeHandwritingRegions(freehandStrokesSample, 'cmp_1', 1);
    const cropRes = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.renderCropPreview()`);
    const liveVisionResp = await fetch(`${baseUrl}/api/wonder/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId: 'cmp_1',
        regionId: 'r_cmp',
        revision: 1,
        imageDataUrl: cropRes?.imageDataUrl || 'data:image/png;base64,iVBORw0KGgo=',
      }),
    });
    const liveVisionJson = await liveVisionResp.json();
    const hybridRes = await recognizeWithHybridPipeline({
      strokes: freehandStrokesSample,
      boardId: 'cmp_1',
      revision: 1,
    });
    report.providerComparison.push(
      {
        sample: 'open-oval 아 + 어 (25% zoom freehand strokes)',
        A_local: localRegs.map((r) => ({ text: r.recognizedText, status: r.recognitionStatus, provider: r.providerId })),
        B_liveVision: { httpStatus: liveVisionResp.status, body: liveVisionJson },
        C_hybrid: hybridRes.regions.map((r) => ({ text: r.recognizedText, status: r.recognitionStatus, provider: r.providerId })),
      }
    );

    // Sample 2: Arbitrary cursive/messy unrepresented freehand strokes (must honestly report AMBIGUOUS / 503 BLOCKED!)
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setZoomScale(0.25);
      })()`
    );
    await new Promise((r) => setTimeout(r, 150));
    const mx = canvasRect.left + 120;
    const my = canvasRect.top + 170;
    // Messy connected freehand cursive strokes simulating rapid human handwriting
    await dragMouseStroke(cdp, [{ x: mx, y: my }, { x: mx + 18, y: my + 55 }, { x: mx + 52, y: my + 12 }, { x: mx + 68, y: my + 58 }]);
    await dragMouseStroke(cdp, [{ x: mx + 95, y: my + 10 }, { x: mx + 135, y: my + 24 }, { x: mx + 105, y: my + 54 }, { x: mx + 148, y: my + 56 }]);
    await new Promise((r) => setTimeout(r, 1400));
    const messyState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const messyCrop = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.renderCropPreview()`);
    const liveMessyResp = await fetch(`${baseUrl}/api/wonder/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: messyCrop.imageDataUrl }),
    });
    const liveMessyJson = await liveMessyResp.json();
    // Ensure NO auto-popped manual typing box ("Chưa đọc rõ nét vẽ tay") appears!
    const hasManualNag = await evalJs(
      cdp,
      `Boolean(Array.from(document.querySelectorAll('input')).find(el => (el.placeholder || '').includes('Chưa đọc rõ nét vẽ tay')))`
    );
    assert.equal(hasManualNag, false, 'Intrusive manual typing prompt must NEVER auto-popup');
    assert.equal(
      messyState.board.annotations.filter((a) => a.status === 'active').length,
      0,
      'Unrecognized ink must produce ZERO fake clouds'
    );
    report.providerComparison.push({
      sample: 'messy connected cursive freehand',
      A_local: messyState.board.regions.map((r) => ({ text: r.recognizedText, status: r.recognitionStatus })),
      B_liveVision: { httpStatus: liveMessyResp.status, crop: `${messyCrop.cropTransform.pixelWidth}x${messyCrop.cropTransform.pixelHeight}`, body: liveMessyJson },
      manualNagShown: hasManualNag,
    });

    // -----------------------------------------------------------------------
    // 3. Partial Recognition Restraint (known syllable next to unreadable scribble)
    // -----------------------------------------------------------------------
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard(); window.__WONDER_BOARD_TEST__.setZoomScale(1.0);`);
    await new Promise((r) => setTimeout(r, 150));
    const px = canvasRect.left + 120;
    const py = canvasRect.top + 180;
    // Valid '사'
    await dragMouseStroke(cdp, [{ x: px + 28, y: py + 10 }, { x: px + 6, y: py + 64 }]);
    await dragMouseStroke(cdp, [{ x: px + 24, y: py + 34 }, { x: px + 44, y: py + 64 }]);
    await dragMouseStroke(cdp, [{ x: px + 56, y: py + 6 }, { x: px + 56, y: py + 82 }]);
    await dragMouseStroke(cdp, [{ x: px + 56, y: py + 42 }, { x: px + 72, y: py + 42 }]);
    // Nearby illegible zigzag cluster
    await dragMouseStroke(cdp, [
      { x: px + 145, y: py + 12 },
      { x: px + 190, y: py + 58 },
      { x: px + 150, y: py + 72 },
      { x: px + 205, y: py + 24 },
      { x: px + 175, y: py + 80 },
    ]);
    await new Promise((r) => setTimeout(r, 1400));
    const partState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const partActiveAnns = partState.board.annotations.filter((a) => a.status === 'active');
    assert.equal(
      partActiveAnns.length,
      0,
      'Must NOT prematurely teach on "사" while adjacent illegible ink sits next to it'
    );
    report.partialRestraint = {
      regions: partState.board.regions.map((r) => ({ text: r.recognizedText, status: r.recognitionStatus })),
      activeAnnotations: partActiveAnns.length,
    };

    // -----------------------------------------------------------------------
    // 4. Viewport & Floating Toolbar Collision Check at 200% Zoom (Zero Auto-Pan!)
    // -----------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.setViewport(2.0, 0, 0);
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에서 사과가 먹어요.', 'tutor', 30, 140);
      })()`
    );
    await new Promise((r) => setTimeout(r, 400));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 500));

    const layoutCheck = await evalJs(
      cdp,
      `(() => {
        const st = window.__WONDER_BOARD_TEST__.getState();
        const cRect = document.querySelector('[data-testid="wonder-canvas"]').getBoundingClientRect();
        const phanBtn = Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Phấn');
        let dockEl = phanBtn;
        while (dockEl && dockEl.parentElement) {
          const r = dockEl.getBoundingClientRect();
          if (r.width > 420 && r.height >= 36 && r.height < 140) break;
          dockEl = dockEl.parentElement;
        }
        const dockRect = dockEl ? dockEl.getBoundingClientRect() : null;
        const textEls = Array.from(document.querySelectorAll('[data-testid^="chalk-corr-"], [data-testid^="chalk-expl-"]'));
        const activeTextGroups = Array.from(document.querySelectorAll('[data-testid^="ann-"] text'));
        const strokeScreenBoxes = st.board.strokes.filter(s => !s.deleted).map(s => ({
          left: cRect.left + st.viewport.offsetX + s.bbox.minX * st.viewport.scale,
          right: cRect.left + st.viewport.offsetX + s.bbox.maxX * st.viewport.scale,
          top: cRect.top + st.viewport.offsetY + s.bbox.minY * st.viewport.scale,
          bottom: cRect.top + st.viewport.offsetY + s.bbox.maxY * st.viewport.scale,
        }));
        const overlaps = [];
        const strokeOverlaps = [];
        const boxes = textEls.map(el => {
          const r = el.getBoundingClientRect();
          const hitsDock = dockRect ? !(r.right < dockRect.left + 4 || r.left > dockRect.right - 4 || r.bottom < dockRect.top - 4 || r.top > dockRect.bottom + 4) : false;
          const offBottom = r.bottom > window.innerHeight - 4;
          const offTop = r.top < 54;
          if (hitsDock || offBottom || offTop) overlaps.push({ testid: el.getAttribute('data-testid'), r: { top: r.top, bottom: r.bottom }, hitsDock, offBottom, offTop });
          return { testid: el.getAttribute('data-testid'), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
        });
        for (const tEl of activeTextGroups) {
          const r = tEl.getBoundingClientRect();
          for (const sb of strokeScreenBoxes) {
            if (!(r.right <= sb.left || r.left >= sb.right || r.bottom <= sb.top || r.top >= sb.bottom)) {
              strokeOverlaps.push({ text: tEl.textContent, textBox: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }, strokeBox: { left: Math.round(sb.left), top: Math.round(sb.top), right: Math.round(sb.right), bottom: Math.round(sb.bottom) } });
            }
          }
        }
        return { viewport: st.viewport, dockRect: dockRect ? { top: dockRect.top, bottom: dockRect.bottom, left: dockRect.left, right: dockRect.right } : null, boxes, overlaps, strokeOverlaps };
      })()`
    );
    assert.equal(layoutCheck.viewport.scale, 2.0, 'Must NOT auto-zoom');
    assert.equal(layoutCheck.viewport.offsetX, 0, 'Must NOT auto-pan X');
    assert.equal(layoutCheck.viewport.offsetY, 0, 'Must NOT auto-pan Y');
    assert.equal(
      layoutCheck.overlaps.length,
      0,
      `Explanation/correction overlapped toolbar or viewport: ${JSON.stringify(layoutCheck)}`
    );
    assert.equal(
      layoutCheck.strokeOverlaps.length,
      0,
      `Explanation/correction overlapped user ink strokes at 200% zoom: ${JSON.stringify(layoutCheck.strokeOverlaps)}`
    );
    await snap(cdp, 'layout_zoom_200_no_toolbar_overlap.png');
    report.toolbarCollisionChecks.push(layoutCheck);

    // -----------------------------------------------------------------------
    // 5. Continuous 8-Step Real Interactive Session Without Reload (Section 7)
    // -----------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.setViewport(0.9, 0, 0);
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));

    // Step 1: Write single syllable '사' with real mouse strokes
    const cSx = canvasRect.left + 80;
    const cSy = canvasRect.top + 80;
    await dragMouseStroke(cdp, [{ x: cSx + 26, y: cSy + 10 }, { x: cSx + 6, y: cSy + 60 }]);
    await dragMouseStroke(cdp, [{ x: cSx + 24, y: cSy + 34 }, { x: cSx + 42, y: cSy + 60 }]);
    await dragMouseStroke(cdp, [{ x: cSx + 54, y: cSy + 6 }, { x: cSx + 54, y: cSy + 78 }]);
    await dragMouseStroke(cdp, [{ x: cSx + 54, y: cSy + 40 }, { x: cSx + 68, y: cSy + 40 }]);
    let step1 = null;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      step1 = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
      if (step1.board.regions.length > 0 && step1.board.regions[0].recognizedText) break;
    }
    assert.ok(step1?.board.regions[0], `Expected step1 region to appear, got ${JSON.stringify(step1?.board.regions)}`);
    assert.equal(step1.board.regions[0].recognizedText, '사');
    report.continuousSession.push({ step: '1_single_char', text: '사', anns: step1.board.annotations.filter((a) => a.status === 'active').length });

    // Step 2: Expand incrementally into freehand sentence with real error ('저는 한국어가 공부해요.') without reload
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await new Promise((r) => setTimeout(r, 150));
    await drawFreehandSentenceWithError(cdp, canvasRect.left + 60, canvasRect.top + 110);
    let step2 = null;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      step2 = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
      if (step2.board.annotations.some((a) => a.status === 'active' && a.severity === 'error')) break;
    }
    const step2Errs = step2.board.annotations.filter((a) => a.status === 'active' && a.severity === 'error');
    assert.equal(step2Errs.length, 1, `Expected 1 error on 한국어가, got ${step2Errs.length}`);
    assert.equal(step2Errs[0].target_text, '한국어가');
    assert.equal(step2Errs[0].suggested_correction, '한국어를');
    report.continuousSession.push({ step: '2_full_sentence_with_error', text: step2.board.regions[0].recognizedText, errors: step2Errs.map((e) => e.target_text) });

    // Step 3: User keeps writing a second independent valid region below ('고마워') without reload -> existing error stays intact, 0 overlap
    const gx = canvasRect.left + 80;
    const gy = canvasRect.top + 380;
    // 고 (x: +4..+56)
    await dragMouseStroke(cdp, [{ x: gx + 10, y: gy + 10 }, { x: gx + 50, y: gy + 10 }, { x: gx + 50, y: gy + 44 }]);
    await dragMouseStroke(cdp, [{ x: gx + 30, y: gy + 46 }, { x: gx + 30, y: gy + 62 }]);
    await dragMouseStroke(cdp, [{ x: gx + 4, y: gy + 64 }, { x: gx + 56, y: gy + 64 }]);
    // 마 (x: +70..+134)
    const max = gx + 70;
    await dragMouseStroke(cdp, [{ x: max + 6, y: gy + 14 }, { x: max + 6, y: gy + 68 }, { x: max + 38, y: gy + 68 }]);
    await dragMouseStroke(cdp, [{ x: max + 8, y: gy + 14 }, { x: max + 38, y: gy + 14 }, { x: max + 38, y: gy + 66 }]);
    await dragMouseStroke(cdp, [{ x: max + 50, y: gy + 6 }, { x: max + 50, y: gy + 82 }]);
    await dragMouseStroke(cdp, [{ x: max + 50, y: gy + 42 }, { x: max + 64, y: gy + 42 }]);
    // 워 (ㅇ + ㅜ + ㅓ, x: +146..+212)
    const wox = gx + 146;
    await dragMouseStroke(cdp, ovalArcPts(wox + 24, gy + 20, 14, 14, 0, Math.PI * 1.85, 10));
    await dragMouseStroke(cdp, [{ x: wox + 4, y: gy + 44 }, { x: wox + 42, y: gy + 44 }]);
    await dragMouseStroke(cdp, [{ x: wox + 24, y: gy + 44 }, { x: wox + 24, y: gy + 74 }]);
    await dragMouseStroke(cdp, [{ x: wox + 44, y: gy + 48 }, { x: wox + 58, y: gy + 48 }]);
    await dragMouseStroke(cdp, [{ x: wox + 58, y: gy + 6 }, { x: wox + 58, y: gy + 82 }]);

    let step3 = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      step3 = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
      if (
        step3.board.regions.some((r) => r.recognizedText === '고마워') &&
        step3.board.annotations.some((a) => a.status === 'active' && a.target_text === '고마워')
      ) {
        break;
      }
    }
    assert.ok(
      step3.board.regions.some((r) => r.recognizedText === '고마워'),
      `New freehand region 고마워 recognized cleanly, got: ${JSON.stringify(step3.board.regions.map((r) => ({ text: r.recognizedText, status: r.recognitionStatus })))}`
    );
    assert.equal(step3.board.annotations.filter((a) => a.status === 'active' && a.target_text === '한국어가').length, 1);
    await new Promise((r) => setTimeout(r, 250));
    const step3CollisionCheck = await evalJs(
      cdp,
      `(() => {
        const st = window.__WONDER_BOARD_TEST__.getState();
        const cRect = document.querySelector('[data-testid="wonder-canvas"]').getBoundingClientRect();
        const phanBtn = Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Phấn');
        let dockEl = phanBtn;
        while (dockEl && dockEl.parentElement) {
          const r = dockEl.getBoundingClientRect();
          if (r.width > 420 && r.height >= 36 && r.height < 140) break;
          dockEl = dockEl.parentElement;
        }
        const dockRect = dockEl ? dockEl.getBoundingClientRect() : null;
        const activeTextGroups = Array.from(document.querySelectorAll('[data-testid^="ann-"] text'));
        const strokeScreenBoxes = st.board.strokes.filter(s => !s.deleted).map(s => ({
          left: cRect.left + st.viewport.offsetX + s.bbox.minX * st.viewport.scale,
          right: cRect.left + st.viewport.offsetX + s.bbox.maxX * st.viewport.scale,
          top: cRect.top + st.viewport.offsetY + s.bbox.minY * st.viewport.scale,
          bottom: cRect.top + st.viewport.offsetY + s.bbox.maxY * st.viewport.scale,
        }));
        const strokeOverlaps = [];
        const dockOverlaps = [];
        for (const tEl of activeTextGroups) {
          const r = tEl.getBoundingClientRect();
          if (dockRect && !(r.right < dockRect.left + 4 || r.left > dockRect.right - 4 || r.bottom < dockRect.top - 4 || r.top > dockRect.bottom + 4)) {
            dockOverlaps.push(tEl.textContent);
          }
          for (const sb of strokeScreenBoxes) {
            if (!(r.right <= sb.left || r.left >= sb.right || r.bottom <= sb.top || r.top >= sb.bottom)) {
              strokeOverlaps.push({ text: tEl.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom) });
            }
          }
        }
        return { strokeOverlaps, dockOverlaps };
      })()`
    );
    assert.equal(step3CollisionCheck.dockOverlaps.length, 0, `Step 3 overlapped dock: ${JSON.stringify(step3CollisionCheck.dockOverlaps)}`);
    assert.equal(step3CollisionCheck.strokeOverlaps.length, 0, `Step 3 overlapped user ink: ${JSON.stringify(step3CollisionCheck.strokeOverlaps)}`);
    await snap(cdp, 'continuous_session_final.png');
    report.continuousSession.push({
      step: '3_continued_writing',
      regions: step3.board.regions.map((r) => r.recognizedText),
      activeAnnotations: step3.board.annotations.filter((a) => a.status === 'active').map((a) => a.target_text),
      networkRequests: networkLog,
    });

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'p0-runtime-comparison.json'), JSON.stringify(report, null, 2));
    console.log('P0 ROOT CAUSE DIAGNOSTICS & CONTINUOUS SESSION COMPLETED.');
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
    try {
      execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', tmpDir], { stdio: 'ignore' });
    } catch {
      // ignore temp cleanup
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
