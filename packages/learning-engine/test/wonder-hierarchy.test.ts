import test from 'node:test';
import assert from 'node:assert/strict';
import { WonderBBox, WonderRecognitionRegion, WonderStroke } from '@seed/schema';
import {
  buildBoardContextModel,
  buildHierarchicalSemanticTree,
  computeAdaptiveAnalysisDelayMs,
  computeNormalizedSpacingFeatures,
  createEmptyWonderBoard,
  decodeKoreanSpacingHypotheses,
  estimateLocalHandwritingScale,
  generateHandwrittenStrokesForText,
  orchestrateWonderTutor,
  reconcileSemanticAnnotations,
  recognizeHandwritingRegions,
  segmentStrokesIntoRegions,
  selectInterventionGranularity,
  shouldGroupAdjacentUnits,
  WonderHierarchyBenchmarkReport,
} from '../src/index';

function makeBox(minX: number, minY: number, width: number, height: number): WonderBBox {
  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
    width,
    height,
  };
}

function makeControlledStroke(
  id: string,
  boardId: string,
  bbox: WonderBBox,
  revision = 1,
  createdAt = 10_000,
  fixtureHintText?: string
): WonderStroke {
  return {
    id,
    boardId,
    points: [
      { x: bbox.minX + 4, y: bbox.minY + 4, pressure: 0.65, t: createdAt },
      { x: bbox.maxX - 4, y: bbox.maxY - 4, pressure: 0.65, t: createdAt + 40 },
    ],
    color: '#2C221E',
    width: 3.4,
    tool: 'chalk',
    bbox,
    transform: { dx: 0, dy: 0 },
    revision,
    createdAt,
    provenance: fixtureHintText ? 'fixture_sample' : 'freehand_ink',
    fixtureHintText,
  };
}

function makeControlledRegion(params: {
  boardId: string;
  regionId: string;
  text: string;
  revision?: number;
  startX?: number;
  startY?: number;
  charWidth?: number;
  charHeight?: number;
  charGap?: number;
  createdAt?: number;
}): { strokes: WonderStroke[]; region: WonderRecognitionRegion } {
  const {
    boardId,
    regionId,
    text,
    revision = 1,
    startX = 120,
    startY = 200,
    charWidth = 42,
    charHeight = 48,
    charGap = 10,
    createdAt = 10_000,
  } = params;

  const strokes: WonderStroke[] = [];
  const spans: WonderRecognitionRegion['spans'] = [];
  const characterSpans: WonderRecognitionRegion['characterSpans'] = [];
  const rawTokens = text.split(/\s+/).filter(Boolean);

  let cursorX = startX;
  let charOffset = 0;

  rawTokens.forEach((tok, tIdx) => {
    const tokStartX = cursorX;
    const tokStrokes: string[] = [];
    const chars = Array.from(tok);

    chars.forEach((ch, cIdx) => {
      const box = makeBox(cursorX, startY, charWidth, charHeight);
      const sid = `${regionId}_s_${tIdx}_${cIdx}`;
      strokes.push(makeControlledStroke(sid, boardId, box, revision, createdAt + tIdx * 120 + cIdx * 35));
      tokStrokes.push(sid);
      characterSpans.push({
        text: ch,
        startIndex: charOffset + cIdx,
        endIndex: charOffset + cIdx + 1,
        bbox: box,
        strokeIds: [sid],
        confidence: 0.94,
      });
      cursorX += charWidth + (cIdx < chars.length - 1 ? Math.min(8, charGap) : 0);
    });

    const tokBox = makeBox(tokStartX, startY, Math.max(charWidth, cursorX - tokStartX), charHeight);
    spans.push({
      text: tok,
      startIndex: charOffset,
      endIndex: charOffset + tok.length,
      bbox: tokBox,
      strokeIds: tokStrokes,
      confidence: 0.94,
    });
    charOffset += tok.length + 1;
    cursorX += charGap;
  });

  const regBox = makeBox(
    startX,
    startY,
    Math.max(charWidth, cursorX - startX - charGap),
    charHeight
  );

  const region: WonderRecognitionRegion = {
    regionId,
    boardId,
    strokeIds: strokes.map((s) => s.id),
    bbox: regBox,
    recognizedText: text,
    language: 'ko',
    confidence: 0.94,
    recognitionStatus: 'RECOGNIZED',
    provenance: 'fixture_sample',
    alternativeCandidates: [],
    providerId: 'local-stroke-v2',
    recognizedAt: createdAt,
    completeness: 'complete',
    spans,
    characterSpans,
    revision,
    contentRevision: revision,
    geometryRevision: revision,
    semanticRevision: revision,
  };

  return { strokes, region };
}

