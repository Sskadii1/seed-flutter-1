import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { WonderAnnotation, WonderRecognitionDiagnosticEntry } from '../packages/schema/src/wonder-board';
import { contrastiveVowelAlternative, decomposeHangulUnit } from '../packages/learning-engine/src/wonder-hangul';

// pnpm exec tsx scripts/benchmark-wonder-contrastive.ts [manifest.json]
// In a local Wonder Board session, get diagnostics and board.annotations from
// window.__WONDER_BOARD_TEST__.getState(). Record the writer's labels separately
// after that capture and set each occurrence's regionId and contrastive pair.
const matrix = {
  basic_vowels: ['ㅏ/ㅓ', 'ㅗ/ㅜ', 'ㅑ/ㅕ', 'ㅛ/ㅠ', 'ㅡ/ㅣ'],
  vowel_syllables: ['아/어', '오/우', '야/여', '요/유'],
  consonant_vowel_syllables: ['가/거', '나/너', '다/더', '자/저', '카/커', '하/허', '고/구', '도/두'],
  similar_initials: ['가/카', '자/차', '다/타', '바/파', '아/하'],
  final_consonants: ['하/학', '도/독', '가/각', '아/안'],
} as const;

type Occurrence = {
  label: string;
  position?: string;
  proposed?: string;
  pair?: string;
  groundTruth?: string;
  regionId?: string;
  disconnected?: boolean;
  expectedIntent?: string;
  shouldCorrect?: boolean;
};
type ReviewCase = {
  id: string;
  source: string;
  provenance?: 'human' | 'fixture';
  screenshot?: string | null;
  rawStrokes?: string | null;
  confirmedByWriter: boolean;
  occurrences: Occurrence[];
  diagnostics?: WonderRecognitionDiagnosticEntry[];
  annotations?: WonderAnnotation[];
  terminologyReview?: Array<{ annotationId: string; incorrect: boolean }>;
};
type Manifest = { dataset: string; cases: ReviewCase[] };
type Sample = {
  caseId: string;
  occurrence: Occurrence;
  groundTruth: string;
  raw: string;
  result: string;
  diagnostic: WonderRecognitionDiagnosticEntry;
  annotations: WonderAnnotation[];
};

const metric = (hits: number, samples: number) => ({
  hits, samples, rate: samples ? Number((hits / samples).toFixed(4)) : null,
});
const actual = (sample: Sample) => decomposeHangulUnit(sample.result);
const expected = (sample: Sample) => decomposeHangulUnit(sample.groundTruth);
const isExact = (sample: Sample) => sample.result === sample.groundTruth;
const practiceIntent = (intent: string) =>
  /^(VOWEL_ORIENTATION|CONSONANT_DISTINCTION|CONTRASTIVE_CHARACTER)_PRACTICE$/.test(intent);
const confusion = (samples: Sample[], key: 'result' | 'raw') => {
  const cells: Record<string, Record<string, number>> = {};
  for (const sample of samples) {
    const row = cells[sample.groundTruth] ??= {};
    row[sample[key]] = (row[sample[key]] ?? 0) + 1;
  }
  return cells;
};

const path = process.argv[2] ?? fileURLToPath(new URL('../docs/wonder-contrastive-regression.json', import.meta.url));
const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
const samples: Sample[] = [];
const pending: Array<Record<string, unknown>> = [];
const reviewedAnnotations = new Map<string, WonderAnnotation>();
const terminologyReview: ReviewCase['terminologyReview'] = [];

for (const record of manifest.cases) {
  for (const occurrence of record.occurrences) {
    const diagnostic = record.diagnostics?.find((d) => d.regionId === occurrence.regionId);
    const truth = occurrence.groundTruth?.trim().normalize('NFC');
    const reasons = [
      record.provenance !== 'human' ? 'REAL_HANDWRITING_MISSING' : '',
      !record.confirmedByWriter || !truth ? 'WRITER_CONFIRMATION_MISSING' : '',
      !diagnostic?.requestAttempted || !diagnostic.cropDataUrl || !diagnostic.sourceStrokeIds?.length
        ? 'LIVE_CROP_AND_STROKE_EVIDENCE_MISSING' : '',
      diagnostic?.recognitionStatus === 'PROVIDER_UNAVAILABLE' || diagnostic?.providerFailureReason
        ? 'PROVIDER_RESULT_UNAVAILABLE' : '',
    ].filter(Boolean);
    if (reasons.length || !truth || !diagnostic) {
      pending.push({ caseId: record.id, source: record.source, ...occurrence, reasons });
      continue;
    }
    const annotations = (record.annotations ?? []).filter((a) =>
      a.status === 'active' && diagnostic.annotationIds?.includes(a.annotation_id));
    for (const annotation of annotations) reviewedAnnotations.set(JSON.stringify([record.id, annotation.annotation_id]), annotation);
    samples.push({
      caseId: record.id, occurrence, groundTruth: truth,
      raw: diagnostic.rawTranscription?.trim().normalize('NFC') || '[EMPTY]',
      result: diagnostic.recognitionStatus === 'RECOGNIZED'
        ? diagnostic.recognizedText.trim().normalize('NFC') || '[EMPTY]' : `[${diagnostic.recognitionStatus}]`,
      diagnostic, annotations,
    });
  }
  if (samples.some((sample) => sample.caseId === record.id)) {
    terminologyReview.push(...(record.terminologyReview ?? []));
  }
}

const measured = (population: Sample[], predicate: (sample: Sample) => boolean) =>
  metric(population.filter(predicate).length, population.length);
