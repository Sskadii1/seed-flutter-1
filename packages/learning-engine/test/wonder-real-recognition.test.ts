import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WonderStroke } from '@seed/schema';
import {
  buildBoardContextModel,
  buildHierarchicalSemanticTree,
  createEmptyWonderBoard,
  decodeKoreanSpacingHypotheses,
  orchestrateWonderTutor,
  recognizeHandwritingRegions,
  recognizeWithHybridPipeline,
  reconcileAnnotationsWithStrokes,
  reconcileSemanticAnnotations,
  segmentStrokesIntoRegions,
  selectInterventionGranularity,
  WonderRecognitionCache,
} from '../src/index';
// @ts-ignore - runtime ESM import of gateway server
import { createGatewayServer } from '../../../services/ai-gateway/server.mjs';

function makeStroke(
  id: string,
  boardId: string,
  pts: Array<{ x: number; y: number; t?: number }>,
  revision = 1
): WonderStroke {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - 2;
  const maxX = Math.max(...xs) + 2;
  const minY = Math.min(...ys) - 2;
  const maxY = Math.max(...ys) + 2;
  return {
    id,
    boardId,
    points: pts.map((p, idx) => ({
      x: p.x,
      y: p.y,
      pressure: 0.65,
      t: p.t ?? 10_000 + idx * 15,
    })),
    color: '#2C221E',
    width: 3.6,
    tool: 'chalk',
    bbox: {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(4, maxX - minX),
      height: Math.max(4, maxY - minY),
    },
    transform: { dx: 0, dy: 0 },
    revision,
    createdAt: Date.now(),
    provenance: 'freehand_ink',
  };
}

test('Real-Rec-1: Large 25%-zoom sentence strokes + trailing period "." merge cleanly without rogue IN_PROGRESS stall', () => {
  // Simulate large strokes spanning ~880px wide, 150px tall, plus small trailing dot at baseline
  const strokes: WonderStroke[] = [
    makeStroke('na1', 'b_dot', [{ x: 100, y: 180 }, { x: 100, y: 310 }, { x: 170, y: 310 }]),
    makeStroke('na2', 'b_dot', [{ x: 205, y: 175 }, { x: 205, y: 325 }]),
    makeStroke('na3', 'b_dot', [{ x: 205, y: 245 }, { x: 235, y: 245 }]),
    makeStroke('do1', 'b_dot', [{ x: 300, y: 185 }, { x: 395, y: 185 }]),
    makeStroke('do2', 'b_dot', [{ x: 300, y: 185 }, { x: 300, y: 270 }, { x: 395, y: 270 }]),
    makeStroke('do3', 'b_dot', [{ x: 348, y: 275 }, { x: 348, y: 315 }]),
    makeStroke('do4', 'b_dot', [{ x: 290, y: 318 }, { x: 405, y: 318 }]),
    // Trailing period dot at bottom-right baseline
    makeStroke('period1', 'b_dot', [{ x: 445, y: 318 }, { x: 448, y: 320 }]),
  ];

  const segs = segmentStrokesIntoRegions(strokes);
  assert.equal(segs.length, 1, 'Sentence strokes and trailing period dot must stay in 1 unified line region');
  assert.notEqual(segs[0].kind, 'in_progress', 'Multi-stroke sentence + trailing period must not be stuck in in_progress');
});

