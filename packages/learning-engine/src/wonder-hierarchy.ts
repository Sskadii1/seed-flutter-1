import {
  WonderAnnotation,
  WonderBBox,
  WonderBoardDocument,
  WonderCompletionStatus,
  WonderInterventionGranularity,
  WonderNormalizedSpacingFeatures,
  WonderRecognitionRegion,
  WonderSemanticNode,
  WonderSemanticTree,
  WonderSpacingHypothesis,
  WonderStroke,
} from '@seed/schema';
import { boxesIntersect, mergeBoundingBoxes } from './wonder-board';

// ---------------------------------------------------------------------------
// 1. Local Handwriting Scale & Normalized Spatial-Temporal Features
// ---------------------------------------------------------------------------

function medianOf(nums: number[], fallback: number): number {
  if (nums.length === 0) return fallback;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function estimateLocalHandwritingScale(boxes: WonderBBox[]): {
  medianHeight: number;
  medianWidth: number;
} {
  const meaningful = boxes.filter((b) => b.height >= 8 || b.width >= 8);
  const source = meaningful.length > 0 ? meaningful : boxes;
  return {
    medianHeight: Math.max(18, medianOf(source.map((b) => b.height), 48)),
    medianWidth: Math.max(16, medianOf(source.map((b) => b.width), 42)),
  };
}

export function computeNormalizedSpacingFeatures(
  a: { bbox: WonderBBox; minTime?: number; maxTime?: number },
  b: { bbox: WonderBBox; minTime?: number; maxTime?: number },
  localScalePx: number
): WonderNormalizedSpacingFeatures {
  const scale = Math.max(16, localScalePx);
  const hGap = Math.max(0, a.bbox.minX - b.bbox.maxX, b.bbox.minX - a.bbox.maxX);
  const aCy = (a.bbox.minY + a.bbox.maxY) / 2;
  const bCy = (b.bbox.minY + b.bbox.maxY) / 2;
  const vOffset = Math.abs(aCy - bCy);
  const overlapY = Math.max(0, Math.min(a.bbox.maxY, b.bbox.maxY) - Math.max(a.bbox.minY, b.bbox.minY));
  const minH = Math.max(1, Math.min(a.bbox.height, b.bbox.height));
  const maxH = Math.max(1, Math.max(a.bbox.height, b.bbox.height));

  const baselineDiff = Math.abs(a.bbox.maxY - b.bbox.maxY);
  const baselineAlignmentScore = Math.max(0, Math.min(1, 1 - baselineDiff / (scale * 0.75)));

  let temporalProximityScore = 0.5;
  if (
    typeof a.maxTime === 'number' &&
    typeof b.minTime === 'number' &&
    typeof b.maxTime === 'number' &&
    typeof a.minTime === 'number'
  ) {
    const dt = Math.max(0, Math.min(Math.abs(b.minTime - a.maxTime), Math.abs(a.minTime - b.maxTime)));
    temporalProximityScore = Math.max(0, Math.min(1, 1 - dt / 15000));
  }

  return {
    normalizedHorizontalGap: hGap / scale,
    normalizedVerticalOffset: vOffset / scale,
    verticalOverlapRatio: overlapY / minH,
    baselineAlignmentScore,
    temporalProximityScore,
    relativeScaleDifference: Math.abs(a.bbox.height - b.bbox.height) / maxH,
  };
}

export function shouldGroupAdjacentUnits(
  features: WonderNormalizedSpacingFeatures,
  hasLinguisticBond: boolean
): { merge: boolean; score: number; kind: 'same_word' | 'same_line_space' | 'separate_region' } {
  if (features.relativeScaleDifference > 0.58) {
    return { merge: false, score: 0.1, kind: 'separate_region' };
  }
  if (features.verticalOverlapRatio < 0.22 && features.normalizedVerticalOffset > 0.72) {
    return { merge: false, score: 0.15, kind: 'separate_region' };
  }

  const gap = features.normalizedHorizontalGap;
  if (gap <= 0.34) {
    return {
      merge: true,
      score: Math.min(0.98, 0.78 + features.baselineAlignmentScore * 0.15 + features.temporalProximityScore * 0.05),
      kind: 'same_word',
    };
  }
  if (gap <= 0.85) {
    const score =
      (hasLinguisticBond ? 0.82 : 0.62) * features.baselineAlignmentScore +
      features.temporalProximityScore * 0.12;
    return {
      merge: hasLinguisticBond || score >= 0.48,
      score: Math.min(0.92, score),
      kind: hasLinguisticBond ? 'same_word' : 'same_line_space',
    };
  }
  if (gap <= 1.65) {
    const score =
      (hasLinguisticBond ? 0.68 : 0.45) * features.baselineAlignmentScore +
      features.temporalProximityScore * 0.12;
    return {
      merge: hasLinguisticBond || features.verticalOverlapRatio >= 0.4,
      score: Math.min(0.84, score),
      kind: 'same_line_space',
    };
  }

  return { merge: false, score: 0.2, kind: 'separate_region' };
}

// ---------------------------------------------------------------------------
// 2. Spacing-Aware Korean Decoder (Preserves Raw Text & Errors Verbatim)
// ---------------------------------------------------------------------------

const KOREAN_EOJEOL_LEXICON = new Set([
  // Pronouns / topics / subjects
  '저는', '제가', '나는', '내가', '너는', '우리는', '우리가', '이름은', '오늘', '어제', '내일',
  '지금', '여기', '거기', '저기', '어디', '언제', '누구', '무엇', '뭐', '정말', '진짜', '매우', '아주',
  // Nouns & noun+particle forms (including valid AND learner-error particle forms so raw errors are preserved!)
  '한국', '한국어', '한국어를', '한국어가', '한국어는', '한국어에',
  '베트남', '베트남어', '베트남어를', '베트남사람',
  '학교', '학교에', '학교에서', '학교를', '학교가',
  '사과', '사과를', '사과가', '사과는',
  '커피', '커피를', '커피가', '우유', '우유를', '우유가', '물', '물을', '물이', '밥', '밥을', '밥이',
  '빵', '빵을', '빵이', '책', '책을', '책이', '집', '집에', '집에서', '집을',
  '카페', '카페에', '카페에서', '도서관', '도서관에', '도서관에서', '회사', '회사에', '회사에서',
  '학생', '학생이에요', '학생예요', '선생님', '선생님이에요', '선생님예요',
  '사람', '사람이에요', '사람예요', '친구', '친구가', '친구를', '친구는',
  '날씨', '날씨가', '날씨는', '이름', '이름이', '이름을',
  '이거', '그거', '저거', '얼마예요', '한', '잔', '두',
  // Verbs / adjectives / greetings (present + past + base)
  '안녕하세요', '안녕', '감사합니다', '죄송합니다', '반갑습니다', '만나서',
  '가요', '갔어요', '와요', '왔어요', '먹어요', '먹었어요', '마셔요', '마셨어요',
  '봐요', '봤어요', '읽어요', '읽었어요', '공부해요', '공부했어요',
  '일해요', '일했어요', '운동해요', '운동했어요', '사랑해요', '사랑해', '사랑했어요', '사랑',
  '좋아요', '좋았어요', '맛있어요', '맛있었어요', '고마워', '고마워요', '미안해', '미안해요',
  '어디야', '나도야', '주세요', '이에요', '예요', '있어요', '없어요', '해요', '했어요',
]);

const KOREAN_NOUN_STEMS = new Set([
  '저', '나', '너', '우리', '한국', '한국어', '베트남', '학교', '사과', '커피', '우유',
  '물', '밥', '빵', '책', '집', '카페', '도서관', '회사', '학생', '선생님', '사람',
  '친구', '날씨', '이름', '아이', '아버지', '어머니', '오빠', '누나', '동생', '사진', '영화',
]);

const KOREAN_PARTICLE_SUFFIXES = ['에서', '이에요', '예요', '으로', '로', '은', '는', '이', '가', '을', '를', '에', '도', '와', '과'];
const KOREAN_VERB_SUFFIXES = ['았어요', '었어요', '했어요', '습니다', 'ㅂ니다', '세요', '아요', '어요', '해요', '예요', '야'];

function scoreKoreanEojeol(tokenWithPunct: string): number {
  const clean = tokenWithPunct.replace(/[.!?]+$/, '');
  if (!clean || !/[\uAC00-\uD7A3]/.test(clean)) return 0;
  if (KOREAN_EOJEOL_LEXICON.has(clean)) {
    return clean.length === 1 ? 4.5 : 8.0 + clean.length * 4.2;
  }

  // Noun + particle pattern (preserving whatever particle the learner actually wrote!)
  for (const pfx of KOREAN_PARTICLE_SUFFIXES) {
    if (clean.endsWith(pfx) && clean.length > pfx.length) {
      const stem = clean.slice(0, -pfx.length);
      if (KOREAN_NOUN_STEMS.has(stem) || stem.length >= 2) {
        return (KOREAN_NOUN_STEMS.has(stem) ? 8.5 : 4.2) + clean.length * 0.9;
      }
    }
  }

  // Predicate + polite/past suffix
  for (const vfx of KOREAN_VERB_SUFFIXES) {
    if (clean.endsWith(vfx) && clean.length > vfx.length) {
      return 6.2 + clean.length * 0.95;
    }
  }

  // Single character syllable without lexical/particle status gets low score (so valid 2+ combos beat 1+1)
  if (clean.length === 1) return 1.1;
  return 2.4 + clean.length * 0.35;
}

function dpSegmentKoreanString(glued: string): { tokens: string[]; score: number } {
  const trailMatch = glued.match(/([.!?]+)$/);
  const trail = trailMatch ? trailMatch[1] : '';
  const body = trail ? glued.slice(0, -trail.length) : glued;
  const n = body.length;
  if (n === 0) return { tokens: glued ? [glued] : [], score: 0 };

  const dpScore = new Array<number>(n + 1).fill(-Infinity);
  const dpPrev = new Array<number>(n + 1).fill(-1);
  dpScore[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 8); j < i; j++) {
      const cand = body.slice(j, i);
      const s = scoreKoreanEojeol(cand);
      const penalty = i - j === 1 ? -2.2 : -1.4;
      const total = dpScore[j] + s + penalty;
      if (total > dpScore[i]) {
        dpScore[i] = total;
        dpPrev[i] = j;
      }
    }
  }

  const tokens: string[] = [];
  let cur = n;
  while (cur > 0) {
    const prev = dpPrev[cur];
    if (prev < 0) break;
    tokens.unshift(body.slice(prev, cur));
    cur = prev;
  }
  if (trail && tokens.length > 0) {
    tokens[tokens.length - 1] += trail;
  }
  return { tokens, score: dpScore[n] };
}

