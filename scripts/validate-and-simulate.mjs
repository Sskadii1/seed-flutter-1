import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Deterministic Hangul Unicode & Morphophonemic Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the Jongseong (batchim) index (0..27) of the last Hangul syllable.
 * 0 means no batchim; 8 means ㄹ (rieul).
 */
export function getBatchimJamoIndex(koreanText) {
  const trimmed = koreanText.trim();
  assert(trimmed.length > 0, 'koreanText must not be empty');
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return 0;
  return (code - 0xac00) % 28;
}

export function hasBatchim(koreanText) {
  return getBatchimJamoIndex(koreanText) !== 0;
}

export function attachParticle(noun, pair) {
  const batchimIdx = getBatchimJamoIndex(noun);
  const hasB = batchimIdx !== 0;
  switch (pair) {
    case '은/는':
      return `${noun}${hasB ? '은' : '는'}`;
    case '이/가':
      return `${noun}${hasB ? '이' : '가'}`;
    case '을/를':
      return `${noun}${hasB ? '을' : '를'}`;
    case '이에요/예요':
      return `${noun}${hasB ? '이에요' : '예요'}`;
    case '(으)로':
      // Both no-batchim (0) and ㄹ-batchim (8) take '로'
      return `${noun}${batchimIdx === 0 || batchimIdx === 8 ? '로' : '으로'}`;
    default:
      throw new Error(`Unsupported particle pair: ${pair}`);
  }
}

// ---------------------------------------------------------------------------
// 2. FSRS-4.5 Scheduler & 4-Stage Mastery Engine
// ---------------------------------------------------------------------------

// Default FSRS-4.5 weights
const W = [
  0.4872, 1.4003, 3.7145, 13.8206, // w0..w3: S0 for Again, Hard, Good, Easy
  5.1618, 1.2298, 0.8975, 0.031,   // w4..w7: D0 & difficulty update
  1.6474, 0.1367, 1.0461,          // w8..w10: recall stability growth
  2.1072, 0.0793, 0.3246, 1.587,   // w11..w14: lapse stability
  0.2272, 2.8755                   // w15..w16: hard penalty, easy bonus
];

const DECAY_FACTOR = 19 / 81; // ensures R(S, S) = 0.9

export function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + DECAY_FACTOR * (elapsedDays / stability), -0.5);
}