test('Real-Rec-2: Hybrid pipeline triggers Vision on partial/in-progress multi-stroke ink and bypasses cache on forceRecognition', async () => {
  const strokes: WonderStroke[] = [
    makeStroke('s1', 'b_force', [{ x: 80, y: 120 }, { x: 80, y: 230 }, { x: 140, y: 230 }]),
    makeStroke('s2', 'b_force', [{ x: 170, y: 115 }, { x: 170, y: 235 }]),
  ];

  const cache = new WonderRecognitionCache(16);
  let calls = 0;
  const mockVision = {
    id: 'mock-vision-live-contract',
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
        recognizedText: '나무',
        rawTranscription: '나무',
        uncertainty: 0.06,
        completenessEvidence: 'complete_noun',
        language: 'ko' as const,
        confidence: 0.94,
        alternatives: [],
        words: [{ text: '나무', bboxNorm: { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }, confidence: 0.94 }],
        providerId: 'mock-vision-live-contract',
        latencyMs: 14,
      };
    },
  };

  const cropRenderer = (_strokes: WonderStroke[], bbox: WonderStroke['bbox']) => ({
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    cropTransform: {
      worldMinX: bbox.minX - 24,
      worldMinY: bbox.minY - 24,
      worldWidth: bbox.width + 48,
      worldHeight: bbox.height + 48,
      pixelWidth: 320,
      pixelHeight: 240,
      scale: 1.5,
    },
  });

  // Pass 1: initial run populates cache
  const res1 = await recognizeWithHybridPipeline({
    strokes,
    boardId: 'b_force',
    revision: 1,
    visionProvider: mockVision,
    cropRenderer,
    cache,
  });
  assert.equal(calls, 1);
  assert.equal(res1.regions[0].recognizedText, '나무');
  assert.equal(res1.diagnostics[0].requestAttempted, true);
  assert.equal(res1.diagnostics[0].cropWidth, 320);

  // Pass 2: normal call hits cache
  const res2 = await recognizeWithHybridPipeline({
    strokes,
    boardId: 'b_force',
    revision: 1,
    visionProvider: mockVision,
    cropRenderer,
    cache,
  });
  assert.equal(calls, 1);
  assert.equal(res2.diagnostics[0].fallbackReason, 'VISION_CACHE_HIT');

  // Pass 3: forceRecognition ("Chấm ngay") bypasses cache and re-queries Vision
  await recognizeWithHybridPipeline({
    strokes,
    boardId: 'b_force',
    revision: 1,
    visionProvider: mockVision,
    cropRenderer,
    cache,
    forceRecognition: true,
    bypassCache: true,
  });
  assert.equal(calls, 2, 'forceRecognition must bypass cache and invoke Vision');
});

test('Real-Rec-3: Stage 3 bounded multi-scale sub-region fallback splits unclear full sentence cleanly within budget', async () => {
  const strokes: WonderStroke[] = [
    // Cluster 1 ("나도")
    makeStroke('w1a', 'b_s3', [{ x: 100, y: 120 }, { x: 100, y: 200 }, { x: 150, y: 200 }]),
    makeStroke('w1b', 'b_s3', [{ x: 170, y: 120 }, { x: 170, y: 200 }]),
    // Cluster 2 ("가요.") separated by clear word gap (> 80px)
    makeStroke('w2a', 'b_s3', [{ x: 290, y: 120 }, { x: 345, y: 120 }, { x: 345, y: 200 }]),
    makeStroke('w2b', 'b_s3', [{ x: 370, y: 120 }, { x: 370, y: 200 }]),
  ];

  let reqIdx = 0;
  const subVision = {
    id: 'mock-multiscale-vision',
    kind: 'multimodal_vision' as const,
    capabilities: {
      supportsFreehandKorean: true,
      supportsFreehandVietnamese: true,
      supportsMixedLanguage: true,
      supportsWordPositioning: true,
      requiresNetwork: true,
    },
    async recognizeRegion(req: { regionId: string }) {
      reqIdx++;
      if (!req.regionId.includes('_sub')) {
        return {
          status: 'AMBIGUOUS' as const,
          recognizedText: '',
          language: 'unknown' as const,
          confidence: 0.25,
          alternatives: [],
          words: [],
          providerId: 'mock-multiscale-vision',
          latencyMs: 10,
        };
      }
      const txt = req.regionId.endsWith('_sub0') ? '나도' : '가요.';
      return {
        status: 'RECOGNIZED' as const,
        recognizedText: txt,
        rawTranscription: txt,
        language: 'ko' as const,
        confidence: 0.91,
        alternatives: [],
        words: [],
        providerId: 'mock-multiscale-vision',
        latencyMs: 12,
      };
    },
  };

  const cropRenderer = (_st: WonderStroke[], bbox: WonderStroke['bbox']) => ({
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    cropTransform: {
      worldMinX: bbox.minX - 20,
      worldMinY: bbox.minY - 20,
      worldWidth: bbox.width + 40,
      worldHeight: bbox.height + 40,
      pixelWidth: 400,
      pixelHeight: 200,
      scale: 1,
    },
  });

  const out = await recognizeWithHybridPipeline({
    strokes,
    boardId: 'b_s3',
    revision: 1,
    visionProvider: subVision,
    cropRenderer,
    maxSubRegionBudget: 2,
  });

  assert.equal(reqIdx, 3, '1 full-sentence request + 2 bounded sub-region fallback requests');
  assert.equal(out.regions[0].recognizedText, '나도 가요.');
  assert.equal(out.regions[0].recognitionStatus, 'RECOGNIZED');
  assert.equal(out.diagnostics[0].fallbackReason, 'VISION_STAGE3_SUBREGION_MERGED');
});