/**
 * Decodes spacing hypotheses (Case A normal, Case B missing spaces, Case C excessive
 * syllable spacing, Case D irregular spacing, Case E independent notes) WITHOUT altering
 * or correcting learner grammar/particles.
 */
export function decodeKoreanSpacingHypotheses(
  rawText: string,
  avgNormalizedGap = 0.45
): WonderSpacingHypothesis[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [
      {
        id: 'hyp_empty',
        rawText: '',
        proposedText: '',
        tokens: [],
        score: 0,
        spacingIssue: 'none',
        reason: 'Empty input',
      },
    ];
  }

  const rawTokens = trimmed.split(/\s+/).filter(Boolean);
  const hasHangul = /[\uAC00-\uD7A3]/.test(trimmed);
  if (!hasHangul) {
    return [
      {
        id: 'hyp_non_ko',
        rawText: trimmed,
        proposedText: trimmed.replace(/\s+/g, ' '),
        tokens: rawTokens,
        score: 0.9,
        spacingIssue: 'none',
        reason: 'Non-Hangul transcription kept verbatim',
      },
    ];
  }

  const hypotheses: WonderSpacingHypothesis[] = [];
  const collapsedRaw = rawTokens.join(' ');
  const singleCharRatio =
    rawTokens.filter((t) => /^[\uAC00-\uD7A3][.!?]?$/.test(t)).length /
    Math.max(1, rawTokens.length);

  // Case B: Missing spaces (single unspaced Hangul clause >= 4 chars not already a single known lexicon word)
  const bareFirst = rawTokens[0]?.replace(/[.!?]+$/, '') ?? '';
  if (
    rawTokens.length === 1 &&
    bareFirst.length >= 4 &&
    !KOREAN_EOJEOL_LEXICON.has(bareFirst)
  ) {
    const dp = dpSegmentKoreanString(rawTokens[0]);
    const validFourCharSplit =
      bareFirst.length >= 5 || dp.tokens.every((t) => scoreKoreanEojeol(t) >= 8.0);
    if (dp.tokens.length >= 2 && validFourCharSplit) {
      hypotheses.push({
        id: 'hyp_case_b_missing_spaces',
        rawText: trimmed,
        proposedText: dp.tokens.join(' '),
        tokens: dp.tokens,
        score: Math.min(0.95, 0.72 + dp.score / (bareFirst.length * 4)),
        spacingIssue: 'missing_spaces',
        reason: `Segmented unspaced Korean sequence into ${dp.tokens.length} eojeols`,
      });
    }
  }

  // Case C & D: Excessive character spacing (e.g. "학 교 에", "저 는 한 국 어 를 공 부 해 요.")
  if (rawTokens.length >= 2 && (singleCharRatio >= 0.5 || rawTokens.some((t) => t.length === 1))) {
    const glued = rawTokens.join('');
    const dp = dpSegmentKoreanString(glued);
    const knownCount = dp.tokens.filter((t) =>
      KOREAN_EOJEOL_LEXICON.has(t.replace(/[.!?]+$/, '')) || scoreKoreanEojeol(t) >= 6.0
    ).length;
    const rawKnownCount = rawTokens.filter((t) =>
      KOREAN_EOJEOL_LEXICON.has(t.replace(/[.!?]+$/, '')) || scoreKoreanEojeol(t) >= 6.0
    ).length;

    const mergedLooksValid =
      dp.tokens.length < rawTokens.length &&
      (knownCount > rawKnownCount ||
        (dp.tokens.length === 1 && scoreKoreanEojeol(dp.tokens[0]) >= 6.0) ||
        avgNormalizedGap <= 0.8);

    // Protect independent practice lists like "사 아" where combining gives gibberish ("사아" score < 3.5)
    if (mergedLooksValid && dp.score > rawTokens.length * 2.1) {
      hypotheses.push({
        id: 'hyp_case_cd_spaced',
        rawText: trimmed,
        proposedText: dp.tokens.join(' '),
        tokens: dp.tokens,
        score: Math.min(0.94, 0.75 + knownCount * 0.05),
        spacingIssue: singleCharRatio >= 0.65 ? 'excessive_spaces' : 'irregular_spaces',
        reason: `Recombined character-spaced syllables into ${dp.tokens.length} eojeol(s)`,
      });
    }
  }

  // Always retain literal whitespace-collapsed transcription as an explicit candidate
  hypotheses.push({
    id: 'hyp_literal',
    rawText: trimmed,
    proposedText: collapsedRaw,
    tokens: rawTokens,
    score:
      hypotheses.length === 0
        ? 0.92
        : 0.45,
    spacingIssue: /\s{2,}/.test(trimmed) ? 'irregular_spaces' : 'none',
    reason: 'Literal recognized spacing',
  });

  return hypotheses.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// 3. Adaptive Temporal Scheduling
