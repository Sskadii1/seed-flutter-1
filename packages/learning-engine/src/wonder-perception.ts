import {
  WonderBBox,
  WonderCropTransform,
  WonderLanguage,
  WonderRecognitionDiagnosticEntry,
  WonderRecognitionRegion,
  WonderRecognitionSpan,
  WonderRecognitionStatus,
  WonderStroke,
  WonderStrokeProvenance,
  WonderVisionRecognitionResponse,
  WonderVisionRecognitionResponseSchema,
} from '@seed/schema';
import {
  boxesIntersect,
  mergeBoundingBoxes,
  recognizeHandwritingRegions,
  segmentStrokesIntoRegions,
} from './wonder-board';

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
  signal?: AbortSignal;
}

export interface ProviderRecognitionResult {
  status: WonderRecognitionStatus;
  recognizedText: string;
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
  let acc = `${strokes.length}`;
  for (const s of strokes) {
    const dx = Math.round(s.transform.dx);
    const dy = Math.round(s.transform.dy);
    const ptLen = s.points.length;
    const p0 = s.points[0];
    const pLast = s.points[ptLen - 1];
    acc += `|${s.id}:${ptLen}:${dx},${dy}:${Math.round(p0?.x ?? 0)},${Math.round(p0?.y ?? 0)}->${Math.round(pLast?.x ?? 0)},${Math.round(pLast?.y ?? 0)}`;
  }
  return acc;
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
  visionResult: WonderVisionRecognitionResponse;
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

  const words =
    visionResult.words.length > 0
      ? visionResult.words
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
  signal?: AbortSignal;
}

/**
 * Hybrid V3 Perception Pipeline:
 * 1. Excludes AI teaching ink ('ai_teaching').
 * 2. Preserves user-confirmed & typed-vector/fixture ground truth transparently.
 * 3. Sends ONLY clean Layer 2 ink crops for freehand_ink regions to the Vision/Gateway provider
 *    when configured; degrades cleanly to PROVIDER_UNAVAILABLE / AMBIGUOUS with zero hallucination.
 */
