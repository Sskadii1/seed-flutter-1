import type {
  AdaptiveAiProfile,
  BktSkillState,
  Exercise,
  FsrsCardState,
  FsrsGrade,
  KnowledgeComponentId,
  MasteryStage,
} from '@seed/schema';
import { MS_PER_DAY, retrievability } from './fsrs';
import { getAllExercises } from './session';

const KC_LABELS: Record<KnowledgeComponentId, string> = {
  kc_phonetics_3way: 'Phụ âm 3 bậc (ㄱ/ㄲ/ㅋ)',
  kc_phonetics_vowel_batchim: 'Nguyên âm & Patchim ㄴ/ㄹ',
  kc_morph_particles: 'Trợ từ & Chia đuôi câu',
  kc_lexicon_hanja: 'Từ vựng & Hán–Việt',
  kc_productive_orthography: 'Gõ & Viết câu chủ động',
};

const STAGE_BKT_PARAMS: Record<
  MasteryStage,
  { pGuess: number; pSlip: number; pTransit: number }
> = {
  1: { pGuess: 0.25, pSlip: 0.08, pTransit: 0.14 },
  2: { pGuess: 0.2, pSlip: 0.1, pTransit: 0.18 },
  3: { pGuess: 0.1, pSlip: 0.12, pTransit: 0.22 },
  4: { pGuess: 0.03, pSlip: 0.14, pTransit: 0.26 },
};

const STAGE_BASE_ELO: Record<MasteryStage, number> = {
  1: 920,
  2: 1000,
  3: 1080,
  4: 1160,
};

/**
 * Q-Matrix Mapper (Zhao et al., IEEE TLT 2024): maps every exercise to 1-2
 * domain-specific Knowledge Components for Vietnamese learners of Korean.
 */
export function extractExerciseKCs(exercise: Exercise): KnowledgeComponentId[] {
  const kcs = new Set<KnowledgeComponentId>();

  if (exercise.type === 'hvpt_minimal_pair') {
    if (exercise.contrastCategory === '3way_stop') {
      kcs.add('kc_phonetics_3way');
    } else {
      kcs.add('kc_phonetics_vowel_batchim');
    }
  } else if (exercise.type === 'particle_contrast') {
    kcs.add('kc_morph_particles');
  } else if (exercise.type === 'syllable_builder') {
    kcs.add('kc_phonetics_vowel_batchim');
    kcs.add('kc_productive_orthography');
  } else if (exercise.type === 'vocab_mcq') {
    kcs.add('kc_lexicon_hanja');
  } else if (exercise.type === 'context_cloze') {
    if (exercise.targetGrammarIds && exercise.targetGrammarIds.length > 0) {
      kcs.add('kc_morph_particles');
    } else {
      kcs.add('kc_phonetics_vowel_batchim');
    }
  } else if (
    exercise.type === 'sentence_scramble' ||
    exercise.type === 'ime_typing_recall' ||
    exercise.type === 'audio_dictation' ||
    exercise.type === 'guided_personal_output'
  ) {
    kcs.add('kc_productive_orthography');
    if (exercise.targetGrammarIds && exercise.targetGrammarIds.length > 0) {
      kcs.add('kc_morph_particles');
    }
  } else if (exercise.type === 'shadowing_speak') {
    kcs.add('kc_phonetics_vowel_batchim');
    kcs.add('kc_productive_orthography');
  }

  if (kcs.size === 0) {
    kcs.add('kc_lexicon_hanja');
  }
  return Array.from(kcs);
}

export function createInitialAiProfile(): AdaptiveAiProfile {
  const all = getAllExercises();
  const itemDifficulties: Record<string, number> = {};
  const itemResponseCounts: Record<string, number> = {};
  for (const ex of all) {
    itemDifficulties[ex.id] = STAGE_BASE_ELO[ex.stage];
    itemResponseCounts[ex.id] = 0;
  }

  const skills = Object.fromEntries(
    (Object.keys(KC_LABELS) as KnowledgeComponentId[]).map((kcId) => [
      kcId,
      {
        kcId,
        labelVi: KC_LABELS[kcId],
        pKnown: 0.25,
        attempts: 0,
        recentDelta: 0,
      } satisfies BktSkillState,
    ])
  ) as Record<KnowledgeComponentId, BktSkillState>;

  return {
    eloRating: 1000,
    totalResponses: 0,
    itemDifficulties,
    itemResponseCounts,
    skills,
    lastRecommendationVi: 'Sẵn sàng chẩn đoán năng lực qua lượt làm bài đầu tiên.',
  };
}

