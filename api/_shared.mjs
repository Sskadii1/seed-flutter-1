export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 16_000;

/** Strict allowlist of official upstream hosts (SSRF protection — rejects arbitrary URLs). */
export const ALLOWED_UPSTREAM_HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.deepseek.com',
]);

export function isAllowedUpstreamEndpoint(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:' && ALLOWED_UPSTREAM_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function jsonResponse(payload, status = 200, origin = '*') {
  return Response.json(payload, {
    status,
    headers: corsHeaders(origin),
  });
}

export async function readBoundedJson(req) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Payload too large'), { status: 413 });
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

const ipRateWindows = new Map();

export function checkRateLimit(clientKey, maxPerWindow = 60, windowMs = 60_000) {
  const key = String(clientKey || 'local');
  const now = Date.now();
  const list = (ipRateWindows.get(key) ?? []).filter((ts) => now - ts < windowMs);
  if (list.length >= maxPerWindow) {
    ipRateWindows.set(key, list);
    return false;
  }
  list.push(now);
  ipRateWindows.set(key, list);
  return true;
}

/**
 * Resolves ordered multimodal Vision upstreams [gemini, openai] for failover
 * (adapted from farhan-beg/riddle-web failover chain, server-side keys only).
 */
export function resolveVisionUpstreams(env = process.env) {
  const deepseekKey = (env.DEEPSEEK_API_KEY ?? '').trim();
  const geminiKey = (env.GEMINI_API_KEY ?? '').trim();
  const openaiKey = (env.OPENAI_API_KEY ?? '').trim();
  const list = [];

  if (deepseekKey) {
    list.push({
      providerId: 'deepseek-vision-gateway',
      providerKey: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model:
        (env.DEEPSEEK_VISION_MODEL ?? env.DEEPSEEK_MODEL ?? 'deepseek-flash').trim() ||
        'deepseek-flash',
      apiKey: deepseekKey,
      supportsThinkingDisable: true,
    });
  }
  if (geminiKey) {
    list.push({
      providerId: 'gemini-gateway',
      providerKey: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: (env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim() || 'gemini-2.5-flash',
      apiKey: geminiKey,
    });
  }
  if (openaiKey) {
    list.push({
      providerId: 'openai-gateway',
      providerKey: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: (env.OPENAI_MODEL ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini',
      apiKey: openaiKey,
    });
  }
  return list;
}

export function resolveVisionUpstream() {
  return resolveVisionUpstreams()[0] ?? null;
}

export function resolveTextUpstreams(env = process.env) {
  const deepseekKey = (env.DEEPSEEK_API_KEY ?? '').trim();
  const geminiKey = (env.GEMINI_API_KEY ?? '').trim();
  const openaiKey = (env.OPENAI_API_KEY ?? '').trim();
  const list = [];

  if (deepseekKey) {
    list.push({
      providerId: 'deepseek-gateway',
      providerKey: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: (env.DEEPSEEK_MODEL ?? 'deepseek-flash').trim() || 'deepseek-flash',
      apiKey: deepseekKey,
      supportsThinkingDisable: true,
    });
  }
  if (geminiKey) {
    list.push({
      providerId: 'gemini-gateway',
      providerKey: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: (env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim() || 'gemini-2.5-flash',
      apiKey: geminiKey,
    });
  }
  if (openaiKey) {
    list.push({
      providerId: 'openai-gateway',
      providerKey: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: (env.OPENAI_MODEL ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini',
      apiKey: openaiKey,
    });
  }
  return list;
}

export function resolveTextUpstream() {
  return resolveTextUpstreams()[0] ?? null;
}

/**
 * Executes an OpenAI-compatible request across ordered upstreams with:
 * 1. Explicit host allowlist check (no arbitrary SSRF targets).
 * 2. MaximeRivest/riddle `src/oracle.rs` HTTP 400 retry (`max_tokens` -> `max_completion_tokens`).
 * 3. farhan-beg/riddle-web `src/worker.js` provider failover on 429 / 5xx / network failures.
 */
export async function callOpenAiCompatibleWithFallback(upstreams, buildBody, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const signal = options.signal;
  const allowCustomEndpointForTest = Boolean(options.allowCustomEndpointForTest);
  const errors = [];

  for (const upstream of upstreams) {
    if (!allowCustomEndpointForTest && !isAllowedUpstreamEndpoint(upstream.endpoint)) {
      errors.push({ provider: upstream.providerKey, status: 403, reason: 'DISALLOWED_UPSTREAM_HOST' });
      continue;
    }

    let bodyObj = buildBody(upstream);
    if (upstream.supportsThinkingDisable && bodyObj && typeof bodyObj === 'object' && !bodyObj.thinking) {
      bodyObj = { ...bodyObj, thinking: { type: 'disabled' } };
    }
    try {
      let resp = await fetchImpl(upstream.endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${upstream.apiKey}`,
        },
        body: JSON.stringify(bodyObj),
      });

      // Ported from MaximeRivest/riddle src/oracle.rs: automatic max_completion_tokens retry on HTTP 400
      if (resp.status === 400 && Object.prototype.hasOwnProperty.call(bodyObj, 'max_tokens')) {
        const errText = await resp.text().catch(() => '');
        if (errText.includes('max_tokens') || errText.includes('max_completion_tokens')) {
          const { max_tokens, ...rest } = bodyObj;
          bodyObj = { ...rest, max_completion_tokens: max_tokens };
          resp = await fetchImpl(upstream.endpoint, {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${upstream.apiKey}`,
            },
            body: JSON.stringify(bodyObj),
          });
        }
      }

      if (resp.ok) {
        return { ok: true, upstream, resp, failoverCount: errors.length };
      }

      errors.push({
        provider: upstream.providerKey,
        status: resp.status,
        reason: resp.status === 429 ? 'RATE_LIMITED' : `HTTP_${resp.status}`,
      });

      // Fail over on 429, 5xx, or incompatible endpoint; stop on client abort
      if (signal?.aborted) break;
    } catch (err) {
      if (signal?.aborted) {
        errors.push({ provider: upstream.providerKey, status: 499, reason: 'ABORTED' });
        break;
      }
      errors.push({
        provider: upstream.providerKey,
        status: 503,
        reason: err?.name || 'NETWORK_ERROR',
      });
    }
  }

  return { ok: false, upstream: upstreams[0] ?? null, resp: null, errors };
}

export function verifyOptionalBearer(req) {
  const token = (process.env.SEED_GATEWAY_TOKEN ?? '').trim();
  if (!token) return true;
  return (req.headers.get('authorization') ?? '') === `Bearer ${token}`;
}
