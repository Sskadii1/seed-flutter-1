import test from 'node:test';
import assert from 'node:assert/strict';
import { unit1Data } from '@seed/schema';
import {
  attachParticle,
  autoGradeAttempt,
  buildAdaptiveAiSession,
  buildDailySmartSession,
  composeHangulFromJamo,
  computeMemoryWeightedXp,
  computeRetentionTruth,
  createInitialAiProfile,
  evaluateExerciseSubmission,
  extractExerciseKCs,
  getAllExercises,
  hasBatchim,
  initFsrsCard,
  MS_PER_DAY,
  nextInterval,
  optimalZone85Score,
  predictSuccessProbability,
  retrievability,
  reviewFsrsCard,
  selectRemedialExercise,
  updateAdaptiveAiProfile,
} from '../src/index';

test('Hangul batchim and particle allomorphy match Unit 1 vocabulary', () => {
  for (const vocab of unit1Data.vocabulary) {
    assert.equal(hasBatchim(vocab.hangul), vocab.hasBatchim, `Mismatch on ${vocab.hangul}`);
  }
  assert.equal(attachParticle('저', '은/는'), '저는');
  assert.equal(attachParticle('이름', '은/는'), '이름은');
  assert.equal(attachParticle('친구', '이에요/예요'), '친구예요');
  assert.equal(attachParticle('선생님', '이에요/예요'), '선생님이에요');
  assert.equal(attachParticle('서울', '(으)로'), '서울로');
  assert.equal(attachParticle('한국', '(으)로'), '한국으로');
});

test('2-beolsik Jamo FSA composes syllables, compound vowels, and liaison cleanly', () => {
  assert.equal(composeHangulFromJamo(['ㅇ', 'ㅗ']), '오');
  assert.equal(composeHangulFromJamo(['ㅇ', 'ㅡ', 'ㅣ', 'ㅅ', 'ㅏ']), '의사');
  assert.equal(composeHangulFromJamo(['ㅎ', 'ㅏ', 'ㄴ', 'ㄱ', 'ㅜ', 'ㄱ', 'ㅇ', 'ㅓ']), '한국어');
  assert.equal(composeHangulFromJamo(['ㅇ', 'ㅣ', 'ㄹ', 'ㅡ', 'ㅁ']), '이름');
  assert.equal(
    composeHangulFromJamo(['ㅈ', 'ㅓ', 'ㄴ', 'ㅡ', 'ㄴ', ' ', 'ㅎ', 'ㅏ', 'ㄱ', 'ㅅ', 'ㅐ', 'ㅇ', 'ㅇ', 'ㅣ', 'ㅇ', 'ㅔ', 'ㅇ', 'ㅛ']),
    '저는 학생이에요'
  );
});

test('FSRS-4.5 identity, 4-stage ladder promotion/demotion, and Memory-Weighted XP', () => {
  assert.ok(Math.abs(retrievability(14, 14) - 0.9) < 1e-9);
  assert.equal(nextInterval(14, 0.9), 14);

  let card = initFsrsCard({
    itemId: 'v-haksaeng',
    itemType: 'vocab',
    label: '학생',
    meaningVi: 'học sinh',
    unitId: 'unit-1',
    grade: 3,
    now: 0,
  });
  assert.equal(card.stage, 2);

  // Review after 4 days -> Stage 3
  card = reviewFsrsCard(card, 3, 4 * MS_PER_DAY);
  assert.equal(card.stage, 3);

  // Review after +15 days -> Stage 4
  card = reviewFsrsCard(card, 3, 19 * MS_PER_DAY);
  assert.equal(card.stage, 4);
  assert.ok(card.stability > 21);

  // XP rewards long-interval Stage 4 much higher than Stage 1 Day 0
  const stage1Day0Xp = computeMemoryWeightedXp(1, 0, 3);
  const stage4Day15Xp = computeMemoryWeightedXp(4, 15, 3);
  assert.equal(stage1Day0Xp, 5);
  assert.equal(stage4Day15Xp, 125);

  // Lapse demotes Stage 4 -> Stage 3
  const lapsed = reviewFsrsCard(card, 1, 25 * MS_PER_DAY);
  assert.equal(lapsed.stage, 3);
  assert.equal(lapsed.lapses, 1);

  const metrics = computeRetentionTruth([card], [1], 19 * MS_PER_DAY);
  assert.equal(metrics.masteredCount, 1);
  assert.equal(metrics.averageRetrievability, 1);
});