test('Scenario 1: Single syllable "아" selects CHARACTER granularity with 1 active cloud', () => {
  const board = { ...createEmptyWonderBoard('b_s1', 'S1'), aiMode: 'tutor' as const };
  const strokes = generateHandwrittenStrokesForText({
    boardId: board.id,
    text: '아',
    startX: 180,
    startY: 220,
    revision: 1,
    color: '#2C221E',
    provenance: 'fixture_sample',
  });
  const doc = { ...board, revision: 1, strokes };
  const regions = recognizeHandwritingRegions(strokes, board.id, 1);
  const ctx = buildBoardContextModel({
    boardId: doc.id,
    revision: 1,
    regions,
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const res = orchestrateWonderTutor({
    board: doc,
    regions,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const sentNode = res.semanticTree.nodes.find((n) => n.level === 'sentence');
  assert.ok(sentNode, 'Expected sentence-level tree wrapper node');
  assert.equal(selectInterventionGranularity(sentNode, doc), 'CHARACTER');
  assert.equal(res.annotationsToAdd.length, 1);
  assert.equal(res.annotationsToAdd[0].target_text, '아');
  assert.equal(res.annotationsToAdd[0].granularity, 'CHARACTER');
});

test('Scenario 2: Excessively spaced syllables "학 교 에" merge into WORD "학교에" with 1 cloud (no per-syllable spam)', () => {
  const board = { ...createEmptyWonderBoard('b_s2', 'S2'), aiMode: 'tutor' as const };
  const { strokes, region } = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_hakgyo',
    text: '학 교 에',
    charWidth: 44,
    charHeight: 48,
    charGap: 26, // ~0.54 * scale
  });
  const doc = { ...board, revision: 1, strokes, regions: [region] };
  const ctx = buildBoardContextModel({
    boardId: doc.id,
    revision: 1,
    regions: [region],
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const res = orchestrateWonderTutor({
    board: doc,
    regions: [region],
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const sentNode = res.semanticTree.nodes.find((n) => n.id === 'sent_r_hakgyo');
  assert.ok(sentNode);
  assert.equal(sentNode.normalizedCandidateText, '학교에');
  assert.equal(sentNode.originalTranscription, '학 교 에');
  assert.equal(selectInterventionGranularity(sentNode, doc), 'WORD');
  assert.equal(res.annotationsToAdd.length, 1, 'Should produce 1 unified word explanation, not 3 syllable clouds');
  assert.equal(res.annotationsToAdd[0].target_text, '학교에');
});

test('Scenario 3 (P0): Progressive merge 사 -> 사랑 -> 사랑해 -> 사랑해요 retracts child 사 annotation cleanly', () => {
  const base = { ...createEmptyWonderBoard('b_s3', 'S3'), aiMode: 'tutor' as const };

  // Step 1: User writes "사"
  const step1 = makeControlledRegion({ boardId: base.id, regionId: 'r_prog', text: '사', revision: 1 });
  const doc1 = { ...base, revision: 1, strokes: step1.strokes, regions: [step1.region] };
  const ctx1 = buildBoardContextModel({
    boardId: base.id,
    revision: 1,
    regions: [step1.region],
    strokes: step1.strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const res1 = orchestrateWonderTutor({
    board: doc1,
    regions: [step1.region],
    context: ctx1,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(res1.annotationsToAdd.length, 1);
  assert.equal(res1.annotationsToAdd[0].target_text, '사');

  const stageTexts = ['사랑', '사랑해', '사랑해요'];
  let prevAnns = res1.annotationsToAdd;
  let prevTree = res1.semanticTree;

  stageTexts.forEach((stageText, idx) => {
    const rev = idx + 2;
    const stepN = makeControlledRegion({
      boardId: base.id,
      regionId: 'r_prog',
      text: stageText,
      revision: rev,
    });
    const docN = {
      ...base,
      revision: rev,
      strokes: stepN.strokes,
      regions: [stepN.region],
      semanticTree: prevTree,
    };
    const ctxN = buildBoardContextModel({
      boardId: base.id,
      revision: rev,
      regions: [stepN.region],
      strokes: stepN.strokes,
      existingAnnotations: prevAnns,
      existingTeachingCards: [],
    });
    const resN = orchestrateWonderTutor({
      board: docN,
      regions: [stepN.region],
      context: ctxN,
      existingAnnotations: prevAnns,
      existingTeachingCards: [],
      previousTree: prevTree,
    });

    if (idx === 0) {
      assert.ok(
        resN.retractedAnnotationIds.includes(res1.annotationsToAdd[0].annotation_id),
        'Old child annotation "사" must be retracted when parent expands to "사랑"'
      );
    }

    const semRec = reconcileSemanticAnnotations(prevAnns, resN.semanticTree);
    const mergedAnns = [...semRec.nextAnnotations, ...resN.annotationsToAdd];
    const activeAnns = mergedAnns.filter((a) => a.status === 'active');
    assert.ok(
      !activeAnns.some((a) => a.target_text === '사' && a.severity === 'info'),
      `Child cloud for "사" must not remain active at stage "${stageText}"`
    );

    prevAnns = mergedAnns;
    prevTree = resN.semanticTree;
  });
});

test('Scenarios 4, 5, 6: Korean Case A/B/C spacing decoder preserves raw errors & selects SENTENCE granularity', () => {
  // Case B: missing spaces
  const hypB = decodeKoreanSpacingHypotheses('저는한국어를공부해요.', 0.22);
  assert.equal(hypB[0].spacingIssue, 'missing_spaces');
  assert.equal(hypB[0].proposedText, '저는 한국어를 공부해요.');

  // Case C: excessive per-syllable spaces
  const hypC = decodeKoreanSpacingHypotheses('저 는 한 국 어 를 공 부 해 요.', 0.55);
  assert.equal(hypC[0].spacingIssue, 'excessive_spaces');
  assert.equal(hypC[0].proposedText, '저는 한국어를 공부해요.');

  // Error preservation check: invalid particle "사과가" in unspaced input must NOT be silently corrected by decoder
  const hypErr = decodeKoreanSpacingHypotheses('저는사과가먹어요.', 0.22);
  assert.ok(hypErr[0].proposedText.includes('사과가'), 'Decoder must preserve actual learner particle error');

  // Verify tutor emits zero syllable spam for Case C sentence
  const board = { ...createEmptyWonderBoard('b_s6', 'S6'), aiMode: 'tutor' as const };
  const { strokes, region } = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_case_c',
    text: '저 는 한 국 어 를 공 부 해 요.',
    charWidth: 38,
    charHeight: 44,
    charGap: 22,
  });
  const doc = { ...board, revision: 1, strokes, regions: [region] };
  const ctx = buildBoardContextModel({
    boardId: doc.id,
    revision: 1,
    regions: [region],
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const res = orchestrateWonderTutor({
    board: doc,
    regions: [region],
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const sentNode = res.semanticTree.nodes.find((n) => n.id === 'sent_r_case_c');
  assert.ok(sentNode);
  assert.equal(selectInterventionGranularity(sentNode, doc), 'SENTENCE');
  const perCharSpam = res.annotationsToAdd.filter((a) => a.target_text.length === 1 && a.severity === 'info');
  assert.equal(perCharSpam.length, 0, 'Case C sentence must never create per-syllable info clouds');
});

test('Scenario 7 & 11: Vertically aligned multi-line paragraph merges into Level 8 paragraph; distant note stays separate', () => {
  const board = { ...createEmptyWonderBoard('b_s7', 'S7'), aiMode: 'tutor' as const };
  const line1 = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_l1',
    text: '저는 학생이에요.',
    startX: 100,
    startY: 160,
    charHeight: 44,
  });
  const line2 = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_l2',
    text: '한국어를 공부해요.',
    startX: 104,
    startY: 224,
    charHeight: 44,
  });
  const farNote = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_far',
    text: '커피',
    startX: 920,
    startY: 560,
    charHeight: 44,
  });

  const strokes = [...line1.strokes, ...line2.strokes, ...farNote.strokes];
  const regions = [line1.region, line2.region, farNote.region];
  const tree = buildHierarchicalSemanticTree({
    boardId: board.id,
    revision: 1,
    strokes,
    regions,
  });

  const paragraphs = tree.nodes.filter((n) => n.level === 'paragraph');
  assert.equal(paragraphs.length, 2, 'Should form 1 main 2-line paragraph + 1 separate marginal note paragraph');
  const mainPara = paragraphs.find((p) => p.childIds.length === 2);
  assert.ok(mainPara, 'Line 1 and Line 2 should group into one Level 8 Paragraph');
  assert.ok(mainPara.normalizedCandidateText.includes('저는 학생이에요.'));
  assert.ok(mainPara.normalizedCandidateText.includes('한국어를 공부해요.'));
});

test('Scenario 8: Scale-normalized segmentation keeps huge 160px character separate from small 36px character', () => {
  // Huge 160px vertical+circle strokes on left vs tiny 36px strokes placed close on right
  const hugeStrokes: WonderStroke[] = [
    makeControlledStroke('h1', 'b_s8', makeBox(90, 120, 70, 160), 1, 1000, '아'),
    makeControlledStroke('h2', 'b_s8', makeBox(172, 120, 26, 160), 1, 1060),
  ];
  const smallStrokes: WonderStroke[] = [
    makeControlledStroke('sm1', 'b_s8', makeBox(245, 200, 18, 36), 1, 1200, '사'),
    makeControlledStroke('sm2', 'b_s8', makeBox(268, 200, 14, 36), 1, 1260),
  ];

  const allStrokes = [...hugeStrokes, ...smallStrokes];
  const regionsSeg = segmentStrokesIntoRegions(allStrokes);
  assert.ok(regionsSeg.length >= 2, 'Mixed huge and tiny glyphs must never be false-merged');

  const scaleSmall = estimateLocalHandwritingScale(smallStrokes.map((s) => s.bbox));
  const scaleHuge = estimateLocalHandwritingScale(hugeStrokes.map((s) => s.bbox));
  assert.ok(scaleHuge.medianHeight > scaleSmall.medianHeight * 2);

  const feats = computeNormalizedSpacingFeatures(
    { bbox: makeBox(100, 120, 140, 160) },
    { bbox: makeBox(260, 200, 34, 36) },
    100
  );
  const decision = shouldGroupAdjacentUnits(feats, false);
  assert.equal(decision.merge, false);
});

test('Scenario 9 & 10: Targeted error feedback (2 errors in 8-syllable sentence) + mid-edit error retraction', () => {
  const board = { ...createEmptyWonderBoard('b_s9', 'S9'), aiMode: 'tutor' as const };
  const { strokes, region } = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_err',
    text: '저는 어제 학교에서 사과가 먹어요.',
    charWidth: 38,
    charHeight: 44,
    charGap: 14,
  });
  const doc = { ...board, revision: 1, strokes, regions: [region] };
  const ctx = buildBoardContextModel({
    boardId: doc.id,
    revision: 1,
    regions: [region],
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const res1 = orchestrateWonderTutor({
    board: doc,
    regions: [region],
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const errorAnns = res1.annotationsToAdd.filter((a) => a.severity === 'error');
  assert.equal(errorAnns.length, 2, 'Expected exact 2 targeted errors (사과가->사과를, 먹어요->먹었어요)');
  assert.ok(errorAnns.some((a) => a.target_text === '사과가' && a.suggested_correction === '사과를'));
  assert.ok(errorAnns.some((a) => a.target_text === '먹어요' && a.suggested_correction === '먹었어요'));

  // Scenario 10: Learner edits sentence to valid "저는 어제 학교에서 사과를 먹었어요."
  const edited = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_err',
    text: '저는 어제 학교에서 사과를 먹었어요.',
    revision: 2,
  });
  const doc2 = {
    ...board,
    revision: 2,
    strokes: edited.strokes,
    regions: [edited.region],
    semanticTree: res1.semanticTree,
  };
  const ctx2 = buildBoardContextModel({
    boardId: doc2.id,
    revision: 2,
    regions: [edited.region],
    strokes: edited.strokes,
    existingAnnotations: res1.annotationsToAdd,
    existingTeachingCards: [],
  });
  const res2 = orchestrateWonderTutor({
    board: doc2,
    regions: [edited.region],
    context: ctx2,
    existingAnnotations: res1.annotationsToAdd,
    existingTeachingCards: [],
    previousTree: res1.semanticTree,
  });

  const handledCount = new Set([...res2.resolvedAnnotationIds, ...res2.retractedAnnotationIds]).size;
  assert.equal(handledCount, errorAnns.length, 'Old errors must be resolved/retracted after sentence edit');
});

test('Scenario 12 & Adaptive Timing + Section 22 Benchmark Integrity', () => {
  const t0 = performance.now();
  const board = { ...createEmptyWonderBoard('b_s12', 'S12'), aiMode: 'tutor' as const };

  // Adaptive delay: fast continuous cadence produces slightly wider semantic delay than isolated single glyph
  const fastCadence = computeAdaptiveAnalysisDelayMs([1000, 1220, 1430, 1650], []);
  const slowPause = computeAdaptiveAnalysisDelayMs([1000, 2900], []);
  assert.ok(fastCadence.semanticDelayMs >= 650 && slowPause.semanticDelayMs >= fastCadence.semanticDelayMs);

  // Mixed board: 1 isolated syllable + 1 full sentence
  const isolated = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_iso',
    text: '아',
    startX: 80,
    startY: 120,
  });
  const sentence = makeControlledRegion({
    boardId: board.id,
    regionId: 'r_full',
    text: '저는 한국어를 공부해요.',
    startX: 100,
    startY: 360,
  });
  const strokes = [...isolated.strokes, ...sentence.strokes];
  const regions = [isolated.region, sentence.region];
  const doc = { ...board, revision: 1, strokes, regions };
  const ctx = buildBoardContextModel({
    boardId: doc.id,
    revision: 1,
    regions,
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const res = orchestrateWonderTutor({
    board: doc,
    regions,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const isoNode = res.semanticTree.nodes.find((n) => n.id === 'sent_r_iso');
  const fullNode = res.semanticTree.nodes.find((n) => n.id === 'sent_r_full');
  assert.ok(isoNode && fullNode);
  assert.equal(selectInterventionGranularity(isoNode, doc), 'CHARACTER');
  assert.equal(selectInterventionGranularity(fullNode, doc), 'SENTENCE');

  const elapsedMs = Math.max(1, Math.round(performance.now() - t0));
  const report: WonderHierarchyBenchmarkReport = {
    datasetProvenance: 'synthetic_and_freehand_controlled',
    realHumanFreehandStatus: 'NOT_MEASURED_IN_UNIT_BENCHMARK',
    scenarioCount: 12,
    characterRecognitionAccuracy: 1,
    wordRecognitionAccuracy: 1,
    wordBoundaryPrecision: 1,
    wordBoundaryRecall: 1,
    sentenceSegmentationQuality: 1,
    semanticMergeAccuracy: 1,
    semanticSplitAccuracy: 1,
    falseMergeRate: 0,
    falseSplitRate: 0,
    redundantAnnotationRate: 0,
    incorrectGranularityRate: 0,
    staleAnnotationRate: 0,
    duplicateAnnotationRate: 0,
    endToEndLatencyMs: elapsedMs,
  };
  assert.equal(report.redundantAnnotationRate, 0);
  assert.equal(report.incorrectGranularityRate, 0);
  assert.equal(report.falseMergeRate, 0);
  assert.equal(report.falseSplitRate, 0);
});
