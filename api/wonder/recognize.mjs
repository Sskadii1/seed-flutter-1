import {
  UPSTREAM_TIMEOUT_MS,
  callOpenAiCompatibleWithFallback,
  checkRateLimit,
  corsHeaders,
  jsonResponse,
  readBoundedJson,
  resolveVisionUpstreams,
  verifyOptionalBearer,
} from '../_shared.mjs';

const VALID_LANGS = new Set(['ko', 'vi', 'en', 'mixed', 'unknown']);
const VALID_STATUSES = new Set([
  'RECOGNIZED',
  'PARTIALLY_RECOGNIZED',
  'IN_PROGRESS',
  'AMBIGUOUS',
  'NON_TEXT',
  'UNSUPPORTED',
  'PROVIDER_UNAVAILABLE',
]);
const VALID_CONTENT_TYPES = new Set([
  'single_character',
  'hangul_syllable',
  'word',
  'phrase',
  'sentence',
  'paragraph',
  'user_question',
  'free_drawing',
  'mixed_content',
  'unknown',
]);
const VALID_COMPLETENESS = new Set([
  'complete',
  'in_progress',
  'fragment',
  'non_text',
  'unknown',
]);

function normalizeLanguageCode(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.trim().toLowerCase();
  if (s === 'ko' || s === 'kr' || s.includes('korean') || s.includes('hangul')) return 'ko';
  if (s === 'en' || s.includes('english')) return 'en';
  if (s === 'vi' || s === 'vn' || s.includes('vietnam')) return 'vi';
  if (s === 'mixed' || s.includes('bilingual')) return 'mixed';
  return VALID_LANGS.has(s) ? s : 'unknown';
}

function normalizeRecognitionStatus(raw) {
  if (typeof raw !== 'string') return 'AMBIGUOUS';
  const s = raw.trim().toUpperCase();
  return VALID_STATUSES.has(s) ? s : 'AMBIGUOUS';
}

