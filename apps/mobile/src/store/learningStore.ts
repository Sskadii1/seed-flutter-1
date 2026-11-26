import {
  unit0Data,
  unit1Data,
  type AdaptiveAiProfile,
  type AttemptLog,
  type ErrorCategory,
  type Exercise,
  type FsrsCardState,
  type FsrsGrade,
} from '@seed/schema';
import {
  computeMemoryWeightedXp,
  createInitialAiProfile,
  getAllExercises,
  initFsrsCard,
  MS_PER_DAY,
  nextInterval,
  reviewFsrsCard,
  updateAdaptiveAiProfile,
} from '@seed/learning-engine';

export interface SeedLearningState {
  cards: Record<string, FsrsCardState>;
  attempts: AttemptLog[];
  completedLessonIds: string[];
  lastCompletedLessonId?: string;
  lessonCompletionSeq?: number;
  totalXp: number;
  streakDays: number;
  simulatedNowOffsetDays: number;
  aiProfile: AdaptiveAiProfile;
}

const STORAGE_KEY = 'seed_korean_learning_state_v1';

function buildVocabLookup(): Map<string, { label: string; meaningVi: string; unitId: string }> {
  const map = new Map<string, { label: string; meaningVi: string; unitId: string }>();
  for (const l of unit0Data.lessons) {
    for (const item of l.items) {
      map.set(item.id, {
        label: item.hangul,
        meaningVi: item.meaningVi ?? item.hintVi ?? item.ipa,
        unitId: 'unit-0',
      });
    }
  }
  for (const v of unit1Data.vocabulary) {
    map.set(v.id, {
      label: v.hangul,
      meaningVi: v.meaningVi,
      unitId: 'unit-1',
    });
  }
  for (const g of unit1Data.grammarPoints) {
    map.set(g.id, {
      label: g.pattern,
      meaningVi: g.meaningVi,
      unitId: 'unit-1',
    });
  }
  return map;
}

const ITEM_LOOKUP = buildVocabLookup();

export function createInitialState(): SeedLearningState {
  return {
    cards: {},
    attempts: [],
    completedLessonIds: [],
    lastCompletedLessonId: undefined,
    lessonCompletionSeq: 0,
    totalXp: 0,
    streakDays: 1,
    simulatedNowOffsetDays: 0,
    aiProfile: createInitialAiProfile(),
  };
}

export function loadLearningState(): SeedLearningState {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SeedLearningState>;
        return {
          ...createInitialState(),
          ...parsed,
          aiProfile: parsed.aiProfile ?? createInitialAiProfile(),
        };
      }
    } catch {
      // ignore storage errors
    }
  }
  return createInitialState();
}

export function saveLearningState(state: SeedLearningState): void {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  }
}

export function getEffectiveNow(state: SeedLearningState): number {
  return Date.now() + state.simulatedNowOffsetDays * MS_PER_DAY;
}

function makeUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function applyExerciseOutcome(
  prev: SeedLearningState,
  params: {
    exercise: Exercise;
    grade: FsrsGrade;
    wrongAttempts: number;
    category: ErrorCategory;
  }
): { nextState: SeedLearningState; xpEarned: number } {
  const now = getEffectiveNow(prev);
  const { exercise, grade, wrongAttempts, category } = params;
  const itemIds = [
    ...(exercise.targetVocabIds ?? []),
    ...(exercise.targetGrammarIds ?? []),
  ];
  if (itemIds.length === 0) {
    itemIds.push(exercise.id);
  }

  const nextCards = { ...prev.cards };
  let maxElapsedDays = 0;

  for (const id of itemIds) {
    const existing = nextCards[id];
    if (!existing) {
      const meta = ITEM_LOOKUP.get(id) ?? {
        label: exercise.type,
        meaningVi: exercise.promptVi.slice(0, 48),
        unitId: exercise.id.startsWith('u0') ? 'unit-0' : 'unit-1',
      };
      nextCards[id] = initFsrsCard({
        itemId: id,
        itemType: id.startsWith('g-') ? 'grammar' : 'vocab',
        label: meta.label,
        meaningVi: meta.meaningVi,
        unitId: meta.unitId,
        grade,
        now,
      });
    } else {
      const elapsedDays = Math.max(0, (now - existing.lastReviewAt) / MS_PER_DAY);
      maxElapsedDays = Math.max(maxElapsedDays, elapsedDays);
      nextCards[id] = reviewFsrsCard(existing, grade, now);
    }
  }

  const xpEarned = computeMemoryWeightedXp(exercise.stage, maxElapsedDays, grade);
  const attempt: AttemptLog = {
    clientAttemptId: makeUuid(),
    exerciseId: exercise.id,
    itemIds,
    category,
    stage: exercise.stage,
    grade,
    xpEarned,
    elapsedDays: maxElapsedDays,
    wrongAttempts,
    createdAt: now,
  };

  const nextAiProfile = updateAdaptiveAiProfile(
    prev.aiProfile ?? createInitialAiProfile(),
    exercise,
    grade,
    wrongAttempts
  );

  const nextState: SeedLearningState = {
    ...prev,
    cards: nextCards,
    attempts: [attempt, ...prev.attempts].slice(0, 300),
    totalXp: prev.totalXp + xpEarned,
    aiProfile: nextAiProfile,
  };
  saveLearningState(nextState);
  return { nextState, xpEarned };
}

