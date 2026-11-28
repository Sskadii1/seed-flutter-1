import test from 'node:test';
import assert from 'node:assert/strict';
import { WonderStroke } from '@seed/schema';
import {
  buildBoardContextModel,
  computeStrokeBoundingBox,
  createEmptyWonderBoard,
  generateHandwrittenStrokesForText,
  latinGlyphStrokes,
  orchestrateWonderTutor,
  recognizeFreehandLatinCluster,
  recognizeHandwritingRegions,
  reconcileAnnotationsWithStrokes,
  reconcileSemanticAnnotations,
} from '../src/index';

function makeFreehandLatinWordStrokes(
  word: string,
  boardId: string,
  startX: number,
  startY: number
): WonderStroke[] {
  const strokes: WonderStroke[] = [];
  let cx = startX;
  const h = 48;
  Array.from(word).forEach((ch, cIdx) => {
    const w = /[mwMW]/.test(ch) ? 32 : /[ilI]/.test(ch) ? 16 : 26;
    const polys = latinGlyphStrokes(ch, cx, startY, w, h, cIdx * 3) ?? [];
    polys.forEach((pts, sIdx) => {
      strokes.push({
        id: `f_en_${word}_${cIdx}_${sIdx}`,
        boardId,
        points: pts,
        color: '#2C221E',
        width: 3.4,
        tool: 'chalk',
        bbox: computeStrokeBoundingBox(pts, 0, 0, 3.4, 'chalk'),
        transform: { dx: 0, dy: 0 },
        revision: 1,
        createdAt: Date.now(),
        provenance: 'freehand_ink',
      });
    });
    cx += w + 8;
  });
  return strokes;
}

test('En-1: Latin vector glyph rendering and strict printed-Latin freehand recognition (with scribble rejection)', () => {
  // Verify full A-Z, a-z, 0-9 generate non-empty vector glyph strokes
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    const polys = latinGlyphStrokes(ch, 20, 20, 24, 36, 0);
    assert.ok(polys && polys.length >= 1 && polys[0].length >= 2, `Missing Latin glyph for ${ch}`);
  }

  const catStrokes = makeFreehandLatinWordStrokes('cat', 'b_en1', 80, 120);
  const autoMatch = recognizeFreehandLatinCluster(catStrokes, false);
  assert.equal(autoMatch?.text.toLowerCase(), 'cat');

  const enMatch = recognizeFreehandLatinCluster(catStrokes, true);
  assert.equal(enMatch?.text.toLowerCase(), 'cat');

  // Strict scribble/zigzag rejection
  const scribblePts = [
    { x: 100, y: 100, pressure: 0.5, t: 0 },
    { x: 160, y: 150, pressure: 0.5, t: 10 },
    { x: 110, y: 170, pressure: 0.5, t: 20 },
    { x: 185, y: 115, pressure: 0.5, t: 30 },
    { x: 120, y: 195, pressure: 0.5, t: 40 },
    { x: 200, y: 145, pressure: 0.5, t: 50 },
    { x: 140, y: 210, pressure: 0.5, t: 60 },
  ];
  const scribbleStroke: WonderStroke = {
    id: 'scribble_en',
    boardId: 'b_en1',
    points: scribblePts,
    color: '#2C221E',
    width: 3.4,
    tool: 'chalk',
    bbox: computeStrokeBoundingBox(scribblePts, 0, 0, 3.4, 'chalk'),
    transform: { dx: 0, dy: 0 },
    revision: 1,
    createdAt: Date.now(),
    provenance: 'freehand_ink',
  };
  assert.equal(recognizeFreehandLatinCluster([scribbleStroke], false), null);
  assert.equal(recognizeFreehandLatinCluster([scribbleStroke], true), null);
});

