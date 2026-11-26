import {
  unit0Data,
  unit1Data,
  type ErrorCategory,
  type Exercise,
  type FsrsCardState,
  type FsrsGrade,
} from '@seed/schema';
import { attachParticle, hasBatchim, normalizeKoreanAnswer } from './hangul';
import { autoGradeAttempt, MS_PER_DAY, retrievability } from './fsrs';

export type ExerciseSubmission =
  | { kind: 'option'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tokens'; tokens: string[] }
  | { kind: 'shadowing_done' };

export type FeedbackEvaluation =
  | {
      status: 'prompt_retry';
      revealAnswer: false;
      hint: string;
    }
  | {
      status: 'passed_first_try' | 'passed_self_repair';
      revealAnswer: true;
      explanation: string;
      fsrsGrade: FsrsGrade;
      requeueAtEnd: false;
    }
  | {
      status: 'failed_reveal';
      revealAnswer: true;
      explanation: string;
      correctSummary: string;
      fsrsGrade: 1;
      requeueAtEnd: true;
    };

function validateGuidedPersonalSentence(
  text: string,
  mustIncludeAny: string[],
  mustIncludeTopicParticle: boolean
): { ok: boolean; customHint?: string } {
  const cleaned = text.trim();
  if (cleaned.length < 6) {
    return {
      ok: false,
      customHint: 'Câu quá ngắn. Hãy viết theo mẫu: 저는 [Tên]이에요/예요. 저는 [Nghề]이에요/예요.',
    };
  }

  const hasHangul = /[\uAC00-\uD7A3]/.test(cleaned);
  if (!hasHangul) {
    return {
      ok: false,
      customHint: 'Hãy gõ bằng chữ Hangul (bật bàn phím Hàn ảo bên dưới nếu chưa cài bộ gõ).',
    };
  }

  const hasCopula = mustIncludeAny.some((suffix) => cleaned.includes(suffix));
  if (!hasCopula) {
    return {
      ok: false,
      customHint: 'Đừng quên gắn đuôi câu 이에요 (có patchim) hoặc 예요 (không patchim) ở cuối câu.',
    };
  }

  if (mustIncludeTopicParticle && !cleaned.includes('은') && !cleaned.includes('는')) {
    return {
      ok: false,
      customHint: 'Người Việt hay quên trợ từ chủ đề! Hãy thêm 저는 hoặc 제 이름은 ở đầu câu.',
    };
  }

  // Morphophonemic check on 저는 / 이름 patterns
  if (cleaned.includes('저은')) {
    return {
      ok: false,
      customHint: 'Chú ý: "저" không có patchim nên phải dùng "저는", không dùng "저은".',
    };
  }
  if (cleaned.includes('이름는')) {
    return {
      ok: false,
      customHint: 'Chú ý: "이름" có patchim ㅁ nên phải dùng "이름은", không dùng "이름는".',
    };
  }

  // Check common Unit 1 nouns preceding copula 이에요/예요
  const wordsToCheck = ['학생', '선생님', '회사원', '사람', '친구'];
  for (const w of wordsToCheck) {
    const expected = attachParticle(w, '이에요/예요');
    const wrong = hasBatchim(w) ? `${w}예요` : `${w}이에요`;
    if (cleaned.includes(wrong)) {
      return {
        ok: false,
        customHint: `Kiểm tra lại patchim của "${w}": đúng phải là "${expected}", không phải "${wrong}".`,
      };
    }
  }

  return { ok: true };
}

export function getExerciseCorrectSummary(ex: Exercise): string {
  switch (ex.type) {
    case 'hvpt_minimal_pair': {
      const opt = ex.options.find((o) => o.id === ex.targetOptionId);
      return opt ? `${opt.hangul} (${opt.meaningVi})` : '';
    }
    case 'vocab_mcq':
    case 'context_cloze': {
      const opt = ex.options.find((o) => o.id === ex.targetOptionId);
      return opt ? opt.text : '';
    }
    case 'syllable_builder':
      return ex.expectedSyllable;
    case 'particle_contrast':
      return ex.expectedPair.join(' / ');
    case 'sentence_scramble':
      return ex.expectedSequence.join(' ');
    case 'ime_typing_recall':
    case 'audio_dictation':
      return ex.expectedAnswers[0] ?? '';
    case 'shadowing_speak':
      return ex.targetText;
    case 'guided_personal_output':
      return ex.templateHint;
  }
}

export function checkExerciseCorrectness(
  ex: Exercise,
  submission: ExerciseSubmission
): { isCorrect: boolean; customHint?: string } {
  switch (ex.type) {
    case 'hvpt_minimal_pair':
    case 'vocab_mcq':
    case 'context_cloze':
      return {
        isCorrect: submission.kind === 'option' && submission.optionId === ex.targetOptionId,
      };
    case 'particle_contrast': {
      if (submission.kind !== 'option') return { isCorrect: false };
      const chosen = ex.options.find((o) => o.id === submission.optionId);
      if (!chosen) return { isCorrect: false };
      return {
        isCorrect:
          chosen.pair[0] === ex.expectedPair[0] &&
          chosen.pair[1] === ex.expectedPair[1],
      };
    }
    case 'syllable_builder':
      return {
        isCorrect:
          submission.kind === 'text' &&
          normalizeKoreanAnswer(submission.text) === normalizeKoreanAnswer(ex.expectedSyllable),
      };
    case 'sentence_scramble':
      return {
        isCorrect:
          submission.kind === 'tokens' &&
          submission.tokens.length === ex.expectedSequence.length &&
          submission.tokens.every((t, idx) => t === ex.expectedSequence[idx]),
      };
    case 'ime_typing_recall':
    case 'audio_dictation': {
      if (submission.kind !== 'text') return { isCorrect: false };
      const norm = normalizeKoreanAnswer(submission.text);
      return {
        isCorrect: ex.expectedAnswers.some((ans) => normalizeKoreanAnswer(ans) === norm),
      };
    }
    case 'shadowing_speak':
      return { isCorrect: submission.kind === 'shadowing_done' };
    case 'guided_personal_output': {
      if (submission.kind !== 'text') return { isCorrect: false };
      const res = validateGuidedPersonalSentence(
        submission.text,
        ex.validationRules.mustIncludeAny,
        ex.validationRules.mustIncludeTopicParticle
      );
      return { isCorrect: res.ok, customHint: res.customHint };
    }
  }
}

/**
 * Implements the 2-Step Prompt-First Corrective Feedback Loop (Lyster & Saito, 2010):
 * - First wrong attempt triggers a metalinguistic promptHint WITHOUT revealing the answer.
 * - Successful self-repair on attempt 2 yields FSRS Hard (2).
 * - Second wrong attempt (or explicit reveal) reveals explanation, grades Again (1), and requeues.
 */
export function evaluateExerciseSubmission(params: {
  exercise: Exercise;
  submission: ExerciseSubmission;
  attemptNumber: 1 | 2;
  forceReveal?: boolean;
  responseTimeMs?: number;
}): FeedbackEvaluation {
  const { exercise, submission, attemptNumber, forceReveal = false, responseTimeMs = 5000 } = params;

  if (forceReveal) {
    return {
      status: 'failed_reveal',
      revealAnswer: true,
      explanation: exercise.explicitExplanation,
      correctSummary: getExerciseCorrectSummary(exercise),
      fsrsGrade: 1,
      requeueAtEnd: true,
    };
  }

  const check = checkExerciseCorrectness(exercise, submission);
  if (check.isCorrect) {
    const wrongAttempts = attemptNumber === 1 ? 0 : 1;
    const grade = autoGradeAttempt({
      wrongAttempts,
      usedReveal: false,
      stage: exercise.stage,
      responseTimeMs,
    });
    return {
      status: attemptNumber === 1 ? 'passed_first_try' : 'passed_self_repair',
      revealAnswer: true,
      explanation: exercise.explicitExplanation,
      fsrsGrade: grade,
      requeueAtEnd: false,
    };
  }

  if (attemptNumber === 1) {
    return {
      status: 'prompt_retry',
      revealAnswer: false,
      hint: check.customHint ?? exercise.promptHint,
    };
  }

  return {
    status: 'failed_reveal',
    revealAnswer: true,
    explanation: exercise.explicitExplanation,
    correctSummary: getExerciseCorrectSummary(exercise),
    fsrsGrade: 1,
    requeueAtEnd: true,
  };
}

export function inferExerciseErrorCategory(ex: Exercise): ErrorCategory {
  if (ex.type === 'hvpt_minimal_pair') return ex.contrastCategory === 'liaison' ? 'batchim_nl' : ex.contrastCategory;
  if (ex.type === 'particle_contrast' || (ex.targetGrammarIds && ex.targetGrammarIds.length > 0)) {
    return 'particles';
  }
  return 'general';
}

export function getAllExercises(): Exercise[] {
  const u0 = unit0Data.lessons.flatMap((l) => l.exercises);
  const u1 = unit1Data.lessons.flatMap((l) => l.exercises);
  return [...u0, ...u1];
}

/**
 * Builds an interleaved smart practice queue prioritizing due FSRS cards,
 * Vietnamese L1 contrast drills (HVPT + particles), and unlearned items.
 */
export function buildDailySmartSession(
  cards: FsrsCardState[],
  now = Date.now(),
  maxItems = 8
): Exercise[] {
  const all = getAllExercises();
  const dueIds = new Set(
    cards
      .filter((c) => {
        const elapsed = Math.max(0, (now - c.lastReviewAt) / MS_PER_DAY);
        return c.dueAt <= now || retrievability(elapsed, c.stability) < 0.9;
      })
      .sort((a, b) => {
        const ra = retrievability((now - a.lastReviewAt) / MS_PER_DAY, a.stability);
        const rb = retrievability((now - b.lastReviewAt) / MS_PER_DAY, b.stability);
        return ra - rb;
      })
      .map((c) => c.itemId)
  );

  const dueExercises: Exercise[] = all.filter(
    (ex) => ex.targetVocabIds?.some((id) => dueIds.has(id)) ?? false
  );
  const contrastExercises: Exercise[] = all.filter(
    (ex) => ex.type === 'hvpt_minimal_pair' || ex.type === 'particle_contrast' || ex.type === 'context_cloze'
  );
  const remaining: Exercise[] = all.filter(
    (ex) => !dueExercises.includes(ex) && !contrastExercises.includes(ex)
  );

  const picked: Exercise[] = [];
  const seen = new Set<string>();
  const pushUnique = (list: Exercise[], limit: number) => {
    for (const ex of list) {
      if (picked.length >= maxItems || limit <= 0) break;
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        picked.push(ex);
        limit--;
      }
    }
  };

  pushUnique(dueExercises, 3);
  pushUnique(contrastExercises, 3);
  pushUnique(remaining, maxItems - picked.length);

  return picked;
}