// ---------------------------------------------------------------------------

export function computeAdaptiveAnalysisDelayMs(
  recentStrokeTimes: number[],
  strokes: WonderStroke[],
  lastRegion?: WonderRecognitionRegion
): { groupingDelayMs: number; semanticDelayMs: number; writingCadenceMs: number } {
  const active = strokes.filter((s) => !s.deleted && s.provenance !== 'ai_teaching');
  const times = recentStrokeTimes.length >= 2
    ? recentStrokeTimes
    : active.map((s) => s.createdAt).slice(-10);

  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt >= 40 && dt <= 6000) deltas.push(dt);
  }
  const cadenceMs = Math.round(medianOf(deltas, 480));
  const groupingDelayMs = Math.max(180, Math.min(350, Math.round(cadenceMs * 0.55)));

  // Look for explicit sentence closure (.?! or polite ending) vs active word-in-progress
  // Baseline IDLE_COMMIT ceiling of 2800ms adapted from MaximeRivest/riddle `src/main.rs`
  const RIDDLE_IDLE_COMMIT_MS = 2800;
  const txt = lastRegion?.recognizedText?.trim() ?? '';
  const hasTerminalPunct = /[.!?]$/.test(txt);
  const looksPoliteComplete = /(해요|했어요|아요|어요|았어요|었어요|이에요|예요|습니다|ㅂ니다)$/.test(txt);
  const singleSyllableProvisional = /^[\uAC00-\uD7A3]$/.test(txt) && !hasTerminalPunct;

  let semanticDelayMs = Math.max(900, Math.min(RIDDLE_IDLE_COMMIT_MS, Math.round(cadenceMs * 2.4)));
  if (hasTerminalPunct || looksPoliteComplete) {
    semanticDelayMs = Math.max(680, Math.min(1250, Math.round(cadenceMs * 1.6)));
  } else if (singleSyllableProvisional || lastRegion?.completeness === 'in_progress') {
    semanticDelayMs = Math.max(1500, Math.min(RIDDLE_IDLE_COMMIT_MS, Math.round(cadenceMs * 3.4)));
  }

  return {
    groupingDelayMs,
    semanticDelayMs,
    writingCadenceMs: cadenceMs,
  };
}

