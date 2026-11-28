import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  WonderSpatialTeachingActionSchema,
  WonderStroke,
  WonderVisionRecognitionResponseSchema,
} from '@seed/schema';
import {
  appendConversationMemoryTurn,
  buildAdaptiveObservationWindows,
  computeAdaptiveAnalysisDelayMs,
  computeStrokeBoundingBox,
  createEmptyWonderBoard,
  decimateStrokePoints,
  evaluateSynthesisLegibility,
  generateHandwrittenStrokesForText,
  mapSpatialTeachingActionToAnnotation,
  recognizeHandwritingRegions,
  recognizeWithHybridPipeline,
  thinZhangSuen,
  traceSkeletonStrokes,
} from '../src/index';
// @ts-ignore - runtime ESM import of gateway helper
import { callOpenAiCompatibleWithFallback, isAllowedUpstreamEndpoint } from '../../../api/_shared.mjs';
import { parseSseActionStream } from '../../../apps/mobile/src/lib/wonderGateway';

function makeFreehandStroke(
  id: string,
  pts: Array<[number, number]>,
  revision = 1,
  createdAt = Date.now()
): WonderStroke {
  const points = pts.map(([x, y], i) => ({
    x,
    y,
    pressure: 0.6,
    t: createdAt + i * 25,
  }));
  return {
    id,
    boardId: 'b_vf',
    points,
    color: '#2C221E',
    width: 3,
    tool: 'chalk',
    bbox: computeStrokeBoundingBox(points, 0, 0, 3, 'chalk'),
    transform: { dx: 0, dy: 0 },
    revision,
    createdAt,
    provenance: 'freehand_ink',
  };
}

test('Vision-first runs Multimodal Vision FIRST on freehand_ink when configured & consented', async () => {
  // Draw strokes resembling "사" — even if local Jamo matches, Vision MUST execute first when active
  const strokes = generateHandwrittenStrokesForText({
    boardId: 'b_vf',
    text: '사',
    startX: 100,
    startY: 120,
    revision: 1,
    color: '#2C221E',
  }).map((s) => ({
    ...s,
    provenance: 'freehand_ink' as const,
    fixtureHintText: undefined,
  }));

  let visionCalled = 0;
  let capturedContextLen = 0;

  const res = await recognizeWithHybridPipeline({
    strokes,
    boardId: 'b_vf',
    revision: 1,
    cloudConsentGranted: true,
    visionFirst: true,
    recentMemory: [
      {
        turnId: 't1',
        revision: 0,
        timestamp: 1000,
        regionId: 'r0',
        userText: '학교',
        aiSummary: 'Danh từ: trường học',
        actionType: 'EXPLAIN_WORD',
        language: 'ko',
      },
    ],
    cropRenderer: (_st, bbox) => ({
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      cropTransform: {
        worldMinX: bbox.minX - 24,
        worldMinY: bbox.minY - 24,
        worldWidth: bbox.width + 48,
        worldHeight: bbox.height + 48,
        pixelWidth: 256,
        pixelHeight: 256,
        scale: 1,
      },
    }),
    visionProvider: {
      id: 'mock-vision-contract',
      kind: 'multimodal_vision',
      capabilities: {
        supportsFreehandKorean: true,
        supportsFreehandVietnamese: true,
        supportsMixedLanguage: true,
        supportsWordPositioning: true,
        requiresNetwork: true,
      },
      async recognizeRegion(req) {
        visionCalled++;
        capturedContextLen = req.recentContext?.length ?? 0;
        return {
          status: 'RECOGNIZED',
          recognizedText: '학교에 가요.',
          rawTranscription: '학교에 가요.',
          language: 'ko',
          confidence: 0.94,
          alternatives: [],
          words: [
            { text: '학교에', bboxNorm: { x0: 0.05, y0: 0.1, x1: 0.5, y1: 0.9 }, confidence: 0.94 },
            { text: '가요.', bboxNorm: { x0: 0.52, y0: 0.1, x1: 0.95, y1: 0.9 }, confidence: 0.94 },
          ],
          providerId: 'mock-vision-contract',
          latencyMs: 12,
        };
      },
    },
  });

  assert.equal(visionCalled, 1);
  assert.equal(capturedContextLen, 0, 'Previous learner text must stay outside the OCR request');
  assert.equal(res.apiCallsMade, 1);
  assert.equal(res.regions[0]?.recognizedText, '학교에 가요.');
  assert.equal(res.regions[0]?.providerId, 'mock-vision-contract');
  assert.ok(res.observationWindows.length >= 1);
});