const groupResults = Object.fromEntries(Object.entries(matrix).map(([group, pairs]) => [group,
  Object.fromEntries(pairs.map((pair) => {
    const subset = samples.filter((sample) => sample.occurrence.pair === pair);
    return [pair, { accuracy: measured(subset, isExact), raw: confusion(subset, 'raw'), verified: confusion(subset, 'result') }];
  })),
]));
const contrastive = samples.filter((sample) =>
  Object.values(matrix).some((pairs) => (pairs as readonly string[]).includes(sample.occurrence.pair ?? '')));
const vowelComparisons = contrastive.filter((sample) => {
  const other = sample.occurrence.pair?.split('/').find((label) => label !== sample.groundTruth);
  return other && (
    contrastiveVowelAlternative(sample.groundTruth, decomposeHangulUnit(other)?.vowel ?? '') === other ||
    sample.occurrence.pair === 'ㅡ/ㅣ'
  );
});
const initialComparisons = contrastive.filter((sample) =>
  (matrix.similar_initials as readonly string[]).includes(sample.occurrence.pair ?? ''));
const finalComparisons = contrastive.filter((sample) =>
  (matrix.final_consonants as readonly string[]).includes(sample.occurrence.pair ?? '') && expected(sample)?.final);
const intentReviewed = samples.filter((sample) => sample.occurrence.expectedIntent);
const annotatedExplanations = [...reviewedAnnotations.entries()]
  .filter(([, annotation]) => annotation.annotation_type === 'explanation' && annotation.teaching_activity_id);
const conceptsByActivity = new Map<string, number>();
for (const [key, annotation] of annotatedExplanations) {
  for (const concept of annotation.learning_concept_ids) {
    const activityConcept = JSON.stringify([JSON.parse(key)[0], annotation.teaching_activity_id, concept]);
    conceptsByActivity.set(activityConcept, (conceptsByActivity.get(activityConcept) ?? 0) + 1);
  }
}
const explicitlyCorrect = samples.filter((sample) => sample.occurrence.shouldCorrect === false);

const report = {
  status: !samples.length ? 'BLOCKED' : pending.length ? 'PARTIAL' : 'MEASURED',
  dataset: manifest.dataset,
  sampleCount: samples.length,
  caseCount: new Set(samples.map((s) => s.caseId)).size,
  sources: [...new Set(manifest.cases.map((record) => record.source))],
  pending,
  matrix: groupResults,
  metrics: {
    contrastiveAccuracy: measured(contrastive, isExact),
    nearIdenticalGlyphAccuracy: measured(contrastive, isExact),
    vowelOrientationConfusionRate: measured(vowelComparisons, (s) => {
      const vowel = actual(s)?.vowel;
      return Boolean(vowel && (contrastiveVowelAlternative(s.groundTruth, vowel) === s.result ||
        (s.occurrence.pair === 'ㅡ/ㅣ' && s.result !== s.groundTruth && vowel !== expected(s)?.vowel)));
    }),
    initialConsonantConfusionRate: measured(initialComparisons, (s) =>
      Boolean(actual(s)?.initial && actual(s)?.initial !== expected(s)?.initial)),
    finalConsonantOmissionRate: measured(finalComparisons, (s) => actual(s)?.final === ''),
    disconnectedStrokeAccuracy: measured(samples.filter((s) => s.occurrence.disconnected === true), isExact),
    characterVersusJamoAccuracy: measured(samples.filter((s) => expected(s)), (s) =>
      Boolean(actual(s) && Boolean(actual(s)?.initial) === Boolean(expected(s)?.initial))),
    repetitionIntentAccuracy: measured(intentReviewed, (s) => s.occurrence.expectedIntent === s.diagnostic.learningIntent),
    contrastivePracticeDetectionAccuracy: measured(intentReviewed, (s) =>
      practiceIntent(s.occurrence.expectedIntent!) === practiceIntent(s.diagnostic.learningIntent ?? '')),
    repeatedExplanationRate: metric([...conceptsByActivity.values()].reduce((n, count) => n + count - 1, 0), annotatedExplanations.length),
    conceptRedundancyRate: metric([...conceptsByActivity.values()].filter((count) => count > 1).length, conceptsByActivity.size),
    falseCorrectionRate: measured(explicitlyCorrect, (s) => s.annotations.some((a) =>
      a.severity === 'error' && a.source_stroke_ids.some((id) => s.diagnostic.sourceStrokeIds?.includes(id)))),
    incorrectTerminologyRate: metric(terminologyReview.filter((r) => r.incorrect).length, terminologyReview.length),
    groupedFeedbackAnnotationDensity: metric(
      [...reviewedAnnotations.values()].filter((a) => a.teaching_activity_id).length,
      samples.filter((s) => s.diagnostic.teachingActivityId).length,
    ),
  },
  occurrences: samples.map(({ caseId, occurrence, groundTruth, raw, result, diagnostic, annotations }) => ({
    caseId, ...occurrence, groundTruth, raw, result,
    regionId: diagnostic.regionId, recognitionId: diagnostic.recognitionId,
    actualInputImage: diagnostic.cropDataUrl,
    inputImageSha256: createHash('sha256').update(Buffer.from(diagnostic.cropDataUrl!.split(',')[1], 'base64')).digest('hex'),
    sourceStrokeIds: diagnostic.sourceStrokeIds, providerId: diagnostic.providerId,
    alternatives: diagnostic.candidateAlternatives, structure: diagnostic.structuralVerification,
    confidence: diagnostic.confidence, intent: diagnostic.learningIntent, conceptIds: diagnostic.conceptIds,
    teachingActivityId: diagnostic.teachingActivityId, action: diagnostic.annotationDecision,
    suppressedReason: diagnostic.suppressedFeedbackReason, finalAnnotationIds: annotations.map((a) => a.annotation_id),
  })),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
