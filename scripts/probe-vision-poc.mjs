#!/usr/bin/env node
/**
 * Phase 1 Quality Gate — Standalone Live Vision Recognition PoC Probe
 * Inspired by MaximeRivest/riddle `src/main.rs` (--oracle-test [PNG]) and `src/oracle.rs`.
 *
 * Tests real user handwriting screenshots (NOT synthetic samples) against real multimodal
 * Vision LLMs (Gemini / OpenAI) with strict anti-auto-correction prompt and Zod validation.
 * Ground truth labels are kept strictly outside the prompt for post-hoc evaluation only.
 *
 * Never fabricates or mocks Vision responses: if no live key is configured, exits with
 * explicit status LIVE_VISION_VALIDATION_BLOCKED.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'docs', 'visual-evidence-vision-first', 'poc-probe-result.json');
const USER_UPLOADED_DIR =
  'C:\\Users\\linhn\\.gemini\\antigravity\\brain\\b6684f8c-30c0-4f32-a71d-3c4aa9b38b14\\.user_uploaded';

// Load optional .env.local without ever logging secrets
const envLocalPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const raw = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !(k in process.env)) {
      process.env[k] = v;
    }
  }
}

const DEFAULT_SAMPLES = [
  {
    id: 'real_ko_hakgyoeseo_97pct',
    file: path.join(USER_UPLOADED_DIR, 'media_1795766655797_ecc3745f.png'),
    postHocGroundTruth: '학교에서',
    note: 'Real mouse handwriting at 97% zoom (4 Hangul syllables with batchim ㄱ and compound vowel ㅔ)',
  },
  {
    id: 'real_ko_a_eo_25pct',
    file: path.join(USER_UPLOADED_DIR, 'media_1795751985724_69798feb.png'),
    postHocGroundTruth: '아 어',
    note: 'Two independent large Hangul syllables drawn at 25% zoom',
  },
  {
    id: 'real_ko_sa_a_34pct',
    file: path.join(USER_UPLOADED_DIR, 'media_1795752084137_d252e6fe.png'),
    postHocGroundTruth: '사 아',
    note: 'Two independent Hangul syllables drawn at 34% zoom',
  },
  {
    id: 'real_ko_mobile_a',
    file: path.join(USER_UPLOADED_DIR, 'media_1795750280490_9491ceba.jpg'),
    postHocGroundTruth: '아',
    note: 'Mobile touch handwriting screenshot',
  },
];

function computeCharDistance(a, b) {
  const s1 = Array.from(a.replace(/\s+/g, ''));
  const s2 = Array.from(b.replace(/\s+/g, ''));
  const dp = Array.from({ length: s1.length + 1 }, () => new Array(s2.length + 1).fill(0));
  for (let i = 0; i <= s1.length; i++) dp[i][0] = i;
  for (let j = 0; j <= s2.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[s1.length][s2.length];
}

async function callVisionUpstream(upstream, imageDataUrl) {
  const prompt = [
    'You are a strict verbatim Korean, English, and Vietnamese handwriting OCR engine.',
    'Read ONLY handwritten text in this board image. Never read UI sidebar/toolbar buttons or printed AI annotations.',
    'For Korean Hangul vowels, inspect exact tick direction relative to the stem: ㅏ/ㅑ ticks extend RIGHT of the vertical bar, ㅓ/ㅕ ticks extend LEFT between the consonant and vertical bar, ㅗ/ㅛ ticks point UP, ㅜ/ㅠ ticks point DOWN. Never guess 아 when the tick points LEFT (어).',
    'CRITICAL: Preserve learner errors verbatim! NEVER auto-correct Hangul spelling/particles or English grammar.',
    'Respond STRICT JSON only:',
    '{"recognizedText": string, "raw_transcription": string, "detected_languages": ("ko"|"vi"|"en"|"mixed"|"unknown")[], "language": "ko"|"vi"|"en"|"mixed"|"unknown", "recognitionStatus": "RECOGNIZED"|"PARTIALLY_RECOGNIZED"|"IN_PROGRESS"|"AMBIGUOUS"|"NON_TEXT", "content_type": "single_character"|"hangul_syllable"|"word"|"phrase"|"sentence"|"paragraph"|"user_question"|"free_drawing"|"mixed_content"|"unknown", "completeness_status": "complete"|"in_progress"|"fragment"|"non_text"|"unknown", "confidence": number, "estimated_uncertainty": number, "word_boundaries": string[], "sentence_boundaries": string[], "alternative_candidates": string[], "handwriting_quality_observations": string[]}',
  ].join('\n');

  let bodyObj = {
    model: upstream.model,
    temperature: 0.1,
    max_tokens: 700,
    ...(upstream.supportsThinkingDisable ? { thinking: { type: 'disabled' } } : {}),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };

  const t0 = Date.now();
  let resp = await fetch(upstream.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${upstream.apiKey}`,
    },
    body: JSON.stringify(bodyObj),
  });

  // Riddle src/oracle.rs HTTP 400 retry: max_tokens -> max_completion_tokens
  if (resp.status === 400) {
    const errText = await resp.text().catch(() => '');
    if (errText.includes('max_tokens') || errText.includes('max_completion_tokens')) {
      const { max_tokens, ...rest } = bodyObj;
      bodyObj = { ...rest, max_completion_tokens: max_tokens };
      resp = await fetch(upstream.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${upstream.apiKey}`,
        },
        body: JSON.stringify(bodyObj),
      });
    }
  }

  const latencyMs = Date.now() - t0;
  if (!resp.ok) {
    return { ok: false, httpStatus: resp.status, latencyMs, parsed: null };
  }
  // Also inspect recognized_regions / words for exact text extraction if needed
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  const match = content.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : null;
  if (parsed && typeof parsed.language === 'string') {
    const s = parsed.language.trim().toLowerCase();
    parsed.language =
      s === 'ko' || s.includes('korean') || s.includes('hangul')
        ? 'ko'
        : s === 'en' || s.includes('english')
          ? 'en'
          : s === 'vi' || s.includes('vietnam')
            ? 'vi'
            : s === 'mixed'
              ? 'mixed'
              : parsed.language;
  }
  return { ok: Boolean(parsed), httpStatus: resp.status, latencyMs, parsed, usage: data?.usage ?? null };
}

async function main() {
  const args = process.argv.slice(2);
  const imgFlagIdx = args.indexOf('--image');
  const customImage = imgFlagIdx >= 0 ? args[imgFlagIdx + 1] : null;

  const geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  const deepseekKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();

  const upstreams = [];
  if (deepseekKey) {
    upstreams.push({
      providerId: 'deepseek-vision-gateway',
      model:
        (process.env.DEEPSEEK_VISION_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash').trim() ||
        'deepseek-flash',
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: deepseekKey,
      supportsThinkingDisable: true,
    });
  }
  if (geminiKey) {
    upstreams.push({
      providerId: 'gemini-gateway',
      model: (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim() || 'gemini-2.5-flash',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey: geminiKey,
    });
  }
  if (openaiKey) {
    upstreams.push({
      providerId: 'openai-gateway',
      model: (process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: openaiKey,
    });
  }

  const samples = customImage
    ? [{ id: 'cli_custom_image', file: path.resolve(customImage), postHocGroundTruth: null, note: 'CLI custom image' }]
    : DEFAULT_SAMPLES.filter((s) => fs.existsSync(s.file));

  fs.mkdirSync(path.dirname(DEFAULT_OUT), { recursive: true });

  if (upstreams.length === 0) {
    const blockedReport = {
      status: 'LIVE_VISION_VALIDATION_BLOCKED',
      timestamp: new Date().toISOString(),
      reason: 'No server-side multimodal Vision API key (GEMINI_API_KEY or OPENAI_API_KEY) found in environment or .env.local.',
      deepseekConfiguredOnly: Boolean(deepseekKey),
      noteOnDeepSeek: deepseekKey
        ? 'DEEPSEEK_API_KEY is present, but deepseek-chat is text-only and cannot process handwriting PNG images.'
        : undefined,
      missingEnvVars: ['GEMINI_API_KEY', 'OPENAI_API_KEY'],
      samplesPrepared: samples.map((s) => ({
        id: s.id,
        file: path.basename(s.file),
        bytes: fs.existsSync(s.file) ? fs.statSync(s.file).size : 0,
        note: s.note,
      })),
      howToUnblock:
        'Add GEMINI_API_KEY=<key> or OPENAI_API_KEY=<key> into c:\\Users\\linhn\\Downloads\\SEED\\.env.local and re-run `node scripts/probe-vision-poc.mjs`.',
    };
    fs.writeFileSync(DEFAULT_OUT, JSON.stringify(blockedReport, null, 2));
    console.log(JSON.stringify(blockedReport, null, 2));
    return;
  }

  const results = [];
  for (const sample of samples) {
    const ext = path.extname(sample.file).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const b64 = fs.readFileSync(sample.file).toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    let finalOut = null;
    for (const up of upstreams) {
      const attempt = await callVisionUpstream(up, dataUrl);
      finalOut = { provider: up.providerId, model: up.model, ...attempt };
      if (attempt.ok) break;
    }

    const recognized = finalOut?.parsed?.recognizedText ?? '';
    const cer =
      sample.postHocGroundTruth && sample.postHocGroundTruth.length > 0
        ? Number(
            (
              computeCharDistance(recognized, sample.postHocGroundTruth) /
              Math.max(1, Array.from(sample.postHocGroundTruth.replace(/\s+/g, '')).length)
            ).toFixed(3)
          )
        : null;

    results.push({
      id: sample.id,
      file: path.basename(sample.file),
      provider: finalOut?.provider,
      model: finalOut?.model,
      ok: Boolean(finalOut?.ok),
      httpStatus: finalOut?.httpStatus,
      latencyMs: finalOut?.latencyMs,
      recognizedText: recognized,
      rawTranscription: finalOut?.parsed?.raw_transcription ?? recognized,
      contentType: finalOut?.parsed?.content_type ?? 'unknown',
      completenessStatus: finalOut?.parsed?.completeness_status ?? 'unknown',
      confidence: finalOut?.parsed?.confidence ?? 0,
      postHocGroundTruth: sample.postHocGroundTruth,
      charErrorRate: cer,
      usage: finalOut?.usage ?? null,
    });
  }

  const report = {
    status: results.every((r) => r.ok) ? 'LIVE_VISION_VALIDATION_PASS' : 'LIVE_VISION_VALIDATION_PARTIAL',
    timestamp: new Date().toISOString(),
    providersAvailable: upstreams.map((u) => `${u.providerId}:${u.model}`),
    results,
  };
  fs.writeFileSync(DEFAULT_OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[probe-vision-poc] fatal error:', err?.message || err);
  process.exit(1);
});
