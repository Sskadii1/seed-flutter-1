import {
  UPSTREAM_TIMEOUT_MS,
  corsHeaders,
  jsonResponse,
  readBoundedJson,
  resolveTextUpstream,
  verifyOptionalBearer,
} from '../_shared.mjs';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req) {
  if (!verifyOptionalBearer(req)) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
  }

  let body;
  try {
    body = await readBoundedJson(req);
  } catch (err) {
    return jsonResponse({ error: err?.message || 'Invalid JSON' }, err?.status || 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 1200) : '';
  if (!query) {
    return jsonResponse({ error: 'query is required' }, 400);
  }

  const upstream = resolveTextUpstream();
  if (!upstream) {
    return jsonResponse(
      { error: 'PROVIDER_UNAVAILABLE', message: 'Server AI API key is not configured.' },
      503
    );
  }

  const systemPrompt =
    typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
      ? body.systemPrompt.trim().slice(0, 2500)
      : 'Bạn là gia sư tiếng Hàn SEED cho người Việt. Giải thích ngắn gọn, dễ hiểu, không dùng emoji.';

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-12)
        .filter(
          (m) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.text === 'string' &&
            m.text.trim().length > 0
        )
        .map((m) => ({
          role: m.role,
          content: m.text.trim().slice(0, 800),
        }))
    : [];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const resp = await fetch(upstream.endpoint, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstream.apiKey}`,
      },
      body: JSON.stringify({
        model: upstream.model,
        temperature: 0.3,
        max_tokens: 550,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: query },
        ],
      }),
    });

    if (!resp.ok) {
      console.error('[api/ai/chat] upstream non-ok HTTP status:', resp.status, upstream.providerKey);
      return jsonResponse({ error: 'UPSTREAM_ERROR', status: resp.status }, 502);
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      console.error('[api/ai/chat] empty choice content from', upstream.providerKey);
      return jsonResponse({ error: 'EMPTY_RESPONSE' }, 502);
    }

    return jsonResponse({
      reply,
      provider: upstream.providerKey,
      model: upstream.model,
    });
  } catch (err) {
    console.error('[api/ai/chat] failure:', err?.name || 'Error');
    return jsonResponse(
      { error: err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'PROVIDER_UNAVAILABLE' },
      503
    );
  } finally {
    clearTimeout(timer);
  }
}