export async function recognizeWithHybridPipeline(
  params: HybridPerceptionParams
): Promise<{
  regions: WonderRecognitionRegion[];
  diagnostics: WonderRecognitionDiagnosticEntry[];
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
    signal,
  } = params;

  const tSeg0 = Date.now();
  const segmented = segmentStrokesIntoRegions(strokes);
  const segmentationMs = Math.max(0, Date.now() - tSeg0);

  const tLocal0 = Date.now();
  const baseRegions = recognizeHandwritingRegions(strokes, boardId, revision);
  const localRecognitionMs = Math.max(0, Date.now() - tLocal0);

  const tCloud0 = Date.now();
  let apiCallsMade = 0;

  const finalRegions: WonderRecognitionRegion[] = [];
  const diagnostics: WonderRecognitionDiagnosticEntry[] = [];

  const pushDiag = (
    reg: WonderRecognitionRegion,
    latencyMs: number,
    fallbackReason: string,
    mappingStatus: WonderRecognitionDiagnosticEntry['mappingStatus']
  ) => {
    diagnostics.push({
      regionId: reg.regionId,
      sourceRevision: reg.revision,
      providerId: reg.providerId,
      engineVersion:
        reg.providerId === 'local-freehand-jamo'
          ? 'local-jamo-batchim-v3'
          : reg.providerId.includes('vision') || reg.providerId.includes('gateway')
            ? 'multimodal-vision-v3'
            : reg.providerId,
      recognitionStatus: reg.recognitionStatus,
      recognizedText: reg.recognizedText,
      confidence: reg.confidence,
      candidateAlternatives: reg.alternativeCandidates ?? [],
      providerLatencyMs: latencyMs,
      fallbackReason,
      mappingStatus,
      timestamp: Date.now(),
    });
  };

  for (let idx = 0; idx < baseRegions.length; idx++) {
    const base = baseRegions[idx];
    const seg = segmented[idx];

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
        regionId: base.regionId,
        revision,
        geometryRevision: revision,
        bbox: base.bbox,
      };
      finalRegions.push(updated);
      pushDiag(updated, 0, 'USER_CONFIRMED_PRESERVED', 'VERIFIED_STROKE_CLUSTERS');
      continue;
    }

    if (
      base.completeness === 'non_text' ||
      base.completeness === 'in_progress' ||
      base.provenance === 'typed_vector' ||
      base.provenance === 'fixture_sample' ||
      base.provenance === 'user_confirmed'
    ) {
      finalRegions.push(base);
      const reason =
        base.completeness === 'non_text'
          ? 'NON_TEXT_REJECTED'
          : base.completeness === 'in_progress'
            ? 'IN_PROGRESS_WAIT'
            : 'GROUND_TRUTH_INPUT';
      pushDiag(
        base,
        localRecognitionMs,
        reason,
        base.spans.length > 0 ? 'VERIFIED_STROKE_CLUSTERS' : 'UNMAPPED'
      );
      continue;
    }

    // If local compositional Jamo recognizer already matched freehand Hangul cleanly,
    // record verified local composition (skip redundant cloud calls unless needed)
    if (
      base.recognitionStatus === 'RECOGNIZED' &&
      base.providerId === 'local-freehand-jamo' &&
      base.confidence >= 0.8
    ) {
      finalRegions.push(base);
      pushDiag(base, localRecognitionMs, 'LOCAL_JAMO_COMPOSED', 'VERIFIED_STROKE_CLUSTERS');
      continue;
    }

    // True freehand_ink handling: check Vision provider if ambiguous locally or freehand upgrade requested
    const strokeHash = seg ? computeRegionStrokeHash(seg.strokes) : '';
    const cached = strokeHash ? cache?.get(strokeHash) : undefined;

    if (cached) {
      const cachedRegion = {
        ...base,
        recognizedText: cached.recognizedText,
        language: cached.language,
        confidence: cached.confidence,
        recognitionStatus: cached.status,
        completeness:
          cached.status === 'RECOGNIZED'
            ? 'complete'
            : cached.status === 'IN_PROGRESS'
              ? 'in_progress'
              : cached.status === 'NON_TEXT'
                ? 'non_text'
                : 'low_confidence',
        alternativeCandidates: cached.alternatives,
        providerId: cached.providerId,
      } as WonderRecognitionRegion;
      finalRegions.push(cachedRegion);
      pushDiag(cachedRegion, 0, 'VISION_CACHE_HIT', 'VERIFIED_STROKE_CLUSTERS');
      continue;
    }

    if (visionProvider && seg && !signal?.aborted) {
      const cropped = cropRenderer ? cropRenderer(seg.strokes, base.bbox) : null;
      try {
        apiCallsMade++;
        const vRes = await visionProvider.recognizeRegion({
          boardId,
          regionId: base.regionId,
          revision,
          strokes: seg.strokes,
          bbox: base.bbox,
          imageDataUrl: cropped?.imageDataUrl,
          cropTransform: cropped?.cropTransform,
          signal,
        });

        if (vRes.status === 'PROVIDER_UNAVAILABLE') {
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
            'UNMAPPED'
          );
          continue;
        }

        const validated: WonderVisionRecognitionResponse | null =
          validateVisionRecognitionPayload({
            recognizedText: vRes.recognizedText,
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
          pushDiag(ambigRegion, vRes.latencyMs, 'VISION_SCHEMA_INVALID', 'UNMAPPED');
          continue;
        }

        if (strokeHash) cache?.set(strokeHash, vRes);

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
          status === 'RECOGNIZED' ? 'VISION_PROVIDER_OK' : `VISION_STATUS_${status}`,
          aligned.mappingVerified
            ? 'VERIFIED_STROKE_CLUSTERS'
            : 'PROPORTIONAL_CLUSTER_FALLBACK'
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
        pushDiag(failRegion, Math.max(0, Date.now() - tCloud0), 'VISION_NETWORK_ERROR', 'UNMAPPED');
        continue;
      }
    }

    // No cloud vision provider active for freehand ink: keep base honest (AMBIGUOUS unless matched)
    const fallbackStatus: WonderRecognitionStatus =
      base.recognitionStatus === 'RECOGNIZED' && base.provenance === 'freehand_ink'
        ? base.recognitionStatus
        : base.recognitionStatus;
    const honestRegion: WonderRecognitionRegion = {
      ...base,
      recognitionStatus: fallbackStatus,
    };
    finalRegions.push(honestRegion);
    pushDiag(
      honestRegion,
      localRecognitionMs,
      honestRegion.recognitionStatus === 'RECOGNIZED'
        ? 'LOCAL_PROTOTYPE_OR_JAMO'
        : 'REAL_FREEHAND_RECOGNITION_BLOCKED_NO_CLOUD_PROVIDER',
      honestRegion.spans.length > 0 ? 'VERIFIED_STROKE_CLUSTERS' : 'UNMAPPED'
    );
  }

  return {
    regions: finalRegions,
    diagnostics,
    segmentationMs,
    localRecognitionMs,
    cloudRecognitionMs: apiCallsMade > 0 ? Math.max(0, Date.now() - tCloud0) : 0,
    apiCallsMade,
  };
}

export type { WonderStrokeProvenance };
