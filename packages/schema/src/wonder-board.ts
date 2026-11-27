import { z } from 'zod';

// ---------------------------------------------------------------------------
// Layer 1 — Canvas Themes, Viewport & Board Metadata
// ---------------------------------------------------------------------------

export type WonderBoardThemeId =
  | 'cozy-green-chalkboard'
  | 'classic-dark-chalkboard'
  | 'soft-cream-whiteboard'
  | 'lavender-dream'
  | 'pastel-mint';

export interface WonderThemeTokens {
  id: WonderBoardThemeId;
  label: string;
  isDark: boolean;
  backgroundHex: string;
  chalkDustHex: string;
  primaryInkHex: string;
  secondaryInkHex: string;
  palette: string[];
  aiCorrectionHex: string;
  aiSuggestionHex: string;
  aiPositiveHex: string;
  aiSupportHex: string;
  noteSurfaceHex: string;
  noteBorderHex: string;
  uiSurfaceHex: string;
  uiTextHex: string;
}

export const WONDER_BOARD_THEMES: Record<WonderBoardThemeId, WonderThemeTokens> = {
  'cozy-green-chalkboard': {
    id: 'cozy-green-chalkboard',
    label: 'Cozy Green Chalkboard',
    isDark: true,
    backgroundHex: '#1E352B',
    chalkDustHex: 'rgba(249, 246, 236, 0.045)',
    primaryInkHex: '#F9F6EC',
    secondaryInkHex: '#D7E2D8',
    palette: ['#F9F6EC', '#FFE699', '#FFB5C2', '#A8E6CF', '#A9DEF9', '#E0BBE4'],
    aiCorrectionHex: '#FFB5C2',
    aiSuggestionHex: '#FFE699',
    aiPositiveHex: '#A8E6CF',
    aiSupportHex: '#A9DEF9',
    noteSurfaceHex: 'rgba(24, 42, 34, 0.94)',
    noteBorderHex: '#476A59',
    uiSurfaceHex: 'rgba(255, 252, 245, 0.95)',
    uiTextHex: '#25332C',
  },
  'classic-dark-chalkboard': {
    id: 'classic-dark-chalkboard',
    label: 'Classic Dark Chalkboard',
    isDark: true,
    backgroundHex: '#23272A',
    chalkDustHex: 'rgba(244, 245, 247, 0.04)',
    primaryInkHex: '#F4F5F7',
    secondaryInkHex: '#C9CED6',
    palette: ['#F4F5F7', '#FFE08A', '#FFA8B8', '#9CE5C0', '#9BD2F5', '#D6B8FF'],
    aiCorrectionHex: '#FFA8B8',
    aiSuggestionHex: '#FFE08A',
    aiPositiveHex: '#9CE5C0',
    aiSupportHex: '#9BD2F5',
    noteSurfaceHex: 'rgba(30, 34, 38, 0.94)',
    noteBorderHex: '#4E565E',
    uiSurfaceHex: 'rgba(250, 250, 252, 0.95)',
    uiTextHex: '#23272A',
  },
  'soft-cream-whiteboard': {
    id: 'soft-cream-whiteboard',
    label: 'Màu Be Ấm (Mặc định)',
    isDark: false,
    backgroundHex: '#F5EFE6',
    chalkDustHex: 'rgba(176, 137, 104, 0.06)',
    primaryInkHex: '#2C221E',
    secondaryInkHex: '#6E5A4F',
    palette: ['#2C221E', '#2F734B', '#C84B64', '#B57416', '#2E6699', '#6D5496'],
    aiCorrectionHex: '#C84B64',
    aiSuggestionHex: '#B57416',
    aiPositiveHex: '#2F734B',
    aiSupportHex: '#2E6699',
    noteSurfaceHex: '#FFFDF9',
    noteBorderHex: '#DFD2C0',
    uiSurfaceHex: '#FFFFFF',
    uiTextHex: '#2C221E',
  },
  'lavender-dream': {
    id: 'lavender-dream',
    label: 'Lavender Dream',
    isDark: true,
    backgroundHex: '#2B253A',
    chalkDustHex: 'rgba(246, 242, 255, 0.04)',
    primaryInkHex: '#F6F2FF',
    secondaryInkHex: '#D8CFF0',
    palette: ['#F6F2FF', '#FFE6A7', '#FFB3D1', '#A7E8CC', '#AED6FF', '#E5C3FF'],
    aiCorrectionHex: '#FFB3D1',
    aiSuggestionHex: '#FFE6A7',
    aiPositiveHex: '#A7E8CC',
    aiSupportHex: '#AED6FF',
    noteSurfaceHex: 'rgba(38, 33, 52, 0.94)',
    noteBorderHex: '#5D527A',
    uiSurfaceHex: 'rgba(252, 249, 255, 0.95)',
    uiTextHex: '#2B253A',
  },
  'pastel-mint': {
    id: 'pastel-mint',
    label: 'Pastel Mint',
    isDark: true,
    backgroundHex: '#213B39',
    chalkDustHex: 'rgba(244, 251, 248, 0.04)',
    primaryInkHex: '#F4FBF8',
    secondaryInkHex: '#CAE5DF',
    palette: ['#F4FBF8', '#FFE89E', '#FFB8C6', '#A8ECCB', '#A6DDF5', '#E8C5F2'],
    aiCorrectionHex: '#FFB8C6',
    aiSuggestionHex: '#FFE89E',
    aiPositiveHex: '#A8ECCB',
    aiSupportHex: '#A6DDF5',
    noteSurfaceHex: 'rgba(28, 52, 50, 0.94)',
    noteBorderHex: '#4C7A75',
    uiSurfaceHex: 'rgba(248, 253, 251, 0.95)',
    uiTextHex: '#213B39',
  },
};

