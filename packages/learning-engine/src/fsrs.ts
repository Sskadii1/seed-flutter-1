import type {
  FsrsCardState,
  FsrsGrade,
  MasteryStage,
  RetentionMetrics,
} from '@seed/schema';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DECAY_FACTOR = 19 / 81; // Guarantees R(S, S) === 0.9

// FSRS-4.5 default parameter vector
const W = [
  0.4872, 1.4003, 3.7145, 13.8206, // w0..w3: initial stability S0
  5.1618, 1.2298, 0.8975, 0.031,   // w4..w7: difficulty weights
  1.6474, 0.1367, 1.0461,          // w8..w10: recall stability growth
  2.1072, 0.0793, 0.3246, 1.587,   // w11..w14: lapse stability
  0.2272, 2.8755                   // w15..w16: hard penalty & easy bonus
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + DECAY_FACTOR * (t / stability), -0.5);
}

export function nextInterval(stability: number, targetRetention = 0.9): number {
  const raw = (stability / DECAY_FACTOR) * (Math.pow(targetRetention, -2) - 1);
  return Math.max(1, Math.round(raw));
}

export function initFsrsCard(params: {
  itemId: string;
  itemType: FsrsCardState['itemType'];
  label: string;
  meaningVi: string;
  unitId: string;
  grade: FsrsGrade;
  now?: number;
}): FsrsCardState {
  const now = params.now ?? Date.now();
  const stability = W[params.grade - 1];
  const difficulty = clamp(W[4] - (params.grade - 3) * W[5], 1, 10);
  const intervalDays = params.grade === 1 ? 0 : nextInterval(stability, 0.9);
  const stage: MasteryStage = params.grade >= 3 ? 2 : 1;

  return {
    itemId: params.itemId,
    itemType: params.itemType,
    label: params.label,
    meaningVi: params.meaningVi,
    unitId: params.unitId,
    stage,
    stability,
    difficulty,
    reps: 1,
    lapses: params.grade === 1 ? 1 : 0,
    lastReviewAt: now,
    dueAt: now + intervalDays * MS_PER_DAY,
    lastElapsedDays: 0,
  };
}

export function reviewFsrsCard(
  card: FsrsCardState,
  grade: FsrsGrade,
  now = Date.now()
): FsrsCardState {
  const elapsedDays = Math.max(0, (now - card.lastReviewAt) / MS_PER_DAY);
  const r = retrievability(elapsedDays, card.stability);
  const d0Good = clamp(W[4], 1, 10);
  const nextDifficulty = clamp(
    W[7] * d0Good + (1 - W[7]) * (card.difficulty - W[6] * (grade - 3)),
    1,
    10
  );

  let nextStability: number;
  let nextStage: MasteryStage = card.stage;
  let lapses = card.lapses;

  if (grade === 1) {
    const forgetStability =
      W[11] *
      Math.pow(card.difficulty, -W[12]) *
      (Math.pow(card.stability + 1, W[13]) - 1) *
      Math.exp(W[14] * (1 - r));
    nextStability = Math.max(0.2, Math.min(card.stability, forgetStability));
    nextStage = Math.max(1, card.stage - 1) as MasteryStage;
    lapses += 1;
  } else {
    const hardPenalty = grade === 2 ? W[15] : 1;
    const easyBonus = grade === 4 ? W[16] : 1;
    const growth =
      Math.exp(W[8]) *
      (11 - card.difficulty) *
      Math.pow(card.stability, -W[9]) *
      (Math.exp(W[10] * (1 - r)) - 1) *
      hardPenalty *
      easyBonus;
    nextStability = card.stability * (1 + growth);

    if (grade >= 3) {
      if (card.stage === 1) nextStage = 2;
      else if (card.stage === 2 && elapsedDays >= 1) nextStage = 3;
      else if (card.stage === 3 && elapsedDays >= 3) nextStage = 4;
    }
  }

  const intervalDays = grade === 1 ? 0 : nextInterval(nextStability, 0.9);

  return {
    ...card,
    stage: nextStage,
    stability: nextStability,
    difficulty: nextDifficulty,
    reps: card.reps + 1,
    lapses,
    lastReviewAt: now,
    dueAt: now + intervalDays * MS_PER_DAY,
    lastElapsedDays: elapsedDays,
  };
}

export function autoGradeAttempt(params: {
  wrongAttempts: number;
  usedReveal: boolean;
  stage: MasteryStage;
  responseTimeMs: number;
}): FsrsGrade {
  if (params.usedReveal || params.wrongAttempts >= 2) return 1; // Again
  if (params.wrongAttempts === 1) return 2; // Hard (self-repaired after promptHint)
  if (params.stage === 4 && params.responseTimeMs <= 4500) return 4; // Easy
  return 3; // Good
}

export function computeMemoryWeightedXp(
  stage: MasteryStage,
  elapsedDays: number,
  grade: FsrsGrade
): number {
  const baseByStage: Record<MasteryStage, number> = {
    1: 5,
    2: 10,
    3: 15,
    4: 25,
  };
  const repairFactor = grade === 1 ? 0.2 : grade === 2 ? 0.7 : 1.0;
  const spacingMultiplier = 1 + Math.floor(Math.log2(1 + Math.max(0, elapsedDays)));
  return Math.round(baseByStage[stage] * spacingMultiplier * repairFactor);
}

export function computeRetentionTruth(
  cards: FsrsCardState[],
  attemptsFirstTryRates: number[],
  now = Date.now()
): RetentionMetrics {
  const stageDistribution: Record<MasteryStage, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  if (cards.length === 0) {
    return {
      totalTrackedCards: 0,
      averageRetrievability: 0,
      retainedCount: 0,
      dueCount: 0,
      masteredCount: 0,
      stageDistribution,
      firstTryAccuracy: 0,
    };
  }

  let totalR = 0;
  let retainedCount = 0;
  let dueCount = 0;
  let masteredCount = 0;

  for (const card of cards) {
    stageDistribution[card.stage] += 1;
    const elapsedDays = Math.max(0, (now - card.lastReviewAt) / MS_PER_DAY);
    const r = retrievability(elapsedDays, card.stability);
    totalR += r;
    if (r >= 0.85) retainedCount += 1;
    if (r < 0.9 || card.dueAt <= now) dueCount += 1;
    if (card.stage === 4 && card.stability >= 21) masteredCount += 1;
  }

  const firstTryAccuracy =
    attemptsFirstTryRates.length > 0
      ? attemptsFirstTryRates.reduce((a, b) => a + b, 0) / attemptsFirstTryRates.length
      : 0;

  return {
    totalTrackedCards: cards.length,
    averageRetrievability: totalR / cards.length,
    retainedCount,
    dueCount,
    masteredCount,
    stageDistribution,
    firstTryAccuracy,
  };
}