/**
 * Logistic Item Response Theory (Pelanek, Computers & Education 2016).
 */
export function predictSuccessProbability(
  eloRating: number,
  itemDifficulty: number
): number {
  const exponent = -0.008 * (eloRating - itemDifficulty);
  return 1 / (1 + Math.exp(exponent));
}

/**
 * Exact Bayesian Knowledge Tracing update (Corbett & Anderson, 1995;
 * Shen et al., IEEE TLT 2024).
 */
export function updateBktMastery(
  skill: BktSkillState,
  isFirstTryCorrect: boolean,
  stage: MasteryStage
): BktSkillState {
  const { pGuess, pSlip, pTransit } = STAGE_BKT_PARAMS[stage];
  const pPrior = Math.min(0.99, Math.max(0.01, skill.pKnown));

  let pPosterior: number;
  if (isFirstTryCorrect) {
    const num = pPrior * (1 - pSlip);
    const den = num + (1 - pPrior) * pGuess;
    pPosterior = den > 0 ? num / den : pPrior;
  } else {
    const num = pPrior * pSlip;
    const den = num + (1 - pPrior) * (1 - pGuess);
    pPosterior = den > 0 ? num / den : pPrior;
  }

  const pNext = Math.min(
    0.99,
    Math.max(0.01, pPosterior + (1 - pPosterior) * pTransit)
  );

  return {
    ...skill,
    pKnown: pNext,
    attempts: skill.attempts + 1,
    recentDelta: pNext - skill.pKnown,
  };
}

function buildDiagnosticSummary(
  eloRating: number,
  skills: Record<KnowledgeComponentId, BktSkillState>
): string {
  const sorted = Object.values(skills).sort((a, b) => a.pKnown - b.pKnown);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  if (!weakest || !strongest) return 'Đang thu thập dữ liệu năng lực.';

  if (weakest.pKnown < 0.45) {
    return `Ưu tiên củng cố "${weakest.labelVi}" (${Math.round(weakest.pKnown * 100)}%).`;
  }
  if (eloRating >= 1100) {
    return `Năng lực tốt (Elo ${Math.round(eloRating)}), đẩy mạnh bài tự gõ Nấc 4.`;
  }
  return `Vững "${strongest.labelVi}" (${Math.round(strongest.pKnown * 100)}%), tiếp tục rèn "${weakest.labelVi}".`;
}

/**
 * Online cognitive update combining Pelanek Elo-IRT + BKT + ZPDES learning progress.
 */
export function updateAdaptiveAiProfile(
  profile: AdaptiveAiProfile,
  exercise: Exercise,
  grade: FsrsGrade,
  wrongAttempts: number
): AdaptiveAiProfile {
  const kcs = extractExerciseKCs(exercise);
  const isFirstTryCorrect = wrongAttempts === 0 && grade >= 3;

  // Outcome score y in {0, 0.65 (self-repaired), 1.0}
  const actualOutcome =
    wrongAttempts === 0 && grade >= 3
      ? 1.0
      : grade === 2
        ? 0.65
        : 0.0;

  const currentItemDiff =
    profile.itemDifficulties[exercise.id] ?? STAGE_BASE_ELO[exercise.stage];
  const currentItemCount = profile.itemResponseCounts[exercise.id] ?? 0;

  const pHat = predictSuccessProbability(profile.eloRating, currentItemDiff);
  const kLearner = 40 / (1 + 0.08 * profile.totalResponses);
  const kItem = 40 / (1 + 0.08 * currentItemCount);

  const nextElo = Math.max(
    600,
    Math.min(1800, profile.eloRating + kLearner * (actualOutcome - pHat))
  );
  const nextItemDiff = Math.max(
    700,
    Math.min(1600, currentItemDiff - 0.35 * kItem * (actualOutcome - pHat))
  );

  const nextSkills = { ...profile.skills };
  for (const kc of kcs) {
    nextSkills[kc] = updateBktMastery(nextSkills[kc], isFirstTryCorrect, exercise.stage);
  }

  return {
    eloRating: nextElo,
    totalResponses: profile.totalResponses + 1,
    itemDifficulties: {
      ...profile.itemDifficulties,
      [exercise.id]: nextItemDiff,
    },
    itemResponseCounts: {
      ...profile.itemResponseCounts,
      [exercise.id]: currentItemCount + 1,
    },
    skills: nextSkills,
    lastRecommendationVi: buildDiagnosticSummary(nextElo, nextSkills),
  };
}

