import test from 'node:test';
import assert from 'node:assert/strict';
import { WonderAnnotationSchema, WONDER_BOARD_THEMES } from '@seed/schema';
import {
  analyzeBoardPedagogy,
  applyWonderLearningEventsToProfile,
  boxesIntersect,
  computeCollisionFreePlacement,
  computeDirtyRegions,
  createEmptyWonderBoard,
  createInitialAiProfile,
  evaluateKoreanRecognitionBenchmark,
  evaluateKoreanRecognitionBenchmarkV2,
  executeGestureQuery,
  findStrokesInPolygon,
  generateCurvedChalkArrowSvgPath,
  generateHandwrittenStrokesForText,
  generateScallopedCloudGeometry,
  generateScallopedCloudSvgPath,
  recognizeHandwritingRegions,
  reconcileAnnotationsWithStrokes,
  sliceArrowPathAtProgress,
  sliceCloudPathAtProgress,
  translateStrokes,
  verifyCloudClearance,
} from '../src/index';

test('Group A (A01-A09): Organic cubic-Bezier cloud encloses visual ink with generous clearance and zero collisions', () => {
  const board = createEmptyWonderBoard('b1', 'Test Board', 'soft-cream-whiteboard');
  assert.equal(WONDER_BOARD_THEMES[board.themeId].backgroundHex, '#F5EFE6');

  const originalStrokes = generateHandwrittenStrokesForText({
    boardId: board.id,
    text: '저는 어제 학교에 가요.',
    startX: 120,
    startY: 160,
    revision: 1,
    color: WONDER_BOARD_THEMES[board.themeId].primaryInkHex,
  });

  board.strokes = originalStrokes;
  board.revision = 1;
  const snapshotBefore = JSON.stringify(board.strokes);

  const regions = recognizeHandwritingRegions(board.strokes, board.id, board.revision);
  const result = analyzeBoardPedagogy({
    board,
    regions,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  // Original user ink remains untouched by AI
  assert.equal(JSON.stringify(board.strokes), snapshotBefore);
  assert.equal(result.nextAnnotations.length, 1);
  const ann = result.nextAnnotations[0];

  // Organic cubic Bezier cloud geometry with generous padding
  const targetStrokes = originalStrokes.filter((s) =>
    ann.source_stroke_ids.includes(s.id)
  );
  const neighborBoxes = regions[0].spans
    .filter((sp) => sp.text !== ann.target_text)
    .map((sp) => sp.bbox);

  const cloud1 = generateScallopedCloudGeometry(
    ann.target_geometry,
    ann.cloud_seed,
    neighborBoxes
  );
  const cloud2 = generateScallopedCloudGeometry(
    ann.target_geometry,
    ann.cloud_seed,
    neighborBoxes
  );

  // Deterministic across re-renders (same seed -> identical pathData)
  assert.equal(cloud1.pathData, cloud2.pathData);
  assert.ok(cloud1.pathData.startsWith('M '));
  assert.ok(cloud1.pathData.includes(' C '));
  assert.ok(cloud1.pathData.endsWith(' Z'));

  const clearance = verifyCloudClearance(cloud1, targetStrokes);
  assert.equal(clearance.valid, true, `Cloud clipped ink: ${JSON.stringify(clearance)}`);
  assert.ok(clearance.minClearance >= 10, `Expected >=10 clearance, got ${clearance.minClearance}`);

  // Neighboring note placement stays non-overlapping
  const placed = computeCollisionFreePlacement({
    targetBox: ann.target_geometry,
    desiredWidth: 240,
    desiredHeight: 110,
    occupiedBoxes: originalStrokes.map((s) => s.bbox),
  });
  for (const sb of originalStrokes.map((s) => s.bbox)) {
    assert.equal(boxesIntersect(placed.noteBox, sb, 6), false);
  }
  const arrowPaths = generateCurvedChalkArrowSvgPath(placed.arrow);
  assert.ok(arrowPaths.shaftPath.startsWith('M '));
  assert.ok(arrowPaths.headPath.includes(' L '));
});

test('Group B (B01-B09): Arc-length single-stroke cloud & arrow progressive slicing produces open paths until 100%', () => {
  const cloud = generateScallopedCloudGeometry(
    { minX: 100, minY: 100, maxX: 220, maxY: 140, width: 120, height: 40 },
    42
  );
  const s0 = sliceCloudPathAtProgress(cloud, 0);
  const s25 = sliceCloudPathAtProgress(cloud, 0.25);
  const s50 = sliceCloudPathAtProgress(cloud, 0.5);
  const s75 = sliceCloudPathAtProgress(cloud, 0.75);
  const s100 = sliceCloudPathAtProgress(cloud, 1);

  assert.equal(s0.pathData, '');
  assert.equal(s25.isClosed, false);
  assert.equal(s25.pathData.endsWith(' Z'), false);
  assert.equal(s50.isClosed, false);
  assert.equal(s75.isClosed, false);
  assert.ok(s50.pathData.length > s25.pathData.length);
  assert.ok(s75.pathData.length > s50.pathData.length);
  assert.equal(s100.isClosed, true);
  assert.ok(s100.pathData.endsWith(' Z'));

  const arrow = { fromX: 160, fromY: 160, ctrlX: 185, ctrlY: 195, toX: 165, toY: 230 };
  const a0 = sliceArrowPathAtProgress(arrow, 0);
  const a50 = sliceArrowPathAtProgress(arrow, 0.5);
  const a100 = sliceArrowPathAtProgress(arrow, 1);
  assert.equal(a0.shaftPath, '');
  assert.equal(a50.headPath, '');
  assert.ok(a50.shaftPath.startsWith('M '));
  assert.ok(a100.headPath.startsWith('M '));
});

test('Group C (C01-C12) & Benchmark V2: Separates synthetic, real-human NOT_AVAILABLE, held-out & negative rejection with zero fake 4-net feedback', () => {
  const legacyBench = evaluateKoreanRecognitionBenchmark();
  assert.ok(legacyBench.cer <= 0.15);
  assert.equal(legacyBench.nonTextRejectionAccuracy, 1);

  const reportV2 = evaluateKoreanRecognitionBenchmarkV2();
  console.log('Wonder Board Recognition Benchmark V2:', {
    syntheticCER: reportV2.datasetA_synthetic.cer,
    realHumanStatus: reportV2.datasetB_realHuman.status,
    heldOutCoverage: reportV2.datasetC_heldOut.coverage,
    heldOutFalseErrors: reportV2.datasetC_heldOut.falseAnnotationRate,
    negativeUnknownRejection: reportV2.datasetD_negativeAndAmbiguous.unknownRejectionRate,
    negativeFalseAnnotations: reportV2.datasetD_negativeAndAmbiguous.falseAnnotationRate,
  });

  assert.equal(reportV2.datasetB_realHuman.status, 'NOT_AVAILABLE');
  assert.equal(reportV2.datasetC_heldOut.coverage, 1);
  assert.equal(reportV2.datasetC_heldOut.falseAnnotationRate, 0);
  assert.equal(reportV2.datasetD_negativeAndAmbiguous.unknownRejectionRate, 1);
  assert.equal(reportV2.datasetD_negativeAndAmbiguous.falseAnnotationRate, 0);

  // C12: AI teaching strokes must never be re-recognized by recognition pipeline
  const aiStrokes = generateHandwrittenStrokesForText({
    boardId: 'b_ai_skip',
    text: '저는 어제 학교에 가요.',
    startX: 40,
    startY: 60,
    revision: 1,
    color: '#C84B64',
    provenance: 'ai_teaching',
  });
  const aiRegs = recognizeHandwritingRegions(aiStrokes, 'b_ai_skip', 1);
  assert.equal(aiRegs.length, 0);
});

test('Group D & E (D01-D15, E01-E12): Incremental N->N+1, multi-error detection, valid-sentence restraint & self-correction', () => {
  // Incomplete fragment N: "저는 어제 학교에 가" -> AI waits cleanly
  const board = createEmptyWonderBoard('bInc');
  const partialStrokes = generateHandwrittenStrokesForText({
    boardId: 'bInc',
    text: '저는 어제 학교에 가',
    startX: 50,
    startY: 80,
    revision: 1,
    color: '#2C221E',
  });
  const partialRegs = recognizeHandwritingRegions(partialStrokes, 'bInc', 1);
  assert.equal(partialRegs[0].recognitionStatus, 'IN_PROGRESS');
  const partialPed = analyzeBoardPedagogy({
    board: { ...board, strokes: partialStrokes },
    regions: partialRegs,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(partialPed.nextAnnotations.length, 0);

  // Learner continues N -> N+1 to "저는 어제 학교에 갔어요." -> Valid sentence, praise tick, zero error!
  const completedStrokes = generateHandwrittenStrokesForText({
    boardId: 'bInc',
    text: '저는 어제 학교에 갔어요.',
    startX: 50,
    startY: 80,
    revision: 2,
    color: '#2C221E',
  });
  const compRegs = recognizeHandwritingRegions(completedStrokes, 'bInc', 2);
  assert.equal(compRegs[0].recognitionStatus, 'RECOGNIZED');
  const dirty = computeDirtyRegions(partialRegs, compRegs);
  assert.ok(dirty.dirtyRegionIds.length >= 1);

  const compPed = analyzeBoardPedagogy({
    board: { ...board, strokes: completedStrokes, revision: 2 },
    regions: compRegs,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(
    compPed.nextAnnotations.filter((a) => a.severity === 'error').length,
    0
  );

  // Multi-sentence independent errors (3 separate errors -> 3 distinct clouds!)
  const s1 = generateHandwrittenStrokesForText({
    boardId: 'bMulti',
    text: '저는 어제 학교에 가요.',
    startX: 50,
    startY: 60,
    revision: 1,
    color: '#2C221E',
  });
  const s2 = generateHandwrittenStrokesForText({
    boardId: 'bMulti',
    text: '저는 사과가 먹어요.',
    startX: 50,
    startY: 220,
    revision: 1,
    color: '#2C221E',
  });
  const s3 = generateHandwrittenStrokesForText({
    boardId: 'bMulti',
    text: '저는 학교에 공부해요.',
    startX: 50,
    startY: 380,
    revision: 1,
    color: '#2C221E',
  });
  const multiBoard = createEmptyWonderBoard('bMulti');
  multiBoard.strokes = [...s1, ...s2, ...s3];
  multiBoard.revision = 1;

  const multiRegs = recognizeHandwritingRegions(multiBoard.strokes, 'bMulti', 1);
  assert.equal(multiRegs.length, 3);
  const multiPed = analyzeBoardPedagogy({
    board: multiBoard,
    regions: multiRegs,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(multiPed.nextAnnotations.length, 3);
  const targets = multiPed.nextAnnotations.map((a) => a.target_text).sort();
  assert.deepEqual(targets, ['가요', '사과가', '학교에']);
  assert.deepEqual(
    multiPed.nextAnnotations.map((a) => a.suggested_correction).sort(),
    ['갔어요', '사과를', '학교에서']
  );

  // Adding valid sentence 저는 학교에 가요. does NOT trigger -에 -> -에서 false positive
  const s4Valid = generateHandwrittenStrokesForText({
    boardId: 'bValid',
    text: '저는 오늘 학교에 가요.',
    startX: 50,
    startY: 60,
    revision: 1,
    color: '#2C221E',
  });
  const validPed = analyzeBoardPedagogy({
    board: { ...createEmptyWonderBoard('bValid'), aiMode: 'gentle', strokes: s4Valid },
    regions: recognizeHandwritingRegions(s4Valid, 'bValid', 1),
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(validPed.nextAnnotations.filter((a) => a.severity === 'error').length, 0);

  // Beginner Vietnamese card + Scenario D trace_guide + Scenario E self-correction BKT bridge
  const sBeg = generateHandwrittenStrokesForText({
    boardId: 'bBeg',
    text: 'Tôi muốn học cách gọi cà phê.',
    startX: 50,
    startY: 80,
    revision: 1,
    color: '#2C221E',
  });
  const begBoard = { ...createEmptyWonderBoard('bBeg'), aiMode: 'discovery' as const, strokes: sBeg };
  const begPed = analyzeBoardPedagogy({
    board: begBoard,
    regions: recognizeHandwritingRegions(sBeg, 'bBeg', 1),
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(begPed.nextTeachingCards[0]?.koreanPhrase, '커피 한 잔 주세요.');

  const hitIds = findStrokesInPolygon(sBeg, [
    { x: 30, y: 60 },
    { x: 600, y: 60 },
    { x: 600, y: 150 },
    { x: 30, y: 150 },
  ]);
  const gRes = executeGestureQuery({ board: begBoard, selectedStrokeIds: hitIds, intent: 'trace_guide' });
  assert.ok(gRes.teachingCard?.ghostHandwritingText);
});

test('Group F (F01-F08): Reconciliation preserves completed annotations on move, invalidates deleted strokes & rejects malformed schemas', () => {
  const board = createEmptyWonderBoard('bRec');
  board.strokes = generateHandwrittenStrokesForText({
    boardId: 'bRec',
    text: '저는 어제 학교에 가요.',
    startX: 50,
    startY: 80,
    revision: 1,
    color: '#2C221E',
  });
  const res = analyzeBoardPedagogy({
    board,
    regions: recognizeHandwritingRegions(board.strokes, 'bRec', 1),
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const completedAnn = {
    ...res.nextAnnotations[0],
    lifecycle_state: 'completed' as const,
    animation_progress: {
      cloud: 1,
      arrow: 1,
      correction: 1,
      explanation: 1,
      completed: true,
    },
  };

  // Moving strokes shifts geometry WITHOUT resetting animation_progress.completed
  const movedStrokes = translateStrokes(
    board.strokes,
    new Set(completedAnn.source_stroke_ids),
    80,
    45,
    2
  );
  const shifted = reconcileAnnotationsWithStrokes([completedAnn], movedStrokes);
  assert.equal(shifted[0].reconciliation_action, 'GEOMETRY_UPDATED');
  assert.equal(shifted[0].animation_progress.completed, true);
  assert.equal(
    Math.round(shifted[0].target_geometry.minX),
    Math.round(completedAnn.target_geometry.minX + 80)
  );

  // Deleting strokes marks annotation INVALIDATED / stale
  const pruned = movedStrokes.filter((s) => !completedAnn.source_stroke_ids.includes(s.id));
  const invalidated = reconcileAnnotationsWithStrokes(shifted, pruned);
  assert.equal(invalidated[0].status, 'stale');
  assert.equal(invalidated[0].lifecycle_state, 'stale');
  assert.equal(invalidated[0].reconciliation_action, 'INVALIDATED');

  // Unconfirmed recognition_uncertainty must NEVER penalize BKT/Elo
  const initProf = createInitialAiProfile();
  const afterUnc = applyWonderLearningEventsToProfile(initProf, [
    {
      eventId: 'u1',
      boardId: 'bRec',
      eventType: 'recognition_uncertainty',
      conceptIds: ['kc_morph_particles'],
      recognizedText: '',
      confirmed: false,
      timestamp: Date.now(),
    },
  ]);
  assert.equal(afterUnc.eloRating, initProf.eloRating);

  // Malformed annotation missing required fields throws ZodError
  assert.throws(() => WonderAnnotationSchema.parse({ annotation_id: 'bad' }));
});
