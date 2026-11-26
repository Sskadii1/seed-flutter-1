import { z } from 'zod';
import roadmapJson from '../../../content/curriculum-roadmap.json';
import unit0Json from '../../../content/unit-0-hangul.json';
import unit1Json from '../../../content/unit-1-greetings.json';

// ---------------------------------------------------------------------------
// Core Curriculum & Exercise Types
// ---------------------------------------------------------------------------

export type MasteryStage = 1 | 2 | 3 | 4;
export type FsrsGrade = 1 | 2 | 3 | 4; // 1: Again, 2: Hard, 3: Good, 4: Easy

export type ExerciseType =
  | 'hvpt_minimal_pair'
  | 'syllable_builder'
  | 'vocab_mcq'
  | 'context_cloze'
  | 'particle_contrast'
  | 'sentence_scramble'
  | 'ime_typing_recall'
  | 'audio_dictation'
  | 'shadowing_speak'
  | 'guided_personal_output';

export type SpeakerId =
  | 'female_seoul_1'
  | 'male_seoul_1'
  | 'female_seoul_2'
  | 'male_busan_1';

export type SpeakingRate = 'slow' | 'normal' | 'fast';

export interface HanjaInfo {
  characters: string;
  hanViet: string;
  note: string;
}

export interface VocabItem {
  id: string;
  hangul: string;
  ipa: string;
  meaningVi: string;
  pos: string;
  hasBatchim: boolean;
  hanja: HanjaInfo | null;
  audioKey: string;
}

export interface GrammarPoint {
  id: string;
  pattern: string;
  meaningVi: string;
  explicitRuleVi: string;
  vietnameseL1Trap: string;
  examples?: Array<{ ko: string; vi: string }>;
}

export interface ExplicitRule {
  title: string;
  summaryVi: string;
  vietnameseTrap: string;
}

export interface BaseExercise {
  id: string;
  stage: MasteryStage;
  type: ExerciseType;
  promptVi: string;
  targetVocabIds?: string[];
  targetGrammarIds?: string[];
  promptHint: string;
  explicitExplanation: string;
}

export interface HvptMinimalPairExercise extends BaseExercise {
  type: 'hvpt_minimal_pair';
  contrastCategory: '3way_stop' | 'vowel_pair' | 'batchim_nl' | 'liaison';
  audioVariants: Array<{
    speakerId: SpeakerId;
    rate: SpeakingRate;
    audioKey: string;
  }>;
  targetOptionId: string;
  options: Array<{
    id: string;
    hangul: string;
    ipa: string;
    meaningVi: string;
  }>;
}

export interface SyllableBuilderExercise extends BaseExercise {
  type: 'syllable_builder';
  availableJamo: string[];
  expectedSyllable: string;
}

export interface VocabMcqExercise extends BaseExercise {
  type: 'vocab_mcq';
  audioKey?: string;
  targetOptionId: string;
  options: Array<{ id: string; text: string }>;
}

export interface ContextClozeExercise extends BaseExercise {
  type: 'context_cloze';
  targetOptionId: string;
  options: Array<{ id: string; text: string }>;
}

export interface ParticleContrastExercise extends BaseExercise {
  type: 'particle_contrast';
  expectedPair: [string, string];
  options: Array<{
    id: string;
    pair: [string, string];
    label: string;
  }>;
}

export interface SentenceScrambleExercise extends BaseExercise {
  type: 'sentence_scramble';
  tokens: string[];
  expectedSequence: string[];
}

export interface ImeTypingRecallExercise extends BaseExercise {
  type: 'ime_typing_recall';
  expectedAnswers: string[];
}

export interface AudioDictationExercise extends BaseExercise {
  type: 'audio_dictation';
  audioKey: string;
  expectedAnswers: string[];
}

export interface ShadowingSpeakExercise extends BaseExercise {
  type: 'shadowing_speak';
  referenceAudioKey: string;
  targetText: string;
}

export interface GuidedPersonalOutputExercise extends BaseExercise {
  type: 'guided_personal_output';
  templateHint: string;
  validationRules: {
    mustIncludeAny: string[];
    mustIncludeTopicParticle: boolean;
  };
}

export type Exercise =
  | HvptMinimalPairExercise
  | SyllableBuilderExercise
  | VocabMcqExercise
  | ContextClozeExercise
  | ParticleContrastExercise
  | SentenceScrambleExercise
  | ImeTypingRecallExercise
  | AudioDictationExercise
  | ShadowingSpeakExercise
  | GuidedPersonalOutputExercise;

export interface Unit0Item {
  id: string;
  hangul: string;
  ipa: string;
  hintVi?: string;
  meaningVi?: string;
  hasBatchim: boolean;
}

export interface Unit0Lesson {
  lessonId: string;
  order: number;
  title: string;
  description: string;
  explicitRule: ExplicitRule;
  items: Unit0Item[];
  exercises: Exercise[];
}

