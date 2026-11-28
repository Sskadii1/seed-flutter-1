import {
  WonderBBox,
  WonderConversationMemoryTurn,
  WonderCropTransform,
  WonderLanguage,
  WonderRecognitionDiagnosticEntry,
  WonderRecognitionRegion,
  WonderRecognitionSpan,
  WonderRecognitionStatus,
  WonderStroke,
  WonderStrokePoint,
  WonderStrokeProvenance,
  WonderTargetLanguage,
  WonderVisionCompletenessStatus,
  WonderVisionContentType,
  WonderVisionRecognitionResponse,
  WonderVisionRecognitionResponseSchema,
} from '@seed/schema';
import {
  boxesIntersect,
  hashString,
  mergeBoundingBoxes,
  recognizeHandwritingRegions,
  segmentStrokesIntoRegions,
} from './wonder-board';
import {
  contrastiveVowelAlternative, decomposeHangulUnit, inspectHangulBranch, inspectStandaloneHangulAxis,
} from './wonder-hangul';

export type RecognitionProviderKind =
  | 'restricted_local_fallback'
  | 'multimodal_vision'
  | 'online_hwr'
  | 'hybrid';

export interface ProviderRecognitionRequest {
  boardId: string;
  regionId: string;
  revision: number;
  strokes: WonderStroke[];
  bbox: WonderBBox;
  cropTransform?: WonderCropTransform;
  imageDataUrl?: string;
  /** Legacy field. The board keeps tutoring context outside OCR requests. */
  recentContext?: WonderConversationMemoryTurn[];
  signal?: AbortSignal;
}

export interface ProviderRecognitionResult {
  status: WonderRecognitionStatus;
  recognizedText: string;
  rawTranscription?: string;
  normalizedCandidate?: string;
  uncertainty?: number;
  completenessEvidence?: string;
  revision?: number;
  contentType?: WonderVisionContentType;
  completenessStatus?: WonderVisionCompletenessStatus;
  detectedLanguages?: WonderLanguage[];
  handwritingQualityObservations?: string[];
  language: WonderLanguage;
  confidence: number;
  alternatives: string[];
  words?: Array<{
    text: string;
    bboxNorm: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
  providerId: string;
  latencyMs: number;
  errorCode?: string;
}

export interface HandwritingRecognitionProvider {
  id: string;
  kind: RecognitionProviderKind;
  capabilities: {
    supportsFreehandKorean: boolean;
    supportsFreehandVietnamese: boolean;
    supportsMixedLanguage: boolean;
    supportsWordPositioning: boolean;
    requiresNetwork: boolean;
  };
  recognizeRegion(req: ProviderRecognitionRequest): Promise<ProviderRecognitionResult>;
}

/**
 * Computes a deterministic structural hash of strokes inside a region
 * for recognition deduplication & bounded cache lookups.
 */
export function computeRegionStrokeHash(strokes: WonderStroke[]): string {
  const geometry = strokes.map((s) => [
    s.id, s.revision, s.transform.dx, s.transform.dy, s.width, s.tool,
    s.points.map((p) => [p.x, p.y, p.pressure]),
  ]);
  return String(hashString(JSON.stringify(geometry)));
}

function verifyVisionHangul(result: ProviderRecognitionResult, strokes: WonderStroke[]): {
  result: ProviderRecognitionResult;
  verification?: WonderRecognitionDiagnosticEntry['structuralVerification'];
} {
  const raw = result.rawTranscription || result.recognizedText;
  const unit = decomposeHangulUnit(raw);
  if (!unit || !['RECOGNIZED', 'AMBIGUOUS', 'PARTIALLY_RECOGNIZED'].includes(result.status)) {
    return { result };
  }
  // A provider can return a normalized candidate alongside its literal reading.
  // Geometry and ambient tutoring operate on the literal glyph.
  if (raw.trim().normalize('NFC') !== result.recognizedText.trim().normalize('NFC')) {
    result = {
      ...result,
      recognizedText: unit.unit,
      rawTranscription: raw,
      words: result.words?.length === 1 ? [{ ...result.words[0], text: unit.unit }] : [],
    };
  }
  const branch = inspectHangulBranch(strokes);
  const bareAxis = !unit.initial && (unit.vowel === 'ㅡ' || unit.vowel === 'ㅣ')
    ? inspectStandaloneHangulAxis(strokes) : undefined;
  const evidence = branch ?? bareAxis;
  if (!evidence || (branch && Boolean(unit.initial) === (branch.componentLayout === 'standalone'))) {
    return { result, verification: { verdict: 'insufficient_evidence' } };
  }
  const opposite = contrastiveVowelAlternative(raw, evidence.vowel);
  const possibleOmission = branch?.possibleFinal && Boolean(unit.initial) && !unit.final;
  if (!opposite && !possibleOmission) {
    return {
      result,
      verification: { ...evidence, verdict: unit.vowel === evidence.vowel ? 'agrees' : 'insufficient_evidence' },
    };
  }
  const alternatives = [...new Set([
    unit.unit, ...(opposite ? [opposite] : []), ...result.alternatives,
  ])].slice(0, 6);
  const providerCorroborates = opposite && !possibleOmission &&
    result.alternatives.some((a) => a.trim().normalize('NFC') === opposite);
  const supported = providerCorroborates && result.status === 'RECOGNIZED';
  return {
    result: {
      ...result,
      rawTranscription: raw,
      recognizedText: supported ? opposite : unit.unit,
      status: supported ? 'RECOGNIZED' : 'AMBIGUOUS',
      confidence: Math.min(result.confidence, supported ? 0.88 : 0.69),
      alternatives,
      words: result.words?.length === 1
        ? [{ ...result.words[0], text: supported ? opposite : unit.unit }]
        : [],
    },
    verification: { ...evidence, verdict: supported ? 'provider_alternative' : 'conflict' },
  };
}

export class WonderRecognitionCache {
  private readonly maxEntries: number;
  private readonly store = new Map<string, ProviderRecognitionResult>();

