import {
  UPSTREAM_TIMEOUT_MS,
  corsHeaders,
  jsonResponse,
  readBoundedJson,
  resolveVisionUpstream,
  verifyOptionalBearer,
} from '../_shared.mjs';

function validateVisionJson(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.recognizedText !== 'string') return null;
  const validLangs = new Set(['ko', 'vi', 'en', 'mixed', 'unknown']);
  const validStatuses = new Set([
    'RECOGNIZED',
    'PARTIALLY_RECOGNIZED',
    'IN_PROGRESS',
    'AMBIGUOUS',
    'NON_TEXT',
    'UNSUPPORTED',
    'PROVIDER_UNAVAILABLE',
  ]);
  if (!validLangs.has(obj.language) || !validStatuses.has(obj.recognitionStatus)) {
    return null;
  }
  const conf = Number(obj.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return null;
  const words = Array.isArray(obj.words)
    ? obj.words.filter(
        (w) =>
          w &&
          typeof w.text === 'string' &&
          w.bboxNorm &&
          Number.isFinite(w.bboxNorm.x0) &&
          Number.isFinite(w.bboxNorm.y0) &&
          Number.isFinite(w.bboxNorm.x1) &&
          Number.isFinite(w.bboxNorm.y1)
      )
    : [];
  return {
    recognizedText: obj.recognizedText.slice(0, 400),
    language: obj.language,
    recognitionStatus: obj.recognitionStatus,
    confidence: conf,
    alternatives: Array.isArray(obj.alternatives)
      ? obj.alternatives.filter((a) => typeof a === 'string').slice(0, 5)
      : [],
    words,
  };
}

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

  if (
    !body ||
    typeof body.imageDataUrl !== 'string' ||
    !body.imageDataUrl.startsWith('data:image/')
  ) {
    return jsonResponse({ error: 'imageDataUrl (data:image/...) is required' }, 400);
  }

  const upstream = resolveVisionUpstream();
  if (!upstream) {
    const hasDeepSeek = Boolean((process.env.DEEPSEEK_API_KEY ?? '').trim());
    return jsonResponse(
      {
        recognitionStatus: 'PROVIDER_UNAVAILABLE',
        error: hasDeepSeek
          ? 'DeepSeek API is text-only; add GEMINI_API_KEY or OPENAI_API_KEY for cloud image OCR.'
          : 'No multimodal vision provider configured on server.',
      },
      503
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const prompt = [
      'You are a Korean and Vietnamese handwriting recognizer.',
      'Read ONLY the handwritten text in this cropped board image. Do not guess if illegible.',
      'Return strict JSON only:',
      '{"recognizedText": string, "language": "ko"|"vi"|"en"|"mixed"|"unknown", "recognitionStatus": "RECOGNIZED"|"PARTIALLY_RECOGNIZED"|"IN_PROGRESS"|"AMBIGUOUS"|"NON_TEXT", "confidence": number (0..1), "alternatives": string[], "words": [{"text": string, "bboxNorm": {"x0": number, "y0": number, "x1": number, "y1": number}, "confidence": number}]}',
    ].join('\n');

    const resp = await fetch(upstream.endpoint, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstream.apiKey}`,
      },
      body: JSON.stringify({
        model: upstream.model,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: body.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      console.error('[api/wonder/recognize] upstream error HTTP:', resp.status, upstream.providerKey);
      return jsonResponse({ recognitionStatus: 'PROVIDER_UNAVAILABLE' }, 502);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? validateVisionJson(JSON.parse(jsonMatch[0])) : null;
    if (!parsed) {
      return jsonResponse({ recognitionStatus: 'AMBIGUOUS', error: 'Invalid vision payload' }, 422);
    }

    return jsonResponse({ ...parsed, providerId: upstream.providerId });
  } catch (err) {
    console.error('[api/wonder/recognize] failure:', err?.name || 'Error');
    return jsonResponse(
      {
        recognitionStatus: 'PROVIDER_UNAVAILABLE',
        error: err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILURE',
      },
      503
    );
  } finally {
    clearTimeout(timer);
  }
}