export function nextInterval(stability, targetRetention = 0.9) {
  const raw = (stability / DECAY_FACTOR) * (Math.pow(targetRetention, -2) - 1);
  return Math.max(1, Math.round(raw));
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export function initFsrsCard(grade) {
  const s = W[grade - 1];
  const d = clamp(W[4] - (grade - 3) * W[5], 1, 10);
  return {
    stability: s,
    difficulty: d,
    reps: 1,
    lapses: grade === 1 ? 1 : 0,
    stage: grade >= 3 ? 2 : 1,
    lastElapsedDays: 0,
  };
}

export function reviewFsrsCard(card, grade, elapsedDays) {
  const r = retrievability(elapsedDays, card.stability);
  const d0Good = clamp(W[4], 1, 10);
  const nextD = clamp(
    W[7] * d0Good + (1 - W[7]) * (card.difficulty - W[6] * (grade - 3)),
    1,
    10
  );

  let nextS;
  let nextStage = card.stage;
  let lapses = card.lapses;

  if (grade === 1) {
    // Lapse: stability shrinks, stage demotes by 1 (min 1)
    const forgetS =
      W[11] *
      Math.pow(card.difficulty, -W[12]) *
      (Math.pow(card.stability + 1, W[13]) - 1) *
      Math.exp(W[14] * (1 - r));
    nextS = Math.max(0.2, Math.min(card.stability, forgetS));
    nextStage = Math.max(1, card.stage - 1);
    lapses += 1;
  } else {
    // Recall
    const hardPenalty = grade === 2 ? W[15] : 1;
    const easyBonus = grade === 4 ? W[16] : 1;
    const growth =
      Math.exp(W[8]) *
      (11 - card.difficulty) *
      Math.pow(card.stability, -W[9]) *
      (Math.exp(W[10] * (1 - r)) - 1) *
      hardPenalty *
      easyBonus;
    nextS = card.stability * (1 + growth);

    // 4-Stage promotion rules (Good or Easy required)
    if (grade >= 3) {
      if (card.stage === 1) nextStage = 2;
      else if (card.stage === 2 && elapsedDays >= 1) nextStage = 3;
      else if (card.stage === 3 && elapsedDays >= 3) nextStage = 4;
    }
  }

  return {
    stability: nextS,
    difficulty: nextD,
    reps: card.reps + 1,
    lapses,
    stage: nextStage,
    lastElapsedDays: elapsedDays,
  };
}

export function computeMemoryWeightedXp(stage, elapsedDays, grade) {
  const baseByStage = { 1: 5, 2: 10, 3: 15, 4: 25 };
  const repairFactor = grade === 1 ? 0.2 : grade === 2 ? 0.7 : 1.0;
  const spacingMultiplier = 1 + Math.floor(Math.log2(1 + Math.max(0, elapsedDays)));
  return Math.round(baseByStage[stage] * spacingMultiplier * repairFactor);
}

// ---------------------------------------------------------------------------
// 3. Content Validation
// ---------------------------------------------------------------------------

function loadJson(relPath) {
  const fullPath = path.join(ROOT, relPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

function validateContent() {
  const roadmap = loadJson('content/curriculum-roadmap.json');
  const unit0 = loadJson('content/unit-0-hangul.json');
  const unit1 = loadJson('content/unit-1-greetings.json');

  assert.equal(roadmap.units.length, 13, 'Roadmap must have 13 units (Unit 0..12)');
  assert.equal(unit0.lessons.length, 6, 'Unit 0 must have 6 lessons');
  assert.equal(unit1.lessons.length, 4, 'Unit 1 must have 4 lessons');

  const validTypes = new Set([
    'hvpt_minimal_pair',
    'syllable_builder',
    'vocab_mcq',
    'context_cloze',
    'particle_contrast',
    'sentence_scramble',
    'ime_typing_recall',
    'audio_dictation',
    'shadowing_speak',
    'guided_personal_output',
  ]);

  let totalExercises = 0;

  // Validate Unit 0 items & exercises
  for (const lesson of unit0.lessons) {
    assert(lesson.explicitRule?.summaryVi?.length > 10, `${lesson.lessonId} missing explicitRule`);
    for (const item of lesson.items) {
      assert.equal(
        item.hasBatchim,
        hasBatchim(item.hangul),
        `Unit 0 item ${item.hangul} hasBatchim mismatch`
      );
    }
    for (const ex of lesson.exercises) {
      totalExercises++;
      assert(ex.stage >= 1 && ex.stage <= 4, `Invalid stage on ${ex.id}`);
      assert(validTypes.has(ex.type), `Invalid type ${ex.type} on ${ex.id}`);
      assert(ex.promptHint && ex.promptHint.length > 5, `Missing promptHint on ${ex.id}`);
      assert(
        ex.explicitExplanation && ex.explicitExplanation.length > 5,
        `Missing explicitExplanation on ${ex.id}`
      );
      if (ex.type === 'hvpt_minimal_pair') {
        assert(
          Array.isArray(ex.audioVariants) && ex.audioVariants.length >= 2,
          `HVPT exercise ${ex.id} must have >= 2 audioVariants`
        );
      }
    }
  }

  // Validate Unit 1 vocab & exercises
  for (const v of unit1.vocabulary) {
    assert.equal(
      v.hasBatchim,
      hasBatchim(v.hangul),
      `Unit 1 vocab ${v.hangul} hasBatchim mismatch`
    );
  }
  for (const lesson of unit1.lessons) {
    assert(lesson.exercises.length >= 2, `${lesson.lessonId} should have >= 2 exercises`);
    for (const ex of lesson.exercises) {
      totalExercises++;
      assert(ex.stage >= 1 && ex.stage <= 4, `Invalid stage on ${ex.id}`);
      assert(validTypes.has(ex.type), `Invalid type ${ex.type} on ${ex.id}`);
      assert(ex.promptHint && ex.promptHint.length > 5, `Missing promptHint on ${ex.id}`);
      assert(
        ex.explicitExplanation && ex.explicitExplanation.length > 5,
        `Missing explicitExplanation on ${ex.id}`
      );
    }
    if (lesson.gradedMicroStory) {
      assert(
        lesson.gradedMicroStory.knownVocabRatio >= 0.95,
        'Micro-story must keep knownVocabRatio >= 0.95'
      );
    }
  }

  return { roadmapUnits: roadmap.units.length, unit1Vocab: unit1.vocabulary.length, totalExercises };
}

// ---------------------------------------------------------------------------
// 4. Run Morphophonemic Tests & 30-Day FSRS Simulation
// ---------------------------------------------------------------------------

function runEngineTests() {
  // Morphophonemic checks
  assert.equal(attachParticle('저', '은/는'), '저는');
  assert.equal(attachParticle('학생', '은/는'), '학생은');
  assert.equal(attachParticle('친구', '이에요/예요'), '친구예요');
  assert.equal(attachParticle('선생님', '이에요/예요'), '선생님이에요');
  assert.equal(attachParticle('이름', '이/가'), '이름이');
  assert.equal(attachParticle('한국', '(으)로'), '한국으로');
  assert.equal(attachParticle('서울', '(으)로'), '서울로'); // ㄹ exception
  assert.equal(attachParticle('버스', '(으)로'), '버스로');

  // FSRS mathematical identity: R(S, S) === 0.9
  assert(Math.abs(retrievability(10, 10) - 0.9) < 1e-9, 'R(S,S) must equal 0.9');
  assert.equal(nextInterval(10, 0.9), 10, 'nextInterval(10, 0.9) must equal 10');

  // Simulation A: Click-only learner stuck at Stage 1 with daily massed repetition (Δt = 1)
  let clickOnlyXpSamples = [];
  for (let i = 0; i < 5; i++) {
    clickOnlyXpSamples.push(computeMemoryWeightedXp(1, 0, 3));
  }

  // Simulation B: SEED 4-Stage Spaced Retrieval learner over ~30 days
  let card = initFsrsCard(3); // Day 0: Good at Stage 1 -> promoted to Stage 2
  let day = 0;
  const trace = [{ day, stage: card.stage, stability: Number(card.stability.toFixed(2)), xp: computeMemoryWeightedXp(1, 0, 3) }];

  // Schedule reviews according to FSRS interval
  while (day < 35) {
    const gap = nextInterval(card.stability, 0.9);
    day += gap;
    // Simulate a self-repair (Hard=2) on review #2, and Good/Easy afterward
    const grade = trace.length === 2 ? 2 : card.stage === 4 ? 4 : 3;
    const xp = computeMemoryWeightedXp(card.stage, gap, grade);
    card = reviewFsrsCard(card, grade, gap);
    trace.push({
      day,
      gap,
      grade,
      stage: card.stage,
      stability: Number(card.stability.toFixed(2)),
      xp,
    });
  }

  assert.equal(card.stage, 4, 'Spaced learner must reach Stage 4 (Productive Recall)');
  assert(card.stability >= 21, `Spaced learner stability (${card.stability}) must reach >= 21 days`);
  assert(trace[trace.length - 1].xp > clickOnlyXpSamples[0] * 5, 'Memory-weighted XP must strongly reward long-interval Stage 4 recall');

  // Verify Lapse demotion: Stage 4 -> Stage 3 on Again (1)
  const lapsed = reviewFsrsCard(card, 1, 10);
  assert.equal(lapsed.stage, 3, 'Lapse at Stage 4 must demote to Stage 3');
  assert(lapsed.stability < card.stability, 'Lapse must shrink stability');

  return { trace, finalCard: card, clickOnlyXp: clickOnlyXpSamples[0] };
}

const contentSummary = validateContent();
const simResult = runEngineTests();

console.log('ALL VALIDATION & SIMULATION CHECKS PASSED');
console.log('Content summary:', JSON.stringify(contentSummary));
console.log('Click-only Stage 1 XP per item:', simResult.clickOnlyXp);
console.log('30-day SEED 4-Stage FSRS trace:');
console.table(simResult.trace);
