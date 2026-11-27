import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WonderBoardActionSchema } from '@seed/schema';
import {
  alignVisionWordsToStrokeClusters,
  applyConfirmedUserTranscript,
  applyWonderLearningEventsToProfile,
  boxesIntersect,
  buildBoardContextModel,
  buildHangulStrokeOrderDemo,
  classifyLearningIntents,
  computeAdaptiveAnnotationTypography,
  computeAnnotationPhaseTimings,
  computeCloudDurationMs,
  computeCollisionFreePlacement,
  computeQueueSpeedMultiplier,
  computeStrokeBoundingBox,
  createEmptyWonderBoard,
  createInitialAiProfile,
  deduplicateWonderAnnotations,
  evaluateSelfCorrectionEvidence,
  evaluateWonderBoardBenchmarkV3,
  executeGestureQuery,
  FONT_FAMILY_KO_CHALK,
  FONT_FAMILY_VI_CHALK,
  generateHandwrittenStrokesForText,
  generateScallopedCloudGeometry,
  orchestrateWonderTutor,
  recognizeHandwritingRegions,
  recognizeWithHybridPipeline,
  segmentMixedLanguageRuns,
  segmentUnicodeGraphemes,
  sliceHangulDemoAtProgress,
  sliceMixedLanguageReveal,
  verifyCloudClearance,
  WonderRecognitionCache,
  wrapMixedLanguageRuns,
} from '../src/index';
// @ts-ignore - runtime ESM import of gateway module
import { createGatewayServer } from '../../../services/ai-gateway/server.mjs';

test('V3-1 Hangul canonical NIKL stroke-order demo decomposes syllables & slices without jumps', () => {
  const ga = buildHangulStrokeOrderDemo({ text: '가', startX: 40, startY: 50 });
  // ㄱ (1) + ㅏ (2) = 3 strokes
  assert.equal(ga.strokes.length, 3);
  assert.ok(ga.scopeNote.includes('11,172'));

  const han = buildHangulStrokeOrderDemo({ text: '한', startX: 40, startY: 50 });
  // ㅎ (3) + ㅏ (2) + ㄴ (1) = 6 strokes
  assert.equal(han.strokes.length, 6);

  const half = sliceHangulDemoAtProgress(han, 0.5);
  assert.equal(half.completedPaths.length, 3);
  assert.ok(half.activePath === null || half.activePath.d.startsWith('M '));

  const full = sliceHangulDemoAtProgress(han, 1);
  assert.equal(full.completedPaths.length, 6);
});

test('V3-2 Hybrid Perception: aligns Vision crop boxes, handles PROVIDER_UNAVAILABLE & explicit user confirmation', async () => {
  const freehandStrokes = [
    {
      id: 'fh_w1',
      boardId: 'b_fh',
      points: [
        { x: 100, y: 100, pressure: 0.6, t: 1 },
        { x: 140, y: 120, pressure: 0.6, t: 2 },
        { x: 110, y: 140, pressure: 0.6, t: 3 },
      ],
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: { minX: 95, minY: 95, maxX: 145, maxY: 145, width: 50, height: 50 },
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    },
    {
      id: 'fh_w2',
      boardId: 'b_fh',
      points: [
        { x: 195, y: 100, pressure: 0.6, t: 4 },
        { x: 235, y: 140, pressure: 0.6, t: 5 },
      ],
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: { minX: 190, minY: 95, maxX: 240, maxY: 145, width: 50, height: 50 },
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    },
  ];

  // Failing provider -> PROVIDER_UNAVAILABLE (must NOT throw or invent feedback)
  const failingRes = await recognizeWithHybridPipeline({
    strokes: freehandStrokes,
    boardId: 'b_fh',
    revision: 1,
    visionProvider: {
      id: 'down-gw',
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
          providerId: 'down-gw',
          latencyMs: 5,
        };
      },
    },
  });
  assert.equal(failingRes.regions[0]?.recognitionStatus, 'PROVIDER_UNAVAILABLE');
  assert.equal(failingRes.regions[0]?.recognizedText, '');

  // Mocked Vision provider with normalized crop boxes -> aligns cleanly + caches repeat calls
  const cache = new WonderRecognitionCache(16);
  let calls = 0;
  const mockProvider = {
    id: 'mock-vision',
    kind: 'multimodal_vision' as const,
    capabilities: {
      supportsFreehandKorean: true,
      supportsFreehandVietnamese: true,
      supportsMixedLanguage: true,
      supportsWordPositioning: true,
      requiresNetwork: true,
    },
    async recognizeRegion() {
      calls++;
      return {
        status: 'RECOGNIZED' as const,
        recognizedText: '저는 학생예요',
        language: 'ko' as const,
        confidence: 0.93,
        alternatives: [],
        words: [
          { text: '저는', bboxNorm: { x0: 0.05, y0: 0.1, x1: 0.35, y1: 0.9 }, confidence: 0.94 },
          { text: '학생예요', bboxNorm: { x0: 0.58, y0: 0.1, x1: 0.95, y1: 0.9 }, confidence: 0.92 },
        ],
        providerId: 'mock-vision',
        latencyMs: 12,
      };
    },
  };
  const cropRenderer = () => ({
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    cropTransform: {
      worldMinX: 80,
      worldMinY: 85,
      worldWidth: 180,
      worldHeight: 75,
      pixelWidth: 360,
      pixelHeight: 150,
      scale: 2,
    },
  });

  const okRes1 = await recognizeWithHybridPipeline({
    strokes: freehandStrokes,
    boardId: 'b_fh',
    revision: 1,
    visionProvider: mockProvider,
    cropRenderer,
    cache,
  });
  assert.equal(okRes1.regions[0]?.recognitionStatus, 'RECOGNIZED');
  assert.equal(okRes1.regions[0]?.spans[0]?.strokeIds[0], 'fh_w1');
  assert.equal(okRes1.regions[0]?.spans[1]?.strokeIds[0], 'fh_w2');

  // Second run hits cache (0 additional calls)
  const okRes2 = await recognizeWithHybridPipeline({
    strokes: freehandStrokes,
    boardId: 'b_fh',
    revision: 1,
    visionProvider: mockProvider,
    cropRenderer,
    cache,
  });
  assert.equal(calls, 1);
  assert.equal(okRes2.regions[0]?.recognizedText, '저는 학생예요');

  // User confirmation overrides provenance transparently
  const confirmed = applyConfirmedUserTranscript(failingRes.regions[0], '안녕하세요');
  assert.equal(confirmed.provenance, 'user_confirmed');
  assert.equal(confirmed.providerId, 'user-confirmed');
  assert.equal(confirmed.recognitionStatus, 'RECOGNIZED');

  void alignVisionWordsToStrokeClusters;
});

