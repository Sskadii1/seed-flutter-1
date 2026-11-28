import assert from 'node:assert/strict';
import test from 'node:test';
import type { WonderBBox, WonderStroke } from '@seed/schema';
import {
  buildBoardContextModel,
  computeStrokeBoundingBox,
  createEmptyWonderBoard,
  decomposeHangulUnit,
  describeKoreanSyllableOrWordVi,
  executeGestureQuery,
  generateScallopedCloudGeometry,
  hiddenAnnotationArrow,
  inspectHangulBranch,
  orchestrateWonderTutor,
  recognizeWithHybridPipeline,
  routeAnnotationArrow,
  sliceArrowPathAtProgress,
  WonderRecognitionCache,
  type HandwritingRecognitionProvider,
} from '../src';

const box = (minX: number, minY: number, width: number, height: number): WonderBBox =>
  ({ minX, minY, width, height, maxX: minX + width, maxY: minY + height });

// Geometry and mocked OCR contract fixtures. Real handwriting is evaluated separately.
const glyphParts: Record<string, number[][][]> = {
  '아': [
    [[27, 28], [11, 27], [4, 39], [9, 54], [23, 56], [31, 45], [29, 33]],
    [[48, 12], [49, 42], [52, 76]], [[55, 42], [77, 39]],
  ],
  '어': [
    [[20, 23], [8, 26], [3, 39], [8, 54], [20, 57], [28, 47], [25, 28]],
    [[58, 10], [60, 38], [62, 77]], [[37, 39], [54, 42]],
  ],
  '오': [
    [[47, 3], [33, 4], [27, 15], [36, 27], [51, 29], [61, 18], [56, 5]],
    [[5, 71], [45, 72], [83, 73]], [[44, 45], [47, 65]],
  ],
  '우': [
    [[49, 5], [32, 5], [25, 18], [32, 32], [49, 34], [60, 19], [55, 8]],
    [[5, 55], [41, 53], [83, 54]], [[43, 59], [41, 83]],
  ],
  '가': [
    [[5, 24], [27, 24], [26, 59]], [[47, 8], [47, 39], [51, 75]], [[50, 41], [73, 43]],
  ],
  '거': [
    [[4, 23], [28, 24], [25, 62]], [[58, 9], [59, 35], [60, 76]], [[35, 39], [55, 41]],
  ],
  '자': [
    [[4, 25], [28, 24]], [[24, 25], [16, 43], [5, 59]], [[18, 42], [31, 58]],
    [[52, 8], [52, 36], [54, 76]], [[55, 43], [75, 43]],
  ],
  '커': [
    [[5, 24], [29, 25], [26, 59]], [[6, 42], [25, 41]],
    [[61, 10], [60, 37], [62, 77]], [[37, 38], [56, 42]],
  ],
};

function drawFixtures(labels: string[], y = 160): WonderStroke[] {
  return labels.flatMap((label, index) => glyphParts[label].map((coordinates, partIndex) => {
    const points = coordinates.map(([x, dy], t) => ({
      x: x + index * 150 + 30, y: y + dy, pressure: 0.55, t,
    }));
    return {
      id: `glyph-${index}-${partIndex}`, boardId: 'contrast', points, width: 3,
      bbox: computeStrokeBoundingBox(points, 0, 0, 3, 'chalk'),
      color: '#222222', tool: 'chalk', transform: { dx: 0, dy: 0 }, revision: 1,
      createdAt: 1000 + index * 1000 + partIndex * 10, provenance: 'freehand_ink',
    };
  }));
}