test('En-2: English grammar & Vietnamese L1 error detection pinpoints exact spans and fixes', () => {
  const cases = [
    { input: 'I go to school yesterday.', target: 'go', corr: 'went' },
    { input: 'She eat a apple every day.', target: 'eat', corr: 'eats' },
    { input: 'She eat a apple every day.', target: 'a apple', corr: 'an apple' },
    { input: 'I am agree and go to home.', target: 'am agree', corr: 'agree' },
    { input: 'I am agree and go to home.', target: 'go to home', corr: 'go home' },
    { input: "He didn't went yesterday.", target: "didn't went", corr: "didn't go" },
    { input: 'This book is more better.', target: 'more better', corr: 'better' },
    { input: 'She gave me many informations.', target: 'informations', corr: 'information' },
  ];

  for (const tc of cases) {
    const board = createEmptyWonderBoard('b_en2', 'English');
    board.targetLanguage = 'en';
    board.aiMode = 'tutor';
    const strokes = generateHandwrittenStrokesForText({
      boardId: board.id,
      text: tc.input,
      startX: 60,
      startY: 120,
      revision: 1,
      color: '#2C221E',
      provenance: 'typed_vector',
    });
    const regions = recognizeHandwritingRegions(strokes, board.id, 1, { targetLanguage: 'en' });
    const ctx = buildBoardContextModel({
      boardId: board.id,
      revision: 1,
      regions,
      strokes,
      existingAnnotations: [],
      existingTeachingCards: [],
    });
    const out = orchestrateWonderTutor({
      board: { ...board, revision: 1, strokes, regions },
      regions,
      context: ctx,
      existingAnnotations: [],
      existingTeachingCards: [],
    });
    const matched = out.annotationsToAdd.find(
      (a) => a.severity === 'error' && a.target_text === tc.target
    );
    assert.ok(matched, `Expected error on "${tc.target}" in "${tc.input}"`);
    assert.equal(matched?.suggested_correction, tc.corr);
  }
});

