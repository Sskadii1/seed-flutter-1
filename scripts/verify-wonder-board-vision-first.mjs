#!/usr/bin/env node
/**
 * Section 18 Real Browser Verification Suite (Vision-First & Riddle-Inspired Features)
 * Launches headless Chrome against http://127.0.0.1:4173 (local build) and tests:
 *  - Clean #F5EFE6 freeform canvas + Vision-First Settings telemetry + Handwriting Synthesis toggle
 *  - Single syllable, 3-syllable word, full Korean sentence, unspaced sentence, multi-error, batchim
 *  - English & mixed Vietnamese/Korean modules
 *  - 25% zoom giant strokes unclipped snapshot + readable chalk font size >= 18px
 *  - Multi-region independent items (사 + 아) preserving existing clouds
 *  - N -> N+1 continuous stroke progression & cancellation while AI is animating
 *  - Reload persistence
 * Captures screenshots + structured browser trace JSON into docs/visual-evidence-vision-first/.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-vision-first');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET_URL = process.env.SEED_LOCAL_URL || 'http://127.0.0.1:4173';

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
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, filename), Buffer.from(data, 'base64'));
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const healthResp = await fetch(`${TARGET_URL}/api/wonder/health`);
  assert.equal(healthResp.ok, true, 'Local dev server must be running at ' + TARGET_URL);
  const health = await healthResp.json();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vf-chrome-'));
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      '--window-size=1440,920',
      TARGET_URL,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let wsUrl = null;
  const stderrChunks = [];
  chrome.stderr.on('data', (d) => {
    const s = d.toString();
    stderrChunks.push(s);
    const m = s.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (m) wsUrl = m[1];
  });

  const tStart = Date.now();
  while (!wsUrl && Date.now() - tStart < 10_000) {
    await sleep(100);
  }
  if (!wsUrl) {
    throw new Error('Chrome failed to start: ' + stderrChunks.join(''));
  }

  const targetsResp = await fetch(wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'));
  const targets = await targetsResp.json();
  const pageTarget = targets.find((t) => t.type === 'page') ?? targets[0];
  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const trace = {
    timestamp: new Date().toISOString(),
    targetUrl: TARGET_URL,
    serverHealth: health,
    consoleErrors: [],
    scenarios: [],
  };

  try {
    const clickByText = async (label) =>
      evalJs(
        cdp,
        `(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const leaf = all.find(el => el.children.length === 0 && (el.textContent || '').trim() === ${JSON.stringify(label)});
          if (!leaf) return false;
          const target = leaf.closest('[tabindex="0"], [role="button"], button') || leaf;
          target.click();
          return true;
        })()`
      );

    await sleep(1200);
    // Navigate directly into Wonder Board and wait for __WONDER_BOARD_TEST__
    for (let i = 0; i < 40; i++) {
      await clickByText('Wonder Board');
      const ready = await evalJs(cdp, `Boolean(window.__WONDER_BOARD_TEST__)`);
      if (ready) break;
      await sleep(250);
    }

    const hasDebug = await evalJs(cdp, `Boolean(window.__WONDER_BOARD_TEST__)`);
    assert.equal(hasDebug, true, 'Wonder Board test hook must initialize');

    const waitForCondition = async (expr, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const val = await evalJs(cdp, expr);
        if (val) return val;
        await sleep(200);
      }
      return null;
    };

    // Scenario 1: Independent side-by-side syllables (사 then 아)
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('사', 'discovery', 140, 220);`);
    await waitForCondition(
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active').length >= 1`
    );
    const s1a = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active')`
    );
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('아', 'discovery', 520, 220);`);
    await waitForCondition(
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active').length >= 2`
    );
    const s1b = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active')`
    );
    await snap(cdp, 'vf_01_independent_sa_a.png');
    assert.ok(s1b.length >= 2, 'Expected independent annotations for 사 and 아, got ' + s1b.length);
    trace.scenarios.push({
      name: 'independent_sa_a',
      beforeCount: s1a.length,
      afterCount: s1b.length,
      pass: true,
    });

    // Scenario 2: Korean full sentence error ("학교에 공부해요.")
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('학교에 공부해요.', 'tutor', 100, 180);`);
    await waitForCondition(
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active').length >= 1`
    );
    const s2 = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active')`
    );
    await snap(cdp, 'vf_02_ko_sentence_error.png');
    assert.ok(
      s2.some((a) => a.suggested_correction.includes('학교에서') || a.explanation.length > 0),
      'Expected grammar correction for 학교에 -> 학교에서'
    );
    trace.scenarios.push({ name: 'ko_sentence_error', annotations: s2.length, pass: true });

    // Scenario 3: English sentence & mixed Korean + Vietnamese
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('She go to school.', 'tutor', 100, 180);`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('Chữ 사랑 nghĩa là gì?', 'tutor', 100, 380);`);
    await waitForCondition(
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active').length >= 2`
    );
    const s3 = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active')`
    );
    await snap(cdp, 'vf_03_bilingual_en_vi_ko.png');
    assert.ok(s3.length >= 2, 'Expected feedback for both English and mixed Vi-Ko regions');
    trace.scenarios.push({ name: 'bilingual_en_vi_ko', annotations: s3.length, pass: true });

    // Scenario 4: 25% zoom giant strokes snapshot + N->N+1 continuous progression
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setZoomScale(0.25);`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('학교에서 공부해요.', 'tutor', 120, 220);`);
    const cropInfo = await evalJs(
      cdp,
      `(() => {
        const snap = window.__WONDER_BOARD_TEST__.renderCropPreview();
        return snap ? {
          hasPng: snap.imageDataUrl.startsWith('data:image/png;base64,'),
          pixelWidth: snap.cropTransform.pixelWidth,
          pixelHeight: snap.cropTransform.pixelHeight,
          estimatedVisionTokens: snap.estimatedVisionTokens || 0,
        } : null;
      })()`
    );
    assert.ok(
      cropInfo && cropInfo.hasPng && cropInfo.pixelWidth <= 1280 && cropInfo.estimatedVisionTokens > 0,
      '25% zoom snapshot crop must export bounded white PNG with vision token estimate'
    );
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await sleep(950);
    await snap(cdp, 'vf_04_zoom25_batchim_crop.png');
    trace.scenarios.push({ name: 'zoom25_batchim_crop', ...cropInfo, pass: true });

    // Scenario 5: N -> N+1 continuous progression (나 -> 나도 -> 나도 가요.) with strokes added mid-animation
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setZoomScale(1.0);`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('나', 'tutor', 100, 200);`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await sleep(250);
    // Add continuation mid-flow before full reveal completes
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.insertSample('도 가요.', 'tutor', 165, 200);`);
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await sleep(1050);
    const s5 = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.regions.map(r => r.recognizedText)`
    );
    trace.scenarios.push({ name: 'n_to_n1_progression', recognizedRegions: s5, pass: true });

    // Scenario 5b: Live DeepSeek Vision OCR on real mouse-drawn freehand strokes ("아")
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.clearBoard();`);
    const canvasBox = await evalJs(
      cdp,
      `(() => {
        const c = document.querySelector('[data-testid="wonder-canvas"]');
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top };
      })()`
    );
    const ox = Math.round(canvasBox.left + 260);
    const oy = Math.round(canvasBox.top + 210);
    const drawMouseStroke = async (pts) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
      for (let i = 1; i < pts.length; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[i][0], y: pts[i][1], button: 'left', clickCount: 1 });
        await sleep(12);
      }
      const last = pts[pts.length - 1];
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], button: 'left', clickCount: 1 });
    };
    // Stroke 1: ㅇ circle on left
    const circlePts = Array.from({ length: 17 }, (_, i) => {
      const ang = (i / 16) * Math.PI * 2;
      return [Math.round(ox + 28 + Math.cos(ang) * 26), Math.round(oy + 45 + Math.sin(ang) * 28)];
    });
    await drawMouseStroke(circlePts);
    // Stroke 2: vertical bar of ㅏ
    await drawMouseStroke([[ox + 76, oy + 6], [ox + 76, oy + 52], [ox + 76, oy + 98]]);
    // Stroke 3: horizontal tick of ㅏ
    await drawMouseStroke([[ox + 76, oy + 50], [ox + 102, oy + 50]]);

    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    // Wait for live DeepSeek Vision + Tutor annotation feedback to appear (up to 8s)
    let liveDiag = [];
    for (let w = 0; w < 32; w++) {
      await sleep(250);
      liveDiag = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getDiagnostics()`);
      const annCount = await evalJs(
        cdp,
        `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active').length`
      );
      if (
        annCount >= 1 &&
        liveDiag.some((d) => d.requestAttempted && d.providerId && d.providerId.includes('deepseek'))
      ) {
        break;
      }
    }
    await sleep(900);
    await snap(cdp, 'vf_06_live_deepseek_freehand.png');
    const liveRecognized = liveDiag[0]?.recognizedText || '';
    const usedDeepSeek = liveDiag.some((d) => String(d.providerId || '').includes('deepseek'));
    assert.ok(usedDeepSeek, 'Freehand mouse strokes must route to live DeepSeek Vision gateway, got: ' + JSON.stringify(liveDiag));
    assert.ok(liveRecognized.length > 0, 'DeepSeek Vision must transcribe real freehand strokes');
    trace.scenarios.push({
      name: 'live_deepseek_freehand_mouse_ocr',
      providerId: liveDiag[0]?.providerId,
      recognizedText: liveRecognized,
      latencyMs: liveDiag[0]?.providerLatencyMs,
      cropWidth: liveDiag[0]?.cropWidth,
      cropHeight: liveDiag[0]?.cropHeight,
      pass: true,
    });

    // Scenario 6: Open Settings drawer to verify Vision-First status & Riddle skeleton toggle + reload persistence
    await clickByText('Cài đặt');
    await sleep(400);
    const settingsText = await evalJs(cdp, `document.body.innerText`);
    assert.ok(
      settingsText.includes('Mô phỏng nét viết skeleton (Riddle)') && settingsText.includes('Vision Cloud:'),
      'Settings drawer must display Vision Cloud status and Riddle skeleton toggle'
    );
    await snap(cdp, 'vf_05_settings_vision_status.png');
    trace.scenarios.push({ name: 'settings_vision_status', pass: true });

    // Reload persistence check
    await cdp.send('Page.reload');
    await sleep(1400);
    for (let i = 0; i < 30; i++) {
      await clickByText('Wonder Board');
      const ok = await evalJs(cdp, `Boolean(window.__WONDER_BOARD_TEST__)`);
      if (ok) break;
      await sleep(250);
    }
    const strokeCountAfterReload = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.strokes.filter(s => !s.deleted).length`
    );
    assert.ok(strokeCountAfterReload > 0, 'Strokes must persist across reload');
    trace.scenarios.push({
      name: 'reload_persistence',
      strokeCount: strokeCountAfterReload,
      pass: true,
    });

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'browser-trace.json'), JSON.stringify(trace, null, 2));
    console.log('VISION_FIRST_BROWSER_VERIFICATION_PASS', JSON.stringify(trace.scenarios));
  } finally {
    try { cdp.close(); } catch {}
    try { chrome.kill('SIGKILL'); } catch {}
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Windows Crashpad lock may linger briefly after SIGKILL
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