export interface Unit0Content {
  unitId: string;
  unitNumber: number;
  title: string;
  pedagogicalNotes: string[];
  lessons: Unit0Lesson[];
}

export interface DialogueLine {
  speaker: string;
  ko: string;
  vi: string;
  audioKey: string;
}

export interface GradedMicroStory {
  titleVi: string;
  knownVocabRatio: number;
  newGlossedWords: Array<{ ko: string; vi: string }>;
  lines: Array<{ ko: string; vi: string }>;
  shadowingAudioKey: string;
}

export interface Unit1Lesson {
  lessonId: string;
  order: number;
  title: string;
  targetVocabIds: string[];
  targetGrammarIds: string[];
  dialogue?: DialogueLine[];
  gradedMicroStory?: GradedMicroStory;
  exercises: Exercise[];
}

export interface Unit1Content {
  unitId: string;
  unitNumber: number;
  title: string;
  communicativeGoal: string;
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  lessons: Unit1Lesson[];
}

export interface RoadmapUnitSummary {
  unitNumber: number;
  id: string;
  title: string;
  communicativeGoal: string;
  lessonsCount: number;
  vocabTarget: number;
  grammarPoints: string[];
  hvptContrasts: string[];
  interleavedContrasts: string[];
  hanjaFamilies: string[];
}

export interface CurriculumRoadmap {
  courseId: string;
  title: string;
  targetLevel: string;
  targetLearner: string;
  designPrinciples: string[];
  totals: {
    unitsCount: number;
    targetLessons: number;
    targetVocab: number;
    targetGrammarPoints: number;
  };
  units: RoadmapUnitSummary[];
}

// ---------------------------------------------------------------------------
// FSRS & Telemetry Types
// ---------------------------------------------------------------------------

export interface FsrsCardState {
  itemId: string;
  itemType: 'vocab' | 'grammar' | 'phoneme';
  label: string;
  meaningVi: string;
  unitId: string;
  stage: MasteryStage;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewAt: number; // epoch ms
  dueAt: number;        // epoch ms
  lastElapsedDays: number;
}

export type ErrorCategory = '3way_stop' | 'vowel_pair' | 'batchim_nl' | 'particles' | 'general';

export interface AttemptLog {
  clientAttemptId: string;
  exerciseId: string;
  itemIds: string[];
  category: ErrorCategory;
  stage: MasteryStage;
  grade: FsrsGrade;
  xpEarned: number;
  elapsedDays: number;
  wrongAttempts: number;
  createdAt: number;
}

export interface RetentionMetrics {
  totalTrackedCards: number;
  averageRetrievability: number; // 0..1
  retainedCount: number;         // cards with R >= 0.85
  dueCount: number;              // cards with R < 0.90 or dueAt <= now
  masteredCount: number;         // stage === 4 && stability >= 21
  stageDistribution: Record<MasteryStage, number>;
  firstTryAccuracy: number;      // 0..1
}

// ---------------------------------------------------------------------------
// Background Adaptive AI Types (BKT + Elo-IRT + ZPDES)
// ---------------------------------------------------------------------------

export type KnowledgeComponentId =
  | 'kc_phonetics_3way'
  | 'kc_phonetics_vowel_batchim'
  | 'kc_morph_particles'
  | 'kc_lexicon_hanja'
  | 'kc_productive_orthography';

export interface BktSkillState {
  kcId: KnowledgeComponentId;
  labelVi: string;
  pKnown: number;      // P(L_t) in [0.01, 0.99]
  attempts: number;
  recentDelta: number; // Empirical learning progress r_k = ΔP(L) for ZPDES
}

export interface AdaptiveAiProfile {
  eloRating: number;
  totalResponses: number;
  itemDifficulties: Record<string, number>;
  itemResponseCounts: Record<string, number>;
  skills: Record<KnowledgeComponentId, BktSkillState>;
  lastRecommendationVi: string;
}

// ---------------------------------------------------------------------------
// Zod Runtime Validators
// ---------------------------------------------------------------------------

export const BaseExerciseSchema = z.object({
  id: z.string().min(1),
  stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  type: z.enum([
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
  ]),
  promptVi: z.string().min(1),
  promptHint: z.string().min(1),
  explicitExplanation: z.string().min(1),
});

export function validateExerciseEnvelope(ex: unknown): BaseExercise {
  return BaseExerciseSchema.parse(ex) as BaseExercise;
}

// ---------------------------------------------------------------------------
// Export Typed Curriculum Data
// ---------------------------------------------------------------------------

export const roadmapData = roadmapJson as CurriculumRoadmap;
export const unit0Data = unit0Json as Unit0Content;
export const unit1Data = unit1Json as Unit1Content;

export * from './wonder-board';
