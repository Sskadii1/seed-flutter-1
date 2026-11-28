import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'visual-evidence-en');
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

function ovalArcPts(cx, cy, rx, ry, startAngle, endAngle, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / steps;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const baseUrl = 'http://127.0.0.1:4173';
  const health = await fetch(`${baseUrl}/api/wonder/health`).then((r) => r.json());
  assert.equal(health.ok, true, 'localhost:4173 dev-local-server must be running');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-en-'));
  const cdpPort = 9341;
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
            (leaf.closest('[tabindex="0"], [role="button"], button') || leaf).click();
            resolve(true);
          } else {
            setTimeout(poll, 150);
          }
        };
        poll();
      })`
    );
    await new Promise((r) => setTimeout(r, 600));

    // Verify 1-click Language Toggle button works (auto -> ko -> en)
    const toggleTexts = await evalJs(
      cdp,
      `(async () => {
        const waitFrame = () => new Promise(r => setTimeout(r, 120));
        const btn0 = document.querySelector('[data-testid="wonder-lang-toggle"]');
        const t0 = btn0?.textContent?.trim();
        btn0?.click();
        await waitFrame();
        const btn1 = document.querySelector('[data-testid="wonder-lang-toggle"]');
        const t1 = btn1?.textContent?.trim();
        btn1?.click();
        await waitFrame();
        const t2 = document.querySelector('[data-testid="wonder-lang-toggle"]')?.textContent?.trim();
        return [t0, t1, t2];
      })()`
    );
    assert.deepEqual(toggleTexts, ['Hàn + Anh', 'Tiếng Hàn', 'Tiếng Anh']);

    const canvasRect = await evalJs(
      cdp,
      `(() => {
        const c = document.querySelector('[data-testid="wonder-canvas"]');
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()`
    );

    // -----------------------------------------------------------------------
    // 1. English Multi-Error Sentences + Valid Praise (Sample & Typed Latin Strokes)
    // -----------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.setTargetLanguage('en');
        window.__WONDER_BOARD_TEST__.setViewport(1.0, 0, 0);
        window.__WONDER_BOARD_TEST__.insertSample('I go to school yesterday.', 'tutor', 70, 95);
        window.__WONDER_BOARD_TEST__.insertSample('She eat a apple every day.', 'tutor', 70, 295);
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 600));

    const enErrorsState = await evalJs(cdp, `window.__WONDER_BOARD_TEST__.getState()`);
    const activeErrs = enErrorsState.board.annotations.filter(
      (a) => a.status === 'active' && a.severity === 'error'
    );
    const activePraisesErr = enErrorsState.board.annotations.filter(
      (a) => a.status === 'active' && a.severity === 'praise'
    );
    assert.equal(activePraisesErr.length, 0, 'Erroneous English sentences must NOT get a Great job checkmark');
    assert.ok(activeErrs.some((a) => a.target_text === 'go' && a.suggested_correction === 'went'), 'go -> went pinpointed');
    assert.ok(activeErrs.some((a) => a.target_text === 'eat' && a.suggested_correction === 'eats'), 'eat -> eats pinpointed');
    assert.ok(activeErrs.some((a) => a.target_text === 'a apple' && a.suggested_correction === 'an apple'), 'a apple -> an apple pinpointed');
    await snap(cdp, 'en_grammar_errors_pinpointed.png');

    // Valid English praise checkmark
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setTargetLanguage('en');
        window.__WONDER_BOARD_TEST__.insertSample('I went to school yesterday.', 'tutor', 70, 140);
      })()`
    );
    await new Promise((r) => setTimeout(r, 400));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 400));
    const validCheck = await evalJs(
      cdp,
      `(() => {
        const st = window.__WONDER_BOARD_TEST__.getState();
        const praises = st.board.annotations.filter(a => a.status === 'active' && a.severity === 'praise');
        const corrEl = praises[0] ? document.querySelector('[data-testid="chalk-corr-' + praises[0].annotation_id + '"]') : null;
        return { count: praises.length, tickText: corrEl?.textContent?.trim() };
      })()`
    );
    assert.equal(validCheck.count, 1);
    assert.equal(validCheck.tickText, 'Great job!');
    await snap(cdp, 'en_valid_praise.png');

    // -----------------------------------------------------------------------
    // 2. Freehand Printed English Word via Mouse + Cloud Preservation (cat -> cat dog)
    // -----------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('fast');
        window.__WONDER_BOARD_TEST__.setTargetLanguage('en');
        window.__WONDER_BOARD_TEST__.setViewport(1.0, 0, 0);
      })()`
    );
    await new Promise((r) => setTimeout(r, 200));

    // Draw "cat" using clean printed strokes
    const fx = canvasRect.left + 180;
    const fy = canvasRect.top + 190;
    // c
    await dragMouseStroke(cdp, ovalArcPts(fx + 16, fy + 38, 12, 16, -Math.PI * 0.25, -Math.PI * 1.75, 8));
    // a
    await dragMouseStroke(cdp, ovalArcPts(fx + 48, fy + 38, 10, 14, 0, Math.PI * 1.9, 8));
    await dragMouseStroke(cdp, [{ x: fx + 60, y: fy + 24 }, { x: fx + 60, y: fy + 52 }]);
    // t
    await dragMouseStroke(cdp, [{ x: fx + 82, y: fy + 10 }, { x: fx + 82, y: fy + 50 }, { x: fx + 92, y: fy + 52 }]);
    await dragMouseStroke(cdp, [{ x: fx + 72, y: fy + 26 }, { x: fx + 94, y: fy + 26 }]);

    let catBefore = null;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 200));
      catBefore = await evalJs(
        cdp,
        `(() => {
          const st = window.__WONDER_BOARD_TEST__.getState();
          const ann = st.board.annotations.find(a => a.status === 'active' && a.target_text.toLowerCase() === 'cat');
          const gEl = ann ? document.querySelector('[data-testid="ann-' + ann.annotation_id + '"]') : null;
          return {
            regions: st.board.regions.map(r => r.recognizedText),
            ann,
            domAnimCloud: gEl ? gEl.getAttribute('data-anim-cloud') : null,
          };
        })()`
      );
      if (catBefore.ann?.animation_progress?.completed && catBefore.domAnimCloud === '1.00') break;
    }
    assert.ok(catBefore?.ann, `Freehand printed "cat" must be recognized & annotated, got ${JSON.stringify(catBefore)}`);
    assert.equal(catBefore.ann.animation_progress?.completed, true);

    // Draw "go" beside "cat" -> cat cloud must NOT reload!
    const gx = fx + 170;
    // g
    await dragMouseStroke(cdp, ovalArcPts(gx + 16, fy + 34, 10, 12, 0, Math.PI * 1.9, 8));
    await dragMouseStroke(cdp, [{ x: gx + 28, y: fy + 22 }, { x: gx + 28, y: fy + 56 }, { x: gx + 14, y: fy + 64 }]);
    // o
    await dragMouseStroke(cdp, ovalArcPts(gx + 54, fy + 38, 12, 14, 0, Math.PI * 1.95, 8));

    let catAfterCheck = null;
    let catEverReset = false;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 200));
      catAfterCheck = await evalJs(
        cdp,
        `(() => {
          const st = window.__WONDER_BOARD_TEST__.getState();
          const active = st.board.annotations.filter(a => a.status === 'active');
          const catAnn = active.find(a => a.target_text.toLowerCase() === 'cat');
          const goAnn = active.find(a => a.target_text.toLowerCase() === 'go');
          const catDom = catAnn ? document.querySelector('[data-testid="ann-' + catAnn.annotation_id + '"]') : null;
          return {
            regions: st.board.regions.map(r => r.recognizedText),
            activeTexts: active.map(a => a.target_text),
            catAnn,
            goAnn,
            catDomAnimCloud: catDom ? catDom.getAttribute('data-anim-cloud') : null,
          };
        })()`
      );
      if (!catAfterCheck.catAnn || catAfterCheck.catDomAnimCloud !== '1.00') catEverReset = true;
      if (catAfterCheck.goAnn?.animation_progress?.completed) break;
    }
    assert.equal(catEverReset, false, 'Completed cloud on freehand "cat" must NEVER reload when drawing "go"');
    assert.equal(catAfterCheck.catAnn.annotation_id, catBefore.ann.annotation_id);
    assert.ok(catAfterCheck.goAnn, 'New freehand "go" must get its own cloud');
    await snap(cdp, 'en_freehand_side_by_side_preserved.png');

    // -----------------------------------------------------------------------
    // 3. Bilingual Board (Korean + English simultaneously in 'auto' mode)
    // -----------------------------------------------------------------------
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.setTargetLanguage('auto');
        window.__WONDER_BOARD_TEST__.insertSample('저는 사과가 먹어요.', 'tutor', 70, 90);
        window.__WONDER_BOARD_TEST__.insertSample('I go to school yesterday.', 'tutor', 70, 320);
      })()`
    );
    await new Promise((r) => setTimeout(r, 400));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.runAnalysisNow();`);
    await new Promise((r) => setTimeout(r, 500));

    const biCheck = await evalJs(
      cdp,
      `(() => {
        const st = window.__WONDER_BOARD_TEST__.getState();
        const active = st.board.annotations.filter(a => a.status === 'active');
        return {
          regions: st.board.regions.map(r => ({ text: r.recognizedText, lang: r.language })),
          annotations: active.map(a => ({ target: a.target_text, corr: a.suggested_correction, severity: a.severity })),
        };
      })()`
    );
    assert.equal(biCheck.annotations.filter((a) => a.severity === 'praise').length, 0, 'Bilingual board with errors must NOT emit spurious praise');
    assert.ok(biCheck.annotations.some((a) => a.target === '사과가' && a.corr === '사과를'));
    assert.ok(biCheck.annotations.some((a) => a.target === 'go' && a.corr === 'went'));
    await snap(cdp, 'en_ko_bilingual_board.png');

    console.log('ALL WONDER BOARD ENGLISH VERIFICATION CHECKS PASSED.');
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