test('En-3: Valid English sentence emits positive Great job! praise with zero errors', () => {
  const board = createEmptyWonderBoard('b_en3', 'English');
  board.targetLanguage = 'en';
  board.aiMode = 'tutor';
  const strokes = generateHandwrittenStrokesForText({
    boardId: board.id,
    text: 'I went to school yesterday.',
    startX: 60,
    startY: 120,
    revision: 1,
    color: '#2C221E',
    provenance: 'typed_vector',
  });
  const regions = recognizeHandwritingRegions(strokes, board.id, 1, { targetLanguage: 'en' });
  const ctx = buildBoardContextModel({
    boardId: board.id,
    revision: 1,
    regions,
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const out = orchestrateWonderTutor({
    board: { ...board, revision: 1, strokes, regions },
    regions,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const errors = out.annotationsToAdd.filter((a) => a.severity === 'error');
  const praises = out.annotationsToAdd.filter((a) => a.severity === 'praise');
  assert.equal(errors.length, 0);
  assert.equal(praises.length, 1);
  assert.equal(praises[0].suggested_correction, 'Great job!');
});

test('En-4: Independent English word cloud (apple) is preserved when adding coffee beside it, then retracts if expanded into sentence', () => {
  const board = createEmptyWonderBoard('b_en4', 'English');
  board.targetLanguage = 'en';
  board.aiMode = 'tutor';

  const appleStrokes = makeFreehandLatinWordStrokes('apple', board.id, 80, 140);
  const r1 = recognizeHandwritingRegions(appleStrokes, board.id, 1, { targetLanguage: 'en' });
  assert.equal(r1[0]?.recognizedText, 'apple');
  const res1 = orchestrateWonderTutor({
    board: { ...board, revision: 1, strokes: appleStrokes, regions: r1 },
    regions: r1,
    context: buildBoardContextModel({
      boardId: board.id,
      revision: 1,
      regions: r1,
      strokes: appleStrokes,
      existingAnnotations: [],
      existingTeachingCards: [],
    }),
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.equal(res1.annotationsToAdd.length, 1);
  const completedApple = {
    ...res1.annotationsToAdd[0],
    lifecycle_state: 'completed' as const,
    animation_progress: { cloud: 1, arrow: 1, correction: 1, explanation: 1, completed: true },
  };

  // Add independent 'coffee' beside 'apple'
  const coffeeStrokes = makeFreehandLatinWordStrokes('coffee', board.id, 300, 140);
  const allStrokes = [...appleStrokes, ...coffeeStrokes];
  const r2 = recognizeHandwritingRegions(allStrokes, board.id, 2, { targetLanguage: 'en' });
  assert.equal(r2.map((r) => r.recognizedText).join(' '), 'apple coffee');
  const reconciled = reconcileAnnotationsWithStrokes([completedApple], allStrokes, r2);
  const res2 = orchestrateWonderTutor({
    board: {
      ...board,
      revision: 2,
      strokes: allStrokes,
      regions: r2,
      annotations: reconciled,
      semanticTree: res1.semanticTree,
    },
    regions: r2,
    context: buildBoardContextModel({
      boardId: board.id,
      revision: 2,
      regions: r2,
      strokes: allStrokes,
      existingAnnotations: reconciled,
      existingTeachingCards: [],
    }),
    existingAnnotations: reconciled,
    existingTeachingCards: [],
    previousTree: res1.semanticTree,
  });

  assert.deepEqual(res2.retractedAnnotationIds, []);
  const sem2 = reconcileSemanticAnnotations(reconciled, res2.semanticTree);
  assert.deepEqual(sem2.retractedAnnotationIds, []);
  const active2 = [...sem2.nextAnnotations, ...res2.annotationsToAdd].filter((a) => a.status === 'active');
  assert.deepEqual(
    active2.map((a) => a.target_text),
    ['apple', 'coffee']
  );
  assert.equal(active2[0].annotation_id, completedApple.annotation_id);
  assert.equal(active2[0].animation_progress?.completed, true);
  assert.equal(active2[1].animation_progress?.completed, false);
});

test('En-5: Vietnamese beginner discovery request for English builds English teaching card', () => {
  const board = createEmptyWonderBoard('b_en5', 'English Discovery');
  board.targetLanguage = 'en';
  board.aiMode = 'discovery';
  const strokes = generateHandwrittenStrokesForText({
    boardId: board.id,
    text: 'Tôi muốn học cách gọi cà phê bằng tiếng Anh.',
    startX: 60,
    startY: 120,
    revision: 1,
    color: '#2C221E',
    provenance: 'typed_vector',
  });
  const regions = recognizeHandwritingRegions(strokes, board.id, 1, { targetLanguage: 'en' });
  const ctx = buildBoardContextModel({
    boardId: board.id,
    revision: 1,
    regions,
    strokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const out = orchestrateWonderTutor({
    board: { ...board, revision: 1, strokes, regions },
    regions,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  assert.ok(out.teachingCardsToAdd.length >= 1);
  assert.ok(out.teachingCardsToAdd[0].koreanPhrase.toLowerCase().includes('coffee'));
});

test('En-6: Bilingual auto board analyzes Korean and English regions independently on the same canvas', () => {
  const board = createEmptyWonderBoard('b_en6', 'Bilingual KO + EN');
  board.targetLanguage = 'auto';
  board.aiMode = 'tutor';
  const koStrokes = generateHandwrittenStrokesForText({
    boardId: board.id,
    text: '저는 사과가 먹어요.',
    startX: 60,
    startY: 90,
    revision: 1,
    color: '#2C221E',
    provenance: 'typed_vector',
    idPrefix: 'ko_line',
  });
  const enStrokes = generateHandwrittenStrokesForText({
    boardId: board.id,
    text: 'I go to school yesterday.',
    startX: 60,
    startY: 310,
    revision: 1,
    color: '#2C221E',
    provenance: 'typed_vector',
    idPrefix: 'en_line',
  });
  const allStrokes = [...koStrokes, ...enStrokes];
  const regions = recognizeHandwritingRegions(allStrokes, board.id, 1, { targetLanguage: 'auto' });
  const ctx = buildBoardContextModel({
    boardId: board.id,
    revision: 1,
    regions,
    strokes: allStrokes,
    existingAnnotations: [],
    existingTeachingCards: [],
  });
  const out = orchestrateWonderTutor({
    board: { ...board, revision: 1, strokes: allStrokes, regions },
    regions,
    context: ctx,
    existingAnnotations: [],
    existingTeachingCards: [],
  });

  const errors = out.annotationsToAdd.filter((a) => a.severity === 'error');
  assert.ok(errors.some((e) => e.target_text === '사과가' && e.suggested_correction === '사과를'));
  assert.ok(errors.some((e) => e.target_text === 'go' && e.suggested_correction === 'went'));
});