test('Vision-first degrades gracefully to verified local fallback when Vision returns PROVIDER_UNAVAILABLE', async () => {
  const strokes = generateHandwrittenStrokesForText({
    boardId: 'b_vf',
    text: '아',
    startX: 100,
    startY: 120,
    revision: 1,
    color: '#2C221E',
  }).map((s) => ({
    ...s,
    provenance: 'freehand_ink' as const,
    fixtureHintText: undefined,
  }));

  const res = await recognizeWithHybridPipeline({
    strokes,
    boardId: 'b_vf',
    revision: 1,
    cloudConsentGranted: true,
    visionFirst: true,
    cropRenderer: (_st, bbox) => ({
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      cropTransform: {
        worldMinX: bbox.minX - 24,
        worldMinY: bbox.minY - 24,
        worldWidth: bbox.width + 48,
        worldHeight: bbox.height + 48,
        pixelWidth: 256,
        pixelHeight: 256,
        scale: 1,
      },
    }),
    visionProvider: {
      id: 'offline-gw',
      kind: 'multimodal_vision',
      capabilities: {
        supportsFreehandKorean: true,
        supportsFreehandVietnamese: true,
        supportsMixedLanguage: true,
        supportsWordPositioning: true,
        requiresNetwork: true,
      },
      async recognizeRegion() {
        return {
          status: 'PROVIDER_UNAVAILABLE',
          recognizedText: '',
          language: 'unknown',
          confidence: 0,
          alternatives: [],
          providerId: 'offline-gw',
          latencyMs: 5,
          errorCode: 'HTTP_503',
        };
      },
    },
  });

  assert.equal(res.apiCallsMade, 1);
  assert.ok(res.regions.length === 1);
  // If local Jamo recognized "아", diagnostic logs VISION_UNAVAILABLE_LOCAL_FALLBACK instead of dropping
  assert.ok(
    res.diagnostics[0]?.fallbackReason === 'VISION_UNAVAILABLE_LOCAL_FALLBACK' ||
      res.regions[0]?.recognitionStatus === 'PROVIDER_UNAVAILABLE'
  );
});

test('Adaptive observation window preserves N->N+1 continuity while keeping distant independent notes separate', () => {
  // Distant independent items at x=80 and x=620
  const s1 = generateHandwrittenStrokesForText({
    boardId: 'b_vf',
    text: '사',
    startX: 80,
    startY: 140,
    revision: 1,
    color: '#2C221E',
  });
  const s2 = generateHandwrittenStrokesForText({
    boardId: 'b_vf',
    text: '아',
    startX: 620,
    startY: 140,
    revision: 2,
    color: '#2C221E',
  });
  const twoRegions = recognizeHandwritingRegions([...s1, ...s2], 'b_vf', 2);
  assert.equal(twoRegions.length, 2);

  const windows = buildAdaptiveObservationWindows(twoRegions);
  assert.equal(windows.length, 2);
  assert.ok(windows.every((w) => w.isDirty));

  // Unchanged vs new window detection
  const nextWindows = buildAdaptiveObservationWindows(twoRegions, [twoRegions[0]]);
  assert.equal(nextWindows[0]?.isDirty, false);
  assert.equal(nextWindows[1]?.isDirty, true);
});

