import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const DIST_DIR = path.resolve(process.cwd(), 'apps/mobile/dist-web');
const OUT_DIR = path.resolve(process.cwd(), 'docs/visual-evidence');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanPath = (req.url || '/').split('?')[0];
      let filePath = path.join(rootDir, cleanPath === '/' ? 'index.html' : cleanPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, 'index.html');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

async function waitForDebugWs(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for Chrome DevTools target');
}

async function evalJs(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`Browser eval error: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result?.value;
}

async function clickByText(cdp, needle, exact = false) {
  return evalJs(
    cdp,
    `(() => {
      const all = Array.from(document.querySelectorAll('div, span, button, a'));
      const leaf = all.find((el) => {
        if (el.children.length > 0) return false;
        const t = (el.textContent || '').trim();
        return ${exact ? `t === ${JSON.stringify(needle)}` : `t.includes(${JSON.stringify(needle)})`};
      });
      if (!leaf) return false;
      const target = leaf.closest('[tabindex="0"], [role="button"], button') || leaf;
      target.click();
      return true;
    })()`
  );
}

async function snap(cdp, fileName) {
  await new Promise((r) => setTimeout(r, 140));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const outPath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  return outPath;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, url } = await startStaticServer(DIST_DIR);
  const debugPort = 9555 + Math.floor(Math.random() * 200);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-v2-'));

  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,820',
      '--disable-gpu',
      '--no-first-run',
      url,
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await waitForDebugWs(debugPort);
    const cdp = new CdpClient(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 2,
      mobile: false,
    });

    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await clickByText(cdp, 'Wonder Board', true), true, 'Wonder Board tab must click');
    await new Promise((r) => setTimeout(r, 500));

    // Clear board cleanly & insert Scenario A: 저는 어제 학교에 가요.
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('natural');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가요.', 'tutor', 80, 120);
      })()`
    );
    await new Promise((r) => setTimeout(r, 250));

    // 03..07: Cloud Progressive Single-Stroke Animation 0%, 25%, 50%, 75%, 100%
    const scrub = async (c, a, corr, expl, done = false) =>
      evalJs(
        cdp,
        `(() => {
          window.__WONDER_BOARD_TEST__.scrubAllAnnotations({
            cloud: ${c}, arrow: ${a}, correction: ${corr}, explanation: ${expl}, completed: ${done}
          });
        })()`
      );

    const readPathStats = async () =>
      evalJs(
        cdp,
        `(() => {
          const paths = Array.from(document.querySelectorAll('[data-testid^="cloud-path-"]'));
          const arrows = Array.from(document.querySelectorAll('[data-testid^="arrow-path-"]'));
          const cursors = Array.from(document.querySelectorAll('[data-testid^="chalk-cursor-"]'));
          const corrs = Array.from(document.querySelectorAll('[data-testid^="chalk-corr-"]'));
          const expls = Array.from(document.querySelectorAll('[data-testid^="chalk-expl-"]'));
          return {
            clouds: paths.map((p) => p.getAttribute('d') || ''),
            arrows: arrows.map((p) => p.getAttribute('d') || ''),
            cursorCount: cursors.length,
            corrTexts: corrs.map((t) => t.textContent || ''),
            explTexts: expls.map((t) => t.textContent || ''),
          };
        })()`
      );

    await scrub(0, 0, 0, 0, false);
    const st0 = await readPathStats();
    assert.equal(st0.clouds.length, 0, 'B01: 0% must show zero cloud path');
    await snap(cdp, '03_cloud_animation_000.png');

    await scrub(0.25, 0, 0, 0, false);
    const st25 = await readPathStats();
    assert.equal(st25.clouds.length, 1);
    assert.equal(st25.clouds[0].endsWith(' Z'), false, 'B02: 25% cloud path must stay open');
    assert.equal(st25.cursorCount, 1, 'B07: Chalk tip cursor must track active stroke');
    await snap(cdp, '04_cloud_animation_025.png');

    await scrub(0.5, 0, 0, 0, false);
    const st50 = await readPathStats();
    assert.ok(st50.clouds[0].length > st25.clouds[0].length, 'B03: 50% path must be longer than 25%');
    assert.equal(st50.clouds[0].endsWith(' Z'), false);
    await snap(cdp, '05_cloud_animation_050.png');

    await scrub(0.75, 0, 0, 0, false);
    const st75 = await readPathStats();
    assert.ok(st75.clouds[0].length > st50.clouds[0].length, 'B04: 75% path must be longer than 50%');
    assert.equal(st75.clouds[0].endsWith(' Z'), false);
    await snap(cdp, '06_cloud_animation_075.png');

    await scrub(1, 0, 0, 0, false);
    const st100 = await readPathStats();
    assert.equal(st100.clouds[0].endsWith(' Z'), true, 'B05: 100% cloud path must close');
    assert.equal(st100.arrows.length, 0, 'B08: arrow waits until cloud finishes');
    await snap(cdp, '07_cloud_animation_100.png');
    await snap(cdp, '02_cloud_geometry_completed.png');

    // 08: Animated arrow phase
    await scrub(1, 0.72, 0, 0, false);
    const stArr = await readPathStats();
    assert.equal(stArr.arrows.length, 1, 'B08: arrow appears during arrow phase');
    assert.equal(stArr.explTexts.length, 0, 'B09: explanation waits until arrow completes');
    await snap(cdp, '08_animated_arrow.png');

    // 09: Direct-on-canvas chalk explanation completed (NO tooltip box!)
    await scrub(1, 1, 1, 1, true);
    const stFull = await readPathStats();
    assert.ok(stFull.corrTexts[0].includes('갔어요'));
    assert.ok(stFull.explTexts.length >= 1);
    await snap(cdp, '09_direct_chalk_explanation.png');

    // 10: Multiple independent errors (3 separate clouds + arrows + chalk notes)
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.clearAnimOverride();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가요.', 'tutor', 80, 65);
        window.__WONDER_BOARD_TEST__.insertSample('저는 사과가 먹어요.', 'tutor', 80, 225);
        window.__WONDER_BOARD_TEST__.insertSample('저는 학교에 공부해요.', 'tutor', 80, 385);
      })()`
    );
    await new Promise((r) => setTimeout(r, 450));
    const stMulti = await readPathStats();
    assert.equal(stMulti.clouds.length, 3, `Expected 3 separate clouds, got ${stMulti.clouds.length}`);
    await snap(cdp, '10_multiple_errors.png');

    // 11: Incremental N -> N+1 (incomplete "저는 어제 학교에 가" waits, then "저는 어제 학교에 갔어요." gets praised)
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.clearAnimOverride();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가', 'tutor', 80, 90);
      })()`
    );
    await new Promise((r) => setTimeout(r, 250));
    const midCount = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active').length`
    );
    assert.equal(midCount, 0, 'D01/C04: incomplete fragment must stay silent');
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.editFirstRegionStrokes('저는 어제 학교에 갔어요.');
      })()`
    );
    await new Promise((r) => setTimeout(r, 350));
    await snap(cdp, '11_incremental_n_plus_one.png');

    // 12: Edit during active animation -> cancels stale cloud immediately
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.clearAnimOverride();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('slow');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가요.', 'tutor', 80, 120);
      })()`
    );
    await new Promise((r) => setTimeout(r, 280));
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.editFirstRegionStrokes('저는 오늘 학교에 가요.');
      })()`
    );
    await new Promise((r) => setTimeout(r, 350));
    const afterCancel = await evalJs(
      cdp,
      `window.__WONDER_BOARD_TEST__.getState().board.annotations.filter(a => a.status === 'active' && a.severity === 'error').length`
    );
    assert.equal(afterCancel, 0, 'B12: Editing error stroke during animation cancels stale error cloud');
    await snap(cdp, '12_edit_during_animation.png');

    // 13: Zoom 45% coordinate check
    await evalJs(
      cdp,
      `(() => {
        window.__WONDER_BOARD_TEST__.clearBoard();
        window.__WONDER_BOARD_TEST__.clearAnimOverride();
        window.__WONDER_BOARD_TEST__.setAnimationSpeed('instant');
        window.__WONDER_BOARD_TEST__.insertSample('저는 어제 학교에 가요.', 'tutor', 100, 140);
      })()`
    );
    await new Promise((r) => setTimeout(r, 300));
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setViewport(0.45, 40, 40)`);
    await snap(cdp, '13_zoom_45_percent.png');

    // Reset zoom to 100% and capture 14 (iPad Landscape EMULATED) & 15 (iPad Portrait EMULATED)
    await evalJs(cdp, `window.__WONDER_BOARD_TEST__.setViewport(1, 0, 0)`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1180,
      height: 820,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 300));
    await snap(cdp, '14_ipad_landscape_emulation.png');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 1180,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 300));
    await snap(cdp, '15_ipad_portrait_emulation.png');

    // 16: Reload persistence check (restore 1280x820 desktop & reload)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await cdp.send('Page.reload', { ignoreCache: false });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await clickByText(cdp, 'Wonder Board', true), true);
    await new Promise((r) => setTimeout(r, 500));
    const reloadedState = await evalJs(
      cdp,
      `(() => {
        const s = window.__WONDER_BOARD_TEST__.getState();
        return {
          strokeCount: s.board.strokes.filter(x => !x.deleted).length,
          completedCount: s.board.annotations.filter(a => a.status === 'active' && a.animation_progress?.completed).length,
        };
      })()`
    );
    assert.ok(reloadedState.strokeCount > 0, 'AC-09: Strokes persisted after reload');
    assert.ok(reloadedState.completedCount >= 1, 'B14: Completed annotations persisted as completed without replay');
    await snap(cdp, '16_after_reload.png');

    console.log('ALL 15 V2 BROWSER VERIFICATION SCREENSHOTS PASSED & SAVED.');
    cdp.close();
  } finally {
    chrome.kill('SIGTERM');
    server.close();
    setTimeout(() => {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // ignore Windows handle lock
      }
    }, 300);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
