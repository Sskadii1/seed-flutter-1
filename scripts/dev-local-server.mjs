import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'apps', 'mobile', 'dist-web');

// Load optional .env.local into process.env (local development only; never print secrets)
const envLocalPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const rawEnv = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of rawEnv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const API_ROUTES = new Map([
  ['/api/wonder/health', () => import('../api/wonder/health.mjs')],
  ['/api/wonder/recognize', () => import('../api/wonder/recognize.mjs')],
  ['/api/wonder/tutor', () => import('../api/wonder/tutor.mjs')],
  ['/api/ai/chat', () => import('../api/ai/chat.mjs')],
]);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApiRequest(req, res, urlPath, loader) {
  const mod = await loader();
  const method = (req.method || 'GET').toUpperCase();
  const handler = mod[method];
  if (typeof handler !== 'function') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  const origin = `http://${req.headers.host || '127.0.0.1'}`;
  const fullUrl = new URL(req.url || urlPath, origin).toString();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }

  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    init.body = await readRawBody(req);
  }
  const webReq = new Request(fullUrl, init);
  const webRes = await handler(webReq);

  const outHeaders = {};
  webRes.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  outHeaders['Cache-Control'] = 'no-store';
  const ct = webRes.headers.get('content-type') || '';
  if (ct.includes('text/event-stream') && webRes.body) {
    res.writeHead(webRes.status, outHeaders);
    const reader = webRes.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
    return;
  }
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.writeHead(webRes.status, outHeaders);
  res.end(buf);
}

export function startLocalFullstackServer(port = Number(process.env.PORT || 4173)) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const apiLoader = API_ROUTES.get(urlPath);
      if (apiLoader) {
        await handleApiRequest(req, res, urlPath, apiLoader);
        return;
      }

      const safeSubPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      let targetPath = path.resolve(DIST_DIR, safeSubPath);
      if (!targetPath.startsWith(DIST_DIR + path.sep) && targetPath !== DIST_DIR) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        targetPath = path.join(DIST_DIR, 'index.html');
      }

      const ext = path.extname(targetPath).toLowerCase();
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (ext === '.html') {
        headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      }
      res.writeHead(200, headers);
      fs.createReadStream(targetPath).pipe(res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || 'INTERNAL_SERVER_ERROR' }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT || 4173);
  startLocalFullstackServer(port)
    .then(() => {
      const visionReady = Boolean(
        (process.env.DEEPSEEK_API_KEY ?? '').trim() ||
          (process.env.GEMINI_API_KEY ?? '').trim() ||
          (process.env.OPENAI_API_KEY ?? '').trim()
      );
      const tutorReady = visionReady;
      console.log(
        `SEED local full-stack server listening at http://localhost:${port} (visionReady=${visionReady}, tutorReady=${tutorReady})`
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