function fixtureProvider(labels: string[], calls: string[]): HandwritingRecognitionProvider {
  return {
    id: 'mock-contrastive-vision', kind: 'multimodal_vision',
    capabilities: {
      supportsFreehandKorean: true, supportsFreehandVietnamese: false,
      supportsMixedLanguage: false, supportsWordPositioning: true, requiresNetwork: false,
    },
    async recognizeRegion(req) {
      calls.push(req.regionId);
      assert.equal(req.recentContext, undefined);
      const indices = new Set(req.strokes.map((s) => Number(s.id.split('-')[1])));
      assert.equal(indices.size, 1, 'Each occurrence must have a separate OCR crop');
      const label = labels[[...indices][0]];
      const raw = label === '어' ? '아' : label;
      return {
        status: 'RECOGNIZED', recognizedText: raw, rawTranscription: raw,
        alternatives: raw !== label ? [label] : [], confidence: 0.94,
        language: 'ko', providerId: 'mock-contrastive-vision', latencyMs: 1,
      };
    },
  };
}

async function practice(labels: string[], y = 160) {
  const strokes = drawFixtures(labels, y);
  const snapshot = structuredClone(strokes);
  const calls: string[] = [];
  const cache = new WonderRecognitionCache();
  const params = {
    strokes, boardId: 'contrast', revision: 1,
    visionProvider: fixtureProvider(labels, calls), cache,
    cropRenderer: (crop: WonderStroke[], bbox: WonderBBox) => ({
      imageDataUrl: `data:image/png;base64,${Buffer.from(crop.map((s) => s.id).join(',')).toString('base64')}`,
      cropTransform: {
        worldMinX: bbox.minX, worldMinY: bbox.minY, worldWidth: bbox.width, worldHeight: bbox.height,
        pixelWidth: 120, pixelHeight: 120, scale: 1,
      },
    }),
  };
  const result = await recognizeWithHybridPipeline(params);
  assert.deepEqual(result.regions.map((region) => region.recognizedText), labels);
  assert.equal(calls.length, labels.length);
  assert.equal(new Set(calls).size, labels.length);
  assert.equal(new Set(result.diagnostics.map((d) => d.recognitionId)).size, labels.length);
  assert.equal(new Set(result.diagnostics.map((d) => d.inputImageHash)).size, labels.length);
  assert.equal(result.diagnostics.filter((d) => d.requestAttempted).length, labels.length);
  assert.deepEqual(strokes, snapshot);
  const cached = await recognizeWithHybridPipeline({ ...params, revision: 2 });
  assert.equal(cached.apiCallsMade, 0);
  assert.deepEqual(cached.regions.map((r) => r.recognizedText), labels);
  assert.deepEqual(cached.regions.map((r) => r.recognitionId), result.regions.map((r) => r.recognitionId));
  const board = { ...createEmptyWonderBoard('contrast'), aiMode: 'tutor' as const,
    guidanceLevel: 'guided' as const, revision: 1, strokes, regions: result.regions };
  const context = buildBoardContextModel({
    boardId: board.id, revision: board.revision, regions: board.regions, strokes,
    existingAnnotations: [], existingTeachingCards: [],
  });
  return {
    result, board, context,
    tutor: orchestrateWonderTutor({ board, regions: board.regions, context, existingAnnotations: [], existingTeachingCards: [] }),
  };
}

for (const scenario of [
  { id: 'R01', labels: ['아', '아', '아', '아'], intent: 'REPEATED_CHARACTER_PRACTICE' },
  { id: 'R02', labels: ['아', '어', '아', '어'], intent: 'VOWEL_ORIENTATION_PRACTICE' },
  { id: 'R03', labels: ['오', '우', '오', '우'], intent: 'VOWEL_ORIENTATION_PRACTICE' },
  { id: 'R04', labels: ['가', '거', '가', '거'], intent: 'VOWEL_ORIENTATION_PRACTICE' },
  { id: 'R06/R08', labels: ['아', '어', '자', '커'], intent: 'UNKNOWN_PRACTICE_INTENT' },
]) {
  test(`${scenario.id} keeps occurrence identities and shares at most one lesson`, async () => {
    const { result, board, context, tutor } = await practice(scenario.labels);
    assert.ok(board.regions.every((reg) => tutor.intentsByRegionId[reg.regionId][0].intent === scenario.intent));
    assert.equal(tutor.annotationsToAdd.length, scenario.id === 'R06/R08' ? 0 : 1);
    assert.ok(tutor.annotationsToAdd.every((annotation) => annotation.severity !== 'error'));
    const next = orchestrateWonderTutor({
      board, regions: board.regions, context, existingAnnotations: tutor.annotationsToAdd, existingTeachingCards: [],
    });
    assert.equal(next.annotationsToAdd.length, 0, 'The same activity must not replay its explanation');
    if (scenario.id === 'R02') {
      assert.ok(tutor.annotationsToAdd[0].explanation.includes('아 = ㅇ + ㅏ'));
      assert.ok(tutor.annotationsToAdd[0].explanation.includes('어 = ㅇ + ㅓ'));
      assert.equal(result.diagnostics[1].rawTranscription, '아');
      assert.equal(result.diagnostics[1].structuralVerification?.verdict, 'provider_alternative');
    }
  });
}