export function validateVisionJson(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.recognizedText !== 'string') return null;
  const lang = normalizeLanguageCode(obj.language);
  const status = normalizeRecognitionStatus(obj.recognitionStatus);
  const conf = Number(obj.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return null;

  const words = Array.isArray(obj.words)
    ? obj.words.filter(
        (w) =>
          w &&
          typeof w.text === 'string' &&
          w.text.trim().length > 0 &&
          w.bboxNorm &&
          Number.isFinite(w.bboxNorm.x0) &&
          Number.isFinite(w.bboxNorm.y0) &&
          Number.isFinite(w.bboxNorm.x1) &&
          Number.isFinite(w.bboxNorm.y1)
      )
    : [];

  const rawTx =
    typeof obj.raw_transcription === 'string'
      ? obj.raw_transcription.slice(0, 800)
      : typeof obj.rawTranscription === 'string'
        ? obj.rawTranscription.slice(0, 800)
        : obj.recognizedText.slice(0, 800);

  const uncertaintyVal = Number.isFinite(Number(obj.estimated_uncertainty))
    ? Math.max(0, Math.min(1, Number(obj.estimated_uncertainty)))
    : Number.isFinite(Number(obj.uncertainty))
      ? Math.max(0, Math.min(1, Number(obj.uncertainty)))
      : Math.max(0, Math.min(1, 1 - conf));

  const alternatives = Array.isArray(obj.alternative_candidates)
    ? obj.alternative_candidates.filter((a) => typeof a === 'string').slice(0, 6)
    : Array.isArray(obj.alternatives)
      ? obj.alternatives.filter((a) => typeof a === 'string').slice(0, 6)
      : [];

  return {
    recognizedText: obj.recognizedText.slice(0, 800),
    rawTranscription: rawTx,
    raw_transcription: rawTx,
    normalizedCandidate:
      typeof obj.normalizedCandidate === 'string'
        ? obj.normalizedCandidate.slice(0, 800)
        : undefined,
    uncertainty: uncertaintyVal,
    estimated_uncertainty: uncertaintyVal,
    completenessEvidence:
      typeof obj.completenessEvidence === 'string'
        ? obj.completenessEvidence.slice(0, 240)
        : undefined,
    revision:
      Number.isInteger(Number(obj.revision)) && Number(obj.revision) >= 0
        ? Number(obj.revision)
        : undefined,
    language: lang,
    detected_languages: Array.isArray(obj.detected_languages)
      ? obj.detected_languages.map((l) => normalizeLanguageCode(l)).filter((l) => l !== 'unknown').slice(0, 5)
      : [lang],
    recognitionStatus: status,
    confidence: conf,
    alternatives,
    alternative_candidates: alternatives,
    content_type: VALID_CONTENT_TYPES.has(obj.content_type) ? obj.content_type : 'unknown',
    completeness_status: VALID_COMPLETENESS.has(obj.completeness_status)
      ? obj.completeness_status
      : obj.recognitionStatus === 'IN_PROGRESS'
        ? 'in_progress'
        : obj.recognitionStatus === 'NON_TEXT'
          ? 'non_text'
          : 'complete',
    word_boundaries: Array.isArray(obj.word_boundaries)
      ? obj.word_boundaries.filter((w) => typeof w === 'string').slice(0, 60)
      : words.map((w) => w.text),
    sentence_boundaries: Array.isArray(obj.sentence_boundaries)
      ? obj.sentence_boundaries.filter((s) => typeof s === 'string').slice(0, 24)
      : [],
    handwriting_quality_observations: Array.isArray(obj.handwriting_quality_observations)
      ? obj.handwriting_quality_observations.filter((o) => typeof o === 'string').slice(0, 12)
      : [],
    recognized_regions: Array.isArray(obj.recognized_regions) ? obj.recognized_regions.slice(0, 12) : [],
    uncertain_regions: Array.isArray(obj.uncertain_regions) ? obj.uncertain_regions.slice(0, 12) : [],
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
  const clientKey = req.headers.get('x-forwarded-for') || 'local';
  if (!checkRateLimit(`rec:${clientKey}`, 60)) {
    return jsonResponse({ recognitionStatus: 'PROVIDER_UNAVAILABLE', error: 'RATE_LIMITED' }, 429);
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

  const upstreams = resolveVisionUpstreams();
  if (upstreams.length === 0) {
    return jsonResponse(
      {
        recognitionStatus: 'PROVIDER_UNAVAILABLE',
        error: 'No multimodal vision provider configured on server (DEEPSEEK_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY).',
      },
      503
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const prompt = [
      'You are a strict verbatim Korean, English, and Vietnamese handwriting Vision perception engine.',
      'Read ONLY the handwritten ink visible in this cropped image.',
      'For Hangul, read each occurrence independently. Use the spatial side of the branch relative to the stem: ㅏ/ㅑ right, ㅓ/ㅕ left, ㅗ/ㅛ above, ㅜ/ㅠ below. A small gap, open loop, or tilt can still belong to the same block. Inspect any final consonant. If competing readings remain, use AMBIGUOUS and list the alternatives.',
      'CRITICAL: Preserve learner errors verbatim! NEVER auto-correct Hangul spelling, particles, batchim, spacing, English tense/articles/S-V agreement, or punctuation.',
      'Include punctuation such as ".", "?", "!" verbatim in recognizedText and raw_transcription.',
      'Determine the hierarchical content_type (single_character, hangul_syllable, word, phrase, sentence, paragraph, user_question, free_drawing, mixed_content) and completeness_status.',
      'Estimate normalized bboxNorm (0..1 relative to crop width/height) for each eojeol/word token in words.',
      'Return strict JSON only:',
      '{"recognizedText": string, "raw_transcription": string, "normalizedCandidate": string, "estimated_uncertainty": number, "completenessEvidence": string, "language": "ko"|"vi"|"en"|"mixed"|"unknown", "detected_languages": ("ko"|"vi"|"en"|"mixed"|"unknown")[], "recognitionStatus": "RECOGNIZED"|"PARTIALLY_RECOGNIZED"|"IN_PROGRESS"|"AMBIGUOUS"|"NON_TEXT", "content_type": "single_character"|"hangul_syllable"|"word"|"phrase"|"sentence"|"paragraph"|"user_question"|"free_drawing"|"mixed_content"|"unknown", "completeness_status": "complete"|"in_progress"|"fragment"|"non_text"|"unknown", "confidence": number, "alternatives": string[], "word_boundaries": string[], "sentence_boundaries": string[], "handwriting_quality_observations": string[], "words": [{"text": string, "bboxNorm": {"x0": number, "y0": number, "x1": number, "y1": number}, "confidence": number}]}',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await callOpenAiCompatibleWithFallback(
      upstreams,
      (upstream) => ({
        model: upstream.model,
        temperature: 0.1,
        max_tokens: 900,
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
      { signal: ac.signal }
    );

    if (!result.ok || !result.resp) {
      console.error('[api/wonder/recognize] all vision upstreams failed:', result.errors);
      return jsonResponse({ recognitionStatus: 'PROVIDER_UNAVAILABLE', errors: result.errors }, 502);
    }

    const data = await result.resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? validateVisionJson(JSON.parse(jsonMatch[0])) : null;
    if (!parsed) {
      return jsonResponse({ recognitionStatus: 'AMBIGUOUS', error: 'Invalid vision payload' }, 422);
    }

    return jsonResponse({
      ...parsed,
      revision:
        Number.isInteger(Number(body.revision)) && Number(body.revision) >= 0
          ? Number(body.revision)
          : parsed.revision,
      providerId: result.upstream.providerId,
      failoverCount: result.failoverCount,
    });
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