// ---------------------------------------------------------------------------
// 4. Hierarchical Semantic Tree Builder (Levels 0 -> 9)
// ---------------------------------------------------------------------------

function computeRegionCompletionStatus(
  region: WonderRecognitionRegion,
  previousTree: WonderSemanticTree | undefined,
  normalizedText: string,
  nowMs: number,
  provisionalWindowMs: number,
  regionStrokes: WonderStroke[]
): WonderCompletionStatus {
  if (
    region.recognitionStatus === 'AMBIGUOUS' ||
    region.recognitionStatus === 'PROVIDER_UNAVAILABLE' ||
    region.completeness === 'low_confidence'
  ) {
    return 'AMBIGUOUS';
  }
  if (region.completeness === 'in_progress') {
    return 'IN_PROGRESS';
  }

  const prevSameStrokeNode = previousTree?.nodes.find(
    (n) =>
      (n.level === 'sentence' || n.level === 'eojeol' || n.level === 'lexical_word') &&
      n.sourceStrokeIds.some((id) => region.strokeIds.includes(id))
  );
  if (
    prevSameStrokeNode &&
    (prevSameStrokeNode.completionStatus === 'STABLE' ||
      prevSameStrokeNode.completionStatus === 'FINALIZED_FOR_CURRENT_ANALYSIS') &&
    prevSameStrokeNode.normalizedCandidateText !== normalizedText
  ) {
    return 'REOPENED';
  }

  const lastTime = regionStrokes.reduce((m, s) => Math.max(m, s.createdAt), 0);
  const isFreshSingleSyllable =
    provisionalWindowMs > 0 &&
    region.provenance === 'freehand_ink' &&
    /^[\uAC00-\uD7A3]$/.test(normalizedText.trim()) &&
    nowMs - lastTime < provisionalWindowMs &&
    !prevSameStrokeNode;

  if (isFreshSingleSyllable) {
    return 'PROVISIONAL';
  }
  return 'STABLE';
}

