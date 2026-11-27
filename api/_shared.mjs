export const MAX_BODY_BYTES = 512 * 1024;
export const UPSTREAM_TIMEOUT_MS = 14_000;

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

/**
 * Resolves the active server-side LLM provider from environment variables.
 * Never reads or logs secret values in responses.
 */
export function resolveTextUpstream() {
  const deepseekKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? '').trim();

  if (deepseekKey) {
    return {
      providerId: 'deepseek-gateway',
      providerKey: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: (process.env.DEEPSEEK_MODEL ?? 'deepseek-chat').trim() || 'deepseek-chat',
      apiKey: deepseekKey,
    };
  }
  if (geminiKey) {
    return {
      providerId: 'gemini-gateway',
      providerKey: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-2.5-flash',
      apiKey: geminiKey,
    };
  }
  if (openaiKey) {
    return {
      providerId: 'openai-gateway',
      providerKey: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: openaiKey,
    };
  }
  return null;
}

export function resolveVisionUpstream() {
  const geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? '').trim();

  if (geminiKey) {
    return {
      providerId: 'gemini-gateway',
      providerKey: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-2.5-flash',
      apiKey: geminiKey,
    };
  }
  if (openaiKey) {
    return {
      providerId: 'openai-gateway',
      providerKey: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: openaiKey,
    };
  }
  return null;
}

export function verifyOptionalBearer(req) {
  const token = (process.env.SEED_GATEWAY_TOKEN ?? '').trim();
  if (!token) return true;
  return (req.headers.get('authorization') ?? '') === `Bearer ${token}`;
}
