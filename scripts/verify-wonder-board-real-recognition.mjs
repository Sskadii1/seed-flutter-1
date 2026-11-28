import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalFullstackServer } from './dev-local-server.mjs';
import { createGatewayServer } from '../services/ai-gateway/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-real-rec');
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

  // 1. Real local full-stack server with real /api/wonder/* routes mounted
  const localSrv = await startLocalFullstackServer(0);
  const webPort = localSrv.address().port;

  // 2. Mocked OpenAI-compatible Vision/LLM HTTP upstream for gateway wire contract E2E
  let currentMockVisionText = '나도 가요.';
  let capturedCropUrls = [];
  const mockUpstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const msg = parsed?.messages?.[0];
        if (Array.isArray(msg?.content)) {
          const imgPart = msg.content.find((x) => x.type === 'image_url');
          if (imgPart?.image_url?.url) capturedCropUrls.push(imgPart.image_url.url);
        }
      } catch {
        // ignore
      }
      const tokens = currentMockVisionText.split(/\s+/).filter(Boolean);
      const payload = {
        recognizedText: currentMockVisionText,
        rawTranscription: currentMockVisionText,
        uncertainty: 0.06,
        completenessEvidence: 'complete_korean_clause_with_period',
        language: 'ko',
        recognitionStatus: 'RECOGNIZED',
        confidence: 0.94,
        alternatives: [],
        words: tokens.map((t, i) => ({
          text: t,
          bboxNorm: {
            x0: i / Math.max(1, tokens.length),
            y0: 0.08,
            x1: (i + 0.92) / Math.max(1, tokens.length),
            y1: 0.92,
          },
          confidence: 0.94,
        })),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
    });
  });
  await new Promise((r) => mockUpstream.listen(0, '127.0.0.1', r));
  const upPort = mockUpstream.address().port;

  const gatewaySrv = createGatewayServer({
    geminiKey: 'mock-upstream-key',
    geminiEndpoint: `http://127.0.0.1:${upPort}`,
  });
  await new Promise((r) => gatewaySrv.listen(0, '127.0.0.1', r));
  const gatewayUrl = `http://127.0.0.1:${gatewaySrv.address().port}`;

  // Verify live /api/wonder/health & /api/wonder/recognize on local server
  const health = await fetch(`http://127.0.0.1:${webPort}/api/wonder/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  if (!health.visionReady) {
    const resp503 = await fetch(`http://127.0.0.1:${webPort}/api/wonder/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
    });
    assert.equal(resp503.status, 503, 'Expected honest 503 when no real Vision key in env');
  }
  trace.push({ step: 'local_health', health });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-real-'));
  const cdpPort = 9338;
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
    // PART 1: Freehand mouse strokes at 25% ZOOM + trailing dot (never infinite WAITING!)
    // -------------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.setZoomScale(0.25);
        window.__WONDER_BOARD_TEST__.setGatewayConfig('', '');
      })()`
    );
    await new Promise((r) => setTimeout(r, 250));

    // Draw 4 rough mouse syllables + trailing period '.' spanning wide screen width at 25% zoom
    const sx = canvasRect.left + 80;
    const sy = canvasRect.top + 170;
    // Syllable 1 (~나)
    await dragMouseStroke(cdp, [{ x: sx, y: sy }, { x: sx, y: sy + 42 }, { x: sx + 32, y: sy + 42 }]);
    await dragMouseStroke(cdp, [{ x: sx + 45, y: sy - 4 }, { x: sx + 45, y: sy + 52 }]);
    await dragMouseStroke(cdp, [{ x: sx + 45, y: sy + 22 }, { x: sx + 58, y: sy + 22 }]);
    // Syllable 2 (~도)
    await dragMouseStroke(cdp, [{ x: sx + 92, y: sy }, { x: sx + 128, y: sy }]);
    await dragMouseStroke(cdp, [{ x: sx + 92, y: sy }, { x: sx + 92, y: sy + 36 }, { x: sx + 132, y: sy + 36 }]);
    await dragMouseStroke(cdp, [{ x: sx + 86, y: sy + 52 }, { x: sx + 138, y: sy + 52 }]);
    // Syllable 3 (~가) separated as word 2
    await dragMouseStroke(cdp, [{ x: sx + 210, y: sy }, { x: sx + 245, y: sy }, { x: sx + 245, y: sy + 42 }]);
    await dragMouseStroke(cdp, [{ x: sx + 260, y: sy - 4 }, { x: sx + 260, y: sy + 52 }]);
    // Syllable 4 (~요) + trailing period '.'
    await dragMouseStroke(cdp, [{ x: sx + 310, y: sy + 14 }, { x: sx + 332, y: sy + 4 }, { x: sx + 344, y: sy + 22 }, { x: sx + 310, y: sy + 24 }]);
    await dragMouseStroke(cdp, [{ x: sx + 300, y: sy + 48 }, { x: sx + 356, y: sy + 48 }]);
    await dragMouseStroke(cdp, [{ x: sx + 368, y: sy + 48 }, { x: sx + 370, y: sy + 50 }]); // trailing period '.'

    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    for (let w = 0; w < 35; w++) {
      await new Promise((r) => setTimeout(r, 200));
      const len = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board.regions.length`);
      if (len >= 1) break;
    }
    const offlineState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    assert.notEqual(
      offlineState.board.teacherState,
      'WAITING_FOR_CONTEXT',
      'Board must NEVER get stuck in WAITING_FOR_CONTEXT after user finished writing with period "."'
    );
    assert.equal(
      offlineState.board.regions.length,
      1,
      `Expected 1 unified region including trailing period, got ${offlineState.board.regions.length}`
    );

    // Check zoom-invariant world-coordinate crop at 0.25, 0.45, 1.0, 2.0
    const cropSizes = [];
    for (const z of [0.25, 0.45, 1.0, 2.0]) {
      await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setZoomScale(${z})`);
      const crop = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.renderCropPreview()`);
      assert.ok(crop && crop.imageDataUrl.startsWith('data:image/png;base64,'));
      assert.ok(crop.cropTransform.pixelWidth <= 1536 && crop.cropTransform.pixelHeight <= 1536);
      assert.ok(
        crop.cropTransform.worldWidth * crop.cropTransform.scale <= crop.cropTransform.pixelWidth + 2,
        `Zoom ${z}: crop overflowed right edge!`
      );
      cropSizes.push({
        zoom: z,
        w: crop.cropTransform.pixelWidth,
        h: crop.cropTransform.pixelHeight,
        scale: crop.cropTransform.scale,
      });
      if (z === 0.25) {
        const b64 = crop.imageDataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(EVIDENCE_DIR, 'crop_zoom_25_percent.png'), Buffer.from(b64, 'base64'));
      }
    }
    trace.push({ step: 'zoom_invariant_crops', cropSizes, regionCount: offlineState.board.regions.length });

    // -------------------------------------------------------------------------
    // PART 2: Browser UI -> Real Gateway HTTP -> Mocked Vision Upstream ("나도 가요.")
    // -------------------------------------------------------------------------
    currentMockVisionText = '나도 가요.';
    capturedCropUrls = [];
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.setZoomScale(0.25);
        window.__WONDER_BOARD_TEST__.setGatewayConfig(${JSON.stringify(gatewayUrl)}, '');
        window.__WONDER_BOARD_TEST__.runAnalysisNow();
      })()`
    );
    await new Promise((r) => setTimeout(r, 900));

    const visOkState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    assert.ok(capturedCropUrls.length >= 1, 'Chấm ngay must send ink crop PNG to Gateway /api/wonder/recognize');
    assert.equal(visOkState.board.regions[0].recognizedText, '나도 가요.');
    assert.equal(visOkState.board.regions[0].recognitionStatus, 'RECOGNIZED');
    const charSpam = visOkState.board.annotations.filter((a) => a.status === 'active' && a.target_text.length === 1);
    assert.equal(charSpam.length, 0, 'Valid sentence "나도 가요." must have 0 per-syllable clouds');
    assert.notEqual(visOkState.board.teacherState, 'WAITING_FOR_CONTEXT');
    await snap(cdp, 'e2e_nado_gayo_25pct.png');
    trace.push({
      step: 'mocked_vision_nado_gayo',
      recognizedText: visOkState.board.regions[0].recognizedText,
      providerId: visOkState.board.regions[0].providerId,
      diag: visOkState.diagnostics.map((d) => ({
        providerId: d.providerId,
        req: d.requestAttempted,
        crop: `${d.cropWidth}x${d.cropHeight}`,
        raw: d.rawTranscription,
      })),
    });

    // -------------------------------------------------------------------------
    // PART 3: Browser UI -> Gateway Vision -> Hierarchical Error Pinpoint ("저는 학생예요.")
    // -------------------------------------------------------------------------
    currentMockVisionText = '저는 학생예요.';
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setZoomScale(1.0);
        window.__WONDER_BOARD_TEST__.setGatewayConfig(${JSON.stringify(gatewayUrl)}, '');
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));

    // Draw 2 rough multi-stroke clusters representing "저는" + "학생예요."
    await dragMouseStroke(cdp, [{ x: canvasRect.left + 90, y: canvasRect.top + 160 }, { x: canvasRect.left + 150, y: canvasRect.top + 215 }]);
    await dragMouseStroke(cdp, [{ x: canvasRect.left + 115, y: canvasRect.top + 155 }, { x: canvasRect.left + 135, y: canvasRect.top + 225 }]);
    await dragMouseStroke(cdp, [{ x: canvasRect.left + 260, y: canvasRect.top + 160 }, { x: canvasRect.left + 420, y: canvasRect.top + 215 }]);
    await dragMouseStroke(cdp, [{ x: canvasRect.left + 320, y: canvasRect.top + 155 }, { x: canvasRect.left + 360, y: canvasRect.top + 225 }]);

    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    for (let w = 0; w < 35; w++) {
      await new Promise((r) => setTimeout(r, 200));
      const len = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState().board.regions.length`);
      if (len >= 1) break;
    }
    const errState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const activeErrs = errState.board.annotations.filter((a) => a.status === 'active' && a.severity === 'error');
    assert.equal(activeErrs.length, 1, `Expected exact 1 error cloud on 학생예요, got ${activeErrs.length}`);
    assert.equal(activeErrs[0].target_text, '학생예요');
    assert.equal(activeErrs[0].suggested_correction, '학생이에요');
    await snap(cdp, 'e2e_haksaeng_yeyo_error.png');
    trace.push({
      step: 'mocked_vision_haksaeng_yeyo',
      recognizedText: errState.board.regions[0].recognizedText,
      errors: activeErrs.map((a) => `${a.target_text}->${a.suggested_correction}`),
    });

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'real-rec-trace.json'),
      JSON.stringify({ capturedAt: new Date().toISOString(), trace }, null, 2)
    );
    console.log('ALL REAL RECOGNITION & CROP VERIFICATION CHECKS PASSED.');
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
    localSrv.close();
    gatewaySrv.close();
    mockUpstream.close();
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
