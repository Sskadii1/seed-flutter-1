import {
  AdaptiveAiProfile,
  WONDER_BOARD_THEMES,
  WonderAnnotation,
  WonderAnnotationSchema,
  WonderBBox,
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
  WonderSemanticTree,
  WonderSpatialTeachingAction,
  WonderSpatialTeachingActionSchema,
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
import {
  buildHierarchicalSemanticTree,
  reconcileSemanticAnnotations,
  selectInterventionGranularity,
} from './wonder-hierarchy';
import { buildHangulStrokeOrderDemo } from './hangul-stroke-order';
import { buildEnglishDiscoveryCard, describeEnglishWordVi } from './wonder-english';
import { decomposeHangulUnit } from './wonder-hangul';
import { findWonderPracticeActivities } from './wonder-practice';

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
    lower.includes('học tiếng anh') ||
    lower.includes('tiếng anh') ||
    lower.includes('english') ||
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
  if (
    lower.includes('nghĩa là gì') ||
    lower.includes('là gì?') ||
    lower.includes('mean') ||
    lower.includes('what does')
  ) {
    intents.push({
      intent: 'ASK_MEANING',
      confidence: 0.91,
      evidence: [`Meaning question marker in "${txt}"`],
    });
  }
  if (
    lower.includes('dịch') ||
    lower.includes('tiếng hàn là gì') ||
    lower.includes('tiếng anh là gì') ||
    lower.includes('how do you say') ||
    lower.includes('nói sao')
  ) {
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
  } else if (region.language === 'en' && /[A-Za-z]/.test(txt)) {
    const wordCount = txt.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 1 && !/[.!?]$/.test(txt)) {
      intents.push({
        intent: 'PRACTICE_VOCABULARY',
        confidence: 0.79,
        evidence: [`Single English word "${txt}"`],
      });
    } else if (intents.length === 0) {
      intents.push({
        intent: 'PRACTICE_SENTENCE',
        confidence: 0.84,
        evidence: [`Multi-word English sentence (${wordCount} tokens)`],
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
  practiceByRegionId: Record<string, {
    activityId: string;
    conceptId?: string;
    suppressedReason?: string;
  }>;
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
  semanticTree: WonderSemanticTree;
  retractedAnnotationIds: string[];
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
  previousTree?: WonderSemanticTree;
  nowMs?: number;
  writingCadenceMs?: number;
  provisionalWindowMs?: number;
}): WonderTutorResult {
  const {
    board,
    regions,
    context,
    existingAnnotations,
    existingTeachingCards,
    recordedEventKeys = new Set<string>(),
  } = params;

  const semanticTree = buildHierarchicalSemanticTree({
    boardId: board.id,
    revision: board.revision,
    strokes: board.strokes,
    regions,
    previousTree: params.previousTree ?? board.semanticTree,
    nowMs: params.nowMs,
    writingCadenceMs: params.writingCadenceMs,
    provisionalWindowMs: params.provisionalWindowMs,
  });
  const semReconciled = reconcileSemanticAnnotations(existingAnnotations, semanticTree);
  const activeExistingAnnotations = semReconciled.nextAnnotations;
  const retractedAnnotationIds = semReconciled.retractedAnnotationIds;

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
      practiceByRegionId: {},
      scheduledActions: [],
      deferredActions: board.deferredActions ?? [],
      annotationsToAdd: [],
      resolvedAnnotationIds: [],
      teachingCardsToAdd: [],
      hangulDemosToAdd: [],
      nextBeginnerLoop: board.beginnerLoop,
      newEvents: [],
      recommendedTeacherState: 'IDLE',
      semanticTree,
      retractedAnnotationIds: [],
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
  for (const prevAnn of activeExistingAnnotations) {
    if (prevAnn.status !== 'active') continue;
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
    ...activeExistingAnnotations.filter((a) => a.status === 'active').map((a) => a.note_geometry),
    ...existingTeachingCards.map((c) => c.geometry),
  ];

  // Track candidate annotations produced for multi-error Korean regions
  const annotationsToAdd: WonderAnnotation[] = [];
  const practiceByRegionId: WonderTutorResult['practiceByRegionId'] = {};
  const confirmedTargets = new Map<string, string>();
  const createdByStrokeId = new Map(board.strokes.map((stroke) => [stroke.id, stroke.createdAt]));
  for (const reg of regions) {
    const targets = context.relations.flatMap((relation) => {
      if (relation.fromRegionId !== reg.regionId || relation.relationType !== 'answer_to_ai_card') return [];
      const card = existingTeachingCards.find((item) => item.cardId === relation.toRegionId);
      return card?.practiceTarget && decomposeHangulUnit(card.practiceTarget) &&
        reg.strokeIds.length && reg.strokeIds.every((id) => (createdByStrokeId.get(id) ?? -1) >= card.createdAt)
        ? [card.practiceTarget.trim().normalize('NFC')] : [];
    });
    if (new Set(targets).size === 1 && reg.recognitionStatus === 'RECOGNIZED' &&
        reg.completeness === 'complete' && reg.confidence >= 0.85 && decomposeHangulUnit(reg.recognizedText)) {
      confirmedTargets.set(reg.regionId, targets[0]);
    }
  }
  const addPracticeNote = (input: {
    id: string;
    activityId: string;
    conceptId: string;
    region: WonderRecognitionRegion;
    text: string;
    strokeIds: string[];
    bbox: WonderBBox;
    start: number;
    end: number;
    header: string;
    explanation: string;
    error?: boolean;
  }) => {
    const { id, activityId, conceptId, region, text, strokeIds, bbox, start, end, header, explanation, error } = input;
    if (activeExistingAnnotations.some((a) => a.annotation_id === id && ['active', 'dismissed'].includes(a.status))) return;
    const { noteBox, placement, arrow } = computeCollisionFreePlacement({
      targetBox: bbox, desiredWidth: 220, desiredHeight: 96, occupiedBoxes,
    });
    occupiedBoxes.push(noteBox);
    annotationsToAdd.push({
      annotation_id: id, stable_key: id, cloud_seed: hashString(id),
      board_id: board.id, source_revision: region.revision, source_stroke_ids: strokeIds,
      recognized_text: region.recognizedText, target_text: text, target_span: { start, end },
      target_geometry: bbox, note_geometry: noteBox, arrow_path: arrow,
      annotation_type: error ? 'spelling_correction' : 'explanation',
      linguistic_category: 'hangul_shape', severity: error ? 'error' : 'info',
      granularity: decomposeHangulUnit(text) ? 'CHARACTER' : 'WORD',
      confidence: region.confidence, suggested_correction: header, explanation, hint: '',
      visual_style: { shape: error ? 'scalloped_cloud' : 'soft_bubble', accentColor: error ? theme.aiCorrectionHex : theme.aiSupportHex },
      placement_preference: placement, learning_concept_ids: [conceptId], teaching_activity_id: activityId,
      error_identity: error ? id : undefined,
      created_at: Date.now(), status: 'active', lifecycle_state: 'queued',
      animation_progress: { cloud: 0, arrow: 0, correction: 0, explanation: 0, completed: false },
    });
  };

  const activities = findWonderPracticeActivities(board, regions);
  for (const activity of activities) {
    if (activity.intent === 'UNKNOWN_PRACTICE_INTENT' && activity.occurrences.some(({ region }) =>
      semanticTree.nodes.find((n) => n.id === `sent_${region.regionId}`)
        ?.spacingHypotheses?.[0]?.spacingIssue === 'excessive_spaces')) continue;
    if (board.targetLanguage === 'en' && activity.occurrences[0].region.language !== 'en') continue;
    if (board.targetLanguage === 'ko' && activity.occurrences[0].region.language !== 'ko') continue;
    const correctOccurrences = activity.occurrences.filter(({ region, text }) =>
      !confirmedTargets.has(region.regionId) || confirmedTargets.get(region.regionId) === text.normalize('NFC'));
    const anchor = correctOccurrences[0];
    const conceptId = activity.conceptId;
    const teach = anchor && conceptId && correctOccurrences.length === activity.occurrences.length &&
      board.aiMode !== 'gentle' && guidanceLevel !== 'minimal';
    const explanation = activity.explanation ?? (anchor && (anchor.region.language === 'en'
      ? describeEnglishWordVi(anchor.text)
      : describeKoreanSyllableOrWordVi(anchor.text))?.explanation);
    const annotationId = `ann_practice_${activity.id}_${conceptId}`;
    const existingGroup = activeExistingAnnotations.some((a) => a.annotation_id === annotationId &&
      ['active', 'dismissed'].includes(a.status));
    for (const { region } of activity.occurrences) {
      intentsByRegionId[region.regionId] = [{
        intent: activity.intent, confidence: conceptId ? 0.9 : 0.5,
        evidence: ['Verified text occurrences and nearby writing cadence'],
      }];
      practiceByRegionId[region.regionId] = {
        activityId: activity.id, conceptId,
        suppressedReason: !conceptId ? 'UNKNOWN_PRACTICE_INTENT'
          : existingGroup || anchor?.region.regionId !== region.regionId ? 'SHARED_PRACTICE_CONCEPT'
          : !teach || !explanation ? 'PRACTICE_OBSERVATION' : undefined,
      };
    }
    const members = new Set(activity.occurrences.flatMap((item) => item.strokeIds));
    for (const ann of activeExistingAnnotations) {
      if ((!teach || ann.annotation_id !== annotationId) && ann.status === 'active' && ann.severity === 'info' &&
          ann.source_stroke_ids.length > 0 && ann.source_stroke_ids.every((id) => members.has(id)) &&
          (ann.teaching_activity_id === activity.id ||
            (ann.annotation_type === 'explanation' && activity.occurrences.some((item) => item.text === ann.target_text)))) {
        retractedAnnotationIds.push(ann.annotation_id);
      }
    }
    if (!teach || !explanation) continue;
    addPracticeNote({
      id: annotationId, activityId: activity.id, conceptId, region: anchor.region, text: anchor.text,
      strokeIds: anchor.strokeIds, bbox: anchor.bbox, start: anchor.startIndex, end: anchor.endIndex,
      header: [...new Set(activity.occurrences.map((item) => item.text))].join(' · '),
      explanation,
    });
  }

  for (const reg of regions) {
    const expected = confirmedTargets.get(reg.regionId);
    if (!expected) continue;
    const text = reg.recognizedText.trim().normalize('NFC');
    const existing = practiceByRegionId[reg.regionId];
    const identity = reg.recognitionId ?? JSON.stringify([board.id, [...reg.strokeIds].sort()]);
    const activityId = existing?.activityId ?? identity;
    const conceptId = `handwriting:${expected}`;
    intentsByRegionId[reg.regionId] = [{
      intent: 'HANDWRITING_IMPROVEMENT', confidence: reg.confidence,
      evidence: ['Response to an explicit writing target'],
    }, ...(intentsByRegionId[reg.regionId] ?? [])];
    practiceByRegionId[reg.regionId] = { activityId, conceptId,
      suppressedReason: expected === text ? 'EXPLICIT_TARGET_MATCH' : undefined };
    if (expected !== text) {
      addPracticeNote({
        id: `ann_practice_error_${identity}_${expected}_${text}`, activityId, conceptId,
        region: reg, text, strokeIds: reg.strokeIds, bbox: reg.bbox, start: 0, end: reg.recognizedText.length,
        header: expected,
        explanation: `Mục tiêu của bài luyện là ${expected}. ${describeKoreanSyllableOrWordVi(expected)?.explanation ?? ''}`.trim(),
        error: true,
      });
    }
  }

  for (const reg of regions) {
    if (practiceByRegionId[reg.regionId]) continue;
    const intents = classifyLearningIntents(reg, context, board);
    intentsByRegionId[reg.regionId] = intents;

    const sentenceNode = semanticTree.nodes.find((n) => n.id === `sent_${reg.regionId}`);
    const primaryIntent = intents[0];
    const granularity = sentenceNode
      ? selectInterventionGranularity(sentenceNode, board, primaryIntent?.intent)
      : undefined;

    const adjUnrecognized = regions.some(
      (r2) =>
        r2.regionId !== reg.regionId &&
        r2.completeness !== 'non_text' &&
        r2.recognitionStatus !== 'RECOGNIZED' &&
        Math.max(
          0,
          reg.bbox.minX - r2.bbox.maxX,
          r2.bbox.minX - reg.bbox.maxX
        ) <= Math.max(120, (sentenceNode?.localScalePx ?? 48) * 2.4) &&
        Math.max(
          0,
          reg.bbox.minY - r2.bbox.maxY,
          r2.bbox.minY - reg.bbox.maxY
        ) <= Math.max(90, (sentenceNode?.localScalePx ?? 48) * 1.4)
    );
    const isSingleCharWaitForAdjacent =
      granularity === 'CHARACTER' &&
      /^[\uAC00-\uD7A3]$/.test(reg.recognizedText.trim()) &&
      adjUnrecognized;

    if (
      reg.completeness === 'non_text' ||
      reg.completeness === 'in_progress' ||
      reg.completeness === 'low_confidence' ||
      reg.recognitionStatus !== 'RECOGNIZED' ||
      reg.confidence < 0.78 ||
      isSingleCharWaitForAdjacent ||
      granularity === 'SILENT_OBSERVE' ||
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

        const isEnglishTopic =
          board.targetLanguage === 'en' ||
          txt.toLowerCase().includes('tiếng anh') ||
          txt.toLowerCase().includes('english');
        const enTopicCard = isEnglishTopic ? buildEnglishDiscoveryCard(txt) : null;
        const isSelfIntro = topic === 'self_intro' || topic === 'hangul_basics';
        const phrase = enTopicCard
          ? enTopicCard.phrase
          : isSelfIntro
            ? '안녕하세요.'
            : topic === 'coffee'
              ? '커피 한 잔 주세요.'
              : '감사합니다.';
        const promptTemplate = enTopicCard ? enTopicCard.phrase : isSelfIntro ? '저는 ___ 이에요.' : phrase;
        const card: WonderTeachingCard = {
          cardId: `card_loop1_${board.id}_${reg.regionId}`,
          boardId: board.id,
          sourceRevision: reg.revision,
          geometry: noteBox,
          titleVi: enTopicCard
            ? 'Bước 1 — Giáo viên AI hướng dẫn tiếng Anh'
            : 'Bước 1 — Giáo viên AI hướng dẫn',
          koreanPhrase: phrase,
          ipa: enTopicCard ? enTopicCard.ipa : isSelfIntro ? '[annjʌŋhasejo]' : undefined,
          explanationVi: enTopicCard
            ? enTopicCard.explanation
            : isSelfIntro
              ? 'Bước 1: Xin chào là "안녕하세요". Bước 2: Thử viết câu giới thiệu: "저는 [tên bạn] 이에요/예요." ngay bên dưới nhé!'
              : `Mẫu câu khởi đầu: "${phrase}". Bạn hãy viết thử bên dưới để AI xem nhé.`,
          breakdown: enTopicCard
            ? enTopicCard.breakdown
            : isSelfIntro
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

        if (topic === 'hangul_basics' && !enTopicCard) {
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
    // Provide helpful explanation for standalone Korean words/syllables OR side-by-side practice items (e.g. "사 아").
    // Never treat spacing-decoded Case B/C words or multi-word sentences ("학 교 에", "저 는 한 국 어 를...") as independent isolated syllable lists.
    const topHyp = sentenceNode?.spacingHypotheses?.[0];
    const hasSpacingDecodedParent = Boolean(topHyp && topHyp.spacingIssue !== 'none');
    const isDecodedSingleMergedWord = Boolean(
      topHyp &&
        topHyp.spacingIssue === 'excessive_spaces' &&
        topHyp.tokens.length === 1 &&
        !/^[\uAC00-\uD7A3]$/.test(topHyp.tokens[0].replace(/[.!?]+$/, ''))
    );

    const isPracticeList =
      !hasSpacingDecodedParent &&
      reg.spans.length >= 2 &&
      !/[.!?]$/.test(txt.trim()) &&
      reg.spans.every((sp) => {
        const t = sp.text.trim();
        if (!/^[\uAC00-\uD7A3]{1,3}$/.test(t)) return false;
        if (
          t.length >= 2 &&
          /(요|다|니다|까요|세요|예요|이에요|은|는|이|가|을|를|에서|에)$/.test(t)
        ) {
          return false;
        }
        return true;
      });
    const EN_SENTENCE_MARKERS = new Set([
      'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'am', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did',
      'can', 'could', 'will', 'would', 'should', 'must', 'may', 'might',
      'the', 'a', 'an', 'and', 'but', 'or', 'to', 'in', 'on', 'at', 'for', 'yesterday',
    ]);
    const isEnglishPracticeList =
      reg.language === 'en' &&
      (board.targetLanguage ?? 'auto') !== 'ko' &&
      reg.spans.length >= 2 &&
      reg.spans.length <= 5 &&
      !/[.!?]$/.test(txt.trim()) &&
      reg.spans.every((sp) => {
        const cleanT = sp.text.trim();
        return /^[A-Za-z][A-Za-z'-]{1,20}$/.test(cleanT) && !EN_SENTENCE_MARKERS.has(cleanT.toLowerCase());
      });

    if (
      (((reg.language === 'ko' || reg.language === 'mixed') &&
        (board.targetLanguage ?? 'auto') !== 'en' &&
        (primaryIntent.intent === 'PRACTICE_VOCABULARY' || isPracticeList || isDecodedSingleMergedWord)) ||
        (reg.language === 'en' &&
          (board.targetLanguage ?? 'auto') !== 'ko' &&
          (primaryIntent.intent === 'PRACTICE_VOCABULARY' || isEnglishPracticeList))) &&
      (board.aiMode === 'tutor' || board.aiMode === 'discovery' || board.aiMode === 'review')
    ) {
      const mergedDisplayText = isDecodedSingleMergedWord
        ? topHyp!.proposedText
        : txt;
      const units =
        isDecodedSingleMergedWord || primaryIntent.intent === 'PRACTICE_VOCABULARY' || reg.spans.length <= 1
          ? [{ text: mergedDisplayText, bbox: reg.bbox, strokeIds: reg.strokeIds, spanStart: 0, spanEnd: txt.length }]
          : reg.spans.map((sp) => ({
              text: sp.text,
              bbox: sp.bbox,
              strokeIds: sp.strokeIds.length > 0 ? sp.strokeIds : reg.strokeIds,
              spanStart: sp.startIndex,
              spanEnd: sp.endIndex,
            }));

      for (let uIdx = 0; uIdx < units.length; uIdx++) {
        const unit = units[uIdx];
        const isUnitEn = reg.language === 'en' || (/^[A-Za-z][A-Za-z'-]*$/.test(unit.text.trim()) && !/[\uAC00-\uD7A3]/.test(unit.text));
        const desc = isUnitEn
          ? describeEnglishWordVi(unit.text)
          : describeKoreanSyllableOrWordVi(unit.text);
        if (!desc) continue;
        const dupWord =
          activeExistingAnnotations.some(
            (a) =>
              (a.status === 'active' || a.status === 'dismissed') &&
              a.target_text === unit.text &&
              a.source_stroke_ids.some((id) => unit.strokeIds.includes(id))
          ) ||
          annotationsToAdd.some(
            (a) =>
              a.target_text === unit.text &&
              a.source_stroke_ids.some((id) => unit.strokeIds.includes(id))
          );
        if (dupWord) continue;

        const isTall = unit.bbox.height > 120;
        const desiredWidth = Math.max(300, Math.min(460, Math.round(unit.bbox.height * 1.25)));
        const desiredHeight = Math.max(134, Math.min(220, Math.round(unit.bbox.height * 0.68)));
        const { noteBox, placement, arrow } = computeCollisionFreePlacement({
          targetBox: unit.bbox,
          desiredWidth,
          desiredHeight,
          preferredOrder: isTall
            ? ['right', 'left', 'above', 'below']
            : ['below', 'right', 'above', 'left'],
          occupiedBoxes,
        });
        occupiedBoxes.push(noteBox);
        const sortedRegIds = [...unit.strokeIds].sort().join('_');
        const stableStrokeHash = hashString(sortedRegIds || String(uIdx));
        annotationsToAdd.push({
          annotation_id: `ann_${board.id}_vocab_${unit.text}_${stableStrokeHash}`,
          stable_key: `${board.id}__explanation__vocabulary__${unit.text}__${[...unit.strokeIds].sort().join(',') || '0'}`,
          cloud_seed: hashString(unit.text) + 7 + uIdx,
          board_id: board.id,
          source_revision: reg.revision,
          source_stroke_ids: unit.strokeIds,
          recognized_text: txt,
          target_text: unit.text,
          target_span: { start: unit.spanStart, end: unit.spanEnd },
          target_geometry: unit.bbox,
          note_geometry: noteBox,
          arrow_path: arrow,
          annotation_type: 'explanation',
          linguistic_category: 'vocabulary',
          severity: 'info',
          granularity: isDecodedSingleMergedWord ? 'WORD' : granularity,
          parent_node_id: sentenceNode?.id,
          confidence: reg.confidence,
          suggested_correction: desc.header,
          explanation: desc.explanation,
          hint: desc.hint,
          visual_style: { shape: 'scalloped_cloud', accentColor: theme.aiSupportHex },
          placement_preference: placement,
          learning_concept_ids: ['kc_lexicon_hanja'],
          created_at: Date.now() + uIdx,
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
                activeExistingAnnotations.some(
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
                  granularity,
                  parent_node_id: sentenceNode?.id,
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
  const eligibleBaseRegions = regions.filter((r) => {
    if (practiceByRegionId[r.regionId]) return false;
    const sNode = semanticTree.nodes.find((n) => n.id === `sent_${r.regionId}`);
    if (!sNode) return true;
    const g = selectInterventionGranularity(sNode, board);
    return g !== 'SILENT_OBSERVE';
  });

  const basePed = analyzeBoardPedagogy({
    board,
    regions: eligibleBaseRegions,
    existingAnnotations: [...activeExistingAnnotations, ...annotationsToAdd],
    existingTeachingCards: [...existingTeachingCards, ...teachingCardsToAdd],
    theme,
  });

  // Annotate basePed outputs with semantic parent_node_id + granularity
  const sentenceNodes = semanticTree.nodes.filter((n) => n.level === 'sentence');
  const taggedBaseAnnotations = basePed.nextAnnotations.map((ann) => {
    const parentSn = sentenceNodes.find((sn) =>
      ann.source_stroke_ids.some((id) => sn.sourceStrokeIds.includes(id))
    );
    const derivedGranularity = parentSn
      ? selectInterventionGranularity(parentSn, board)
      : ann.granularity;
    return {
      ...ann,
      granularity: ann.granularity ?? derivedGranularity,
      parent_node_id: ann.parent_node_id ?? parentSn?.id,
    };
  });

  // Merge and strictly deduplicate across semantic identity + stroke overlap (P0.4)
  const dedupedAll = deduplicateWonderAnnotations([
    ...activeExistingAnnotations,
    ...annotationsToAdd,
    ...taggedBaseAnnotations,
  ]);
  const existingIdSet = new Set(activeExistingAnnotations.map((a) => a.annotation_id));
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

  // Cognitive-load gating: throttle strictly under beginner_friendly (max 1 concurrent error),
  // while guided/detailed modes display multi-sentence errors across the board up to batch cap.
  const budget = getActionBudgetForGuidance(guidanceLevel);
  const errorAndFeedbackAnns = combinedCandidates;
  const maxBatchErrors = Math.max(4, budget + 2);

  const scheduledAnns: WonderAnnotation[] = [];
  const deferredActions: WonderBoardAction[] = [...(board.deferredActions ?? [])].slice(-12);

  errorAndFeedbackAnns.forEach((ann, idx) => {
    const isDeferred =
      guidanceLevel === 'beginner_friendly' && idx >= 1 && ann.severity === 'error'
        ? true
        : idx >= maxBatchErrors && ann.severity === 'error';

    const action = makeValidatedAction({
      actionId: `act_${ann.annotation_id}`,
      boardId: board.id,
      type: ann.severity === 'praise' ? 'DRAW_CHECKMARK' : 'DRAW_CLOUD',
      sourceRegionIds: regions.filter((region) =>
        ann.source_stroke_ids.some((id) => region.strokeIds.includes(id))).map((region) => region.regionId),
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
        : activeExistingAnnotations.some(
              (a) => a.status === 'active' && !resolvedAnnotationIds.includes(a.annotation_id)
            )
          ? 'WAITING_FOR_LEARNER'
          : 'OBSERVING';

  return {
    intentsByRegionId,
    practiceByRegionId,
    scheduledActions: allCandidateActions.filter((a) => a.status === 'scheduled'),
    deferredActions: deferredActions.slice(-12),
    annotationsToAdd: scheduledAnns,
    resolvedAnnotationIds,
    teachingCardsToAdd,
    hangulDemosToAdd,
    nextBeginnerLoop,
    newEvents,
    recommendedTeacherState,
    semanticTree,
    retractedAnnotationIds,
  };
}

/**
 * Validates and converts a structured Section 10 spatial teaching action (or SSE streamed action)
 * into a collision-free Layer 4 WonderAnnotation anchored to verified strokes on the board.
 * Drops invalid schemas, WAIT actions, or stale revisions automatically.
 */
export function mapSpatialTeachingActionToAnnotation(params: {
  rawAction: unknown;
  boardId: string;
  currentRevision: number;
  regions: WonderRecognitionRegion[];
  occupiedBoxes: WonderBBox[];
  themeId: WonderBoardDocument['themeId'];
  seedIndex?: number;
}): {
  status: 'APPLIED' | 'WAIT' | 'RETRACT' | 'REJECTED_INVALID' | 'REJECTED_STALE' | 'REJECTED_UNANCHORED';
  annotation?: WonderAnnotation;
  retractRegionId?: string;
} {
  const parsed = WonderSpatialTeachingActionSchema.safeParse(params.rawAction);
  if (!parsed.success) {
    return { status: 'REJECTED_INVALID' };
  }
  const act: WonderSpatialTeachingAction = parsed.data;
  if (act.sourceRevision > 0 && act.sourceRevision !== params.currentRevision) {
    return { status: 'REJECTED_STALE' };
  }
  if (act.type === 'WAIT') {
    return { status: 'WAIT' };
  }
  if (act.type === 'RETRACT_ANNOTATION') {
    return { status: 'RETRACT', retractRegionId: act.regionId };
  }

  const matchedRegion = params.regions.find((r) => r.regionId === act.regionId);
  if (!matchedRegion) {
    return { status: 'REJECTED_UNANCHORED' };
  }

  const cleanTarget = act.targetText.trim() || matchedRegion.recognizedText.trim();
  if (!cleanTarget || !matchedRegion.recognizedText.includes(cleanTarget)) {
    return { status: 'REJECTED_UNANCHORED' };
  }

  const matchingSpans = matchedRegion.spans.filter((sp) => sp.text.includes(cleanTarget));
  if (matchingSpans.length !== 1 && matchedRegion.recognizedText.trim() !== cleanTarget) {
    return { status: 'REJECTED_UNANCHORED' };
  }
  const matchedSpan = matchingSpans.length === 1 ? matchingSpans[0] : undefined;
  const targetBox = matchedSpan?.bbox ?? matchedRegion.bbox;
  const strokeIds =
    matchedSpan?.strokeIds && matchedSpan.strokeIds.length > 0
      ? matchedSpan.strokeIds
      : matchedRegion.strokeIds;
  if (strokeIds.length === 0) {
    return { status: 'REJECTED_UNANCHORED' };
  }

  const theme = WONDER_BOARD_THEMES[params.themeId];
  const isError = act.type === 'MARK_GRAMMAR_ERROR' || act.type === 'WRITE_CORRECTION';
  const isPraise = act.type === 'PRAISE';
  const isHint = act.type === 'PROVIDE_HINT';
  const severity: WonderAnnotation['severity'] = isError
    ? 'error'
    : isPraise
      ? 'praise'
      : isHint
        ? 'gentle'
        : 'info';
  const accentColor = isError
    ? theme.aiCorrectionHex
    : isPraise
      ? theme.aiPositiveHex
      : isHint
        ? theme.aiSuggestionHex
        : theme.aiSupportHex;

  const estLines = Math.max(2, Math.ceil((act.explanation.length + 24) / 28));
  const noteW = Math.min(310, Math.max(200, targetBox.width + 44));
  const noteH = Math.min(185, 48 + estLines * 17);
  const placement = computeCollisionFreePlacement({
    targetBox,
    desiredWidth: noteW,
    desiredHeight: noteH,
    preferredOrder: [act.anchorHint, 'below', 'right', 'above', 'left'],
    occupiedBoxes: params.occupiedBoxes,
  });
  params.occupiedBoxes.push(placement.noteBox);

  const stableKey = `spatial_${act.type}_${matchedRegion.regionId}_${cleanTarget}`;
  const annotation: WonderAnnotation = {
    annotation_id: `sp_${act.actionId}_${params.currentRevision}_${params.seedIndex ?? 0}`,
    stable_key: stableKey,
    cloud_seed: hashString(stableKey) % 10000,
    board_id: params.boardId,
    source_revision: params.currentRevision,
    source_stroke_ids: strokeIds,
    recognized_text: matchedRegion.recognizedText,
    target_text: cleanTarget.slice(0, 120),
    target_span: {
      start: matchedSpan?.startIndex ?? 0,
      end: matchedSpan?.endIndex ?? cleanTarget.length,
    },
    target_geometry: targetBox,
    note_geometry: placement.noteBox,
    arrow_path: placement.arrow,
    annotation_type: isError
      ? 'grammar_correction'
      : isPraise
        ? 'positive_feedback'
        : isHint
          ? 'hint'
          : 'explanation',
    linguistic_category: act.semanticTarget === 'character' ? 'hangul_shape' : 'naturalness',
    severity,
    confidence: act.confidence,
    suggested_correction: act.suggestedCorrection.slice(0, 200),
    explanation: (act.explanation || act.hint || cleanTarget).slice(0, 580),
    hint: act.hint.slice(0, 280),
    visual_style: {
      shape: isPraise ? 'chalk_tick' : 'scalloped_cloud',
      accentColor,
    },
    placement_preference: placement.placement,
    learning_concept_ids: [`wonder:${matchedRegion.language}:${act.semanticTarget}`],
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
    reconciliation_action: 'ADDED',
    granularity:
      act.semanticTarget === 'character' || act.semanticTarget === 'syllable'
        ? 'CHARACTER'
        : act.semanticTarget === 'word'
          ? 'WORD'
          : 'SENTENCE',
  };

  const valid = WonderAnnotationSchema.safeParse(annotation);
  if (!valid.success) {
    return { status: 'REJECTED_INVALID' };
  }
  return { status: 'APPLIED', annotation };
}