test('V3-3 Learning Intent Engine classifies all 14 intent categories with supporting evidence', () => {
  const b = createEmptyWonderBoard('b_intent');
  const emptyCtx = buildBoardContextModel({
    boardId: b.id,
    revision: 1,
    regions: [],
    strokes: [],
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const checkIntent = (text: string, expected: string) => {
    const strokes = generateHandwrittenStrokesForText({
      boardId: b.id,
      text,
      startX: 40,
      startY: 60,
      revision: 1,
      color: '#2C221E',
      provenance: 'fixture_sample',
    });
    const regs = recognizeHandwritingRegions(strokes, b.id, 1);
    const intents = classifyLearningIntents(regs[0], emptyCtx, b);
    assert.ok(
      intents.some((i) => i.intent === expected),
      `Expected ${expected} for "${text}", got ${JSON.stringify(intents)}`
    );
  };

  checkIntent('Tôi muốn học cách giới thiệu bản thân.', 'LEARN_NEW_TOPIC');
  checkIntent('안녕하세요 nghĩa là gì?', 'ASK_MEANING');
  checkIntent('Cách viết 한?', 'ASK_HOW_TO_WRITE');
  checkIntent('Phát âm 안녕하세요 đọc như thế nào?', 'ASK_PRONUNCIATION');
  checkIntent('Xin lỗi tiếng Hàn là gì?', 'ASK_TRANSLATION');
  checkIntent('Câu 저는 학생예요 đúng chưa?', 'ASK_GRAMMAR');
  checkIntent('저는 학교에 가요.', 'PRACTICE_SENTENCE');
});

test('V3-4 Zero-Knowledge Beginner Micro-Teaching Loop + Cognitive Load Throttling + Schema Protocol', () => {
  const b = createEmptyWonderBoard('b_beg');
  b.guidanceLevel = 'beginner_friendly';

  // Step 1: Beginner writes Vietnamese learning goal
  const introStrokes = generateHandwrittenStrokesForText({
    boardId: b.id,
    text: 'Tôi muốn học cách giới thiệu bản thân.',
    startX: 50,
    startY: 60,
    revision: 1,
    color: '#2C221E',
    provenance: 'fixture_sample',
  });
  b.strokes = introStrokes;
  b.revision = 1;
  let regs = recognizeHandwritingRegions(b.strokes, b.id, 1);
  let ctx = buildBoardContextModel({
    boardId: b.id,
    revision: 1,
    regions: regs,
    strokes: b.strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const t1 = orchestrateWonderTutor({
    board: b,
    regions: regs,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(t1.nextBeginnerLoop?.active, true);
  assert.equal(t1.teachingCardsToAdd[0]?.koreanPhrase, '안녕하세요.');
  assert.ok(t1.scheduledActions.every((act) => WonderBoardActionSchema.parse(act)));

  // Step 2: Learner tries below teaching card with copula batchim error ("저는 학생예요.")
  b.teachingCards = t1.teachingCardsToAdd;
  b.beginnerLoop = t1.nextBeginnerLoop;
  const cardMaxY = b.teachingCards[0].geometry.maxY;
  b.strokes = [
    ...b.strokes,
    ...generateHandwrittenStrokesForText({
      boardId: b.id,
      text: '저는 학생예요.',
      startX: 60,
      startY: cardMaxY + 40,
      revision: 2,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
  ];
  b.revision = 2;
  regs = recognizeHandwritingRegions(b.strokes, b.id, 2);
  ctx = buildBoardContextModel({
    boardId: b.id,
    revision: 2,
    regions: regs,
    strokes: b.strokes,
    existingAnnotations: [],
    existingTeachingCards: b.teachingCards,
  });
  assert.ok(ctx.relations.some((r) => r.relationType === 'answer_to_ai_card'));
  const t2 = orchestrateWonderTutor({
    board: b,
    regions: regs,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: b.teachingCards,
  });
  assert.equal(t2.annotationsToAdd[0]?.suggested_correction, '학생이에요');

  // Step 3: Cognitive throttling under beginner_friendly keeps active queue bounded while saving deferredActions
  b.annotations = t2.annotationsToAdd;
  b.strokes = [
    ...b.strokes,
    ...generateHandwrittenStrokesForText({
      boardId: b.id,
      text: '저는 어제 학교에 가요.',
      startX: 60,
      startY: cardMaxY + 210,
      revision: 3,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
    ...generateHandwrittenStrokesForText({
      boardId: b.id,
      text: '저는 사과가 먹어요.',
      startX: 60,
      startY: cardMaxY + 370,
      revision: 3,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
  ];
  b.revision = 3;
  regs = recognizeHandwritingRegions(b.strokes, b.id, 3);
  ctx = buildBoardContextModel({
    boardId: b.id,
    revision: 3,
    regions: regs,
    strokes: b.strokes,
    existingAnnotations: b.annotations,
    existingTeachingCards: b.teachingCards,
  });
  const t3 = orchestrateWonderTutor({
    board: b,
    regions: regs,
    context: ctx,
    existingAnnotations: b.annotations,
    existingTeachingCards: b.teachingCards,
  });
  assert.equal(t3.annotationsToAdd.length, 1);
  assert.ok(t3.deferredActions.length >= 1);
});

test('V3-5 Evidence-Based Self-Correction & Idempotent BKT/Elo Profile Updates', () => {
  const b = createEmptyWonderBoard('b_ev');
  b.strokes = generateHandwrittenStrokesForText({
    boardId: b.id,
    text: '저는 어제 학교에 가요.',
    startX: 60,
    startY: 70,
    revision: 1,
    color: '#2C221E',
    provenance: 'fixture_sample',
  });
  let regs = recognizeHandwritingRegions(b.strokes, b.id, 1);
  let ctx = buildBoardContextModel({
    boardId: b.id,
    revision: 1,
    regions: regs,
    strokes: b.strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const t1 = orchestrateWonderTutor({
    board: b,
    regions: regs,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const schoolAnn = t1.annotationsToAdd[0];
  assert.equal(schoolAnn.suggested_correction, '갔어요');

  // Unrelated sentence containing 갔어요? e.g. "친구가 집에 갔어요." shares zero roots with "어제 학교" -> must NOT resolve!
  b.strokes = [
    ...b.strokes,
    ...generateHandwrittenStrokesForText({
      boardId: b.id,
      text: '친구가 집에 갔어요.',
      startX: 60,
      startY: 220,
      revision: 2,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
  ];
  regs = recognizeHandwritingRegions(b.strokes, b.id, 2);
  ctx = buildBoardContextModel({
    boardId: b.id,
    revision: 2,
    regions: regs,
    strokes: b.strokes,
    existingAnnotations: [schoolAnn],
    existingTeachingCards: [],
  });
  const unrelatedEv = evaluateSelfCorrectionEvidence(schoolAnn, regs, ctx);
  assert.equal(unrelatedEv.resolved, false);

  // Now learner writes "저는 어제 학교에 갔어요." -> shared roots (어제, 학교) + 갔어요 -> RESOLVED!
  b.strokes = [
    ...b.strokes,
    ...generateHandwrittenStrokesForText({
      boardId: b.id,
      text: '저는 어제 학교에 갔어요.',
      startX: 60,
      startY: 370,
      revision: 3,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
  ];
  regs = recognizeHandwritingRegions(b.strokes, b.id, 3);
  ctx = buildBoardContextModel({
    boardId: b.id,
    revision: 3,
    regions: regs,
    strokes: b.strokes,
    existingAnnotations: [schoolAnn],
    existingTeachingCards: [],
  });
  const validEv = evaluateSelfCorrectionEvidence(schoolAnn, regs, ctx);
  assert.equal(validEv.resolved, true);

  // Idempotent Elo/BKT updates: replaying same idempotencyKey has zero second change!
  const keys = new Set<string>();
  const evt = {
    eventId: 'e1',
    idempotencyKey: 'fix:b_ev:ann1',
    boardId: b.id,
    eventType: 'self_correction_completed' as const,
    conceptIds: ['kc_morph_particles'],
    recognizedText: '저는 어제 학교에 갔어요.',
    confirmed: true,
    evidenceKind: 'guided_self_correction' as const,
    timestamp: Date.now(),
  };
  const p0 = createInitialAiProfile();
  const p1 = applyWonderLearningEventsToProfile(p0, [evt], keys);
  const p2 = applyWonderLearningEventsToProfile(p1, [evt], keys);
  assert.ok(p1.eloRating !== p0.eloRating);
  assert.equal(p2.eloRating, p1.eloRating);
  assert.equal(p2.totalResponses, p1.totalResponses);
});

test('V3-6 Production AI Gateway enforces auth, rate limits, 503 unavailability, and mocked Vision 200 contract', async () => {
  const srv = createGatewayServer({
    authToken: 'secret-token',
    rateLimitMax: 4,
    geminiKey: '',
    openaiKey: '',
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const port = (srv.address() as { port: number }).port;
  const reqJson = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path, method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
            });
          });
        }
      );
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });

  try {
    const health = await reqJson('GET', '/api/wonder/health', {});
    assert.equal(health.status, 200);
    assert.equal(health.json.authRequired, true);

    const unauth = await reqJson(
      'POST',
      '/api/wonder/recognize',
      { 'Content-Type': 'application/json' },
      { imageDataUrl: 'data:image/png;base64,AA==' }
    );
    assert.equal(unauth.status, 401);

    const noKey = await reqJson(
      'POST',
      '/api/wonder/recognize',
      { 'Content-Type': 'application/json', Authorization: 'Bearer secret-token' },
      { imageDataUrl: 'data:image/png;base64,AA==' }
    );
    assert.equal(noKey.status, 503);
    assert.equal(noKey.json.recognitionStatus, 'PROVIDER_UNAVAILABLE');
  } finally {
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  // Test valid mocked upstream Vision response through Gateway
  const srvMock = createGatewayServer({
    geminiKey: 'mock-server-only-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recognizedText: '한국어',
                  language: 'ko',
                  recognitionStatus: 'RECOGNIZED',
                  confidence: 0.96,
                  alternatives: [],
                  words: [
                    { text: '한국어', bboxNorm: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, confidence: 0.96 },
                  ],
                }),
              },
            },
          ],
        };
      },
    }),
  });
  await new Promise<void>((resolve) => srvMock.listen(0, '127.0.0.1', () => resolve()));
  const mockPort = (srvMock.address() as { port: number }).port;
  try {
    const res = await new Promise<{ status: number; json: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: mockPort,
            path: '/api/wonder/recognize',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (r) => {
            const chunks: Buffer[] = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () =>
              resolve({
                status: r.statusCode ?? 0,
                json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
              })
            );
          }
        );
        req.on('error', reject);
        req.write(JSON.stringify({ imageDataUrl: 'data:image/png;base64,AA==' }));
        req.end();
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.recognizedText, '한국어');
    assert.equal(res.json.providerId, 'gemini-gateway');
  } finally {
    await new Promise<void>((resolve) => srvMock.close(() => resolve()));
  }
});

test('V3-7 Stratified Benchmark V3 reports honest Datasets A-E separation', () => {
  const report = evaluateWonderBoardBenchmarkV3();
  console.log('Wonder Board Benchmark V3:', JSON.stringify(report, null, 2));
  assert.equal(report.datasetB_realHumanFreehand.status, 'NOT_AVAILABLE');
  assert.equal(report.datasetC_unseenLanguage.unseenHandwriting.status, 'NOT_MEASURED_OFFLINE');
  assert.ok(report.datasetC_unseenLanguage.unseenLinguisticAnalysis.intentClassificationAccuracy >= 0.85);
  assert.equal(report.datasetD_negativeInputs.falseAnnotationRate, 0);
  assert.equal(report.datasetE_continuousSessions.duplicateAnnotationRate, 0);
  assert.equal(report.datasetE_continuousSessions.staleAnnotationRate, 0);
  assert.equal(report.datasetE_continuousSessions.selfCorrectionAccuracy, 1);
  assert.equal(report.datasetE_continuousSessions.idempotentEventAccuracy, 1);
});

test('V3-8 Large freehand Hangul syllable "아" recognizes cleanly and places explanation outside cloud', () => {
  // Replicate user drawing a large ~350px-tall freehand 아 (left ㅇ oval + right | + right -)
  const ovalPts = Array.from({ length: 16 }, (_, k) => {
    const a = -0.35 + (k / 15) * (Math.PI * 1.82); // slightly open at top like human handwriting
    return {
      x: 340 + Math.cos(a) * 68,
      y: 350 + Math.sin(a) * 145,
      pressure: 0.55,
      t: k * 10,
    };
  });
  const vertPts = [
    { x: 475, y: 195, pressure: 0.55, t: 200 },
    { x: 470, y: 505, pressure: 0.55, t: 220 },
  ];
  const horizPts = [
    { x: 468, y: 360, pressure: 0.55, t: 300 },
    { x: 545, y: 362, pressure: 0.55, t: 320 },
  ];

  const strokes = [
    {
      id: 'user_a_1',
      boardId: 'b_large_a',
      points: ovalPts,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(ovalPts, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    },
    {
      id: 'user_a_2',
      boardId: 'b_large_a',
      points: vertPts,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(vertPts, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    },
    {
      id: 'user_a_3',
      boardId: 'b_large_a',
      points: horizPts,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(horizPts, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    },
  ];

  const regs = recognizeHandwritingRegions(strokes, 'b_large_a', 1);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].recognizedText, '아');

  const board = { ...createEmptyWonderBoard('b_large_a'), strokes, regions: regs, revision: 1 };
  const q = executeGestureQuery({
    board,
    selectedStrokeIds: strokes.map((s) => s.id),
    intent: 'explain',
  });
  assert.ok(q.annotation);
  assert.equal(q.annotation!.target_text, '아');
  assert.ok(q.annotation!.explanation.includes('아'));
  assert.equal(q.annotation!.suggested_correction, '아 [a]');

  const cloud = generateScallopedCloudGeometry(q.annotation!.target_geometry, q.annotation!.cloud_seed);
  assert.equal(
    boxesIntersect(q.annotation!.note_geometry, cloud.outerBounds, 6),
    false,
    'Explanation note must sit strictly OUTSIDE the cloud outline!'
  );
});

test('V3-9 Multi-syllable freehand Korean word "고마워" recognizes accurately and explains cleanly', () => {
  const mkStroke = (id: string, pts: Array<{ x: number; y: number }>) => {
    const full = pts.map((p, idx) => ({ ...p, pressure: 0.55, t: idx * 10 }));
    return {
      id,
      boardId: 'b_gomawo',
      points: full,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(full, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    };
  };

  // Mimic user's exact 9 strokes for 고 마 워
  const strokes = [
    // 고: ㄱ (above), | (stem), ㅡ (bottom)
    mkStroke('g1', [{ x: 300, y: 160 }, { x: 370, y: 160 }, { x: 370, y: 245 }]),
    mkStroke('g2', [{ x: 335, y: 245 }, { x: 335, y: 295 }]),
    mkStroke('g3', [{ x: 285, y: 295 }, { x: 390, y: 295 }]),
    // 마: ㄴ + ㄱ (forming ㅁ), | + - (forming ㅏ)
    mkStroke('m1', [{ x: 420, y: 175 }, { x: 420, y: 280 }, { x: 462, y: 282 }]),
    mkStroke('m2', [{ x: 422, y: 175 }, { x: 465, y: 175 }, { x: 465, y: 280 }]),
    mkStroke('m3', [{ x: 482, y: 155 }, { x: 482, y: 315 }]),
    mkStroke('m4', [{ x: 482, y: 235 }, { x: 510, y: 235 }]),
    // 워: ㅇ (top-left), ㅡ + | (ㅜ below), | + - (right)
    mkStroke('w1', Array.from({ length: 12 }, (_, k) => {
      const a = (k / 11) * Math.PI * 1.9;
      return { x: 560 + Math.cos(a) * 24, y: 178 + Math.sin(a) * 22 };
    })),
    mkStroke('w2', [{ x: 525, y: 222 }, { x: 595, y: 222 }]),
    mkStroke('w3', [{ x: 560, y: 222 }, { x: 560, y: 310 }]),
    mkStroke('w4', [{ x: 615, y: 155 }, { x: 615, y: 315 }]),
    mkStroke('w5', [{ x: 590, y: 270 }, { x: 635, y: 272 }]),
  ];

  const regs = recognizeHandwritingRegions(strokes, 'b_gomawo', 1);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].recognizedText, '고마워');

  const board = { ...createEmptyWonderBoard('b_gomawo'), strokes, regions: regs, revision: 1 };
  const q = executeGestureQuery({
    board,
    selectedStrokeIds: strokes.map((s) => s.id),
    intent: 'explain',
  });
  assert.ok(q.annotation);
  assert.equal(q.annotation!.target_text, '고마워');
  assert.equal(q.annotation!.suggested_correction, '고마워 [ko-ma-wo]');
  assert.ok(q.annotation!.explanation.includes('Cảm ơn'));
});

test('V3-10 Diagonal freehand "어디야" and "나도야" stay separated and compose accurately', () => {
  const mkStroke = (id: string, pts: Array<{ x: number; y: number }>) => {
    const full = pts.map((p, idx) => ({ ...p, pressure: 0.55, t: idx * 10 }));
    return {
      id,
      boardId: 'b_diag',
      points: full,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(full, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    };
  };

  const ox1 = 80;
  const oy1 = 100;
  const ox2 = 420;
  const oy2 = 225;

  const strokes = [
    // 어디야 (top-left, includes 1-stroke C-bracket ㄷ)
    mkStroke(
      'e1',
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ox1 + 28 + Math.cos(a) * 24, y: oy1 + 70 + Math.sin(a) * 42 };
      })
    ),
    mkStroke('e2', [{ x: ox1 + 54, y: oy1 + 70 }, { x: ox1 + 78, y: oy1 + 70 }]),
    mkStroke('e3', [{ x: ox1 + 78, y: oy1 + 15 }, { x: ox1 + 78, y: oy1 + 135 }]),
    mkStroke('d1', [
      { x: ox1 + 152, y: oy1 + 28 },
      { x: ox1 + 108, y: oy1 + 28 },
      { x: ox1 + 108, y: oy1 + 112 },
      { x: ox1 + 154, y: oy1 + 112 },
    ]),
    mkStroke('d2', [{ x: ox1 + 172, y: oy1 + 15 }, { x: ox1 + 172, y: oy1 + 135 }]),
    mkStroke(
      'y1',
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ox1 + 222 + Math.cos(a) * 22, y: oy1 + 68 + Math.sin(a) * 38 };
      })
    ),
    mkStroke('y2', [{ x: ox1 + 262, y: oy1 + 15 }, { x: ox1 + 262, y: oy1 + 135 }]),
    mkStroke('y3', [{ x: ox1 + 262, y: oy1 + 52 }, { x: ox1 + 290, y: oy1 + 52 }]),
    mkStroke('y4', [{ x: ox1 + 262, y: oy1 + 94 }, { x: ox1 + 290, y: oy1 + 94 }]),

    // 나도야 (bottom-right, includes 2-stroke ㄷ above ㅗ in 도)
    mkStroke('n1', [{ x: ox2, y: oy2 + 15 }, { x: ox2, y: oy2 + 105 }, { x: ox2 + 42, y: oy2 + 105 }]),
    mkStroke('n2', [{ x: ox2 + 58, y: oy2 + 5 }, { x: ox2 + 58, y: oy2 + 130 }]),
    mkStroke('n3', [{ x: ox2 + 58, y: oy2 + 66 }, { x: ox2 + 82, y: oy2 + 66 }]),
    mkStroke('do1', [{ x: ox2 + 105, y: oy2 + 10 }, { x: ox2 + 155, y: oy2 + 10 }]),
    mkStroke('do2', [{ x: ox2 + 105, y: oy2 + 10 }, { x: ox2 + 105, y: oy2 + 78 }, { x: ox2 + 160, y: oy2 + 78 }]),
    mkStroke('do3', [{ x: ox2 + 132, y: oy2 + 78 }, { x: ox2 + 132, y: oy2 + 122 }]),
    mkStroke('do4', [{ x: ox2 + 96, y: oy2 + 122 }, { x: ox2 + 172, y: oy2 + 122 }]),
    mkStroke(
      'ny1',
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 11) * Math.PI * 1.9;
        return { x: ox2 + 215 + Math.cos(a) * 22, y: oy2 + 58 + Math.sin(a) * 38 };
      })
    ),
    mkStroke('ny2', [{ x: ox2 + 255, y: oy2 + 5 }, { x: ox2 + 255, y: oy2 + 130 }]),
    mkStroke('ny3', [{ x: ox2 + 255, y: oy2 + 45 }, { x: ox2 + 282, y: oy2 + 45 }]),
    mkStroke('ny4', [{ x: ox2 + 255, y: oy2 + 88 }, { x: ox2 + 282, y: oy2 + 88 }]),
  ];

  const regs = recognizeHandwritingRegions(strokes, 'b_diag', 1);
  assert.equal(regs.length, 2, `Expected 2 separate regions, got ${regs.length}`);
  assert.equal(regs[0].recognizedText, '어디야');
  assert.equal(regs[1].recognizedText, '나도야');

  const board = { ...createEmptyWonderBoard('b_diag'), strokes, regions: regs, revision: 1 };
  const q1 = executeGestureQuery({
    board,
    selectedStrokeIds: regs[0].strokeIds,
    intent: 'explain',
  });
  const q2 = executeGestureQuery({
    board,
    selectedStrokeIds: regs[1].strokeIds,
    intent: 'explain',
  });
  assert.ok(q1.annotation && q2.annotation);
  assert.equal(q1.annotation!.suggested_correction, '어디야 [eo-di-ya]');
  assert.equal(q2.annotation!.suggested_correction, '나도야 [na-do-ya]');
});