test('Real-Rec-4: Full Vision->Tutor validation across all 8 required unseen Korean cases + Gateway 503 contract', async () => {
  // 1. Gateway returns honest HTTP 503 when no Vision credentials exist
  const gwNoKey = createGatewayServer({ geminiKey: '', openaiKey: '' });
  await new Promise<void>((r) => gwNoKey.listen(0, '127.0.0.1', r));
  const noKeyPort = (gwNoKey.address() as { port: number }).port;
  try {
    const resp503 = await fetch(`http://127.0.0.1:${noKeyPort}/api/wonder/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
    });
    assert.equal(resp503.status, 503);
    const json503 = (await resp503.json()) as { recognitionStatus: string };
    assert.equal(json503.recognitionStatus, 'PROVIDER_UNAVAILABLE');
  } finally {
    gwNoKey.close();
  }

  // 2. Verify all 8 unseen Section 11 inputs via Gateway -> Hybrid Perception -> Hierarchical Tutor
  const cases: Array<{
    input: string;
    expectedActiveErrors: number;
    expectedGranularity: 'WORD' | 'SENTENCE';
    maxPerSyllableClouds: number;
  }> = [
    { input: '나무', expectedActiveErrors: 0, expectedGranularity: 'WORD', maxPerSyllableClouds: 0 },
    { input: '바나나', expectedActiveErrors: 0, expectedGranularity: 'WORD', maxPerSyllableClouds: 0 },
    { input: '나도 가요.', expectedActiveErrors: 0, expectedGranularity: 'SENTENCE', maxPerSyllableClouds: 0 },
    { input: '나도가요.', expectedActiveErrors: 0, expectedGranularity: 'SENTENCE', maxPerSyllableClouds: 0 },
    { input: '나 도 가 요.', expectedActiveErrors: 0, expectedGranularity: 'SENTENCE', maxPerSyllableClouds: 0 },
    { input: '저는 학생이에요.', expectedActiveErrors: 0, expectedGranularity: 'SENTENCE', maxPerSyllableClouds: 0 },
    { input: '저는 학생예요.', expectedActiveErrors: 1, expectedGranularity: 'SENTENCE', maxPerSyllableClouds: 0 },
    { input: '저는 한국어를 공부해요.', expectedActiveErrors: 0, expectedGranularity: 'SENTENCE', maxPerSyllableClouds: 0 },
  ];

  // Confirm spacing decoder handles 나도가요. and 나 도 가 요. cleanly
  const hypB = decodeKoreanSpacingHypotheses('나도가요.', 0.25);
  assert.ok(hypB[0].tokens.includes('가요.') || hypB[0].proposedText.includes('가요.'), 'Case B should segment 가요.');
  const hypC = decodeKoreanSpacingHypotheses('나 도 가 요.', 0.52);
  assert.equal(hypC[0].proposedText, '나도 가요.');

  // Run mocked Vision upstream server verifying structured Gateway JSON roundtrip for all 8 inputs
  let nextText = '나무';
  const mockUpstream = http.createServer((_req, res) => {
    const tokens = nextText.split(/\s+/).filter(Boolean);
    const payload = {
      recognizedText: nextText,
      rawTranscription: nextText,
      uncertainty: 0.05,
      completenessEvidence: 'complete_expression',
      language: 'ko',
      recognitionStatus: 'RECOGNIZED',
      confidence: 0.95,
      alternatives: [],
      words: tokens.map((t, i) => ({
        text: t,
        bboxNorm: {
          x0: i / Math.max(1, tokens.length),
          y0: 0.1,
          x1: (i + 0.9) / Math.max(1, tokens.length),
          y1: 0.9,
        },
        confidence: 0.95,
      })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
  });
  await new Promise<void>((r) => mockUpstream.listen(0, '127.0.0.1', r));
  const upPort = (mockUpstream.address() as { port: number }).port;
  const gw = createGatewayServer({
    geminiKey: 'mock-key-for-contract-test',
    geminiEndpoint: `http://127.0.0.1:${upPort}`,
  });
  await new Promise<void>((r) => gw.listen(0, '127.0.0.1', r));
  const gwPort = (gw.address() as { port: number }).port;

  try {
    for (const c of cases) {
      nextText = c.input;
      const tokens = c.input.split(/\s+/).filter(Boolean);
      const strokes: WonderStroke[] = tokens.map((_t, idx) =>
        makeStroke(`c_${idx}`, 'b_cases', [
          { x: 100 + idx * 140, y: 150 },
          { x: 195 + idx * 140, y: 245 },
        ])
      );

      const gatewayVisionProvider = {
        id: 'seed-ai-gateway-vision',
        kind: 'multimodal_vision' as const,
        capabilities: {
          supportsFreehandKorean: true,
          supportsFreehandVietnamese: true,
          supportsMixedLanguage: true,
          supportsWordPositioning: true,
          requiresNetwork: true,
        },
        async recognizeRegion(req: { boardId: string; regionId: string; revision: number; imageDataUrl?: string }) {
          const resp = await fetch(`http://127.0.0.1:${gwPort}/api/wonder/recognize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              boardId: req.boardId,
              regionId: req.regionId,
              revision: req.revision,
              imageDataUrl: req.imageDataUrl,
            }),
          });
          const raw = (await resp.json()) as {
            recognitionStatus: 'RECOGNIZED';
            recognizedText: string;
            rawTranscription?: string;
            language: 'ko';
            confidence: number;
            alternatives: string[];
            words: Array<{ text: string; bboxNorm: { x0: number; y0: number; x1: number; y1: number }; confidence: number }>;
            providerId: string;
          };
          return {
            status: raw.recognitionStatus,
            recognizedText: raw.recognizedText,
            rawTranscription: raw.rawTranscription,
            language: raw.language,
            confidence: raw.confidence,
            alternatives: raw.alternatives,
            words: raw.words,
            providerId: raw.providerId,
            latencyMs: 5,
          };
        },
      };

      const perc = await recognizeWithHybridPipeline({
        strokes,
        boardId: 'b_cases',
        revision: 1,
        visionProvider: gatewayVisionProvider,
        cropRenderer: (_st, bbox) => ({
          imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          cropTransform: {
            worldMinX: bbox.minX - 20,
            worldMinY: bbox.minY - 20,
            worldWidth: bbox.width + 40,
            worldHeight: bbox.height + 40,
            pixelWidth: 640,
            pixelHeight: 200,
            scale: 1,
          },
        }),
      });

      assert.equal(perc.regions[0].recognizedText, c.input);
      const board = { ...createEmptyWonderBoard('b_cases', 'Cases'), aiMode: 'tutor' as const, strokes, regions: perc.regions };
      const ctx = buildBoardContextModel({
        boardId: board.id,
        revision: 1,
        regions: perc.regions,
        strokes,
        existingAnnotations: [],
        existingTeachingCards: [],
      });
      const tutor = orchestrateWonderTutor({
        board,
        regions: perc.regions,
        context: ctx,
        existingAnnotations: [],
        existingTeachingCards: [],
      });

      const activeErrs = tutor.annotationsToAdd.filter((a) => a.severity === 'error');
      const charInfos = tutor.annotationsToAdd.filter((a) => a.severity === 'info' && a.target_text.length === 1);
      assert.equal(activeErrs.length, c.expectedActiveErrors, `Unexpected errors for "${c.input}": ${JSON.stringify(activeErrs.map((e) => e.target_text))}`);
      assert.ok(charInfos.length <= c.maxPerSyllableClouds, `Spurious syllable clouds on "${c.input}"`);
      if (c.expectedActiveErrors === 1) {
        assert.equal(activeErrs[0].target_text, '학생예요');
        assert.equal(activeErrs[0].suggested_correction, '학생이에요');
      }
      const tree = buildHierarchicalSemanticTree({ boardId: board.id, revision: 1, strokes, regions: perc.regions });
      const sNode = tree.nodes.find((n) => n.level === 'sentence');
      assert.ok(sNode);
      assert.equal(selectInterventionGranularity(sNode, board), c.expectedGranularity);
    }
  } finally {
    gw.close();
    mockUpstream.close();
  }
});

test('Real-Rec-5: Incremental sequence 나 -> 나도 -> 나도 가 -> 나도 가요. continuously adapts and retracts child cloud', () => {
  const board = { ...createEmptyWonderBoard('b_inc_na', 'IncNa'), aiMode: 'tutor' as const };
  const s1 = makeStroke('n1', board.id, [{ x: 100, y: 150 }, { x: 160, y: 230 }]);
  const s2 = makeStroke('n2', board.id, [{ x: 220, y: 150 }, { x: 280, y: 230 }]);
  const s3 = makeStroke('n3', board.id, [{ x: 380, y: 150 }, { x: 440, y: 230 }]);
  const s4 = makeStroke('n4', board.id, [{ x: 500, y: 150 }, { x: 575, y: 230 }]);

  const makeRegion = (txt: string, sts: WonderStroke[], rev: number) => ({
    regionId: 'r_inc',
    boardId: board.id,
    strokeIds: sts.map((s) => s.id),
    bbox: { minX: 98, minY: 148, maxX: sts[sts.length - 1].bbox.maxX, maxY: 232, width: sts[sts.length - 1].bbox.maxX - 98, height: 84 },
    recognizedText: txt,
    language: 'ko' as const,
    confidence: 0.94,
    recognitionStatus: 'RECOGNIZED' as const,
    provenance: 'freehand_ink' as const,
    alternativeCandidates: [],
    providerId: 'seed-ai-gateway-vision',
    recognizedAt: Date.now(),
    completeness: 'complete' as const,
    spans: txt.split(' ').map((w, i) => ({
      text: w,
      startIndex: txt.indexOf(w),
      endIndex: txt.indexOf(w) + w.length,
      strokeIds: [sts[Math.min(i, sts.length - 1)].id],
      bbox: sts[Math.min(i, sts.length - 1)].bbox,
      confidence: 0.94,
    })),
    characterSpans: [],
    revision: rev,
    contentRevision: rev,
    geometryRevision: rev,
    semanticRevision: rev,
  });

  // Step 1: "나" -> CHARACTER cloud
  const r1 = makeRegion('나', [s1], 1);
  const res1 = orchestrateWonderTutor({
    board: { ...board, revision: 1, strokes: [s1], regions: [r1] },
    regions: [r1],
    context: buildBoardContextModel({ boardId: board.id, revision: 1, regions: [r1], strokes: [s1], existingAnnotations: [], existingTeachingCards: [] }),
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(res1.annotationsToAdd.length, 1);
  assert.equal(res1.annotationsToAdd[0].target_text, '나');

  // Step 2: "나도" -> retracts "나"
  const r2 = makeRegion('나도', [s1, s2], 2);
  const res2 = orchestrateWonderTutor({
    board: { ...board, revision: 2, strokes: [s1, s2], regions: [r2], semanticTree: res1.semanticTree },
    regions: [r2],
    context: buildBoardContextModel({ boardId: board.id, revision: 2, regions: [r2], strokes: [s1, s2], existingAnnotations: res1.annotationsToAdd, existingTeachingCards: [] }),
    existingAnnotations: res1.annotationsToAdd,
    existingTeachingCards: [],
    previousTree: res1.semanticTree,
  });
  assert.ok(res2.retractedAnnotationIds.includes(res1.annotationsToAdd[0].annotation_id));

  // Step 3-4: "나도 가" -> "나도 가요." (complete valid sentence -> 0 syllable spam)
  const r4 = makeRegion('나도 가요.', [s1, s2, s3, s4], 4);
  const semPrev = reconcileSemanticAnnotations(res1.annotationsToAdd, res2.semanticTree);
  const allPrev = [...semPrev.nextAnnotations, ...res2.annotationsToAdd];
  const res4 = orchestrateWonderTutor({
    board: { ...board, revision: 4, strokes: [s1, s2, s3, s4], regions: [r4], semanticTree: res2.semanticTree },
    regions: [r4],
    context: buildBoardContextModel({ boardId: board.id, revision: 4, regions: [r4], strokes: [s1, s2, s3, s4], existingAnnotations: allPrev, existingTeachingCards: [] }),
    existingAnnotations: allPrev,
    existingTeachingCards: [],
    previousTree: res2.semanticTree,
  });
  const activeCharSpam = res4.annotationsToAdd.filter((a) => a.target_text.length === 1);
  assert.equal(activeCharSpam.length, 0);
});

test('Real-Rec-6: writing independent syllables side by side (사 -> 사 아) preserves completed cloud on 사 without retracting or recreating its annotation_id', () => {
  const board = createEmptyWonderBoard('wb_side_by_side', 'Ko');
  board.aiMode = 'tutor';

  // Freehand strokes for '사' (left) and '아' (right)
  const saStrokes: WonderStroke[] = [
    makeStroke('sa1', board.id, [{ x: 128, y: 114 }, { x: 106, y: 164 }]),
    makeStroke('sa2', board.id, [{ x: 124, y: 136 }, { x: 142, y: 164 }]),
    makeStroke('sa3', board.id, [{ x: 154, y: 108 }, { x: 154, y: 184 }]),
    makeStroke('sa4', board.id, [{ x: 154, y: 144 }, { x: 170, y: 144 }]),
  ];
  const aStrokes: WonderStroke[] = [
    makeStroke('a1', board.id, [
      { x: 318, y: 114 },
      { x: 300, y: 126 },
      { x: 298, y: 150 },
      { x: 304, y: 172 },
      { x: 320, y: 178 },
      { x: 332, y: 166 },
      { x: 332, y: 132 },
      { x: 324, y: 114 },
    ]),
    makeStroke('a2', board.id, [{ x: 346, y: 106 }, { x: 346, y: 188 }]),
    makeStroke('a3', board.id, [{ x: 346, y: 144 }, { x: 362, y: 144 }]),
  ];

  // Step 1: User writes '사' -> cloud completes
  const r1 = recognizeHandwritingRegions(saStrokes, board.id, 1);
  assert.equal(r1[0]?.recognizedText, '사');
  const res1 = orchestrateWonderTutor({
    board: { ...board, revision: 1, strokes: saStrokes, regions: r1 },
    regions: r1,
    context: buildBoardContextModel({
      boardId: board.id,
      revision: 1,
      regions: r1,
      strokes: saStrokes,
      existingAnnotations: [],
      existingTeachingCards: [],
    }),
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(res1.annotationsToAdd.length, 1);
  const completedSaAnn = {
    ...res1.annotationsToAdd[0],
    lifecycle_state: 'completed' as const,
    animation_progress: {
      cloud: 1,
      arrow: 1,
      correction: 1,
      explanation: 1,
      completed: true,
    },
  };
  const saAnnIdBefore = completedSaAnn.annotation_id;

  // Step 2: User writes independent '아' next to '사' -> '사 아'
  const allStrokes = [...saStrokes, ...aStrokes];
  const r2 = recognizeHandwritingRegions(allStrokes, board.id, 2);
  assert.equal(r2.map((r) => r.recognizedText).join(' '), '사 아');
  const reconciledPrev = reconcileAnnotationsWithStrokes([completedSaAnn], allStrokes, r2);
  const res2 = orchestrateWonderTutor({
    board: {
      ...board,
      revision: 2,
      strokes: allStrokes,
      regions: r2,
      annotations: reconciledPrev,
      semanticTree: res1.semanticTree,
    },
    regions: r2,
    context: buildBoardContextModel({
      boardId: board.id,
      revision: 2,
      regions: r2,
      strokes: allStrokes,
      existingAnnotations: reconciledPrev,
      existingTeachingCards: [],
    }),
    existingAnnotations: reconciledPrev,
    existingTeachingCards: [],
    previousTree: res1.semanticTree,
  });

  assert.deepEqual(
    res2.retractedAnnotationIds,
    [],
    'Adding an independent character beside 사 must NOT retract 사 cloud'
  );
  const finalSem = reconcileSemanticAnnotations(reconciledPrev, res2.semanticTree);
  assert.deepEqual(finalSem.retractedAnnotationIds, []);
  const finalActive = [
    ...finalSem.nextAnnotations.filter((a) => !res2.retractedAnnotationIds.includes(a.annotation_id)),
    ...res2.annotationsToAdd,
  ].filter((a) => a.status === 'active');
  assert.deepEqual(
    finalActive.map((a) => a.target_text),
    ['사', '아']
  );
  const saAfter = finalActive.find((a) => a.target_text === '사');
  const aAfter = finalActive.find((a) => a.target_text === '아');
  assert.equal(saAfter?.annotation_id, saAnnIdBefore, '사 annotation_id must remain identical');
  assert.equal(saAfter?.animation_progress?.completed, true, '사 cloud must stay completed without reloading');
  assert.equal(aAfter?.animation_progress?.completed, false, 'Only new 아 should animate');
});