export function buildHierarchicalSemanticTree(params: {
  boardId: string;
  revision: number;
  strokes: WonderStroke[];
  regions: WonderRecognitionRegion[];
  previousTree?: WonderSemanticTree;
  nowMs?: number;
  writingCadenceMs?: number;
  provisionalWindowMs?: number;
}): WonderSemanticTree {
  const {
    boardId,
    revision,
    strokes,
    regions,
    previousTree,
    nowMs = Date.now(),
    writingCadenceMs = 480,
    provisionalWindowMs = 0,
  } = params;

  const activeStrokes = strokes.filter((s) => !s.deleted && s.provenance !== 'ai_teaching');
  const strokeById = new Map(activeStrokes.map((s) => [s.id, s]));
  const nodes: WonderSemanticNode[] = [];
  const rootId = `ctx_${boardId}_r${revision}`;

  const boardBBox =
    regions.length > 0
      ? mergeBoundingBoxes(regions.map((r) => r.bbox))
      : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

  const regionEntries: Array<{
    region: WonderRecognitionRegion;
    sentenceNode: WonderSemanticNode;
    localScalePx: number;
  }> = [];

  for (const reg of regions) {
    const regStrokes = reg.strokeIds
      .map((id) => strokeById.get(id))
      .filter((s): s is WonderStroke => Boolean(s));
    const glyphBoxes =
      reg.characterSpans.length > 0
        ? reg.characterSpans.map((c) => c.bbox)
        : reg.spans.length > 0
          ? reg.spans.map((sp) => sp.bbox)
          : [reg.bbox];
    const localScalePx = estimateLocalHandwritingScale(glyphBoxes).medianHeight;
    const avgNormGap =
      reg.spans.length >= 2
        ? reg.spans
            .slice(1)
            .reduce((acc, sp, idx) => acc + Math.max(0, sp.bbox.minX - reg.spans[idx].bbox.maxX) / localScalePx, 0) /
          (reg.spans.length - 1)
        : 0.45;

    const spacingHypotheses = decodeKoreanSpacingHypotheses(reg.recognizedText, avgNormGap);
    const topHyp = spacingHypotheses[0];
    const normalizedText = topHyp?.proposedText || reg.recognizedText;
    const completionStatus = computeRegionCompletionStatus(
      reg,
      previousTree,
      normalizedText,
      nowMs,
      provisionalWindowMs,
      regStrokes
    );

    const sentenceId = `sent_${reg.regionId}`;
    const sentenceNode: WonderSemanticNode = {
      id: sentenceId,
      level: 'sentence',
      parentId: null,
      childIds: [],
      sourceStrokeIds: reg.strokeIds,
      recognizedText: normalizedText,
      originalTranscription: reg.recognizedText,
      normalizedCandidateText: normalizedText,
      alternativeCandidates: reg.alternativeCandidates ?? [],
      bbox: reg.bbox,
      language: reg.language,
      recognitionConfidence: reg.confidence,
      segmentationConfidence: topHyp?.score ?? 0.88,
      semanticConfidence: reg.confidence * (topHyp?.score ?? 0.9),
      contentRevision: reg.contentRevision,
      geometryRevision: reg.geometryRevision,
      semanticRevision: reg.semanticRevision,
      completionStatus,
      contextDependencyIds: [],
      localScalePx,
      spacingHypotheses,
    };

    // Build Level 4/5 Eojeol/LexicalWord child nodes + Level 3 Syllable children
    const tokens = topHyp && topHyp.tokens.length > 0 ? topHyp.tokens : [normalizedText].filter(Boolean);
    let charCursor = 0;
    const charSpans = reg.characterSpans;

    tokens.forEach((tok, tIdx) => {
      const cleanLen = tok.length;
      // Map token slice onto characterSpans cleanly by non-space index if spacing changed
      const nonSpaceChars = tok.replace(/\s+/g, '');
      const matchingCharSpans: typeof charSpans = [];
      let matchedChars = 0;
      while (charCursor < charSpans.length && matchedChars < nonSpaceChars.length) {
        const cs = charSpans[charCursor];
        charCursor++;
        if (cs.text.trim().length === 0) continue;
        matchingCharSpans.push(cs);
        matchedChars++;
      }

      const fallbackSpan = reg.spans[Math.min(tIdx, Math.max(0, reg.spans.length - 1))];
      const eojeolStrokes = Array.from(
        new Set(
          matchingCharSpans.length > 0
            ? matchingCharSpans.flatMap((c) => c.strokeIds)
            : fallbackSpan?.strokeIds ?? reg.strokeIds
        )
      );
      const eojeolBox =
        matchingCharSpans.length > 0
          ? mergeBoundingBoxes(matchingCharSpans.map((c) => c.bbox))
          : fallbackSpan?.bbox ?? reg.bbox;

      const eojeolId = `eoj_${reg.regionId}_${tIdx}`;
      const syllChildIds: string[] = [];

      matchingCharSpans.forEach((cs, sIdx) => {
        const syllId = `syl_${reg.regionId}_${tIdx}_${sIdx}`;
        syllChildIds.push(syllId);
        nodes.push({
          id: syllId,
          level: /^[\u3131-\u318E]$/.test(cs.text) ? 'hangul_jamo' : 'syllable_block',
          parentId: eojeolId,
          childIds: cs.strokeIds,
          sourceStrokeIds: cs.strokeIds,
          recognizedText: cs.text,
          originalTranscription: cs.text,
          normalizedCandidateText: cs.text,
          alternativeCandidates: [],
          bbox: cs.bbox,
          language: reg.language,
          recognitionConfidence: cs.confidence,
          segmentationConfidence: 0.9,
          semanticConfidence: cs.confidence,
          contentRevision: reg.contentRevision,
          geometryRevision: reg.geometryRevision,
          semanticRevision: reg.semanticRevision,
          completionStatus,
          contextDependencyIds: [eojeolId],
          localScalePx,
        });
      });

      const isSingleSyll = Array.from(tok.replace(/[.!?]/g, '')).length <= 1;
      nodes.push({
        id: eojeolId,
        level: tokens.length === 1 && isSingleSyll ? 'syllable_block' : 'eojeol',
        parentId: sentenceId,
        childIds: syllChildIds,
        sourceStrokeIds: eojeolStrokes,
        recognizedText: tok,
        originalTranscription: tok,
        normalizedCandidateText: tok,
        alternativeCandidates: [],
        bbox: eojeolBox,
        language: reg.language,
        recognitionConfidence: reg.confidence,
        segmentationConfidence: topHyp?.score ?? 0.9,
        semanticConfidence: reg.confidence,
        contentRevision: reg.contentRevision,
        geometryRevision: reg.geometryRevision,
        semanticRevision: reg.semanticRevision,
        completionStatus,
        contextDependencyIds: [sentenceId],
        localScalePx,
      });
      sentenceNode.childIds.push(eojeolId);
      void cleanLen;
    });

    regionEntries.push({ region: reg, sentenceNode, localScalePx });
  }

  // Group sentences into Level 8 Paragraph nodes ONLY when left-aligned, same-scale, & vertically contiguous
  const textEntries = regionEntries.filter(
    (e) =>
      e.region.completeness !== 'non_text' &&
      e.region.recognizedText.trim().length > 0
  );
  const nonTextEntries = regionEntries.filter(
    (e) =>
      e.region.completeness === 'non_text' ||
      e.region.recognizedText.trim().length === 0
  );

  const paragraphClusters: Array<typeof regionEntries> = [];
  const sortedByTop = [...textEntries].sort((a, b) => a.sentenceNode.bbox.minY - b.sentenceNode.bbox.minY);
  for (const entry of sortedByTop) {
    const matchCluster = paragraphClusters.find((cluster) => {
      const last = cluster[cluster.length - 1];
      const maxScale = Math.max(last.localScalePx, entry.localScalePx, 1);
      const scaleDiff = Math.abs(last.localScalePx - entry.localScalePx) / maxScale;
      if (scaleDiff > 0.45) return false;
      const vGap = entry.sentenceNode.bbox.minY - last.sentenceNode.bbox.maxY;
      const leftDelta = Math.abs(entry.sentenceNode.bbox.minX - last.sentenceNode.bbox.minX);
      const horizOverlap = boxesIntersect(
        { ...last.sentenceNode.bbox, minY: 0, maxY: 1, height: 1 },
        { ...entry.sentenceNode.bbox, minY: 0, maxY: 1, height: 1 },
        maxScale
      );
      return vGap >= -maxScale * 0.2 && vGap <= maxScale * 1.9 && (leftDelta <= maxScale * 2.2 || horizOverlap);
    });
    if (matchCluster) {
      matchCluster.push(entry);
    } else {
      paragraphClusters.push([entry]);
    }
  }

  const paragraphIds: string[] = [];
  paragraphClusters.forEach((cluster, pIdx) => {
    const paraId = `para_${boardId}_r${revision}_${pIdx}`;
    paragraphIds.push(paraId);
    const paraBox = mergeBoundingBoxes(cluster.map((c) => c.sentenceNode.bbox));
    const paraText = cluster.map((c) => c.sentenceNode.normalizedCandidateText).join('\n');
    const paraStrokes = cluster.flatMap((c) => c.sentenceNode.sourceStrokeIds);
    const avgScale =
      cluster.reduce((acc, c) => acc + c.localScalePx, 0) / Math.max(1, cluster.length);

    cluster.forEach((c) => {
      c.sentenceNode.parentId = paraId;
      nodes.push(c.sentenceNode);
    });

    nodes.push({
      id: paraId,
      level: 'paragraph',
      parentId: rootId,
      childIds: cluster.map((c) => c.sentenceNode.id),
      sourceStrokeIds: paraStrokes,
      recognizedText: paraText,
      originalTranscription: cluster.map((c) => c.sentenceNode.originalTranscription).join('\n'),
      normalizedCandidateText: paraText,
      alternativeCandidates: [],
      bbox: paraBox,
      language: cluster.every((c) => c.sentenceNode.language === 'ko') ? 'ko' : 'mixed',
      recognitionConfidence:
        cluster.reduce((acc, c) => acc + c.sentenceNode.recognitionConfidence, 0) / cluster.length,
      segmentationConfidence: 0.9,
      semanticConfidence: 0.88,
      contentRevision: revision,
      geometryRevision: revision,
      semanticRevision: revision,
      completionStatus: cluster.some((c) => c.sentenceNode.completionStatus === 'IN_PROGRESS')
        ? 'IN_PROGRESS'
        : 'STABLE',
      contextDependencyIds: [],
      localScalePx: avgScale,
    });
  });

  for (const nt of nonTextEntries) {
    nt.sentenceNode.parentId = rootId;
    nodes.push(nt.sentenceNode);
    paragraphIds.push(nt.sentenceNode.id);
  }

  nodes.push({
    id: rootId,
    level: 'board_context',
    parentId: null,
    childIds: paragraphIds,
    sourceStrokeIds: activeStrokes.map((s) => s.id),
    recognizedText: textEntries.map((e) => e.sentenceNode.normalizedCandidateText).join('\n'),
    originalTranscription: textEntries.map((e) => e.sentenceNode.originalTranscription).join('\n'),
    normalizedCandidateText: textEntries.map((e) => e.sentenceNode.normalizedCandidateText).join('\n'),
    alternativeCandidates: [],
    bbox: boardBBox,
    language: 'mixed',
    recognitionConfidence: 1,
    segmentationConfidence: 1,
    semanticConfidence: 1,
    contentRevision: revision,
    geometryRevision: revision,
    semanticRevision: revision,
    completionStatus: 'STABLE',
    contextDependencyIds: [],
    localScalePx: estimateLocalHandwritingScale(textEntries.map((e) => e.sentenceNode.bbox)).medianHeight,
  });

  return {
    boardId,
    revision,
    rootId,
    nodes,
    writingCadenceMs,
    updatedAt: nowMs,
  };
}

