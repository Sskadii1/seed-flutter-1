import {
  AdaptiveAiProfile,
  WONDER_BOARD_THEMES,
  WonderAnnotation,
  WonderAnnotationSchema,
  WonderBeginnerLoopState,
  WonderBoardAction,
  WonderBoardActionSchema,
  WonderBoardContext,
  WonderBoardDocument,
  WonderDetectedIntent,
  WonderGuidanceLevel,
  WonderHangulDemoSpec,
  WonderLearningEvent,
  WonderRecognitionRegion,
  WonderTeachingCard,
} from '@seed/schema';
import { attachParticle, hasBatchim } from './hangul';
import {
  analyzeBoardPedagogy,
  computeCollisionFreePlacement,
  deduplicateWonderAnnotations,
  describeKoreanSyllableOrWordVi,
  generateScallopedCloudGeometry,
  hashString,
} from './wonder-board';
import { buildHangulStrokeOrderDemo } from './hangul-stroke-order';

function tokenizeMeaningfulRoots(text: string): string[] {
  return text
    .replace(/[.?!,]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .map((w) => w.replace(/(은|는|이|가|을|를|에서|에|이에요|예요|아요|어요|았어요|었어요)$/, ''));
}

/**
 * Learning Intent Engine (Section 8):
 * Supports all 14 educational & conversational intents with confidence and explicit evidence.
 * Returns multiple intents when applicable, or UNKNOWN_INTENT when evidence is insufficient.
 */
export function classifyLearningIntents(
  region: WonderRecognitionRegion,
  context: WonderBoardContext,
  board: WonderBoardDocument
): WonderDetectedIntent[] {
  if (
    region.completeness === 'non_text' ||
    region.recognitionStatus === 'NON_TEXT'
  ) {
    return [
      {
        intent: 'FREE_DRAWING',
        confidence: 0.9,
        evidence: ['Cluster classified geometrically as freehand doodle/drawing'],
      },
    ];
  }

  if (
    region.completeness === 'low_confidence' ||
    region.recognitionStatus === 'AMBIGUOUS' ||
    region.recognitionStatus === 'PROVIDER_UNAVAILABLE' ||
    region.recognitionStatus === 'UNSUPPORTED' ||
    region.recognizedText.trim().length === 0
  ) {
    return [
      {
        intent: 'UNKNOWN_INTENT',
        confidence: 0.25,
        evidence: [`Recognition status is ${region.recognitionStatus}; avoiding intent hallucination`],
      },
    ];
  }

  const txt = region.recognizedText.trim();
  const lower = txt.toLowerCase();
  const intents: WonderDetectedIntent[] = [];

  // 1. Explicit beginner start / new topic request
  if (
    lower.includes('chưa biết tiếng hàn') ||
    lower.includes('từ đầu') ||
    lower.includes('bắt đầu học') ||
    lower.includes('giới thiệu bản thân') ||
    lower.includes('muốn học') ||
    lower.includes('học tiếng hàn') ||
    lower.includes('cách gọi')
  ) {
    const topic = lower.includes('giới thiệu')
      ? 'self_intro'
      : lower.includes('chưa biết') || lower.includes('từ đầu') || lower.includes('bắt đầu')
        ? 'hangul_basics'
        : lower.includes('cà phê') || lower.includes('trà') || lower.includes('cách gọi')
          ? 'coffee'
          : 'greetings';
    intents.push({
      intent: 'LEARN_NEW_TOPIC',
      confidence: 0.92,
      topic,
      evidence: [`Matched learner goal phrase in "${txt}" (topic=${topic})`],
    });
  }

  // 2. Question / Meaning / Translation / Pronunciation / Grammar / How to write
  if (lower.includes('nghĩa là gì') || lower.includes('là gì?') || lower.includes('mean')) {
    intents.push({
      intent: 'ASK_MEANING',
      confidence: 0.91,
      evidence: [`Meaning question marker in "${txt}"`],
    });
  }
  if (lower.includes('dịch') || lower.includes('tiếng hàn là gì') || lower.includes('nói sao')) {
    intents.push({
      intent: 'ASK_TRANSLATION',
      confidence: 0.88,
      evidence: [`Translation request marker in "${txt}"`],
    });
  }
  if (
    lower.includes('phát âm') ||
    lower.includes('đọc sao') ||
    lower.includes('đọc như thế nào') ||
    lower.includes('ipa')
  ) {
    intents.push({
      intent: 'ASK_PRONUNCIATION',
      confidence: 0.89,
      evidence: [`Pronunciation marker in "${txt}"`],
    });
  }
  if (
    lower.includes('cách viết') ||
    lower.includes('viết như thế nào') ||
    lower.includes('thứ tự nét') ||
    lower.includes('stroke')
  ) {
    intents.push({
      intent: 'ASK_HOW_TO_WRITE',
      confidence: 0.9,
      evidence: [`Hangul stroke-order query in "${txt}"`],
    });
  }
  if (
    lower.includes('ngữ pháp') ||
    lower.includes('sai ở đâu') ||
    lower.includes('đúng chưa') ||
    lower.includes('đúng không') ||
    lower.includes('tại sao dùng')
  ) {
    intents.push({
      intent: 'ASK_GRAMMAR',
      confidence: 0.88,
      evidence: [`Explicit grammar question in "${txt}"`],
    });
  }

  // 3. Context-linked intents (self-correction & exercise response)
  const relSelfFix = context.relations.find(
    (r) => r.fromRegionId === region.regionId && r.relationType === 'self_correction_candidate'
  );
  if (relSelfFix) {
    intents.push({
      intent: 'SELF_CORRECTION',
      confidence: relSelfFix.confidence,
      evidence: relSelfFix.evidence,
    });
  }

  const relAnswerCard = context.relations.find(
    (r) =>
      r.fromRegionId === region.regionId &&
      r.relationType === 'answer_to_ai_card'
  );
  if (relAnswerCard || board.beginnerLoop?.active) {
    const looksLikeKoreanAttempt = /[\uAC00-\uD7A3]/.test(txt);
    if (looksLikeKoreanAttempt) {
      intents.push({
        intent: 'ANSWER_AI_EXERCISE',
        confidence: relAnswerCard ? relAnswerCard.confidence : 0.72,
        evidence: relAnswerCard
          ? relAnswerCard.evidence
          : ['Korean attempt produced during active beginner micro-teaching loop'],
      });
    }
  }

  // 4. Korean handwriting / vocabulary / sentence practice
  const hasKo = /[\uAC00-\uD7A3]/.test(txt);
  const hasBareJamo = /[\u3131-\u318E]/.test(txt);
  if (hasBareJamo && !hasKo) {
    intents.push({
      intent: 'PRACTICE_HANGUL',
      confidence: 0.85,
      evidence: [`Isolated Hangul Jamo detected in "${txt}"`],
    });
  } else if (hasKo) {
    const wordCount = txt.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 1 && !/[.!?]$/.test(txt)) {
      intents.push({
        intent: 'PRACTICE_VOCABULARY',
        confidence: 0.78,
        evidence: [`Single Korean word "${txt}"`],
      });
    } else if (intents.length === 0) {
      intents.push({
        intent: 'PRACTICE_SENTENCE',
        confidence: 0.84,
        evidence: [`Multi-word Korean sentence (${wordCount} tokens)`],
      });
    }
  }

  if (intents.length === 0) {
    intents.push({
      intent: 'FREE_PRACTICE',
      confidence: 0.65,
      evidence: [`Open board writing "${txt.slice(0, 40)}"`],
    });
  }

  return intents;
}