test('Section 8 rich Vision schema preserves verbatim learner errors and validates optional rich metadata', () => {
  const valid = WonderVisionRecognitionResponseSchema.safeParse({
    recognizedText: '학교에 공부해요.',
    raw_transcription: '학교에 공부해요.',
    detected_languages: ['ko'],
    language: 'ko',
    recognitionStatus: 'RECOGNIZED',
    content_type: 'sentence',
    completeness_status: 'complete',
    confidence: 0.92,
    estimated_uncertainty: 0.08,
    word_boundaries: ['학교에', '공부해요.'],
    sentence_boundaries: ['학교에 공부해요.'],
    handwriting_quality_observations: ['clear stroke separation'],
    words: [
      { text: '학교에', bboxNorm: { x0: 0.05, y0: 0.1, x1: 0.45, y1: 0.9 }, confidence: 0.91 },
      { text: '공부해요.', bboxNorm: { x0: 0.48, y0: 0.1, x1: 0.95, y1: 0.9 }, confidence: 0.93 },
    ],
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.raw_transcription, '학교에 공부해요.');
  assert.equal(valid.data.content_type, 'sentence');
});

test('Section 10 Zod spatial actions + SSE ReadableStream parser drop stale revisions & reasoning tokens', async () => {
  // Verify all 13 Section 10 action types parse cleanly
  const actionTypes = [
    'WAIT',
    'EXPLAIN_CHARACTER',
    'EXPLAIN_WORD',
    'MARK_GRAMMAR_ERROR',
    'PROVIDE_HINT',
    'WRITE_CORRECTION',
    'WRITE_EXPLANATION',
    'CREATE_EXAMPLE',
    'CREATE_TRACE_GUIDE',
    'DRAW_CLOUD',
    'DRAW_ARROW',
    'PRAISE',
    'RETRACT_ANNOTATION',
  ] as const;

  for (const type of actionTypes) {
    const p = WonderSpatialTeachingActionSchema.safeParse({
      actionId: `a_${type}`,
      type,
      regionId: 'r1',
      sourceRevision: 5,
      targetText: '학교에',
      suggestedCorrection: '학교에서',
      explanation: 'Dùng -에서 cho nơi diễn ra hành động.',
      confidence: 0.91,
    });
    assert.equal(p.success, true, `Failed action schema for ${type}`);
  }

  // Test browser SSE parser ignoring reasoning fields and dropping stale sourceRevision=3 when current=5
  const sseText =
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'hidden thinking', content: '{"action":{"actionId":"stale1","type":"MARK_GRAMMAR_ERROR","regionId":"r1","sourceRevision":3,"targetText":"학교에","suggestedCorrection":"학교에서","explanation":"stale"},"providerId":"gemini-gateway"}\n' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: '{"action":{"actionId":"fresh1","type":"MARK_GRAMMAR_ERROR","regionId":"r1","sourceRevision":5,"targetText":"학교에","suggestedCorrection":"학교에서","explanation":"Dùng -에서 cho nơi hành động."},"providerId":"gemini-gateway"}\n' } }] })}\n\n` +
    `data: [DONE]\n\n`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(sseText.slice(0, 90)));
      ctrl.enqueue(encoder.encode(sseText.slice(90)));
      ctrl.close();
    },
  });

  const received: string[] = [];
  const parsed = await parseSseActionStream(stream, {
    expectedRevision: 5,
    onAction: (act) => received.push(act.actionId),
  });
  assert.deepEqual(received, ['fresh1']);
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.type, 'MARK_GRAMMAR_ERROR');

  // Map fresh spatial action to collision-free WonderAnnotation
  const board = createEmptyWonderBoard('b_vf');
  const reg = recognizeHandwritingRegions(
    generateHandwrittenStrokesForText({
      boardId: 'b_vf',
      text: '학교에',
      startX: 100,
      startY: 120,
      revision: 5,
      color: '#2C221E',
    }),
    'b_vf',
    5
  )[0]!;
  const mapped = mapSpatialTeachingActionToAnnotation({
    rawAction: { ...parsed.actions[0], regionId: reg.regionId },
    boardId: board.id,
    currentRevision: 5,
    regions: [reg],
    occupiedBoxes: [],
    themeId: board.themeId,
  });
  assert.equal(mapped.status, 'APPLIED');
  assert.equal(mapped.annotation?.suggested_correction, '학교에서');
  assert.equal(mapSpatialTeachingActionToAnnotation({
    rawAction: parsed.actions[0], boardId: board.id, currentRevision: 5, regions: [reg],
    occupiedBoxes: [], themeId: board.themeId,
  }).status, 'REJECTED_UNANCHORED');

  const staleMapped = mapSpatialTeachingActionToAnnotation({
    rawAction: { ...parsed.actions[0], sourceRevision: 2 },
    boardId: board.id,
    currentRevision: 5,
    regions: [reg],
    occupiedBoxes: [],
    themeId: board.themeId,
  });
  assert.equal(staleMapped.status, 'REJECTED_STALE');
});

test('Gateway security: host allowlist blocks arbitrary URLs; failover handles 429 & Riddle max_completion_tokens 400 retry', async () => {
  assert.equal(
    isAllowedUpstreamEndpoint('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'),
    true
  );
  assert.equal(isAllowedUpstreamEndpoint('https://api.openai.com/v1/chat/completions'), true);
  assert.equal(isAllowedUpstreamEndpoint('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedUpstreamEndpoint('https://evil.example.com/v1/chat/completions'), false);

  let primaryCalls = 0;
  let secondaryAttempts = 0;
  const mockSrv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/primary') {
        primaryCalls++;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate limit' }));
        return;
      }
      if (req.url === '/secondary') {
        secondaryAttempts++;
        const payload = JSON.parse(raw);
        // Simulate OpenAI HTTP 400 rejecting max_tokens and succeeding on max_completion_tokens
        if ('max_tokens' in payload) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Unsupported parameter: max_tokens, use max_completion_tokens' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ ok: true, usedCompletionTokens: payload.max_completion_tokens }) } }],
          })
        );
      }
    });
  });

  await new Promise<void>((r) => mockSrv.listen(0, '127.0.0.1', () => r()));
  const port = (mockSrv.address() as { port: number }).port;
  try {
    const out = await callOpenAiCompatibleWithFallback(
      [
        {
          providerId: 'gemini-gateway',
          providerKey: 'gemini',
          model: 'gemini-2.5-flash',
          endpoint: `http://127.0.0.1:${port}/primary`,
          apiKey: 'fake-1',
        },
        {
          providerId: 'openai-gateway',
          providerKey: 'openai',
          model: 'gpt-4o-mini',
          endpoint: `http://127.0.0.1:${port}/secondary`,
          apiKey: 'fake-2',
        },
      ],
      (up: { model: string }) => ({ model: up.model, max_tokens: 400, messages: [] }),
      { allowCustomEndpointForTest: true }
    );
    assert.equal(out.ok, true);
    assert.equal(primaryCalls, 1);
    assert.equal(secondaryAttempts, 2);
    assert.equal(out.upstream.providerKey, 'openai');
    assert.equal(out.failoverCount, 1);
  } finally {
    await new Promise<void>((r) => mockSrv.close(() => r()));
  }
});

