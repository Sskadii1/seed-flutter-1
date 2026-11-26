import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

async function clickByText(cdp, needle, exact = false) {
  return cdp.send('Runtime.evaluate', {
    expression: `(() => {
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
    })()`,
    returnByValue: true,
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, url } = await startStaticServer(DIST_DIR);
  const debugPort = 9444 + Math.floor(Math.random() * 200);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-wb-v1-'));

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
    console.log('tab clicked:', (await clickByText(cdp, 'Wonder Board', true)).result.value);
    await new Promise((r) => setTimeout(r, 600));
    console.log('sample clicked:', (await clickByText(cdp, 'Viết mẫu thử', true)).result.value);
    await new Promise((r) => setTimeout(r, 400));
    console.log('scenario A clicked:', (await clickByText(cdp, 'Kịch bản A', false)).result.value);
    await new Promise((r) => setTimeout(r, 1800));

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const outFile = path.join(OUT_DIR, '01_board_before_upgrade.png');
    fs.writeFileSync(outFile, Buffer.from(data, 'base64'));
    console.log('SAVED:', outFile);
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