/**
 * Evidence-Based Self-Correction Evaluation (Section 17):
 * Prevents unrelated valid sentences on the canvas from falsely resolving an earlier error.
 */
export function evaluateSelfCorrectionEvidence(
  prevAnn: WonderAnnotation,
  regions: WonderRecognitionRegion[],
  context: WonderBoardContext
): {
  resolved: boolean;
  evidenceKind: 'copied_answer' | 'guided_self_correction' | 'independent_usage';
  matchingRegionId?: string;
  evidence: string[];
} {
  if (
    prevAnn.status !== 'active' ||
    prevAnn.severity !== 'error' ||
    !prevAnn.suggested_correction
  ) {
    return { resolved: false, evidenceKind: 'exposure', evidence: [] } as unknown as {
      resolved: boolean;
      evidenceKind: 'copied_answer' | 'guided_self_correction' | 'independent_usage';
      evidence: string[];
    };
  }

  const prevRoots = new Set(tokenizeMeaningfulRoots(prevAnn.recognized_text));

  for (const reg of regions) {
    if (reg.completeness !== 'complete') continue;
    const isSameRegionEdited = prevAnn.source_stroke_ids.some((id) =>
      reg.strokeIds.includes(id)
    );
    if (isSameRegionEdited) continue; // Stale invalidation handles in-place edit separately

    if (reg.recognizedAt + 50 < prevAnn.created_at) continue;

    // Require BOTH suggested correction AND semantic/stem link or explicit context relation
    const containsFix = reg.recognizedText.includes(prevAnn.suggested_correction);
    if (!containsFix) continue;

    const regRoots = tokenizeMeaningfulRoots(reg.recognizedText);
    const sharedRootCount = regRoots.filter((r) => prevRoots.has(r)).length;
    const hasContextRel = context.relations.some(
      (rel) =>
        rel.fromRegionId === reg.regionId &&
        rel.relationType === 'self_correction_candidate'
    );

    if (hasContextRel || sharedRootCount >= 1) {
      const wasProvidedExplicitly = prevAnn.animation_progress?.completed === true;
      const exactCopy =
        reg.recognizedText.trim().length <= prevAnn.recognized_text.trim().length + 3;
      return {
        resolved: true,
        evidenceKind:
          wasProvidedExplicitly && exactCopy ? 'copied_answer' : 'guided_self_correction',
        matchingRegionId: reg.regionId,
        evidence: [
          `Region ${reg.regionId} contains "${prevAnn.suggested_correction}" with ${sharedRootCount} shared root(s)`,
        ],
      };
    }
  }

  return {
    resolved: false,
    evidenceKind: 'guided_self_correction',
    evidence: [],
  };
}