export function markLessonCompleted(
  prev: SeedLearningState,
  lessonId: string
): SeedLearningState {
  const alreadyCompleted = prev.completedLessonIds.includes(lessonId);
  const nextState: SeedLearningState = {
    ...prev,
    completedLessonIds: alreadyCompleted
      ? prev.completedLessonIds
      : [...prev.completedLessonIds, lessonId],
    lastCompletedLessonId: lessonId,
    lessonCompletionSeq: (prev.lessonCompletionSeq ?? 0) + 1,
  };
  saveLearningState(nextState);
  return nextState;
}

/**
 * Simulates 30 days of spaced FSRS study on sample Unit 1 items so the user
 * can inspect how Memory-Weighted XP, Retrievability R, and Stage 4 Mastery work.
 */
export function runDemo30DaySimulation(): SeedLearningState {
  const baseNow = Date.now() - 32 * MS_PER_DAY;
  const demoIds = [
    'v-annyeonghaseyo',
    'v-haksaeng',
    'v-seonsaengnim',
    'v-beteunam',
    'v-hanguk',
    'v-hoesawon',
    'g-topic-eun-neun',
    'g-copula-ieyo-yeyo',
  ];

  const cards: Record<string, FsrsCardState> = {};
  const attempts: AttemptLog[] = [];
  let totalXp = 0;

  for (let i = 0; i < demoIds.length; i++) {
    const id = demoIds[i];
    const meta = ITEM_LOOKUP.get(id)!;
    let t = baseNow;
    let card = initFsrsCard({
      itemId: id,
      itemType: id.startsWith('g-') ? 'grammar' : 'vocab',
      label: meta.label,
      meaningVi: meta.meaningVi,
      unitId: meta.unitId,
      grade: 3,
      now: t,
    });
    const xp0 = computeMemoryWeightedXp(1, 0, 3);
    totalXp += xp0;
    attempts.push({
      clientAttemptId: makeUuid(),
      exerciseId: `demo-${id}-0`,
      itemIds: [id],
      category: id.startsWith('g-') ? 'particles' : 'general',
      stage: 1,
      grade: 3,
      xpEarned: xp0,
      elapsedDays: 0,
      wrongAttempts: 0,
      createdAt: t,
    });

    // Simulate scheduled FSRS reviews up to today
    let step = 1;
    while (step <= 4) {
      const gap = nextInterval(card.stability, 0.9);
      const nextT = t + gap * MS_PER_DAY;
      if (nextT > Date.now()) break;
      t = nextT;
      // Give one realistic self-repair (Hard=2) on 2 items to show Stage 3 vs Stage 4 spread
      const grade: FsrsGrade = i >= 6 && step === 2 ? 2 : card.stage === 4 ? 4 : 3;
      const xp = computeMemoryWeightedXp(card.stage, gap, grade);
      totalXp += xp;
      attempts.push({
        clientAttemptId: makeUuid(),
        exerciseId: `demo-${id}-${step}`,
        itemIds: [id],
        category: id.startsWith('g-') ? 'particles' : 'general',
        stage: card.stage,
        grade,
        xpEarned: xp,
        elapsedDays: gap,
        wrongAttempts: grade === 2 ? 1 : 0,
        createdAt: t,
      });
      card = reviewFsrsCard(card, grade, t);
      step++;
    }
    cards[id] = card;
  }

  let aiProfile = createInitialAiProfile();
  const sampleExercises = getAllExercises().slice(0, 14);
  for (let idx = 0; idx < sampleExercises.length; idx++) {
    const ex = sampleExercises[idx];
    const simulatedGrade: FsrsGrade = idx % 5 === 4 ? 2 : 3;
    const simulatedWrongs = simulatedGrade === 2 ? 1 : 0;
    aiProfile = updateAdaptiveAiProfile(aiProfile, ex, simulatedGrade, simulatedWrongs);
  }

  const state: SeedLearningState = {
    cards,
    attempts: attempts.sort((a, b) => b.createdAt - a.createdAt),
    completedLessonIds: ['u0-l1', 'u0-l2', 'u0-l3', 'u1-l1', 'u1-l2'],
    lastCompletedLessonId: 'u1-l2',
    lessonCompletionSeq: 1,
    totalXp,
    streakDays: 14,
    simulatedNowOffsetDays: 0,
    aiProfile,
  };
  saveLearningState(state);
  return state;
}