test('R05 small gaps, tilt, open loops, reversed pen paths, and unavailable corroboration', async () => {
  const strokes = drawFixtures(['어']).reverse().map((s) => ({ ...s, points: [...s.points].reverse() }));
  const evidence = inspectHangulBranch(strokes);
  assert.equal(evidence?.vowel, 'ㅓ');
  assert.equal(evidence?.side, 'left');
  assert.equal(evidence?.virtualJunction, true);
  assert.equal(evidence?.componentLayout, 'initial_left');
  const provider = fixtureProvider(['아'], []);
  const res = await recognizeWithHybridPipeline({ strokes, boardId: 'contrast', revision: 1, visionProvider: provider });
  assert.equal(res.regions[0].recognitionStatus, 'AMBIGUOUS');
  assert.deepEqual(res.regions[0].alternativeCandidates, ['아', '어']);
  assert.equal(res.diagnostics[0].structuralVerification?.verdict, 'conflict');
});

test('R07 explicit writing exercise only corrects the mismatching occurrence', async () => {
  const { board } = await practice(['아', '아', '어', '아'], 340);
  const sample = board.regions[0];
  const exercise = executeGestureQuery({ board, selectedStrokeIds: sample.strokeIds, intent: 'practice_exercise' });
  assert.equal(exercise.teachingCard?.practiceTarget, '아');
  const card = { ...exercise.teachingCard!, createdAt: 0, geometry: box(25, 260, 610, 58) };
  const context = buildBoardContextModel({
    boardId: board.id, revision: board.revision, regions: board.regions, strokes: board.strokes,
    existingAnnotations: [], existingTeachingCards: [card],
  });
  const result = orchestrateWonderTutor({
    board, regions: board.regions, context, existingAnnotations: [], existingTeachingCards: [card],
  });
  assert.deepEqual(result.annotationsToAdd.filter((a) => a.severity === 'error').map((a) => a.target_text), ['어']);
  assert.equal(result.annotationsToAdd.length, 1);
  assert.deepEqual(result.annotationsToAdd[0].source_stroke_ids, board.regions[2].strokeIds);
});

test('Unicode jamo and syllable descriptions preserve initial, medial and final roles', () => {
  assert.deepEqual(decomposeHangulUnit('어'), { unit: '어', initial: 'ㅇ', vowel: 'ㅓ', final: '' });
  assert.deepEqual(decomposeHangulUnit('학'), { unit: '학', initial: 'ㅎ', vowel: 'ㅏ', final: 'ㄱ' });
  assert.match(describeKoreanSyllableOrWordVi('아')!.explanation, /Âm tiết Hangul 아 = ㅇ \+ ㅏ/);
  assert.match(describeKoreanSyllableOrWordVi('ㅏ')!.explanation, /ㅏ là jamo nguyên âm/);
});