function getActionBudgetForGuidance(level: WonderGuidanceLevel): number {
  switch (level) {
    case 'minimal':
    case 'beginner_friendly':
      return 1;
    case 'guided':
      return 2;
    case 'detailed':
      return 4;
  }
}

function makeValidatedAction(raw: WonderBoardAction): WonderBoardAction {
  return WonderBoardActionSchema.parse(raw);
}

const KOREAN_PHRASE_EXPLANATIONS: Array<{
  patternKo: string;
  meaningVi: string;
  grammarVi: string;
  ipa?: string;
}> = [
  {
    patternKo: '안녕하세요',
    meaningVi: 'Xin chào (cách chào lịch sự, dùng được với mọi người lớn tuổi và người mới gặp).',
    grammarVi: 'Từ chào hỏi chuẩn lịch sự đuôi -요.',
    ipa: '[annjʌŋhasejo]',
  },
  {
    patternKo: '감사합니다',
    meaningVi: 'Xin cảm ơn (lịch sự trang trọng).',
    grammarVi: 'Đuôi trang trọng -ㅂ니다.',
    ipa: '[kamsahamnida]',
  },
  {
    patternKo: '죄송합니다',
    meaningVi: 'Tôi xin lỗi (lịch sự trang trọng).',
    grammarVi: 'Đuôi trang trọng -ㅂ니다.',
    ipa: '[tɕwesʰoŋhamnida]',
  },
  {
    patternKo: '반갑습니다',
    meaningVi: 'Rất vui được gặp bạn.',
    grammarVi: 'Đi sau 만나서 tạo thành câu "Rất vui được gặp bạn".',
  },
  {
    patternKo: '학생',
    meaningVi: 'Học sinh / Sinh viên (Hán-Việt: Học sinh).',
    grammarVi: 'Có patchim ㅇ nên đi với -이에요 (학생이에요) và -은 (학생은).',
  },
  {
    patternKo: '선생님',
    meaningVi: 'Giáo viên / Thầy cô giáo (Hán-Việt: Tiên sinh).',
    grammarVi: 'Có patchim ㅁ nên đi với -이에요 (선생님이에요).',
  },
];

export interface WonderTutorResult {
  intentsByRegionId: Record<string, WonderDetectedIntent[]>;
  scheduledActions: WonderBoardAction[];
  deferredActions: WonderBoardAction[];
  annotationsToAdd: WonderAnnotation[];
  resolvedAnnotationIds: string[];
  teachingCardsToAdd: WonderTeachingCard[];
  hangulDemosToAdd: WonderHangulDemoSpec[];
  nextBeginnerLoop: WonderBeginnerLoopState | undefined;
  newEvents: WonderLearningEvent[];
  recommendedTeacherState: WonderBoardDocument['teacherState'];
}

/**
 * Ambient Adaptive Tutor Orchestrator (Sections 9–12, 16–17):
 * - Separates semantic decision -> structured action protocol (Zod) -> spatial layout.
 * - Orchestrates beginner zero-knowledge micro-teaching loops step-by-step.
 * - Throttles concurrent annotations cleanly via deferredActions instead of dropping errors.
 */