test('Riddle memory & Zhang-Suen handwriting synthesis ports work cleanly and fall back on dense text', () => {
  // 1. Stroke point decimation & bounded conversation memory (riddle/src/memory.rs)
  const dense = Array.from({ length: 10 }, (_, i) => ({ x: i * 1, y: 0, pressure: 0.5, t: i }));
  const decimated = decimateStrokePoints(dense, 9);
  assert.ok(decimated.length < dense.length);
  assert.equal(decimated[0]?.x, 0);
  assert.equal(decimated[decimated.length - 1]?.x, 9);

  let mem: ReturnType<typeof appendConversationMemoryTurn> = [];
  for (let i = 0; i < 20; i++) {
    mem = appendConversationMemoryTurn(
      mem,
      {
        turnId: `t_${i}`,
        revision: i,
        timestamp: 1000 + i,
        regionId: 'r1',
        userText: `txt ${i}`,
        aiSummary: `sum ${i}`,
        actionType: 'EXPLAIN_WORD',
        language: 'ko',
      },
      16
    );
  }
  assert.equal(mem.length, 16);
  assert.equal(mem[0]?.turnId, 't_4');

  // 2. Zhang-Suen thinning + trace (riddle/src/script.rs) on a 3px-thick L-shape bitmap
  const w = 16;
  const h = 16;
  const mask = new Uint8Array(w * h);
  for (let y = 2; y <= 13; y++) {
    for (let x = 3; x <= 5; x++) mask[y * w + x] = 1;
  }
  for (let y = 11; y <= 13; y++) {
    for (let x = 3; x <= 12; x++) mask[y * w + x] = 1;
  }
  const thinned = thinZhangSuen(w, h, mask);
  let rawCount = 0;
  let thinCount = 0;
  for (let i = 0; i < w * h; i++) {
    rawCount += mask[i]!;
    thinCount += thinned[i]!;
  }
  assert.ok(thinCount > 0 && thinCount < rawCount);
  const traced = traceSkeletonStrokes(w, h, thinned, 2);
  assert.ok(traced.length >= 1);

  const legibilityGood = evaluateSynthesisLegibility(traced, 'ㄴ');
  assert.equal(legibilityGood.usable, true);

  const legibilityDenseFallback = evaluateSynthesisLegibility(
    traced,
    '이 문장은 너무 길어서 스켈레톤 애니메이션 대신 글자 단위 표시로 자동 전환됩니다.'
  );
  assert.equal(legibilityDenseFallback.usable, false);

  // 3. Adaptive delay honors Riddle 2800ms IDLE_COMMIT ceiling on mid-word strokes
  const slowDelay = computeAdaptiveAnalysisDelayMs([0, 950, 1900], [
    makeFreehandStroke('s1', [[10, 10], [20, 40]]),
  ]);
  assert.ok(slowDelay.semanticDelayMs >= 900 && slowDelay.semanticDelayMs <= 2800);
});