export interface WonderViewport {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type WonderAiMode = 'gentle' | 'tutor' | 'discovery' | 'focus' | 'review';

export type WonderTeacherState =
  | 'OBSERVING'
  | 'RECOGNIZING'
  | 'WAITING_FOR_CONTEXT'
  | 'ANALYZING'
  | 'PLANNING_FEEDBACK'
  | 'DRAWING_CLOUD'
  | 'DRAWING_ARROW'
  | 'WRITING_CORRECTION'
  | 'WRITING_EXPLANATION'
  | 'WAITING_FOR_LEARNER'
  | 'REASSESSING'
  | 'IDLE';

export type WonderAnimationSpeed = 'slow' | 'natural' | 'fast' | 'instant';

export type WonderStrokeProvenance =
  | 'freehand_ink'
  | 'typed_vector'
  | 'fixture_sample'
  | 'user_confirmed'
  | 'ai_teaching'
  | 'imported';

export type WonderGuidanceLevel =
  | 'minimal'
  | 'guided'
  | 'detailed'
  | 'beginner_friendly';

export type WonderLearningIntentType =
  | 'FREE_PRACTICE'
  | 'ASK_TRANSLATION'
  | 'ASK_GRAMMAR'
  | 'ASK_MEANING'
  | 'ASK_PRONUNCIATION'
  | 'ASK_HOW_TO_WRITE'
  | 'LEARN_NEW_TOPIC'
  | 'PRACTICE_HANGUL'
  | 'PRACTICE_VOCABULARY'
  | 'PRACTICE_SENTENCE'
  | 'SELF_CORRECTION'
  | 'ANSWER_AI_EXERCISE'
  | 'FREE_DRAWING'
  | 'UNKNOWN_INTENT';

export interface WonderDetectedIntent {
  intent: WonderLearningIntentType;
  confidence: number;
  evidence: string[];
  topic?: string;
}

export type WonderRegionRelationType =
  | 'continuation_below'
  | 'marginal_note'
  | 'self_correction_candidate'
  | 'answer_to_ai_card'
  | 'linked_by_arrow'
  | 'independent';

export interface WonderRegionRelation {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  relationType: WonderRegionRelationType;
  confidence: number;
  evidence: string[];
}

export interface WonderBoardContext {
  boardId: string;
  revision: number;
  relations: WonderRegionRelation[];
  updatedAt: number;
}

export interface WonderCropTransform {
  worldMinX: number;
  worldMinY: number;
  worldWidth: number;
  worldHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  scale: number;
}

export const WonderVisionWordSchema = z.object({
  text: z.string().min(1).max(120),
  bboxNorm: z.object({
    x0: z.number().min(0).max(1),
    y0: z.number().min(0).max(1),
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
  }),
  confidence: z.number().min(0).max(1),
});

export const WonderVisionRecognitionResponseSchema = z.object({
  recognizedText: z.string().max(400),
  language: z.enum(['ko', 'vi', 'en', 'mixed', 'unknown']),
  recognitionStatus: z.enum([
    'RECOGNIZED',
    'PARTIALLY_RECOGNIZED',
    'IN_PROGRESS',
    'AMBIGUOUS',
    'NON_TEXT',
    'UNSUPPORTED',
    'PROVIDER_UNAVAILABLE',
  ]),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(z.string().max(400)).max(6).default([]),
  words: z.array(WonderVisionWordSchema).max(60).default([]),
});

export type WonderVisionRecognitionResponse = z.infer<
  typeof WonderVisionRecognitionResponseSchema
>;

export type WonderBoardActionType =
  | 'DRAW_CLOUD'
  | 'DRAW_ARROW'
  | 'WRITE_CORRECTION'
  | 'WRITE_EXPLANATION'
  | 'WRITE_EXAMPLE'
  | 'CREATE_TRACE_GUIDE'
  | 'DRAW_CHECKMARK'
  | 'CREATE_PRACTICE_PROMPT'
  | 'ASK_LEARNER'
  | 'REMOVE_AI_ANNOTATION'
  | 'UPDATE_AI_ANNOTATION'
  | 'WAIT';

export const WonderBoardActionSchema = z.object({
  actionId: z.string().min(1),
  boardId: z.string().min(1),
  type: z.enum([
    'DRAW_CLOUD',
    'DRAW_ARROW',
    'WRITE_CORRECTION',
    'WRITE_EXPLANATION',
    'WRITE_EXAMPLE',
    'CREATE_TRACE_GUIDE',
    'DRAW_CHECKMARK',
    'CREATE_PRACTICE_PROMPT',
    'ASK_LEARNER',
    'REMOVE_AI_ANNOTATION',
    'UPDATE_AI_ANNOTATION',
    'WAIT',
  ]),
  sourceRegionIds: z.array(z.string()),
  sourceRevision: z.number().int().nonnegative(),
  targetSemanticSpan: z.object({
    text: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  targetStrokeAnchors: z.array(z.string()),
  content: z.string().max(600),
  educationalPurpose: z.string().min(1).max(240),
  confidence: z.number().min(0).max(1),
  visualStyleToken: z.string().min(1).max(64),
  priority: z.number().int().min(1).max(10),
  dependencies: z.array(z.string()),
  expirationCondition: z.string().max(200),
  status: z.enum(['scheduled', 'completed', 'deferred', 'dismissed', 'expired']),
});

export type WonderBoardAction = z.infer<typeof WonderBoardActionSchema>;

export interface WonderHangulDemoStroke {
  index: number;
  jamo: string;
  points: Array<{ x: number; y: number }>;
  directionLabel: string;
}

export interface WonderHangulDemoSpec {
  demoId: string;
  text: string;
  geometry: WonderBBox;
  strokes: WonderHangulDemoStroke[];
  scopeNote: string;
}

export interface WonderBeginnerLoopState {
  active: boolean;
  topic: 'self_intro' | 'greetings' | 'coffee' | 'hangul_basics';
  stepIndex: number;
  expectedPromptKo: string;
  lastStepRegionId?: string;
  completedSteps: number[];
}

// ---------------------------------------------------------------------------
// Layer 2 — Original User Ink (Immutable source of truth)
// ---------------------------------------------------------------------------

export type WonderToolType =
  | 'chalk'
  | 'pencil'
  | 'highlighter'
  | 'eraser_pixel'
  | 'eraser_stroke'
  | 'lasso'
  | 'ai_lasso'
  | 'pan';

export interface WonderStrokePoint {
  x: number;
  y: number;
  pressure: number; // 0..1
  tiltX?: number;
  tiltY?: number;
  t: number; // ms relative or epoch
}

export interface WonderBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface WonderStroke {
  id: string;
  boardId: string;
  points: WonderStrokePoint[];
  color: string;
  width: number;
  tool: 'chalk' | 'pencil' | 'highlighter' | 'eraser_pixel';
  bbox: WonderBBox;
  transform: { dx: number; dy: number };
  revision: number;
  createdAt: number;
  deleted?: boolean;
  provenance?: WonderStrokeProvenance;
  /** Optional semantic hint stored only for typed text / test fixtures */
  fixtureHintText?: string;
}

// ---------------------------------------------------------------------------
// Layer 3 — Semantic Recognition (Derived, hidden by default)
// ---------------------------------------------------------------------------

export type WonderLanguage = 'ko' | 'vi' | 'en' | 'mixed' | 'unknown';
export type WonderCompleteness = 'complete' | 'in_progress' | 'non_text' | 'low_confidence';

export type WonderRecognitionStatus =
  | 'RECOGNIZED'
  | 'PARTIALLY_RECOGNIZED'
  | 'IN_PROGRESS'
  | 'AMBIGUOUS'
  | 'NON_TEXT'
  | 'UNSUPPORTED'
  | 'PROVIDER_UNAVAILABLE';

export interface WonderRecognitionSpan {
  text: string;
  startIndex: number;
  endIndex: number;
  strokeIds: string[];
  bbox: WonderBBox;
  confidence: number;
}

export interface WonderRecognitionRegion {
  regionId: string;
  boardId: string;
  revision: number;
  contentRevision: number;
  geometryRevision: number;
  semanticRevision: number;
  strokeIds: string[];
  bbox: WonderBBox;
  recognizedText: string;
  language: WonderLanguage;
  confidence: number;
  completeness: WonderCompleteness;
  recognitionStatus: WonderRecognitionStatus;
  provenance: WonderStrokeProvenance;
  alternativeCandidates: string[];
  spans: WonderRecognitionSpan[];
  characterSpans: WonderRecognitionSpan[];
  providerId: string;
  recognizedAt: number;
}

// ---------------------------------------------------------------------------
// Layer 4 — AI Annotations (Structured & Zod-Validated)
// ---------------------------------------------------------------------------

export type WonderAnnotationType =
  | 'grammar_correction'
  | 'particle_correction'
  | 'spelling_correction'
  | 'positive_feedback'
  | 'hint'
  | 'explanation'
  | 'ambiguity_check';

export type WonderLinguisticCategory =
  | 'tense'
  | 'particle'
  | 'batchim'
  | 'honorifics'
  | 'spelling'
  | 'vocabulary'
  | 'naturalness'
  | 'hangul_shape'
  | 'beginner_intent';

export type WonderPlacementPreference = 'below' | 'above' | 'right' | 'left';

export interface WonderArrowPath {
  fromX: number;
  fromY: number;
  ctrlX: number;
  ctrlY: number;
  toX: number;
  toY: number;
}

export type WonderAnnotationLifecycleState =
  | 'pending'
  | 'queued'
  | 'drawing_cloud'
  | 'drawing_arrow'
  | 'writing_correction'
  | 'writing_explanation'
  | 'completed'
  | 'paused'
  | 'cancelled'
  | 'stale';

export type WonderReconciliationAction =
  | 'ADDED'
  | 'UNCHANGED'
  | 'GEOMETRY_UPDATED'
  | 'SEMANTIC_UPDATED'
  | 'INVALIDATED'
  | 'RESOLVED'
  | 'SUPERSEDED'
  | 'DISMISSED';

export interface WonderAnimationProgress {
  cloud: number;
  arrow: number;
  correction: number;
  explanation: number;
  completed: boolean;
}

export interface WonderAnnotation {
  annotation_id: string;
  stable_key: string;
  cloud_seed: number;
  board_id: string;
  source_revision: number;
  source_stroke_ids: string[];
  recognized_text: string;
  target_text: string;
  target_span: { start: number; end: number };
  target_geometry: WonderBBox;
  note_geometry: WonderBBox;
  arrow_path: WonderArrowPath;
  annotation_type: WonderAnnotationType;
  linguistic_category: WonderLinguisticCategory;
  severity: 'info' | 'gentle' | 'error' | 'praise';
  confidence: number;
  suggested_correction: string;
  explanation: string;
  hint: string;
  practice_exercise?: {
    promptVi: string;
    expectedKo: string;
  };
  visual_style: {
    shape: 'scalloped_cloud' | 'soft_bubble' | 'chalk_tick';
    accentColor: string;
    strokeDash?: number[];
  };
  placement_preference: WonderPlacementPreference;
  learning_concept_ids: string[];
  created_at: number;
  status: 'active' | 'resolved' | 'dismissed' | 'stale';
  lifecycle_state: WonderAnnotationLifecycleState;
  animation_progress: WonderAnimationProgress;
  reconciliation_action?: WonderReconciliationAction;
}

export const WonderBBoxSchema = z.object({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const WonderAnnotationSchema = z.object({
  annotation_id: z.string().min(1),
  stable_key: z.string().min(1).optional(),
  cloud_seed: z.number().finite().optional(),
  board_id: z.string().min(1),
  source_revision: z.number().int().nonnegative(),
  source_stroke_ids: z.array(z.string().min(1)).min(1),
  recognized_text: z.string().min(1).max(300),
  target_text: z.string().min(1).max(120),
  target_span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  target_geometry: WonderBBoxSchema,
  note_geometry: WonderBBoxSchema,
  arrow_path: z.object({
    fromX: z.number().finite(),
    fromY: z.number().finite(),
    ctrlX: z.number().finite(),
    ctrlY: z.number().finite(),
    toX: z.number().finite(),
    toY: z.number().finite(),
  }),
  annotation_type: z.enum([
    'grammar_correction',
    'particle_correction',
    'spelling_correction',
    'positive_feedback',
    'hint',
    'explanation',
    'ambiguity_check',
  ]),
  linguistic_category: z.enum([
    'tense',
    'particle',
    'batchim',
    'honorifics',
    'spelling',
    'vocabulary',
    'naturalness',
    'hangul_shape',
    'beginner_intent',
  ]),
  severity: z.enum(['info', 'gentle', 'error', 'praise']),
  confidence: z.number().min(0).max(1),
  suggested_correction: z.string().max(200),
  explanation: z.string().min(1).max(600),
  hint: z.string().max(300),
  practice_exercise: z
    .object({
      promptVi: z.string().min(1).max(240),
      expectedKo: z.string().min(1).max(160),
    })
    .optional(),
  visual_style: z.object({
    shape: z.enum(['scalloped_cloud', 'soft_bubble', 'chalk_tick']),
    accentColor: z.string().min(4).max(32),
    strokeDash: z.array(z.number().positive()).optional(),
  }),
  placement_preference: z.enum(['below', 'above', 'right', 'left']),
  learning_concept_ids: z.array(z.string()),
  created_at: z.number().finite(),
  status: z.enum(['active', 'resolved', 'dismissed', 'stale']),
  lifecycle_state: z
    .enum([
      'pending',
      'queued',
      'drawing_cloud',
      'drawing_arrow',
      'writing_correction',
      'writing_explanation',
      'completed',
      'paused',
      'cancelled',
      'stale',
    ])
    .optional(),
  animation_progress: z
    .object({
      cloud: z.number().min(0).max(1),
      arrow: z.number().min(0).max(1),
      correction: z.number().min(0).max(1),
      explanation: z.number().min(0).max(1),
      completed: z.boolean(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Layer 5 — AI Teaching Content
// ---------------------------------------------------------------------------

export interface WonderTeachingCard {
  cardId: string;
  boardId: string;
  sourceRevision: number;
  geometry: WonderBBox;
  titleVi: string;
  koreanPhrase: string;
  ipa?: string;
  explanationVi: string;
  breakdown: Array<{ token: string; meaningVi: string }>;
  ghostHandwritingText?: string;
  ghostBBox?: WonderBBox;
  learningConceptIds: string[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Layer 6 — Gesture Actions, Telemetry & Adaptive Events
// ---------------------------------------------------------------------------

export type WonderGestureIntent =
  | 'explain'
  | 'translate'
  | 'grammar_check'
  | 'example'
  | 'trace_guide'
  | 'practice_exercise';

export type WonderLearningEventType =
  | 'concept_encountered'
  | 'grammar_error_observed'
  | 'hint_requested'
  | 'correction_attempted'
  | 'self_correction_completed'
  | 'repeated_error'
  | 'successful_independent_usage'
  | 'exercise_completed'
  | 'recognition_uncertainty';

export interface WonderLearningEvent {
  eventId: string;
  boardId: string;
  eventType: WonderLearningEventType;
  conceptIds: string[];
  recognizedText: string;
  confirmed: boolean;
  timestamp: number;
  idempotencyKey?: string;
  evidenceKind?:
    | 'answer_provided'
    | 'copied_answer'
    | 'guided_self_correction'
    | 'independent_usage'
    | 'exposure';
  linkedAnnotationId?: string;
}

export interface WonderTelemetryMetrics {
  lastRenderFrameMs: number;
  lastRecognitionLatencyMs: number;
  lastAiLatencyMs: number;
  lastSegmentationMs?: number;
  lastLocalRecognitionMs?: number;
  lastCloudRecognitionMs?: number;
  lastLinguisticAnalysisMs?: number;
  lastQueueWaitMs?: number;
  lastCloudAnimDurationMs?: number;
  lastTextRevealDurationMs?: number;
  lastTotalTimeToFeedbackMs?: number;
  apiCallCount: number;
  estimatedTokens: number;
  errorCount: number;
  timeoutCount: number;
}

export interface WonderBoardDocument {
  id: string;
  title: string;
  themeId: WonderBoardThemeId;
  aiEnabled: boolean;
  aiMode: WonderAiMode;
  guidanceLevel?: WonderGuidanceLevel;
  teacherState: WonderTeacherState;
  animationSpeed: WonderAnimationSpeed;
  chalkCursorEnabled: boolean;
  showAnnotations: boolean;
  chalkTextureEnabled: boolean;
  viewport: WonderViewport;
  revision: number;
  strokes: WonderStroke[];
  redoStack: WonderStroke[];
  regions: WonderRecognitionRegion[];
  annotations: WonderAnnotation[];
  teachingCards: WonderTeachingCard[];
  boardContext?: WonderBoardContext;
  beginnerLoop?: WonderBeginnerLoopState;
  hangulDemos?: WonderHangulDemoSpec[];
  deferredActions?: WonderBoardAction[];
  recordedEventKeys?: string[];
  events: WonderLearningEvent[];
  telemetry: WonderTelemetryMetrics;
  createdAt: number;
  updatedAt: number;
}

export const WonderRecognitionDiagnosticEntrySchema = z.object({
  regionId: z.string(),
  sourceRevision: z.number().int(),
  providerId: z.string(),
  engineVersion: z.string(),
  recognitionStatus: WonderVisionRecognitionResponseSchema.shape.recognitionStatus,
  recognizedText: z.string(),
  confidence: z.number().min(0).max(1),
  candidateAlternatives: z.array(z.string()),
  providerLatencyMs: z.number().nonnegative(),
  fallbackReason: z.string(),
  mappingStatus: z.enum([
    'VERIFIED_STROKE_CLUSTERS',
    'PROPORTIONAL_CLUSTER_FALLBACK',
    'UNMAPPED',
  ]),
  timestamp: z.number(),
});

export type WonderRecognitionDiagnosticEntry = z.infer<
  typeof WonderRecognitionDiagnosticEntrySchema
>;