export function orchestrateWonderTutor(params: {
  board: WonderBoardDocument;
  regions: WonderRecognitionRegion[];
  context: WonderBoardContext;
  existingAnnotations: WonderAnnotation[];
  existingTeachingCards: WonderTeachingCard[];
  learnerProfile?: AdaptiveAiProfile;
  recordedEventKeys?: Set<string>;
}): WonderTutorResult {
  const {
    board,
    regions,
    context,
    existingAnnotations,
    existingTeachingCards,
    recordedEventKeys = new Set<string>(),
  } = params;

  const theme = WONDER_BOARD_THEMES[board.themeId];
  const guidanceLevel: WonderGuidanceLevel =
    board.guidanceLevel ??
    (board.aiMode === 'discovery'
      ? 'beginner_friendly'
      : board.aiMode === 'gentle'
        ? 'minimal'
        : 'guided');

  if (!board.aiEnabled || board.aiMode === 'focus') {
    return {
      intentsByRegionId: {},
      scheduledActions: [],
      deferredActions: board.deferredActions ?? [],
      annotationsToAdd: [],
      resolvedAnnotationIds: [],
      teachingCardsToAdd: [],
      hangulDemosToAdd: [],
      nextBeginnerLoop: board.beginnerLoop,
      newEvents: [],
      recommendedTeacherState: 'IDLE',
    };
  }

  const intentsByRegionId: Record<string, WonderDetectedIntent[]> = {};
  const allCandidateActions: WonderBoardAction[] = [];
  const teachingCardsToAdd: WonderTeachingCard[] = [];
  const hangulDemosToAdd: WonderHangulDemoSpec[] = [];
  const newEvents: WonderLearningEvent[] = [];
  let nextBeginnerLoop = board.beginnerLoop;

  const pushUniqueEvent = (evt: WonderLearningEvent) => {
    const key = evt.idempotencyKey ?? evt.eventId;
    if (!recordedEventKeys.has(key) && !newEvents.some((e) => (e.idempotencyKey ?? e.eventId) === key)) {
      newEvents.push(evt);
    }
  };

  // 1. Evaluate evidence-based self-corrections cleanly
  const resolvedAnnotationIds: string[] = [];
  for (const prevAnn of existingAnnotations) {
    const ev = evaluateSelfCorrectionEvidence(prevAnn, regions, context);
    if (ev.resolved) {
      resolvedAnnotationIds.push(prevAnn.annotation_id);
      pushUniqueEvent({
        eventId: `evt_fix_${prevAnn.annotation_id}_${ev.matchingRegionId}`,
        idempotencyKey: `self_fix:${board.id}:${prevAnn.annotation_id}`,
        boardId: board.id,
        eventType: 'self_correction_completed',
        conceptIds: prevAnn.learning_concept_ids,
        recognizedText: prevAnn.suggested_correction,
        confirmed: true,
        evidenceKind: ev.evidenceKind,
        linkedAnnotationId: prevAnn.annotation_id,
        timestamp: Date.now(),
      });
    }
  }

  // Occupied boxes for non-overlapping placement of tutor responses (include actual billowy cloud outer bounds)
  const activeStrokes = board.strokes.filter((s) => !s.deleted);
  const occupiedRegionClouds = regions.map(
    (r) => generateScallopedCloudGeometry(r.bbox, 1).outerBounds
  );
  const occupiedBoxes = [
    ...occupiedRegionClouds,
    ...activeStrokes.map((s) => s.bbox),
    ...existingAnnotations.filter((a) => a.status === 'active').map((a) => a.note_geometry),
    ...existingTeachingCards.map((c) => c.geometry),
  ];

  // Track candidate annotations produced for multi-error Korean regions
  const annotationsToAdd: WonderAnnotation[] = [];

  for (const reg of regions) {
    const intents = classifyLearningIntents(reg, context, board);
    intentsByRegionId[reg.regionId] = intents;

    if (
      reg.completeness === 'non_text' ||
      reg.completeness === 'in_progress' ||
      reg.completeness === 'low_confidence' ||
      intents.every((i) => i.intent === 'UNKNOWN_INTENT' || i.intent === 'FREE_DRAWING')
    ) {
      // Explicit OBSERVE / WAIT action: never emit fake feedback
      allCandidateActions.push(
        makeValidatedAction({
          actionId: `act_wait_${reg.regionId}`,
          boardId: board.id,
          type: 'WAIT',
          sourceRegionIds: [reg.regionId],
          sourceRevision: reg.revision,
          targetSemanticSpan: { text: '', start: 0, end: 0 },
          targetStrokeAnchors: [],
          content: '',
          educationalPurpose: `Waiting safely (${reg.recognitionStatus})`,
          confidence: 1,
          visualStyleToken: 'silent',
          priority: 10,
          dependencies: [],
          expirationCondition: 'region_updated',
          status: 'scheduled',
        })
      );
      continue;
    }

    const txt = reg.recognizedText;
    const primaryIntent = intents[0];

    // 2. Question intents: ASK_HOW_TO_WRITE -> NIKL Hangul Stroke Order Demo
    if (intents.some((i) => i.intent === 'ASK_HOW_TO_WRITE')) {
      const hangulTokens = txt.match(/[\uAC00-\uD7A3\u3131-\u3163]+/g);
      const targetCharText = hangulTokens?.[0] ?? '한';
      const alreadyHasDemo = (board.hangulDemos ?? []).some(
        (d) => d.text === targetCharText
      );
      if (!alreadyHasDemo) {
        const { noteBox } = computeCollisionFreePlacement({
          targetBox: reg.bbox,
          desiredWidth: 260,
          desiredHeight: 140,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
        });
        occupiedBoxes.push(noteBox);
        const demo = buildHangulStrokeOrderDemo({
          demoId: `demo_${board.id}_${reg.regionId}`,
          text: targetCharText,
          startX: noteBox.minX + 14,
          startY: noteBox.minY + 34,
          cellSize: 58,
        });
        hangulDemosToAdd.push(demo);

        allCandidateActions.push(
          makeValidatedAction({
            actionId: `act_trace_${reg.regionId}`,
            boardId: board.id,
            type: 'CREATE_TRACE_GUIDE',
            sourceRegionIds: [reg.regionId],
            sourceRevision: reg.revision,
            targetSemanticSpan: { text: targetCharText, start: 0, end: targetCharText.length },
            targetStrokeAnchors: reg.strokeIds,
            content: `${targetCharText} (${demo.strokes.length} nét theo chuẩn NIKL)`,
            educationalPurpose: 'Demonstrate authentic Hangul stroke order',
            confidence: 0.92,
            visualStyleToken: theme.aiSuggestionHex,
            priority: 1,
            dependencies: [],
            expirationCondition: 'stroke_removed',
            status: 'scheduled',
          })
        );
      }
      continue;
    }

    // 3. Question intents: ASK_MEANING / ASK_PRONUNCIATION
    if (intents.some((i) => i.intent === 'ASK_MEANING' || i.intent === 'ASK_PRONUNCIATION')) {
      const matchedEntry = KOREAN_PHRASE_EXPLANATIONS.find((k) => txt.includes(k.patternKo));
      const targetWord =
        matchedEntry?.patternKo ??
        txt.match(/[\uAC00-\uD7A3]+/)?.[0] ??
        reg.spans[0]?.text ??
        txt;
      const existing = existingAnnotations.some(
        (a) =>
          a.status === 'active' &&
          a.annotation_type === 'explanation' &&
          a.target_text === targetWord
      );
      if (!existing) {
        const { noteBox, placement, arrow } = computeCollisionFreePlacement({
          targetBox: reg.bbox,
          desiredWidth: 260,
          desiredHeight: 118,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
        });
        occupiedBoxes.push(noteBox);

        const explanationText = matchedEntry
          ? `${matchedEntry.meaningVi}${matchedEntry.ipa ? ` ${matchedEntry.ipa}` : ''} ${matchedEntry.grammarVi}`
          : `"${targetWord}": ${
              hasBatchim(targetWord)
                ? 'âm tiết cuối có patchim (-이에요 / -은).'
                : 'âm tiết cuối mở, không patchim (-예요 / -는).'
            }`;

        annotationsToAdd.push({
          annotation_id: `ann_${board.id}_meaning_${reg.regionId}`,
          stable_key: `${board.id}__meaning__${targetWord}__${reg.strokeIds[0] ?? '0'}`,
          cloud_seed: hashString(targetWord) + 11,
          board_id: board.id,
          source_revision: reg.revision,
          source_stroke_ids: reg.strokeIds,
          recognized_text: txt,
          target_text: targetWord,
          target_span: { start: 0, end: targetWord.length },
          target_geometry: reg.bbox,
          note_geometry: noteBox,
          arrow_path: arrow,
          annotation_type: 'explanation',
          linguistic_category: 'vocabulary',
          severity: 'info',
          confidence: 0.9,
          suggested_correction: matchedEntry?.ipa ?? '',
          explanation: explanationText,
          hint: 'Viết thử 1 câu ngắn dùng từ này bên dưới nhé.',
          visual_style: { shape: 'scalloped_cloud', accentColor: theme.aiSupportHex },
          placement_preference: placement,
          learning_concept_ids: ['kc_lexicon_hanja'],
          created_at: Date.now(),
          status: 'active',
          lifecycle_state: 'queued',
          animation_progress: { cloud: 0, arrow: 0, correction: 0, explanation: 0, completed: false },
        });
      }
      continue;
    }

    // 4. Zero-Knowledge Beginner Micro-Teaching Loop (Section 10 & 11)
    if (primaryIntent.intent === 'LEARN_NEW_TOPIC') {
      const topic = (primaryIntent.topic ?? 'self_intro') as WonderBeginnerLoopState['topic'];
      const alreadyStarted = existingTeachingCards.some(
        (c) => c.sourceRevision >= reg.revision - 1 && c.titleVi.includes('Bước 1')
      );
      if (!alreadyStarted && (!nextBeginnerLoop || !nextBeginnerLoop.active)) {
        const { noteBox } = computeCollisionFreePlacement({
          targetBox: reg.bbox,
          desiredWidth: 280,
          desiredHeight: 162,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
        });
        occupiedBoxes.push(noteBox);

        const isSelfIntro = topic === 'self_intro' || topic === 'hangul_basics';
        const phrase = isSelfIntro ? '안녕하세요.' : topic === 'coffee' ? '커피 한 잔 주세요.' : '감사합니다.';
        const promptTemplate = isSelfIntro ? '저는 ___ 이에요.' : phrase;
        const card: WonderTeachingCard = {
          cardId: `card_loop1_${board.id}_${reg.regionId}`,
          boardId: board.id,
          sourceRevision: reg.revision,
          geometry: noteBox,
          titleVi: 'Bước 1 — Giáo viên AI hướng dẫn',
          koreanPhrase: phrase,
          ipa: isSelfIntro ? '[annjʌŋhasejo]' : undefined,
          explanationVi: isSelfIntro
            ? 'Bước 1: Xin chào là "안녕하세요". Bước 2: Thử viết câu giới thiệu: "저는 [tên bạn] 이에요/예요." ngay bên dưới nhé!'
            : `Mẫu câu khởi đầu: "${phrase}". Bạn hãy viết thử bên dưới để AI xem nhé.`,
          breakdown: isSelfIntro
            ? [
                { token: '안녕하세요', meaningVi: 'Xin chào' },
                { token: '저는 ... 이에요/예요', meaningVi: 'Tôi là ...' },
              ]
            : [{ token: phrase, meaningVi: 'Mẫu thực hành' }],
          ghostHandwritingText: phrase,
          ghostBBox: {
            minX: noteBox.minX + 10,
            minY: noteBox.maxY + 14,
            maxX: noteBox.minX + 250,
            maxY: noteBox.maxY + 54,
            width: 240,
            height: 40,
          },
          learningConceptIds: ['kc_lexicon_hanja', 'kc_productive_orthography'],
          createdAt: Date.now(),
        };
        teachingCardsToAdd.push(card);

        if (topic === 'hangul_basics') {
          hangulDemosToAdd.push(
            buildHangulStrokeOrderDemo({
              demoId: `demo_intro_${board.id}_${reg.regionId}`,
              text: '안녕',
              startX: noteBox.maxX + 24,
              startY: noteBox.minY + 12,
              cellSize: 52,
            })
          );
        }

        nextBeginnerLoop = {
          active: true,
          topic,
          stepIndex: 1,
          expectedPromptKo: promptTemplate,
          lastStepRegionId: reg.regionId,
          completedSteps: [],
        };

        allCandidateActions.push(
          makeValidatedAction({
            actionId: `act_loop_${reg.regionId}`,
            boardId: board.id,
            type: 'WRITE_EXAMPLE',
            sourceRegionIds: [reg.regionId],
            sourceRevision: reg.revision,
            targetSemanticSpan: { text: txt, start: 0, end: txt.length },
            targetStrokeAnchors: reg.strokeIds,
            content: `${phrase} | ${promptTemplate}`,
            educationalPurpose: 'Initiate zero-knowledge beginner micro-teaching step 1',
            confidence: primaryIntent.confidence,
            visualStyleToken: theme.aiSuggestionHex,
            priority: 1,
            dependencies: [],
            expirationCondition: 'learner_responds',
            status: 'scheduled',
          })
        );

        pushUniqueEvent({
          eventId: `evt_intro_${reg.regionId}`,
          idempotencyKey: `exposure:${board.id}:${topic}:step1`,
          boardId: board.id,
          eventType: 'concept_encountered',
          conceptIds: ['kc_lexicon_hanja'],
          recognizedText: phrase,
          confirmed: true,
          evidenceKind: 'exposure',
          timestamp: Date.now(),
        });
      }
      continue;
    }

    // 5. Fallback / Core Korean pedagogy & unseen copula/particle grammar analysis
    // Provide helpful single-word explanation if learner writes a standalone vocabulary word (e.g. 고마워)
    if (
      (reg.language === 'ko' || reg.language === 'mixed') &&
      primaryIntent.intent === 'PRACTICE_VOCABULARY' &&
      (board.aiMode === 'tutor' || board.aiMode === 'discovery' || board.aiMode === 'review')
    ) {
      const desc = describeKoreanSyllableOrWordVi(txt);
      if (desc) {
        const dupWord = existingAnnotations.some(
          (a) =>
            (a.status === 'active' || a.status === 'dismissed') &&
            a.target_text === txt &&
            a.source_stroke_ids.some((id) => reg.strokeIds.includes(id))
        );
        if (!dupWord) {
          const isTall = reg.bbox.height > 120;
          const desiredWidth = Math.max(300, Math.min(460, Math.round(reg.bbox.height * 1.25)));
          const desiredHeight = Math.max(134, Math.min(220, Math.round(reg.bbox.height * 0.68)));
          const { noteBox, placement, arrow } = computeCollisionFreePlacement({
            targetBox: reg.bbox,
            desiredWidth,
            desiredHeight,
            preferredOrder: isTall
              ? ['right', 'left', 'above', 'below']
              : ['right', 'below', 'above', 'left'],
            occupiedBoxes,
          });
          occupiedBoxes.push(noteBox);
          const sortedRegIds = [...reg.strokeIds].sort().join(',');
          annotationsToAdd.push({
            annotation_id: `ann_${board.id}_vocab_${reg.regionId}`,
            stable_key: `${board.id}__explanation__vocabulary__${txt}__${sortedRegIds || '0'}`,
            cloud_seed: hashString(txt) + 7,
            board_id: board.id,
            source_revision: reg.revision,
            source_stroke_ids: reg.strokeIds,
            recognized_text: txt,
            target_text: txt,
            target_span: { start: 0, end: txt.length },
            target_geometry: reg.bbox,
            note_geometry: noteBox,
            arrow_path: arrow,
            annotation_type: 'explanation',
            linguistic_category: 'vocabulary',
            severity: 'info',
            confidence: reg.confidence,
            suggested_correction: desc.header,
            explanation: desc.explanation,
            hint: desc.hint,
            visual_style: { shape: 'scalloped_cloud', accentColor: theme.aiSupportHex },
            placement_preference: placement,
            learning_concept_ids: ['kc_lexicon_hanja'],
            created_at: Date.now(),
            status: 'active',
            lifecycle_state: 'queued',
            animation_progress: {
              cloud: 0,
              arrow: 0,
              correction: 0,
              explanation: 0,
              completed: false,
            },
          });
        }
      }
    }

    // Check general Korean copula pattern "<Noun>예요/이에요" for ANY Korean noun even unseen!
    if (reg.language === 'ko' || reg.language === 'mixed') {
      for (const sp of reg.spans) {
        const cleanWord = sp.text.replace(/[.!?]/g, '');
        if (cleanWord.endsWith('예요') && cleanWord.length > 2) {
          const stem = cleanWord.slice(0, -2);
          if (stem !== '뭐' && stem !== '얼마' && stem !== '거') {
            const expected = attachParticle(stem, '이에요/예요');
            if (expected !== cleanWord) {
              const dup =
                existingAnnotations.some(
                  (a) =>
                    (a.status === 'active' || a.status === 'dismissed') &&
                    a.target_text === cleanWord &&
                    a.source_stroke_ids.some((id) => reg.strokeIds.includes(id))
                ) ||
                annotationsToAdd.some((a) => a.target_text === cleanWord);
              if (!dup) {
                const { noteBox, placement, arrow } = computeCollisionFreePlacement({
                  targetBox: sp.bbox,
                  desiredWidth: 252,
                  desiredHeight: 112,
                  preferredOrder: ['below', 'right', 'above', 'left'],
                  occupiedBoxes,
                });
                occupiedBoxes.push(noteBox);
                annotationsToAdd.push({
                  annotation_id: `ann_${board.id}_copula_${cleanWord}_${reg.regionId}`,
                  stable_key: `${board.id}__batchim__${cleanWord}__${sp.strokeIds[0] ?? '0'}`,
                  cloud_seed: hashString(cleanWord) + 3,
                  board_id: board.id,
                  source_revision: reg.revision,
                  source_stroke_ids: sp.strokeIds,
                  recognized_text: txt,
                  target_text: cleanWord,
                  target_span: { start: sp.startIndex, end: sp.endIndex },
                  target_geometry: sp.bbox,
                  note_geometry: noteBox,
                  arrow_path: arrow,
                  annotation_type: 'particle_correction',
                  linguistic_category: 'batchim',
                  severity: 'error',
                  confidence: Math.min(0.95, reg.confidence),
                  suggested_correction: expected,
                  explanation: `"${stem}" có patchim nên phải dùng đuôi -이에요 (${expected}) thay cho -예요.`,
                  hint: `Kiểm tra phụ âm cuối của "${stem}".`,
                  visual_style: { shape: 'scalloped_cloud', accentColor: theme.aiCorrectionHex },
                  placement_preference: placement,
                  learning_concept_ids: ['kc_morph_particles', 'kc_phonetics_vowel_batchim'],
                  created_at: Date.now(),
                  status: 'active',
                  lifecycle_state: 'queued',
                  animation_progress: {
                    cloud: 0,
                    arrow: 0,
                    correction: 0,
                    explanation: 0,
                    completed: false,
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  // Combine with core V2 pedagogy (which checks tense, object particle, place particle, praise, etc.)
  const basePed = analyzeBoardPedagogy({
    board,
    regions,
    existingAnnotations: [...existingAnnotations, ...annotationsToAdd],
    existingTeachingCards: [...existingTeachingCards, ...teachingCardsToAdd],
    theme,
  });

  // Merge and strictly deduplicate across semantic identity + stroke overlap (P0.4)
  const dedupedAll = deduplicateWonderAnnotations([
    ...existingAnnotations,
    ...annotationsToAdd,
    ...basePed.nextAnnotations,
  ]);
  const existingIdSet = new Set(existingAnnotations.map((a) => a.annotation_id));
  const combinedCandidates = dedupedAll.filter(
    (a) => a.status === 'active' && !existingIdSet.has(a.annotation_id)
  );
  for (const card of basePed.nextTeachingCards) {
    if (!teachingCardsToAdd.some((c) => c.koreanPhrase === card.koreanPhrase && c.sourceRevision === card.sourceRevision)) {
      teachingCardsToAdd.push(card);
    }
  }

  // Advance beginner loop if learner submitted a clean self-intro sentence
  if (nextBeginnerLoop?.active && nextBeginnerLoop.stepIndex === 1) {
    const cleanKoIntro = regions.find(
      (r) =>
        r.completeness === 'complete' &&
        r.language === 'ko' &&
        (r.recognizedText.includes('저는') || r.recognizedText.includes('이름은')) &&
        !combinedCandidates.some(
          (a) =>
            a.severity === 'error' &&
            a.source_stroke_ids.some((id) => r.strokeIds.includes(id))
        )
    );
    if (cleanKoIntro) {
      nextBeginnerLoop = {
        ...nextBeginnerLoop,
        stepIndex: 2,
        completedSteps: [...nextBeginnerLoop.completedSteps, 1],
        expectedPromptKo: '저는 베트남 사람이에요.',
        lastStepRegionId: cleanKoIntro.regionId,
      };
    }
  }

  // Cognitive-load gating: keep top N actions active, store overflow cleanly in deferredActions!
  const budget = getActionBudgetForGuidance(guidanceLevel);
  const errorAndFeedbackAnns = combinedCandidates;
  const activeExistingCount = existingAnnotations.filter(
    (a) => a.status === 'active' && !resolvedAnnotationIds.includes(a.annotation_id)
  ).length;
  const remainingSlots = Math.max(0, Math.max(budget, 3) - activeExistingCount);

  const scheduledAnns: WonderAnnotation[] = [];
  const deferredActions: WonderBoardAction[] = [...(board.deferredActions ?? [])].slice(-12);

  errorAndFeedbackAnns.forEach((ann, idx) => {
    const isDeferred =
      guidanceLevel === 'beginner_friendly' && idx >= 1 && ann.severity === 'error'
        ? true
        : idx >= Math.max(1, remainingSlots + 2) && ann.severity === 'error';

    const action = makeValidatedAction({
      actionId: `act_${ann.annotation_id}`,
      boardId: board.id,
      type: ann.severity === 'praise' ? 'DRAW_CHECKMARK' : 'DRAW_CLOUD',
      sourceRegionIds: [],
      sourceRevision: ann.source_revision,
      targetSemanticSpan: {
        text: ann.target_text,
        start: ann.target_span.start,
        end: ann.target_span.end,
      },
      targetStrokeAnchors: ann.source_stroke_ids,
      content: ann.suggested_correction
        ? `${ann.target_text} -> ${ann.suggested_correction}: ${ann.explanation}`
        : ann.explanation,
      educationalPurpose: `Feedback on ${ann.linguistic_category}`,
      confidence: ann.confidence,
      visualStyleToken: ann.visual_style.accentColor,
      priority: ann.severity === 'error' ? 1 : 2,
      dependencies: [],
      expirationCondition: 'target_strokes_edited_or_resolved',
      status: isDeferred ? 'deferred' : 'scheduled',
    });
    allCandidateActions.push(action);

    if (isDeferred) {
      if (!deferredActions.some((d) => d.actionId === action.actionId)) {
        deferredActions.push(action);
      }
    } else {
      scheduledAnns.push(ann);
    }
  });

  // Forward idempotent learning events
  for (const evt of basePed.newEvents) {
    pushUniqueEvent({
      ...evt,
      idempotencyKey: `base:${board.id}:${evt.eventType}:${evt.recognizedText}`,
      evidenceKind:
        evt.eventType === 'successful_independent_usage'
          ? 'independent_usage'
          : evt.eventType === 'grammar_error_observed'
            ? 'exposure'
            : 'exposure',
    });
  }

  const recommendedTeacherState: WonderBoardDocument['teacherState'] =
    scheduledAnns.length > 0 || teachingCardsToAdd.length > 0 || hangulDemosToAdd.length > 0
      ? 'PLANNING_FEEDBACK'
      : regions.some((r) => r.completeness === 'in_progress')
        ? 'WAITING_FOR_CONTEXT'
        : existingAnnotations.some(
              (a) => a.status === 'active' && !resolvedAnnotationIds.includes(a.annotation_id)
            )
          ? 'WAITING_FOR_LEARNER'
          : 'OBSERVING';

  return {
    intentsByRegionId,
    scheduledActions: allCandidateActions.filter((a) => a.status === 'scheduled'),
    deferredActions: deferredActions.slice(-12),
    annotationsToAdd: scheduledAnns,
    resolvedAnnotationIds,
    teachingCardsToAdd,
    hangulDemosToAdd,
    nextBeginnerLoop,
    newEvents,
    recommendedTeacherState,
  };
}