// ---------------------------------------------------------------------------
// 5. Intervention Granularity Policy & Redundant Child Suppression (P0)
// ---------------------------------------------------------------------------

export function selectInterventionGranularity(
  sentenceNode: WonderSemanticNode,
  board: Pick<WonderBoardDocument, 'aiEnabled' | 'aiMode'>,
  explicitIntent?: string
): WonderInterventionGranularity {
  if (!board.aiEnabled || board.aiMode === 'focus') {
    return 'SILENT_OBSERVE';
  }
  if (
    sentenceNode.completionStatus === 'AMBIGUOUS' ||
    sentenceNode.completionStatus === 'IN_PROGRESS' ||
    sentenceNode.completionStatus === 'PROVISIONAL'
  ) {
    return 'SILENT_OBSERVE';
  }
  if (explicitIntent === 'ASK_HOW_TO_WRITE' || explicitIntent === 'PRACTICE_HANGUL') {
    return 'CHARACTER';
  }

  const txt = sentenceNode.normalizedCandidateText.trim();
  if (!txt) return 'SILENT_OBSERVE';

  const topHyp = sentenceNode.spacingHypotheses?.[0];
  const tokens =
    topHyp && topHyp.tokens.length > 0 ? topHyp.tokens : txt.split(/\s+/).filter(Boolean);
  const cleanFirst = tokens[0]?.replace(/[.!?]+$/, '') ?? '';

  if (tokens.length === 1 && /^[\uAC00-\uD7A3]$/.test(cleanFirst)) {
    return 'CHARACTER';
  }
  if (tokens.length === 1) {
    return 'WORD';
  }
  return 'SENTENCE';
}