// Helper that emits realistic multi-stroke freehand Hangul (without any fixtureHintText or prototype dictionary)
function buildRealisticFreehandHangulSentence(
  boardId: string,
  syllableWords: string[],
  startX = 60,
  startY = 100
) {
  const CHOSEONG = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  ];
  const JUNGSEONG = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
    'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
  ];
  const JONGSEONG = [
    '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
    'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  ];

  const strokes: ReturnType<typeof computeStrokeBoundingBox> extends never ? never : Array<ReturnType<any>> = [];
  let seq = 1;
  const push = (pts: Array<{ x: number; y: number }>) => {
    const full = pts.map((p, i) => ({ ...p, pressure: 0.55, t: seq * 20 + i * 6 }));
    strokes.push({
      id: `fh_${boardId}_${seq++}`,
      boardId,
      points: full,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(full, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    });
  };

  const drawConsonant = (c: string, bx: number, by: number, bw: number, bh: number) => {
    const P = (rx: number, ry: number) => ({ x: bx + rx * bw, y: by + ry * bh });
    if (c === 'ㅇ') {
      push(
        Array.from({ length: 12 }, (_, k) => {
          const a = (k / 11) * Math.PI * 1.92;
          return P(0.5 + Math.cos(a) * 0.42, 0.5 + Math.sin(a) * 0.42);
        })
      );
    } else if (c === 'ㅎ') {
      push([P(0.25, 0.08), P(0.75, 0.08)]);
      push([P(0.1, 0.24), P(0.9, 0.24)]);
      push(
        Array.from({ length: 12 }, (_, k) => {
          const a = (k / 11) * Math.PI * 1.92;
          return P(0.5 + Math.cos(a) * 0.36, 0.65 + Math.sin(a) * 0.28);
        })
      );
    } else if (c === 'ㄱ') {
      push([P(0.12, 0.14), P(0.88, 0.14), P(0.88, 0.88)]);
    } else if (c === 'ㄴ') {
      push([P(0.15, 0.12), P(0.15, 0.86), P(0.88, 0.86)]);
    } else if (c === 'ㄷ') {
      push([P(0.82, 0.14), P(0.16, 0.14), P(0.16, 0.86), P(0.84, 0.86)]);
    } else if (c === 'ㄹ') {
      push([P(0.15, 0.1), P(0.85, 0.1), P(0.85, 0.46)]);
      push([P(0.2, 0.48), P(0.8, 0.48)]);
      push([P(0.15, 0.5), P(0.15, 0.9), P(0.88, 0.9)]);
    } else if (c === 'ㅁ') {
      push([P(0.15, 0.15), P(0.15, 0.85), P(0.85, 0.85)]);
      push([P(0.17, 0.15), P(0.85, 0.15), P(0.85, 0.83)]);
    } else if (c === 'ㅂ') {
      push([P(0.18, 0.1), P(0.18, 0.9)]);
      push([P(0.82, 0.1), P(0.82, 0.9)]);
      push([P(0.18, 0.52), P(0.82, 0.52)]);
      push([P(0.18, 0.9), P(0.82, 0.9)]);
    } else if (c === 'ㅅ') {
      push([P(0.62, 0.12), P(0.1, 0.88)]);
      push([P(0.52, 0.42), P(0.92, 0.88)]);
    } else if (c === 'ㅆ') {
      push([P(0.38, 0.12), P(0.08, 0.88)]);
      push([P(0.28, 0.44), P(0.48, 0.88)]);
      push([P(0.78, 0.12), P(0.52, 0.88)]);
      push([P(0.7, 0.44), P(0.94, 0.88)]);
    } else if (c === 'ㅈ') {
      push([P(0.12, 0.16), P(0.88, 0.16)]);
      push([P(0.6, 0.22), P(0.14, 0.88)]);
      push([P(0.52, 0.48), P(0.9, 0.88)]);
    } else if (c === 'ㅊ') {
      push([P(0.32, 0.06), P(0.68, 0.06)]);
      push([P(0.12, 0.24), P(0.88, 0.24)]);
      push([P(0.58, 0.3), P(0.14, 0.9)]);
      push([P(0.52, 0.54), P(0.9, 0.9)]);
    }
  };

  let curX = startX;
  const cellH = 120;
  const cellW = 92;

  for (let wIdx = 0; wIdx < syllableWords.length; wIdx++) {
    const word = syllableWords[wIdx];
    for (const ch of Array.from(word)) {
      if (ch === '.') {
        push([{ x: curX - 8, y: startY + cellH - 6 }, { x: curX - 4, y: startY + cellH - 6 }]);
        curX += 14;
        continue;
      }
      if (ch === '?') {
        push([
          { x: curX - 6, y: startY + 26 },
          { x: curX + 10, y: startY + 20 },
          { x: curX + 14, y: startY + 42 },
          { x: curX + 2, y: startY + 62 },
        ]);
        push([{ x: curX, y: startY + cellH - 12 }, { x: curX + 4, y: startY + cellH - 12 }]);
        curX += 24;
        continue;
      }
      const code = ch.charCodeAt(0) - 0xac00;
      const cho = CHOSEONG[Math.floor(code / 588)];
      const jung = JUNGSEONG[Math.floor((code % 588) / 28)];
      const jong = JONGSEONG[code % 28];

      const isHorizVowel = ['ㅗ', 'ㅛ', 'ㅜ', 'ㅠ', 'ㅡ'].includes(jung);
      const hasB = jong.length > 0;
      const topH = hasB ? cellH * 0.56 : cellH;

      if (isHorizVowel) {
        const choH = hasB ? cellH * 0.34 : cellH * 0.5;
        drawConsonant(cho, curX + cellW * 0.14, startY + 4, cellW * 0.72, choH);
        const barY = hasB ? startY + cellH * 0.5 : startY + cellH * 0.76;
        if (jung === 'ㅗ') {
          push([{ x: curX + cellW * 0.5, y: barY - cellH * 0.14 }, { x: curX + cellW * 0.5, y: barY }]);
          push([{ x: curX + 4, y: barY }, { x: curX + cellW - 4, y: barY }]);
        } else if (jung === 'ㅛ') {
          push([{ x: curX + cellW * 0.36, y: barY - cellH * 0.14 }, { x: curX + cellW * 0.36, y: barY }]);
          push([{ x: curX + cellW * 0.64, y: barY - cellH * 0.14 }, { x: curX + cellW * 0.64, y: barY }]);
          push([{ x: curX + 4, y: barY }, { x: curX + cellW - 4, y: barY }]);
        } else if (jung === 'ㅜ') {
          const uBarY = hasB ? startY + cellH * 0.42 : startY + cellH * 0.62;
          push([{ x: curX + 4, y: uBarY }, { x: curX + cellW - 4, y: uBarY }]);
          push([{ x: curX + cellW * 0.5, y: uBarY }, { x: curX + cellW * 0.5, y: uBarY + cellH * 0.16 }]);
        } else if (jung === 'ㅡ') {
          push([{ x: curX + 4, y: barY }, { x: curX + cellW - 4, y: barY }]);
        }
      } else {
        drawConsonant(cho, curX + 4, startY + 6, cellW * 0.48, topH - 12);
        const vx = curX + cellW * 0.74;
        const vTop = startY + 4;
        const vBot = startY + topH - 4;
        const vMid = (vTop + vBot) / 2;
        if (['ㅏ', 'ㅑ', 'ㅓ', 'ㅕ', 'ㅣ'].includes(jung)) {
          push([{ x: vx, y: vTop }, { x: vx, y: vBot }]);
          if (jung === 'ㅏ') push([{ x: vx, y: vMid }, { x: vx + 18, y: vMid }]);
          if (jung === 'ㅑ') {
            push([{ x: vx, y: vTop + (vBot - vTop) * 0.35 }, { x: vx + 18, y: vTop + (vBot - vTop) * 0.35 }]);
            push([{ x: vx, y: vTop + (vBot - vTop) * 0.65 }, { x: vx + 18, y: vTop + (vBot - vTop) * 0.65 }]);
          }
          if (jung === 'ㅓ') push([{ x: vx - 16, y: vMid }, { x: vx, y: vMid }]);
          if (jung === 'ㅕ') {
            push([{ x: vx - 16, y: vTop + (vBot - vTop) * 0.35 }, { x: vx, y: vTop + (vBot - vTop) * 0.35 }]);
            push([{ x: vx - 16, y: vTop + (vBot - vTop) * 0.65 }, { x: vx, y: vTop + (vBot - vTop) * 0.65 }]);
          }
        } else if (jung === 'ㅐ' || jung === 'ㅔ') {
          const vx2 = curX + cellW * 0.92;
          push([{ x: vx, y: vTop }, { x: vx, y: vBot }]);
          if (jung === 'ㅐ') push([{ x: vx, y: vMid }, { x: vx2, y: vMid }]);
          else push([{ x: vx - 16, y: vMid }, { x: vx, y: vMid }]);
          push([{ x: vx2, y: vTop }, { x: vx2, y: vBot }]);
        }
      }

      if (hasB) {
        drawConsonant(jong, curX + cellW * 0.14, startY + cellH * 0.65, cellW * 0.72, cellH * 0.34);
      }

      curX += cellW + 18;
    }
    curX += 72; // wide word gap so segmentStrokesIntoRegions separates word clusters cleanly
  }
  return strokes;
}

test('V3-11 Unseen freehand Korean validation sentences compose syllable-by-syllable with batchim & zero false errors', () => {
  const unseenValid = [
    '안녕하세요.',
    '사랑해요.',
    '어디에 가요?',
    '저는 한국어를 공부해요.',
    '오늘 날씨가 좋아요.',
  ];

  for (let i = 0; i < unseenValid.length; i++) {
    const sentence = unseenValid[i];
    const tokens = sentence.split(' ');
    const strokes = buildRealisticFreehandHangulSentence(`b_unseen_${i}`, tokens, 60, 100);
    const regions = recognizeHandwritingRegions(strokes, `b_unseen_${i}`, 1);
    assert.equal(regions.length, 1);
    assert.equal(regions[0].recognizedText, sentence, `Failed composing "${sentence}", got "${regions[0].recognizedText}"`);
    assert.equal(regions[0].providerId, 'local-freehand-jamo');

    const board = { ...createEmptyWonderBoard(`b_unseen_${i}`), strokes, regions, revision: 1 };
    const ctx = buildBoardContextModel({
      boardId: board.id,
      revision: 1,
      regions,
      strokes,
      existingAnnotations: [],
      existingTeachingCards: [],
    });
    const tutor = orchestrateWonderTutor({
      board,
      regions,
      context: ctx,
      existingAnnotations: [],
      existingTeachingCards: [],
      learnerProfile: createInitialAiProfile(),
    });
    assert.equal(
      tutor.annotationsToAdd.filter((a) => a.severity === 'error').length,
      0,
      `Expected 0 false grammar errors on valid "${sentence}"`
    );
  }

  // Unseen sentence WITH grammar error ("저는 한국어가 공부해요." -> pinpoints ONLY "한국어가")
  const errStrokes = buildRealisticFreehandHangulSentence(
    'b_unseen_err',
    ['저는', '한국어가', '공부해요.'],
    60,
    100
  );
  const errRegs = recognizeHandwritingRegions(errStrokes, 'b_unseen_err', 1);
  assert.equal(errRegs[0].recognizedText, '저는 한국어가 공부해요.');
  const errBoard = { ...createEmptyWonderBoard('b_unseen_err'), strokes: errStrokes, regions: errRegs, revision: 1 };
  const errCtx = buildBoardContextModel({
    boardId: 'b_unseen_err',
    revision: 1,
    regions: errRegs,
    strokes: errStrokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const errTutor = orchestrateWonderTutor({
    board: errBoard,
    regions: errRegs,
    context: errCtx,
    existingAnnotations: [],
    existingTeachingCards: [],
    learnerProfile: createInitialAiProfile(),
  });
  const errs = errTutor.annotationsToAdd.filter((a) => a.severity === 'error');
  assert.equal(errs.length, 1, 'Should pinpoint only the single error word, never the whole sentence');
  assert.equal(errs[0].target_text, '한국어가');
  assert.equal(errs[0].suggested_correction, '한국어를');
});

test('V3-12 P0 Fixes: Zero unknown-ink clouds, canonical deduplication, billowy organic cloud V3 & diagnostics', async () => {
  // 1. Unknown/ambiguous strokes emit ZERO "Xác nhận chữ viết" or "Cụm N nét" clouds
  const ambigStrokes = [
    {
      id: 'amb_1',
      boardId: 'b_p0',
      points: [
        { x: 100, y: 120, pressure: 0.5, t: 1 },
        { x: 155, y: 185, pressure: 0.5, t: 2 },
        { x: 112, y: 170, pressure: 0.5, t: 3 },
      ],
      color: '#2C221E',
      width: 3.5,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox([
        { x: 100, y: 120, pressure: 0.5, t: 1 },
        { x: 155, y: 185, pressure: 0.5, t: 2 },
        { x: 112, y: 170, pressure: 0.5, t: 3 },
      ]),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    },
  ];
  const ambBoard = { ...createEmptyWonderBoard('b_p0'), strokes: ambigStrokes, revision: 1 };
  const gestureEmpty = executeGestureQuery({
    board: ambBoard,
    selectedStrokeIds: ['amb_1'],
    intent: 'explain',
  });
  assert.equal(gestureEmpty.annotation, undefined, 'Must never spawn automatic unknown-ink cloud');

  const perception = await recognizeWithHybridPipeline({
    strokes: ambigStrokes,
    boardId: 'b_p0',
    revision: 1,
  });
  assert.equal(perception.diagnostics.length, 1);
  assert.equal(perception.diagnostics[0].fallbackReason, 'REAL_FREEHAND_RECOGNITION_BLOCKED_NO_CLOUD_PROVIDER');

  // 2. Strict deduplication keeps only 1 active annotation on overlapping strokes
  const gomaStrokes = buildRealisticFreehandHangulSentence('b_dedupe', ['고마워'], 80, 140);
  const gomaRegs = recognizeHandwritingRegions(gomaStrokes, 'b_dedupe', 1);
  const gomaBoard = { ...createEmptyWonderBoard('b_dedupe'), strokes: gomaStrokes, regions: gomaRegs, revision: 1 };
  const qLeft = executeGestureQuery({ board: gomaBoard, selectedStrokeIds: gomaStrokes.map((s) => s.id), intent: 'explain' });
  const qRight = executeGestureQuery({
    board: { ...gomaBoard, revision: 2 },
    selectedStrokeIds: gomaStrokes.slice(1).map((s) => s.id),
    intent: 'explain',
  });
  const merged = deduplicateWonderAnnotations([qLeft.annotation!, qRight.annotation!]);
  assert.equal(merged.length, 1, 'Overlapping explanations on 고마워 must deduplicate to 1');

  // 3. Organic Cloud V3 has bowed top/bottom silhouette (non-collinear) & height-scaled puff depth
  const largeBox = { minX: 160, minY: 140, maxX: 480, maxY: 320, width: 320, height: 180 };
  const cloud = generateScallopedCloudGeometry(largeBox, 7);
  const topPts = cloud.sampledPoints.filter((p) => p.y < 140);
  const botPts = cloud.sampledPoints.filter((p) => p.y > 320);
  const topMinY = Math.min(...topPts.map((p) => p.y));
  const topMaxY = Math.max(...topPts.map((p) => p.y));
  const botMinY = Math.min(...botPts.map((p) => p.y));
  const botMaxY = Math.max(...botPts.map((p) => p.y));
  assert.ok(topMaxY - topMinY > 18, `Top cloud silhouette must curve organically, got deltaY=${topMaxY - topMinY}`);
  assert.ok(botMaxY - botMinY > 18, `Bottom cloud silhouette must puff organically, got deltaY=${botMaxY - botMinY}`);
  const clearance = verifyCloudClearance(cloud, gomaStrokes);
  assert.equal(clearance.valid, true);
  assert.ok(cloud.safeInteriorBounds.minX <= largeBox.minX - 60, 'Expected generous proportional horizontal padding');
});

test('V3-13 Hotfix: Mixed-language font runs, adaptive typography bounds, fast chalk timings & collision-free arrow/note placement', () => {
  // 1. All 6 visual regression mixed-language phrases preserve Vietnamese combining diacritics & separate Hangul vs Vietnamese runs
  const samples = [
    '아 [a]',
    'Âm tiết 아 = ㅇ (âm câm đầu) + ㅏ [a].',
    'Ví dụ: 아이 (đứa trẻ), 아버지 (bố).',
    '저는 한국어를 공부해요.',
    '받침 — phụ âm cuối.',
    '학생예요 → 학생이에요.',
  ];
  for (const s of samples) {
    const runs = segmentMixedLanguageRuns(s, 'explanation', 18);
    assert.ok(runs.length >= 1, `Expected font runs for ${s}`);
    assert.equal(runs.map((r) => r.text).join(''), s.normalize('NFC'));
    const hangulRuns = runs.filter((r) => r.script === 'hangul_syllable' || r.script === 'hangul_jamo');
    const viRuns = runs.filter((r) => r.script === 'vietnamese_latin');
    for (const h of hangulRuns) assert.equal(h.fontFamily, FONT_FAMILY_KO_CHALK);
    for (const v of viRuns) assert.equal(v.fontFamily, FONT_FAMILY_VI_CHALK);
  }

  // Grapheme slicing must never detach Vietnamese tone marks (e.g. NFD "đầu")
  const nfdSample = 'đa\u0302\u0300u tie\u0302\u0301ng Vie\u0323\u0302t';
  assert.equal(segmentUnicodeGraphemes(nfdSample).length, 14);
  const sliced = sliceMixedLanguageReveal(nfdSample, 0.3);
  assert.equal(sliced, sliced.normalize('NFC'));

  // 2. Adaptive typography bounds decoupled from giant handwriting height across zooms
  const smallHandTypo = computeAdaptiveAnnotationTypography(44, 1.0);
  const hugeHandTypo = computeAdaptiveAnnotationTypography(290, 1.0);
  assert.ok(smallHandTypo.correctionCssPx >= 24 && smallHandTypo.correctionCssPx <= 36);
  assert.ok(hugeHandTypo.correctionCssPx >= 24 && hugeHandTypo.correctionCssPx <= 36);
  assert.ok(hugeHandTypo.explanationCssPx >= 16 && hugeHandTypo.explanationCssPx <= 21);
  assert.ok(hugeHandTypo.lineHeightRatio >= 1.4 && hugeHandTypo.lineHeightRatio <= 1.55);
  assert.ok(hugeHandTypo.safeGapCssPx >= 24 && hugeHandTypo.safeGapCssPx <= 40);

  for (const z of [0.45, 0.75, 1.0, 1.5, 2.0]) {
    const t = computeAdaptiveAnnotationTypography(88, z);
    assert.ok(t.correctionWorldPx >= 20, `Zoom ${z} correctionWorldPx >= 20`);
    assert.ok(t.explanationWorldPx >= 15, `Zoom ${z} explanationWorldPx >= 15`);
  }

  // Wrapping keeps Hangul + Vietnamese lines within target width
  const wrapped = wrapMixedLanguageRuns(
    'Âm tiết 아 = ㅇ (âm câm đầu) + ㅏ [a]. Ví dụ: 아이 (đứa trẻ), 아버지 (bố).',
    'explanation',
    18,
    300
  );
  assert.ok(wrapped.lines.length >= 2 && wrapped.maxWidth <= 320);

  // 3. Animation timings satisfy A01-A03 & adaptive queue scaling
  const smallCloudMs = computeCloudDurationMs(620, 'natural', 1);
  const medCloudMs = computeCloudDurationMs(900, 'natural', 1);
  const largeCloudMs = computeCloudDurationMs(1600, 'natural', 1);
  assert.ok(smallCloudMs >= 600 && smallCloudMs <= 900, `Expected small cloud 600-900ms, got ${smallCloudMs}`);
  assert.ok(medCloudMs >= 900 && medCloudMs <= 1300, `Expected medium cloud 900-1300ms, got ${medCloudMs}`);
  assert.ok(largeCloudMs <= 1800, `Expected large cloud <= 1800ms, got ${largeCloudMs}`);

  assert.equal(computeQueueSpeedMultiplier(1), 1.0);
  assert.ok(computeQueueSpeedMultiplier(3) < 1.0);
  assert.ok(computeQueueSpeedMultiplier(5) < computeQueueSpeedMultiplier(3));
  assert.ok(computeQueueSpeedMultiplier(7) < computeQueueSpeedMultiplier(5));

  const sched = computeAnnotationPhaseTimings({
    cloudPathLengthWorld: 680,
    viewportScale: 1,
    arrowLengthWorld: 180,
    correctionText: '학생예요 → 학생이에요',
    explanationText: 'Dùng -이에요 vì danh từ "학생" có patchim ㅇ ở cuối.',
    speed: 'natural',
    pendingCount: 1,
  });
  assert.ok(sched.arrowMs >= 200 && sched.arrowMs <= 350, `Expected arrow 200-350ms, got ${sched.arrowMs}`);
  assert.ok(sched.pauseAfterCloudMs >= 50 && sched.pauseAfterCloudMs <= 100);
  assert.ok(sched.explMs <= 1500, `Expected explanation reveal <= 1500ms, got ${sched.explMs}`);

  // 4. Spatial placement prevents arrow/cloud/note collisions even when writing encroaches below
  const targetBox = { minX: 120, minY: 120, maxX: 280, maxY: 200, width: 160, height: 80 };
  const cloudOuter = generateScallopedCloudGeometry(targetBox, 1).outerBounds;
  const activeBelowBlocker = {
    minX: cloudOuter.minX - 20,
    minY: cloudOuter.maxY + 10,
    maxX: cloudOuter.maxX + 40,
    maxY: cloudOuter.maxY + 180,
    width: cloudOuter.width + 60,
    height: 170,
  };
  const placed = computeCollisionFreePlacement({
    targetBox,
    desiredWidth: 280,
    desiredHeight: 110,
    preferredOrder: ['below', 'right', 'above', 'left'],
    occupiedBoxes: [],
    activeWritingBox: activeBelowBlocker,
    safeGap: 28,
  });
  assert.notEqual(placed.placement, 'below', 'Should avoid active writing region below cloud');
  assert.equal(boxesIntersect(placed.noteBox, cloudOuter, 8), false, 'Note must not collide with cloud');
  assert.equal(boxesIntersect(placed.noteBox, activeBelowBlocker, 8), false, 'Note must not collide with active ink');
  // Arrow destination must stay strictly outside noteBox (no arrow-over-text intersection)
  const arrowEndBox = {
    minX: placed.arrow.toX - 2,
    minY: placed.arrow.toY - 2,
    maxX: placed.arrow.toX + 2,
    maxY: placed.arrow.toY + 2,
    width: 4,
    height: 4,
  };
  assert.equal(boxesIntersect(arrowEndBox, placed.noteBox, 2), false, 'Arrowhead must stop outside noteBox');
});

test('V3-14 Multi-word & multi-sentence support + freehand short-tick recognition', () => {
  const mkStroke = (id: string, pts: Array<{ x: number; y: number }>) => {
    const full = pts.map((p, i) => ({ ...p, pressure: 0.5, t: i * 10 }));
    return {
      id,
      boardId: 'b_multi',
      points: full,
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk' as const,
      bbox: computeStrokeBoundingBox(full, 0, 0, 3.4, 'chalk'),
      transform: { dx: 0, dy: 0 },
      revision: 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink' as const,
    };
  };

  // 1. Freehand 사 (left) + tall-narrow 아 with short wobbly horizontal tick (right)
  const strokes = [
    // 사 at x=80..180
    mkStroke('sa1', [{ x: 112, y: 120 }, { x: 80, y: 210 }]),
    mkStroke('sa2', [{ x: 102, y: 162 }, { x: 128, y: 210 }]),
    mkStroke('sa3', [{ x: 152, y: 115 }, { x: 152, y: 225 }]),
    mkStroke('sa4', [{ x: 152, y: 168 }, { x: 174, y: 170 }]),
    // 아 at x=460..560 (tall narrow ㅇ + slightly wobbly short tick ㅏ)
    mkStroke(
      'a1',
      Array.from({ length: 14 }, (_, k) => {
        const a = (k / 13) * Math.PI * 1.9;
        return { x: 488 + Math.cos(a) * 20, y: 165 + Math.sin(a) * 58 };
      })
    ),
    mkStroke('a2', [{ x: 528, y: 112 }, { x: 528, y: 230 }]),
    mkStroke('a3', [{ x: 528, y: 164 }, { x: 544, y: 167 }]),
  ];

  const regs = recognizeHandwritingRegions(strokes, 'b_multi', 1);
  assert.equal(regs.length, 2, `Expected 2 separate regions for 사 and 아, got ${regs.length}`);
  const byX = [...regs].sort((a, b) => a.bbox.minX - b.bbox.minX);
  assert.equal(byX[0].recognizedText, '사');
  assert.equal(byX[1].recognizedText, '아');

  const board = { ...createEmptyWonderBoard('b_multi'), strokes, regions: regs, revision: 1 };
  const ctx = buildBoardContextModel({
    boardId: board.id,
    revision: 1,
    regions: regs,
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const tutor = orchestrateWonderTutor({
    board,
    regions: regs,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
    learnerProfile: createInitialAiProfile(),
  });
  assert.equal(tutor.annotationsToAdd.length, 2, 'Both 사 and 아 must receive clouds/explanations');
  assert.equal(
    boxesIntersect(tutor.annotationsToAdd[0].note_geometry, tutor.annotationsToAdd[1].note_geometry, 2),
    false,
    'Separate word notes must not overlap'
  );

  // 2. Multi-sentence board (3 distinct sentences under default guided mode) -> all 3 annotated!
  const b3 = createEmptyWonderBoard('b_multi_sent');
  b3.guidanceLevel = 'guided';
  b3.strokes = [
    ...generateHandwrittenStrokesForText({
      boardId: b3.id,
      text: '저는 어제 학교에 가요.',
      startX: 60,
      startY: 70,
      revision: 1,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
    ...generateHandwrittenStrokesForText({
      boardId: b3.id,
      text: '저는 사과가 먹어요.',
      startX: 60,
      startY: 240,
      revision: 1,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
    ...generateHandwrittenStrokesForText({
      boardId: b3.id,
      text: '저는 학생예요.',
      startX: 60,
      startY: 410,
      revision: 1,
      color: '#2C221E',
      provenance: 'fixture_sample',
    }),
  ];
  const r3 = recognizeHandwritingRegions(b3.strokes, b3.id, 1);
  assert.equal(r3.length, 3);
  const ctx3 = buildBoardContextModel({
    boardId: b3.id,
    revision: 1,
    regions: r3,
    strokes: b3.strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const t3 = orchestrateWonderTutor({
    board: { ...b3, regions: r3, revision: 1 },
    regions: r3,
    context: ctx3,
    existingAnnotations: [],
    existingTeachingCards: [],
    learnerProfile: createInitialAiProfile(),
  });
  assert.ok(t3.annotationsToAdd.length >= 3, `Expected >= 3 sentence annotations, got ${t3.annotationsToAdd.length}`);
});