  constructor(maxEntries = 64) {
    this.maxEntries = maxEntries;
  }

  get(hash: string): ProviderRecognitionResult | undefined {
    const val = this.store.get(hash);
    if (!val) return undefined;
    // LRU touch
    this.store.delete(hash);
    this.store.set(hash, val);
    return val;
  }

  set(hash: string, result: ProviderRecognitionResult): void {
    if (this.store.has(hash)) {
      this.store.delete(hash);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(hash, result);
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Validates raw JSON returned by any multimodal Vision/LLM endpoint strictly against
 * WonderVisionRecognitionResponseSchema, preventing unvalidated strings from entering UI.
 */
export function validateVisionRecognitionPayload(
  raw: unknown
): WonderVisionRecognitionResponse | null {
  const parsed = WonderVisionRecognitionResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Maps Vision-returned normalized word boxes back onto raw world stroke clusters using the
 * exact cropTransform generated when rendering Layer 2 raw ink. Unmappable words fall back to
 * uniform cluster mapping ONLY when cluster counts match and overall confidence is verified.
 */
export function alignVisionWordsToStrokeClusters(params: {
  visionResult: {
    recognizedText: string;
    confidence: number;
    words?: WonderVisionRecognitionResponse['words'];
    language?: WonderLanguage;
    recognitionStatus?: WonderRecognitionStatus;
    alternatives?: string[];
  };
  cropTransform: WonderCropTransform;
  wordClusters: WonderStroke[][];
  fallbackBbox: WonderBBox;
}): {
  spans: WonderRecognitionSpan[];
  characterSpans: WonderRecognitionSpan[];
  mappingVerified: boolean;
} {
  const { visionResult, cropTransform, wordClusters, fallbackBbox } = params;
  const spans: WonderRecognitionSpan[] = [];
  const characterSpans: WonderRecognitionSpan[] = [];
  const recognizedText = visionResult.recognizedText.trim();
  if (!recognizedText) {
    return { spans, characterSpans, mappingVerified: false };
  }

  const visionWords = visionResult.words ?? [];
  const words =
    visionWords.length > 0
      ? visionWords
      : recognizedText.split(/\s+/).map((text) => ({
          text,
          bboxNorm: { x0: 0, y0: 0, x1: 1, y1: 1 },
          confidence: visionResult.confidence,
        }));

  let cursor = 0;
  let mappedClusters = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const idx = recognizedText.indexOf(w.text, cursor);
    const startIndex = idx >= 0 ? idx : cursor;
    const endIndex = startIndex + w.text.length;
    cursor = endIndex;

    const worldBoxFromCrop: WonderBBox = {
      minX: cropTransform.worldMinX + w.bboxNorm.x0 * cropTransform.worldWidth,
      minY: cropTransform.worldMinY + w.bboxNorm.y0 * cropTransform.worldHeight,
      maxX: cropTransform.worldMinX + w.bboxNorm.x1 * cropTransform.worldWidth,
      maxY: cropTransform.worldMinY + w.bboxNorm.y1 * cropTransform.worldHeight,
      width: Math.max(4, (w.bboxNorm.x1 - w.bboxNorm.x0) * cropTransform.worldWidth),
      height: Math.max(4, (w.bboxNorm.y1 - w.bboxNorm.y0) * cropTransform.worldHeight),
    };

    const matchingClusters = wordClusters.filter((cluster) => {
      const cBox = mergeBoundingBoxes(cluster.map((s) => s.bbox));
      return boxesIntersect(worldBoxFromCrop, cBox, 12);
    });

    let matchedStrokes: WonderStroke[] = matchingClusters.flat();
    let alignedBox = fallbackBbox;

    if (matchedStrokes.length > 0) {
      alignedBox = mergeBoundingBoxes(matchedStrokes.map((s) => s.bbox));
      mappedClusters++;
    } else if (wordClusters.length === words.length) {
      matchedStrokes = wordClusters[i];
      alignedBox = mergeBoundingBoxes(matchedStrokes.map((s) => s.bbox));
      mappedClusters++;
    } else if (wordClusters.length > 0) {
      const fallbackIdx = Math.min(
        wordClusters.length - 1,
        Math.floor((i / Math.max(1, words.length)) * wordClusters.length)
      );
      matchedStrokes = wordClusters[fallbackIdx];
      alignedBox = mergeBoundingBoxes(matchedStrokes.map((s) => s.bbox));
    }

    spans.push({
      text: w.text,
      startIndex,
      endIndex,
      strokeIds: matchedStrokes.map((s) => s.id),
      bbox: alignedBox,
      confidence: w.confidence,
    });

    const chars = Array.from(w.text);
    const stepW = alignedBox.width / Math.max(1, chars.length);
    chars.forEach((ch, cIdx) => {
      const cMinX = alignedBox.minX + cIdx * stepW;
      characterSpans.push({
        text: ch,
        startIndex: startIndex + cIdx,
        endIndex: startIndex + cIdx + 1,
        strokeIds: matchedStrokes.map((s) => s.id),
        bbox: {
          minX: cMinX,
          minY: alignedBox.minY,
          maxX: cMinX + stepW,
          maxY: alignedBox.maxY,
          width: stepW,
          height: alignedBox.height,
        },
        confidence: w.confidence,
      });
    });
  }

  return {
    spans,
    characterSpans,
    mappingVerified: mappedClusters > 0 || wordClusters.length === 0,
  };
}

/**
 * Allows the learner to explicitly confirm or correct recognized text for a handwritten region
 * without mislabeling that confirmation as automatic freehand OCR accuracy.
 */
export function applyConfirmedUserTranscript(
  region: WonderRecognitionRegion,
  confirmedText: string
): WonderRecognitionRegion {
  const cleaned = confirmedText.trim();
  const hasKo = /[\uAC00-\uD7A3]/.test(cleaned);
  const hasVi =
    /[ăâêôơưđàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(
      cleaned
    );
  const language: WonderLanguage =
    hasKo && hasVi ? 'mixed' : hasKo ? 'ko' : hasVi ? 'vi' : 'unknown';

  const words = cleaned.split(/\s+/).filter(Boolean);
  let cursor = 0;
  const spans: WonderRecognitionSpan[] = words.map((word) => {
    const startIndex = cleaned.indexOf(word, cursor);
    const endIndex = startIndex + word.length;
    cursor = endIndex;
    return {
      text: word,
      startIndex,
      endIndex,
      strokeIds: region.strokeIds,
      bbox: region.bbox,
      confidence: 1,
    };
  });

  return {
    ...region,
    recognizedText: cleaned,
    language,
    confidence: 1,
    completeness: cleaned.length > 0 ? 'complete' : 'low_confidence',
    recognitionStatus: cleaned.length > 0 ? 'RECOGNIZED' : 'AMBIGUOUS',
    provenance: 'user_confirmed',
    providerId: 'user-confirmed',
    spans,
    recognizedAt: Date.now(),
  };
}

export interface HybridPerceptionParams {
  strokes: WonderStroke[];
  boardId: string;
  revision: number;
  visionProvider?: HandwritingRecognitionProvider;
  cropRenderer?: (
    regionStrokes: WonderStroke[],
    bbox: WonderBBox
  ) => { imageDataUrl: string; cropTransform: WonderCropTransform } | null;
  cache?: WonderRecognitionCache;
  existingRegions?: WonderRecognitionRegion[];
  /** Legacy field. Board transcripts are ignored during recognition. */
  recentMemory?: WonderConversationMemoryTurn[];
  visionFirst?: boolean;
  signal?: AbortSignal;
  forceRecognition?: boolean;
  bypassCache?: boolean;
  maxSubRegionBudget?: number;
  cloudConsentGranted?: boolean;
  noProviderReason?: string;
  targetLanguage?: WonderTargetLanguage;
}

/**
 * Decimates polyline points using squared distance threshold while preserving endpoints.
 * Ported from MaximeRivest/riddle `src/memory.rs` (`MIN_POINT_DIST2 = 9`) for compact telemetry.
 */
export function decimateStrokePoints(
  points: WonderStrokePoint[],
  minDistSq = 9
): WonderStrokePoint[] {
  if (points.length <= 2) return points.slice();
  const out: WonderStrokePoint[] = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const pt = points[i];
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    if (dx * dx + dy * dy >= minDistSq) {
      out.push(pt);
      last = pt;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Maintains bounded rolling conversation memory (adapted from MaximeRivest/riddle `src/memory.rs`).
 */
export function appendConversationMemoryTurn(
  history: WonderConversationMemoryTurn[] | undefined,
  turn: WonderConversationMemoryTurn,
  maxTurns = 16
): WonderConversationMemoryTurn[] {
  const base = Array.isArray(history) ? history : [];
  const deduped = base.filter((t) => t.turnId !== turn.turnId);
  const next = [...deduped, turn];
  return next.length > maxTurns ? next.slice(next.length - maxTurns) : next;
}

export interface AdaptiveObservationWindow {
  windowId: string;
  scope: 'single_glyph' | 'syllable' | 'word' | 'line' | 'multi_line_group';
  regionIds: string[];
  bbox: WonderBBox;
  strokeCount: number;
  isDirty: boolean;
}

/**
 * Groups evolving spatially contiguous regions into adaptive observation windows (single glyph ->
 * word -> sentence -> multi-line block) without merging distant independent notes on the board.
 */
export function buildAdaptiveObservationWindows(
  regions: WonderRecognitionRegion[],
  existingRegions: WonderRecognitionRegion[] = []
): AdaptiveObservationWindow[] {
  if (regions.length === 0) return [];
  const prevBySignature = new Map(
    existingRegions.map((r) => [r.strokeIds.join(','), r] as const)
  );
  return regions.map((reg, idx) => {
    const sig = reg.strokeIds.join(',');
    const prev = prevBySignature.get(sig);
    const isDirty = !prev || prev.recognizedText !== reg.recognizedText || prev.revision !== reg.revision;
    const tokenCount = reg.recognizedText.trim().split(/\s+/).filter(Boolean).length;
    const aspect = reg.bbox.width / Math.max(1, reg.bbox.height);
    const scope: AdaptiveObservationWindow['scope'] =
      reg.strokeIds.length <= 2 && aspect <= 1.35 && tokenCount <= 1
        ? 'single_glyph'
        : tokenCount <= 1 && aspect <= 1.65
          ? 'syllable'
          : tokenCount <= 1
            ? 'word'
            : reg.bbox.height > 180 && tokenCount >= 5
              ? 'multi_line_group'
              : 'line';

    return {
      windowId: `win_${reg.regionId || idx}`,
      scope,
      regionIds: [reg.regionId],
      bbox: reg.bbox,
      strokeCount: reg.strokeIds.length,
      isDirty,
    };
  });
}

/**
 * Hybrid V4 Vision-First Perception Pipeline (Riddle-inspired):
 * 1. Excludes AI teaching ink ('ai_teaching').
 * 2. Preserves user-confirmed & typed-vector/fixture ground truth transparently.
 * 3. For freehand_ink: calls Multimodal Vision FIRST when configured & consented so template/local
 *    heuristics NEVER gate or block real handwriting understanding.
 * 4. Keeps local compositional engine as verified offline/unconfigured fallback and for
 *    spatial segmentation, word cluster alignment, and crop-to-world transform.
 */
export async function recognizeWithHybridPipeline(
  params: HybridPerceptionParams
): Promise<{
  regions: WonderRecognitionRegion[];
  diagnostics: WonderRecognitionDiagnosticEntry[];
  observationWindows: AdaptiveObservationWindow[];
  segmentationMs: number;
  localRecognitionMs: number;
  cloudRecognitionMs: number;
  apiCallsMade: number;
}> {
  const {
    strokes,
    boardId,
    revision,
    visionProvider,
    cropRenderer,
    cache,
    existingRegions = [],
    visionFirst = true,
    signal,
    forceRecognition = false,
    bypassCache = forceRecognition,
    maxSubRegionBudget = 2,
    cloudConsentGranted = Boolean(visionProvider),
    noProviderReason,
    targetLanguage = 'auto',
  } = params;

  const tSeg0 = Date.now();
  const separateHangulOccurrences = targetLanguage !== 'en';
  const segmented = segmentStrokesIntoRegions(strokes, separateHangulOccurrences);
  const segmentationMs = Math.max(0, Date.now() - tSeg0);

  const tLocal0 = Date.now();
  const baseRegions = recognizeHandwritingRegions(strokes, boardId, revision, {
    targetLanguage,
    separateHangulOccurrences,
  });
  const localRecognitionMs = Math.max(0, Date.now() - tLocal0);

  const tCloud0 = Date.now();
  let apiCallsMade = 0;

  const finalRegions: WonderRecognitionRegion[] = [];
  const diagnostics: WonderRecognitionDiagnosticEntry[] = [];

  const pushDiag = (
    reg: WonderRecognitionRegion,
    latencyMs: number,
    fallbackReason: string,
    mappingStatus: WonderRecognitionDiagnosticEntry['mappingStatus'],
    extra?: {
      requestAttempted?: boolean;
      cropTransform?: WonderCropTransform;
      cropDataUrl?: string;
      rawTranscription?: string;
      segmentationSummary?: string;
      providerFailureReason?: string;
      structuralVerification?: WonderRecognitionDiagnosticEntry['structuralVerification'];
    }
  ) => {
    diagnostics.push({
      regionId: reg.regionId,
      recognitionId: reg.recognitionId,
      sourceStrokeIds: reg.strokeIds,
      inputImageHash: extra?.cropDataUrl
        ? `fnv1a32:${hashString(extra.cropDataUrl).toString(16).padStart(8, '0')}` : undefined,
      structuralVerification: extra?.structuralVerification,
      sourceRevision: reg.revision,
      providerId: reg.providerId,
      engineVersion:
        reg.providerId === 'local-freehand-jamo'
          ? 'local-jamo-batchim-v3'
          : reg.providerId.includes('vision') || reg.providerId.includes('gateway')
            ? 'multimodal-vision-v4'
            : reg.providerId,
      recognitionStatus: reg.recognitionStatus,
      recognizedText: reg.recognizedText,
      confidence: reg.confidence,
      candidateAlternatives: reg.alternativeCandidates ?? [],
      providerLatencyMs: latencyMs,
      fallbackReason,
      mappingStatus,
      timestamp: Date.now(),
      requestAttempted: extra?.requestAttempted ?? false,
      cropWidth: extra?.cropTransform?.pixelWidth,
      cropHeight: extra?.cropTransform?.pixelHeight,
      cropDataUrl: extra?.cropDataUrl,
      rawTranscription: extra?.rawTranscription ?? reg.recognizedText,
      segmentationSummary: extra?.segmentationSummary,
      completionState: reg.completeness,
      providerFailureReason: extra?.providerFailureReason,
    });
  };

  for (let idx = 0; idx < baseRegions.length; idx++) {
    const base = {
      ...baseRegions[idx],
      recognitionId: JSON.stringify([boardId, [...baseRegions[idx].strokeIds].sort()]),
    };
    const seg = segmented[idx];
    const segSummary = seg
      ? `strokes=${seg.strokes.length}, clusters=${seg.wordClusters.length}, box=${Math.round(base.bbox.width)}x${Math.round(base.bbox.height)}`
      : `strokes=${base.strokeIds.length}, clusters=0, box=${Math.round(base.bbox.width)}x${Math.round(base.bbox.height)}`;

    // Preserve previous user_confirmed region if stroke IDs are unchanged
    const existingConfirmed = existingRegions.find(
      (r) =>
        r.provenance === 'user_confirmed' &&
        r.strokeIds.length === base.strokeIds.length &&
        r.strokeIds.every((id) => base.strokeIds.includes(id))
    );
    if (existingConfirmed) {
      const updated = {
        ...existingConfirmed,
        recognitionId: base.recognitionId,
        regionId: base.regionId,
        revision,
        geometryRevision: revision,
        bbox: base.bbox,
      };
      finalRegions.push(updated);
      pushDiag(updated, 0, 'USER_CONFIRMED_PRESERVED', 'VERIFIED_STROKE_CLUSTERS', {
        segmentationSummary: segSummary,
      });
      continue;
    }

    const isTinySingleStrokeInProgress =
      base.completeness === 'in_progress' &&
      !forceRecognition &&
      (!seg || seg.strokes.length <= 1);

    if (
      base.completeness === 'non_text' ||
      isTinySingleStrokeInProgress ||
      base.provenance === 'typed_vector' ||
      base.provenance === 'fixture_sample' ||
      base.provenance === 'user_confirmed'
    ) {
      finalRegions.push(base);
      const reason =
        base.completeness === 'non_text'
          ? 'NON_TEXT_REJECTED'
          : isTinySingleStrokeInProgress
            ? 'IN_PROGRESS_WAIT'
            : 'GROUND_TRUTH_INPUT';
      pushDiag(
        base,
        localRecognitionMs,
        reason,
        base.spans.length > 0 ? 'VERIFIED_STROKE_CLUSTERS' : 'UNMAPPED',
        { segmentationSummary: segSummary }
      );
      continue;
    }

    const useVisionPrimary = Boolean(visionProvider && cloudConsentGranted && visionFirst);

    // Local heuristic is used directly ONLY when Vision is not active/consented or explicitly opted out
    if (
      !useVisionPrimary &&
      !forceRecognition &&
      base.recognitionStatus === 'RECOGNIZED' &&
      (base.providerId === 'local-freehand-jamo' || base.providerId === 'local-freehand-latin') &&
      base.confidence >= (base.providerId === 'local-freehand-latin' ? 0.8 : 0.93) &&
      seg &&
      seg.strokes.length >= (base.providerId === 'local-freehand-latin' ? 2 : 6) &&
      base.spans.length === seg.wordClusters.length
    ) {
      finalRegions.push(base);
      pushDiag(base, localRecognitionMs, 'LOCAL_JAMO_COMPOSED', 'VERIFIED_STROKE_CLUSTERS', {
        segmentationSummary: segSummary,
      });
      continue;
    }

    // True freehand_ink handling: check Vision provider when uncertain/partial or forced
    const strokeHash = seg && visionProvider && cloudConsentGranted
      ? JSON.stringify([base.recognitionId, visionProvider.id, targetLanguage, computeRegionStrokeHash(seg.strokes)])
      : '';
    const cachedRaw = !bypassCache && strokeHash ? cache?.get(strokeHash) : undefined;

    if (cachedRaw) {
      const { result: cached, verification } = verifyVisionHangul(cachedRaw, seg.strokes);
      const cachedCropped =
        cropRenderer && seg ? cropRenderer(seg.strokes, base.bbox) : null;
      const alignedCached =
        cachedCropped && seg
          ? alignVisionWordsToStrokeClusters({
              visionResult: {
                recognizedText: cached.recognizedText,
                language: cached.language,
                recognitionStatus: cached.status,
                confidence: cached.confidence,
                alternatives: cached.alternatives,
                words: cached.words ?? [],
              },
              cropTransform: cachedCropped.cropTransform,
              wordClusters: seg.wordClusters,
              fallbackBbox: base.bbox,
            })
          : { spans: base.spans, characterSpans: base.characterSpans, mappingVerified: true };

      const cachedRegion = {
        ...base,
        recognizedText: cached.recognizedText,
        language: cached.language,
        confidence: cached.confidence,
        recognitionStatus: cached.status === 'RECOGNIZED' && !alignedCached.mappingVerified
          ? 'PARTIALLY_RECOGNIZED' : cached.status,
        completeness:
          cached.status === 'RECOGNIZED' && alignedCached.mappingVerified
            ? 'complete'
            : cached.status === 'IN_PROGRESS'
              ? 'in_progress'
              : cached.status === 'NON_TEXT'
                ? 'non_text'
                : 'low_confidence',
        alternativeCandidates: cached.alternatives,
        spans: alignedCached.spans,
        characterSpans: alignedCached.characterSpans,
        providerId: cached.providerId,
      } as WonderRecognitionRegion;
      finalRegions.push(cachedRegion);
      pushDiag(cachedRegion, 0, 'VISION_CACHE_HIT',
        alignedCached.mappingVerified ? 'VERIFIED_STROKE_CLUSTERS' : 'PROPORTIONAL_CLUSTER_FALLBACK', {
        cropTransform: cachedCropped?.cropTransform,
        cropDataUrl: cachedCropped?.imageDataUrl,
        rawTranscription: cached.rawTranscription ?? cached.recognizedText,
        segmentationSummary: segSummary,
        structuralVerification: verification,
      });
      continue;
    }

    if (visionProvider && cloudConsentGranted && seg && !signal?.aborted) {
      const cropped = cropRenderer ? cropRenderer(seg.strokes, base.bbox) : null;
      try {
        apiCallsMade++;
        let vRes = await visionProvider.recognizeRegion({
          boardId,
          regionId: base.regionId,
          revision,
          strokes: seg.strokes,
          bbox: base.bbox,
          imageDataUrl: cropped?.imageDataUrl,
          cropTransform: cropped?.cropTransform,
          signal,
        });
        let usedSubRegionFallback = false;

        // Stage 3 Bounded Multi-Scale Fallback when whole sentence crop is unclear
        if (
          (vRes.status === 'AMBIGUOUS' || vRes.status === 'PARTIALLY_RECOGNIZED') &&
          seg.wordClusters.length >= 2 &&
          maxSubRegionBudget > 0 &&
          cropRenderer &&
          !signal?.aborted
        ) {
          const mid = Math.ceil(seg.wordClusters.length / 2);
          const halves = [
            seg.wordClusters.slice(0, mid).flat(),
            seg.wordClusters.slice(mid).flat(),
          ].filter((h) => h.length > 0);
          const budgetHalves = halves.slice(0, Math.min(2, maxSubRegionBudget));
          const halfResults: Array<{ res: ProviderRecognitionResult; box: WonderBBox }> = [];

          for (let hIdx = 0; hIdx < budgetHalves.length; hIdx++) {
            const hStrokes = budgetHalves[hIdx];
            const hBox = mergeBoundingBoxes(hStrokes.map((s) => s.bbox));
            const hCrop = cropRenderer(hStrokes, hBox);
            if (!hCrop) continue;
            apiCallsMade++;
            const hRes = await visionProvider.recognizeRegion({
              boardId,
              regionId: `${base.regionId}_sub${hIdx}`,
              revision,
              strokes: hStrokes,
              bbox: hBox,
              imageDataUrl: hCrop.imageDataUrl,
              cropTransform: hCrop.cropTransform,
              signal,
            });
            if (hRes.recognizedText.trim().length > 0) {
              halfResults.push({ res: hRes, box: hBox });
            }
          }

          if (halfResults.length === budgetHalves.length && halfResults.length >= 2) {
            const joined = halfResults.map((x) => x.res.recognizedText.trim()).join(' ');
            const avgConf =
              halfResults.reduce((acc, x) => acc + x.res.confidence, 0) / halfResults.length;
            vRes = {
              status: avgConf >= 0.65 ? 'RECOGNIZED' : 'PARTIALLY_RECOGNIZED',
              recognizedText: joined,
              rawTranscription: halfResults
                .map((x) => (x.res.rawTranscription ?? x.res.recognizedText).trim())
                .join(' '),
              language: halfResults[0].res.language === 'unknown' ? 'ko' : halfResults[0].res.language,
              confidence: avgConf,
              alternatives: vRes.alternatives,
              words: halfResults.map((x) => ({
                text: x.res.recognizedText.trim(),
                bboxNorm: cropped
                  ? {
                      x0: Math.max(0, Math.min(1, (x.box.minX - cropped.cropTransform.worldMinX) / cropped.cropTransform.worldWidth)),
                      y0: Math.max(0, Math.min(1, (x.box.minY - cropped.cropTransform.worldMinY) / cropped.cropTransform.worldHeight)),
                      x1: Math.max(0, Math.min(1, (x.box.maxX - cropped.cropTransform.worldMinX) / cropped.cropTransform.worldWidth)),
                      y1: Math.max(0, Math.min(1, (x.box.maxY - cropped.cropTransform.worldMinY) / cropped.cropTransform.worldHeight)),
                    }
                  : { x0: 0, y0: 0, x1: 1, y1: 1 },
                confidence: x.res.confidence,
              })),
              providerId: halfResults[0].res.providerId,
              latencyMs: halfResults.reduce((acc, x) => acc + x.res.latencyMs, vRes.latencyMs),
            };
            usedSubRegionFallback = true;
          }
        }

        if (vRes.status === 'PROVIDER_UNAVAILABLE') {
          if (
            base.recognitionStatus === 'RECOGNIZED' &&
            (base.providerId === 'local-freehand-jamo' || base.providerId === 'local-freehand-latin') &&
            base.confidence >= 0.8
          ) {
            finalRegions.push(base);
            pushDiag(
              base,
              vRes.latencyMs,
              'VISION_UNAVAILABLE_LOCAL_FALLBACK',
              base.spans.length > 0 ? 'VERIFIED_STROKE_CLUSTERS' : 'UNMAPPED',
              {
                requestAttempted: true,
                cropTransform: cropped?.cropTransform,
                cropDataUrl: cropped?.imageDataUrl,
                segmentationSummary: segSummary,
                providerFailureReason: vRes.errorCode || 'PROVIDER_UNAVAILABLE',
              }
            );
            continue;
          }
          const unavailRegion: WonderRecognitionRegion = {
            ...base,
            recognizedText: '',
            confidence: 0,
            completeness: 'low_confidence',
            recognitionStatus: 'PROVIDER_UNAVAILABLE',
            providerId: vRes.providerId,
          };
          finalRegions.push(unavailRegion);
          pushDiag(
            unavailRegion,
            vRes.latencyMs,
            vRes.errorCode || 'PROVIDER_UNAVAILABLE',
            'UNMAPPED',
            {
              requestAttempted: true,
              cropTransform: cropped?.cropTransform,
              cropDataUrl: cropped?.imageDataUrl,
              segmentationSummary: segSummary,
              providerFailureReason: vRes.errorCode || 'PROVIDER_UNAVAILABLE',
            }
          );
          continue;
        }

        const rawResult = vRes;
        const verified = verifyVisionHangul(vRes, seg.strokes);
        vRes = verified.result;
        const validated: WonderVisionRecognitionResponse | null =
          validateVisionRecognitionPayload({
            recognizedText: vRes.recognizedText,
            rawTranscription: vRes.rawTranscription,
            normalizedCandidate: vRes.normalizedCandidate,
            uncertainty: vRes.uncertainty,
            completenessEvidence: vRes.completenessEvidence,
            revision: vRes.revision,
            language: vRes.language,
            recognitionStatus: vRes.status,
            confidence: vRes.confidence,
            alternatives: vRes.alternatives,
            words: vRes.words ?? [],
          });

        if (!validated) {
          const ambigRegion: WonderRecognitionRegion = {
            ...base,
            recognizedText: '',
            confidence: 0.25,
            completeness: 'low_confidence',
            recognitionStatus: 'AMBIGUOUS',
            providerId: vRes.providerId,
          };
          finalRegions.push(ambigRegion);
          pushDiag(ambigRegion, vRes.latencyMs, 'VISION_SCHEMA_INVALID', 'UNMAPPED', {
            requestAttempted: true,
            cropTransform: cropped?.cropTransform,
            cropDataUrl: cropped?.imageDataUrl,
            segmentationSummary: segSummary,
            providerFailureReason: 'SCHEMA_VALIDATION_REJECTED',
          });
          continue;
        }

        if (strokeHash) cache?.set(strokeHash, rawResult);

        const aligned = cropped
          ? alignVisionWordsToStrokeClusters({
              visionResult: validated,
              cropTransform: cropped.cropTransform,
              wordClusters: seg.wordClusters,
              fallbackBbox: base.bbox,
            })
          : { spans: base.spans, characterSpans: base.characterSpans, mappingVerified: true };

        const status: WonderRecognitionStatus =
          validated.recognitionStatus === 'RECOGNIZED' && !aligned.mappingVerified
            ? 'PARTIALLY_RECOGNIZED'
            : validated.recognitionStatus;

        const mappedRegion: WonderRecognitionRegion = {
          ...base,
          recognizedText: validated.recognizedText,
          language: validated.language,
          confidence: validated.confidence,
          recognitionStatus: status,
          completeness:
            status === 'RECOGNIZED'
              ? 'complete'
              : status === 'IN_PROGRESS'
                ? 'in_progress'
                : status === 'NON_TEXT'
                  ? 'non_text'
                  : 'low_confidence',
          alternativeCandidates: validated.alternatives,
          spans: aligned.spans,
          characterSpans: aligned.characterSpans,
          providerId: vRes.providerId,
          recognizedAt: Date.now(),
        };
        finalRegions.push(mappedRegion);
        pushDiag(
          mappedRegion,
          vRes.latencyMs,
          usedSubRegionFallback
            ? 'VISION_STAGE3_SUBREGION_MERGED'
            : status === 'RECOGNIZED'
              ? 'VISION_PROVIDER_OK'
              : `VISION_STATUS_${status}`,
          aligned.mappingVerified
            ? 'VERIFIED_STROKE_CLUSTERS'
            : 'PROPORTIONAL_CLUSTER_FALLBACK',
          {
            requestAttempted: true,
            cropTransform: cropped?.cropTransform,
            cropDataUrl: cropped?.imageDataUrl,
            rawTranscription: validated.rawTranscription ?? validated.recognizedText,
            segmentationSummary: segSummary,
            structuralVerification: verified.verification,
          }
        );
        continue;
      } catch {
        const failRegion: WonderRecognitionRegion = {
          ...base,
          recognizedText: '',
          confidence: 0,
          completeness: 'low_confidence',
          recognitionStatus: 'PROVIDER_UNAVAILABLE',
          providerId: visionProvider.id,
        };
        finalRegions.push(failRegion);
        pushDiag(failRegion, Math.max(0, Date.now() - tCloud0), 'VISION_NETWORK_ERROR', 'UNMAPPED', {
          requestAttempted: true,
          cropTransform: cropped?.cropTransform,
          cropDataUrl: cropped?.imageDataUrl,
          segmentationSummary: segSummary,
          providerFailureReason: 'NETWORK_OR_ABORT',
        });
        continue;
      }
    }

    // No cloud vision provider active for freehand ink: keep base honest and surface exact crop + blocker
    const croppedBlocked = seg && cropRenderer ? cropRenderer(seg.strokes, base.bbox) : null;
    const honestRegion: WonderRecognitionRegion = {
      ...base,
    };
    finalRegions.push(honestRegion);
    const blockReason = noProviderReason
      ? noProviderReason
      : !cloudConsentGranted && params.cloudConsentGranted === false
        ? 'CLOUD_CONSENT_DISABLED'
        : 'NO_CLOUD_PROVIDER';
    const fallbackReason =
      honestRegion.recognitionStatus === 'RECOGNIZED'
        ? 'LOCAL_PROTOTYPE_OR_JAMO'
        : noProviderReason
          ? `REAL_FREEHAND_BLOCKED_${blockReason}`
          : 'REAL_FREEHAND_RECOGNITION_BLOCKED_NO_CLOUD_PROVIDER';
    pushDiag(
      honestRegion,
      localRecognitionMs,
      fallbackReason,
      honestRegion.spans.length > 0 ? 'VERIFIED_STROKE_CLUSTERS' : 'UNMAPPED',
      {
        requestAttempted: false,
        cropTransform: croppedBlocked?.cropTransform,
        cropDataUrl: croppedBlocked?.imageDataUrl,
        segmentationSummary: segSummary,
        providerFailureReason: honestRegion.recognitionStatus === 'RECOGNIZED' ? undefined : blockReason,
      }
    );
  }

  return {
    regions: finalRegions,
    diagnostics,
    observationWindows: buildAdaptiveObservationWindows(finalRegions, existingRegions),
    segmentationMs,
    localRecognitionMs,
    cloudRecognitionMs: apiCallsMade > 0 ? Math.max(0, Date.now() - tCloud0) : 0,
    apiCallsMade,
  };
}

export type { WonderStrokeProvenance };