/**
 * Section 14 (P0) & Scenario 10:
 * Reassesses child annotations whenever strokes are absorbed into a higher-level parent
 * (e.g., 사 -> 사랑 -> 사랑해 -> 사랑해요, or 학 교 에 -> 학교에), or when a target error
 * has already disappeared after continued editing.
 */
export function reconcileSemanticAnnotations(
  annotations: WonderAnnotation[],
  tree: WonderSemanticTree
): {
  nextAnnotations: WonderAnnotation[];
  retractedAnnotationIds: string[];
} {
  const retractedAnnotationIds: string[] = [];
  const sentenceNodes = tree.nodes.filter((n) => n.level === 'sentence');

  const nextAnnotations = annotations.map((ann) => {
    if (ann.status !== 'active') return ann;

    const parentSentence = sentenceNodes.find((sn) =>
      ann.source_stroke_ids.some((id) => sn.sourceStrokeIds.includes(id))
    );
    if (!parentSentence) return ann;

    const topHyp = parentSentence.spacingHypotheses?.[0];
    const hasSpacingDecode = Boolean(topHyp && topHyp.spacingIssue !== 'none');
    const parentTokens =
      topHyp?.tokens ??
      parentSentence.normalizedCandidateText.split(/\s+/).filter(Boolean);
    const parentClean = parentSentence.normalizedCandidateText.replace(/[.!?]+$/, '').trim();
    const annClean = ann.target_text.replace(/[.!?]+$/, '').trim();

    const tokenStillStandalone = parentTokens.some(
      (t) => t.replace(/[.!?]+$/, '').trim() === annClean
    );
    const ENGLISH_CLAUSE_STOPWORDS = new Set([
      'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'am', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did',
      'can', 'could', 'will', 'would', 'should', 'must', 'may', 'might',
      'the', 'a', 'an', 'and', 'but', 'or', 'to', 'in', 'on', 'at', 'for', 'yesterday',
    ]);
    const isKoreanPracticeRow =
      parentTokens.every((t) => {
        const cleanT = t.trim();
        if (!/^[\uAC00-\uD7A3]{1,3}$/.test(cleanT)) return false;
        if (
          cleanT.length >= 2 &&
          /(요|다|니다|까요|세요|예요|이에요|은|는|이|가|을|를|에서|에)$/.test(cleanT)
        ) {
          return false;
        }
        return true;
      });
    const isEnglishPracticeRow =
      parentTokens.length <= 5 &&
      parentTokens.every((t) => {
        const cleanT = t.trim();
        return (
          /^[A-Za-z][A-Za-z'-]{1,20}$/.test(cleanT) &&
          !ENGLISH_CLAUSE_STOPWORDS.has(cleanT.toLowerCase())
        );
      });
    const isSideBySidePracticeRow =
      !hasSpacingDecode &&
      parentTokens.length >= 2 &&
      !/[.!?]$/.test(parentSentence.normalizedCandidateText.trim()) &&
      (isKoreanPracticeRow || isEnglishPracticeRow);

    // 1. Child syllable/word explanation superseded because strokes merged into a larger parent expression
    // (Never retract an unchanged standalone item in an independent side-by-side practice row like "사" -> "사 아")
    const isCharOrWordInfo =
      ann.severity === 'info' &&
      (ann.annotation_type === 'explanation' || ann.granularity === 'CHARACTER');
    const isStrictSubsetOfLargerParent =
      ann.source_stroke_ids.length < parentSentence.sourceStrokeIds.length &&
      parentClean.length > annClean.length &&
      parentClean.replace(/\s+/g, '').includes(annClean.replace(/\s+/g, '')) &&
      (parentTokens.length >= 2 || parentClean.replace(/\s+/g, '').length >= 2) &&
      ann.recognized_text.replace(/\s+/g, '') !== parentSentence.normalizedCandidateText.replace(/\s+/g, '');

    if (
      isCharOrWordInfo &&
      isStrictSubsetOfLargerParent &&
      !(tokenStillStandalone && isSideBySidePracticeRow)
    ) {
      retractedAnnotationIds.push(ann.annotation_id);
      return {
        ...ann,
        status: 'stale' as const,
        lifecycle_state: 'cancelled' as const,
        reconciliation_action: 'SUPERSEDED' as const,
        retracted_reason: `Superseded by parent semantic unit "${parentSentence.normalizedCandidateText}"`,
        parent_node_id: parentSentence.id,
      };
    }

    // 2. Active/pending error disappears after continued/edited writing in the same region (Scenario 10)
    if (
      ann.severity === 'error' &&
      ann.target_text.length > 0 &&
      !parentSentence.normalizedCandidateText.includes(ann.target_text) &&
      !parentSentence.originalTranscription.includes(ann.target_text)
    ) {
      retractedAnnotationIds.push(ann.annotation_id);
      return {
        ...ann,
        status: 'stale' as const,
        lifecycle_state: 'cancelled' as const,
        reconciliation_action: 'INVALIDATED' as const,
        retracted_reason: `Error token "${ann.target_text}" no longer present in "${parentSentence.normalizedCandidateText}"`,
        parent_node_id: parentSentence.id,
      };
    }

    return {
      ...ann,
      parent_node_id: ann.parent_node_id ?? parentSentence.id,
    };
  });

  return { nextAnnotations, retractedAnnotationIds };
}

// ---------------------------------------------------------------------------
// 6. Section 22 Hierarchical Benchmark Metrics
// ---------------------------------------------------------------------------

export interface WonderHierarchyBenchmarkReport {
  datasetProvenance: 'synthetic_and_freehand_controlled';
  realHumanFreehandStatus: 'NOT_MEASURED_IN_UNIT_BENCHMARK';
  scenarioCount: number;
  characterRecognitionAccuracy: number;
  wordRecognitionAccuracy: number;
  wordBoundaryPrecision: number;
  wordBoundaryRecall: number;
  sentenceSegmentationQuality: number;
  semanticMergeAccuracy: number;
  semanticSplitAccuracy: number;
  falseMergeRate: number;
  falseSplitRate: number;
  redundantAnnotationRate: number;
  incorrectGranularityRate: number;
  staleAnnotationRate: number;
  duplicateAnnotationRate: number;
  endToEndLatencyMs: number;
}