test('R05 geometry preserves two-branch occupancy under stroke reordering', () => {
  const options = [
    { label: '아', offsetX: 0, offsetY: 14, expected: 'ㅑ' },
    { label: '어', offsetX: 0, offsetY: 14, expected: 'ㅕ' },
    { label: '오', offsetX: 19, offsetY: 0, expected: 'ㅛ' },
    { label: '우', offsetX: 19, offsetY: 0, expected: 'ㅠ' },
  ];
  for (const { label, offsetX, offsetY, expected } of options) {
    const [initial, stem, branch] = drawFixtures([label]);
    const points = branch.points.map((p) => ({ ...p, x: p.x + offsetX, y: p.y + offsetY })).reverse();
    const extra = { ...branch, id: 'second-branch', points, bbox: computeStrokeBoundingBox(points, 0, 0, 3, 'chalk') };
    assert.equal(inspectHangulBranch([extra, initial, branch, stem])?.vowel, expected);
  }
});

test('Twenty recognized practice occurrences leave one shared visible annotation candidate', async () => {
  const { board, tutor } = await practice(Array.from({ length: 20 }, () => '아'));
  assert.equal(board.regions.length, 20);
  assert.equal(tutor.annotationsToAdd.length, 1);
  assert.equal(Object.keys(tutor.practiceByRegionId).length, 20);
});

test('AR01–AR04, AR06–AR07 validate the shaft, head, alternate anchors, moved ink and no-route fallback', () => {
  const targetBox = box(70, 100, 45, 45);
  const cloud = generateScallopedCloudGeometry(targetBox, 1, [], true);
  const noteBox = box(cloud.outerBounds.maxX + 85, 87, 190, 84);
  const params = { targetBox, cloud, noteBox, placement: 'right' as const, obstacles: [targetBox] };
  const direct = routeAnnotationArrow(params);
  assert.ok(direct, 'Unobstructed text retains its connector');
  const anotherArrow = routeAnnotationArrow({ ...params, existingRoutes: [direct] });
  assert.notDeepEqual(anotherArrow, direct);
  const ink = box(direct.toX - 52, direct.toY - 2, 3, 4);
  const alternate = routeAnnotationArrow({ ...params, obstacles: [targetBox, ink] });
  assert.ok(alternate);
  assert.notDeepEqual(alternate, direct);
  const unrelatedCloud = box(cloud.outerBounds.maxX + 4, 0, 60, 260);
  assert.equal(routeAnnotationArrow({ ...params, obstacles: [unrelatedCloud] }), undefined);
  // A narrow obstacle near a previous sample interval still intersects the shaft.
  const adjacentInk = box(direct.fromX + 2, direct.fromY - 140, 1, 280);
  assert.equal(routeAnnotationArrow({ ...params, obstacles: [adjacentInk] }), undefined);
  assert.equal(routeAnnotationArrow({ ...params, noteBox: box(700, 90, 200, 85) }), undefined);
  const moved = routeAnnotationArrow({ ...params, noteBox: box(noteBox.minX + 12, 100, 190, 84) });
  assert.ok(moved);
  assert.ok(Math.abs(moved.toX - noteBox.minX) < 0.06);
  const hidden = sliceArrowPathAtProgress(hiddenAnnotationArrow(noteBox), 1);
  assert.equal(hidden.shaftPath + hidden.headPath, '');
});

test('AR05 viewport constraints preserve the world-space owner and hide clipped routes', () => {
  const targetBox = box(80, 120, 35, 45);
  const cloud = generateScallopedCloudGeometry(targetBox, 11, [], true);
  const noteBox = box(cloud.outerBounds.maxX + 55, 100, 180, 70);
  const params = { targetBox, cloud, noteBox, placement: 'right' as const, obstacles: [targetBox] };
  const route = routeAnnotationArrow(params);
  assert.ok(route);
  for (const zoom of [0.25, 0.5, 1, 1.5, 2]) {
    const safeBounds = box(20, 20, 800 / zoom, 420 / zoom);
    assert.deepEqual(routeAnnotationArrow({ ...params, safeBounds }), route);
  }
  assert.equal(routeAnnotationArrow({ ...params, safeBounds: box(200, 100, 400, 200) }), undefined);
});