test('2-Step Prompt-First feedback hides answer on first error and validates personal output', () => {
  const all = getAllExercises();
  const cloze = all.find((e) => e.id === 'u1-l1-ex2')!;
  const personal = all.find((e) => e.id === 'u1-l4-ex3')!;

  // Step 1 wrong: prompt_retry without answer reveal
  const step1 = evaluateExerciseSubmission({
    exercise: cloze,
    submission: { kind: 'option', optionId: 'o-eun' },
    attemptNumber: 1,
  });
  assert.equal(step1.status, 'prompt_retry');
  assert.equal(step1.revealAnswer, false);

  // Step 2 self-repair: passed_self_repair -> Grade Hard (2)
  const step2Pass = evaluateExerciseSubmission({
    exercise: cloze,
    submission: { kind: 'option', optionId: 'o-neun' },
    attemptNumber: 2,
  });
  assert.equal(step2Pass.status, 'passed_self_repair');
  assert.equal(step2Pass.fsrsGrade, 2);

  // Guided personal output catches Vietnamese batchim trap ("학생예요")
  const badPersonal = evaluateExerciseSubmission({
    exercise: personal,
    submission: { kind: 'text', text: '안녕하세요. 저는 란이에요. 저는 학생예요.' },
    attemptNumber: 1,
  });
  assert.equal(badPersonal.status, 'prompt_retry');
  if (badPersonal.status === 'prompt_retry') {
    assert.ok(badPersonal.hint.includes('학생이에요'));
  }

  const goodPersonal = evaluateExerciseSubmission({
    exercise: personal,
    submission: { kind: 'text', text: '안녕하세요. 저는 린이에요. 저는 회사원이에요.' },
    attemptNumber: 1,
  });
  assert.equal(goodPersonal.status, 'passed_first_try');

  // Auto grade fast Stage 4 -> Easy (4)
  assert.equal(
    autoGradeAttempt({ wrongAttempts: 0, usedReveal: false, stage: 4, responseTimeMs: 3200 }),
    4
  );

  // Smart session builds interleaved queue
  const queue = buildDailySmartSession([], Date.now(), 6);
  assert.equal(queue.length, 6);
});

test('Background Adaptive AI (BKT + Elo-IRT + 85% Rule + ZPDES) adapts to learner responses', () => {
  let profile = createInitialAiProfile();
  const all = getAllExercises();
  const stage4Particle = all.find((e) => e.id === 'u1-l1-ex4')!;
  const stage1Hvpt = all.find((e) => e.id === 'u0-l3-ex1')!;

  // Q-Matrix mapping check
  assert.ok(extractExerciseKCs(stage4Particle).includes('kc_productive_orthography'));
  assert.ok(extractExerciseKCs(stage1Hvpt).includes('kc_phonetics_3way'));

  // Wilson 85% rule peaks at 0.85
  assert.ok(optimalZone85Score(0.85) > optimalZone85Score(0.5));
  assert.ok(optimalZone85Score(0.85) > optimalZone85Score(0.99));

  // First-try correct increases Elo and BKT P(Known)
  const beforeElo = profile.eloRating;
  const beforeOrth = profile.skills.kc_productive_orthography.pKnown;
  profile = updateAdaptiveAiProfile(profile, stage4Particle, 3, 0);
  assert.ok(profile.eloRating > beforeElo);
  assert.ok(profile.skills.kc_productive_orthography.pKnown > beforeOrth);

  // Repeated errors drop Elo and pick a lower-stage remedial scaffold on same KC
  profile = updateAdaptiveAiProfile(profile, stage4Particle, 1, 2);
  profile = updateAdaptiveAiProfile(profile, stage4Particle, 1, 2);
  const pAfterFail = predictSuccessProbability(
    profile.eloRating,
    profile.itemDifficulties[stage4Particle.id]
  );
  assert.ok(pAfterFail < 0.7);

  const remedial = selectRemedialExercise(stage4Particle, profile);
  assert.ok(remedial !== null);
  assert.ok(remedial!.stage <= stage4Particle.stage);

  // Adaptive session prioritizes weakest skills + 85% zone + FSRS urgency
  const adaptiveQueue = buildAdaptiveAiSession([], profile, Date.now(), 6);
  assert.equal(adaptiveQueue.length, 6);
});