/**
 * Wilson et al. (Nature Communications, 2019) Eighty-Five Percent Rule score:
 * Peaks at 1.0 when predicted success probability is 0.85.
 */
export function optimalZone85Score(predictedProb: number): number {
  const diff = predictedProb - 0.85;
  return Math.exp(-(diff * diff) / (2 * 0.12 * 0.12));
}

/**
 * Multi-objective ZPDES + FSRS-4.5 + BKT + 85% Rule exercise sequencer.
 */
export function buildAdaptiveAiSession(
  cards: FsrsCardState[],
  aiProfile: AdaptiveAiProfile,
  now = Date.now(),
  maxItems = 8
): Exercise[] {
  const all = getAllExercises();
  const cardById = new Map(cards.map((c) => [c.itemId, c]));

  const scored = all.map((ex) => {
    // 1. FSRS forgetting urgency (1 - R)
    let forgettingUrgency = 0.35; // mild priority for unseen items
    if (ex.targetVocabIds && ex.targetVocabIds.length > 0) {
      let minR = 1;
      let found = false;
      for (const id of ex.targetVocabIds) {
        const c = cardById.get(id);
        if (c) {
          found = true;
          const elapsed = Math.max(0, (now - c.lastReviewAt) / MS_PER_DAY);
          minR = Math.min(minR, retrievability(elapsed, c.stability));
        }
      }
      if (found) {
        forgettingUrgency = 1 - minR;
      }
    }

    // 2. BKT skill deficit (1 - P(L_k)) & ZPDES empirical progress |r_k|
    const kcs = extractExerciseKCs(ex);
    let maxDeficit = 0;
    let maxProgress = 0;
    for (const kc of kcs) {
      const sk = aiProfile.skills[kc];
      if (sk) {
        maxDeficit = Math.max(maxDeficit, 1 - sk.pKnown);
        maxProgress = Math.max(maxProgress, Math.abs(sk.recentDelta));
      }
    }

    // 3. Wilson 85% optimal learning zone score
    const itemDiff =
      aiProfile.itemDifficulties[ex.id] ?? STAGE_BASE_ELO[ex.stage];
    const pHat = predictSuccessProbability(aiProfile.eloRating, itemDiff);
    const zoneScore = optimalZone85Score(pHat);

    const totalScore =
      0.35 * forgettingUrgency +
      0.3 * maxDeficit +
      0.25 * zoneScore +
      0.1 * Math.min(1, maxProgress * 4);

    return { ex, totalScore };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored.slice(0, maxItems).map((s) => s.ex);
}

/**
 * ZPDES Mid-Lesson Remedial Scaffolding: when a learner fails an item (`grade = 1`),
 * selects a lower-stage exercise sharing the same Knowledge Component closest to
 * the 85% success zone before re-testing the failed item.
 */
export function selectRemedialExercise(
  failedExercise: Exercise,
  aiProfile: AdaptiveAiProfile
): Exercise | null {
  const all = getAllExercises();
  const targetKCs = new Set(extractExerciseKCs(failedExercise));

  const candidates = all.filter((ex) => {
    if (ex.id === failedExercise.id) return false;
    if (ex.stage > failedExercise.stage) return false;
    const exKCs = extractExerciseKCs(ex);
    return exKCs.some((kc) => targetKCs.has(kc));
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const pA = predictSuccessProbability(
      aiProfile.eloRating,
      aiProfile.itemDifficulties[a.id] ?? STAGE_BASE_ELO[a.stage]
    );
    const pB = predictSuccessProbability(
      aiProfile.eloRating,
      aiProfile.itemDifficulties[b.id] ?? STAGE_BASE_ELO[b.stage]
    );
    return optimalZone85Score(pB) - optimalZone85Score(pA);
  });

  return candidates[0] ?? null;
}
