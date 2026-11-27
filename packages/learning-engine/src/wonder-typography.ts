import type { WonderAnimationSpeed } from '@seed/schema';

export type WonderScriptClass =
  | 'hangul_syllable'
  | 'hangul_jamo'
  | 'vietnamese_latin'
  | 'ipa_phonetic'
  | 'number'
  | 'math_symbol'
  | 'punctuation'
  | 'whitespace';

export type WonderTypographyRole = 'correction' | 'explanation';

export interface WonderFontRun {
  text: string;
  script: WonderScriptClass;
  fontFamily: string;
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacingEm: number;
  baselineShiftEm: number;
  scaleFactor: number;
}

export interface WonderMeasuredLine {
  text: string;
  runs: WonderFontRun[];
  width: number;
}

export interface WonderWrappedTextMetrics {
  lines: WonderMeasuredLine[];
  maxWidth: number;
  totalHeight: number;
  lineHeight: number;
}

export interface WonderAdaptiveTypographySpec {
  correctionCssPx: number;
  explanationCssPx: number;
  correctionWorldPx: number;
  explanationWorldPx: number;
  lineHeightRatio: number;
  explLineHeightWorldPx: number;
  explGapTopWorldPx: number;
  safeGapCssPx: number;
  safeGapWorldPx: number;
  maxLineWidthWorldPx: number;
}

export interface WonderAnimationPhaseTimings {
  cloudMs: number;
  pauseAfterCloudMs: number;
  arrowMs: number;
  pauseBeforeExplMs: number;
  corrMs: number;
  explMs: number;
  totalAnimMs: number;
  queueMultiplier: number;
  speedFactor: number;
}

export const FONT_FAMILY_VI_CHALK = "'Playpen Sans', 'Be Vietnam Pro', sans-serif";
export const FONT_FAMILY_KO_CHALK = "'Gaegu', 'Noto Sans KR', sans-serif";
export const FONT_FAMILY_IPA_SYMBOL = "'Be Vietnam Pro', 'Noto Sans KR', sans-serif";

export const WONDER_SPEED_FACTORS: Record<WonderAnimationSpeed, number> = {
  slow: 1.5,
  natural: 1.0,
  fast: 0.55,
  instant: 0,
};

/**
 * Normalizes display text to Unicode NFC and splits cleanly into Unicode grapheme
 * clusters so Vietnamese combining diacritics and Hangul syllables are never split.
 */
export function segmentUnicodeGraphemes(text: string): string[] {
  const normalized = text.normalize('NFC');
  if (!normalized) return [];
  const intlAny = Intl as unknown as {
    Segmenter?: new (
      locale: string,
      opts: { granularity: string }
    ) => { segment(s: string): Iterable<{ segment: string }> };
  };
  if (typeof intlAny.Segmenter === 'function') {
    const seg = new intlAny.Segmenter('vi', { granularity: 'grapheme' });
    return Array.from(seg.segment(normalized), (x) => x.segment);
  }
  const out: string[] = [];
  for (const ch of Array.from(normalized)) {
    const cp = ch.codePointAt(0) ?? 0;
    const isCombining =
      (cp >= 0x0300 && cp <= 0x036f) ||
      (cp >= 0x1ab0 && cp <= 0x1aff) ||
      (cp >= 0x1dc0 && cp <= 0x1dff) ||
      (cp >= 0xfe20 && cp <= 0xfe2f);
    if (isCombining && out.length > 0) {
      out[out.length - 1] += ch;
    } else {
      out.push(ch);
    }
  }
  return out;
}

const MATH_SYMBOL_SET = new Set([
  '=',
  '+',
  '-',
  '−',
  '→',
  '←',
  '↔',
  '⇒',
  '—',
  '–',
  '×',
  '÷',
  '≈',
  '≠',
  '≤',
  '≥',
]);

function classifyGraphemeScript(grapheme: string, inIpaBracket: boolean): WonderScriptClass {
  if (/^\s+$/.test(grapheme)) return 'whitespace';
  const cp = grapheme.codePointAt(0) ?? 0;
  if (cp >= 0xac00 && cp <= 0xd7a3) return 'hangul_syllable';
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xd7b0 && cp <= 0xd7ff)
  ) {
    return 'hangul_jamo';
  }
  if (inIpaBracket || (cp >= 0x0250 && cp <= 0x02af)) return 'ipa_phonetic';
  if (MATH_SYMBOL_SET.has(grapheme)) return 'math_symbol';
  if (/^[0-9]$/.test(grapheme)) return 'number';
  if (/^[.,!?:;'"()[\]{}/\\]$/.test(grapheme)) return 'punctuation';
  return 'vietnamese_latin';
}

function getRunStyleConfig(
  script: WonderScriptClass,
  role: WonderTypographyRole
): {
  fontFamily: string;
  scaleFactor: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacingEm: number;
  baselineShiftEm: number;
} {
  switch (script) {
    case 'hangul_syllable':
      return {
        fontFamily: FONT_FAMILY_KO_CHALK,
        scaleFactor: 1.1,
        fontWeight: '700',
        letterSpacingEm: 0.015,
        baselineShiftEm: 0.02,
      };
    case 'hangul_jamo':
      return {
        fontFamily: FONT_FAMILY_KO_CHALK,
        scaleFactor: 1.14,
        fontWeight: '700',
        letterSpacingEm: 0.02,
        baselineShiftEm: 0.03,
      };
    case 'ipa_phonetic':
      return {
        fontFamily: FONT_FAMILY_IPA_SYMBOL,
        scaleFactor: 0.88,
        fontWeight: '500',
        letterSpacingEm: 0.02,
        baselineShiftEm: 0,
      };
    case 'math_symbol':
      return {
        fontFamily: FONT_FAMILY_IPA_SYMBOL,
        scaleFactor: 0.95,
        fontWeight: '600',
        letterSpacingEm: 0.04,
        baselineShiftEm: -0.02,
      };
    case 'vietnamese_latin':
    case 'number':
    case 'punctuation':
    case 'whitespace':
    default:
      return {
        fontFamily: FONT_FAMILY_VI_CHALK,
        scaleFactor: role === 'correction' ? 0.94 : 1.0,
        fontWeight: role === 'correction' ? '600' : '500',
        letterSpacingEm: role === 'correction' ? 0.01 : 0.005,
        baselineShiftEm: 0,
      };
  }
}

/**
 * Splits mixed Korean/Vietnamese/IPA/math text into explicit font runs with
 * normalized visual scale, stroke weight, baseline alignment, and spacing.
 */
export function segmentMixedLanguageRuns(
  text: string,
  role: WonderTypographyRole,
  baseFontSize: number
): WonderFontRun[] {
  const graphemes = segmentUnicodeGraphemes(text);
  if (graphemes.length === 0) return [];

  // Identify bracketed phonetic spans like [a] or [ko-ma-wo]
  const ipaFlags = new Array<boolean>(graphemes.length).fill(false);
  let idx = 0;
  while (idx < graphemes.length) {
    if (graphemes[idx] === '[') {
      const closeIdx = graphemes.indexOf(']', idx + 1);
      if (closeIdx > idx && closeIdx - idx <= 24) {
        const inside = graphemes.slice(idx + 1, closeIdx).join('');
        if (/^[a-zA-Z0-9\u0250-\u02AF\s\-ːˈˌ.]+$/.test(inside)) {
          for (let k = idx; k <= closeIdx; k++) {
            ipaFlags[k] = true;
          }
          idx = closeIdx + 1;
          continue;
        }
      }
    }
    idx++;
  }

  const runs: WonderFontRun[] = [];
  for (let i = 0; i < graphemes.length; i++) {
    const g = graphemes[i];
    const script = classifyGraphemeScript(g, ipaFlags[i]);
    const style = getRunStyleConfig(script, role);
    const fontSize = Number((baseFontSize * style.scaleFactor).toFixed(2));
    const prev = runs[runs.length - 1];

    const canMerge =
      prev &&
      ((prev.fontFamily === style.fontFamily &&
        prev.fontWeight === style.fontWeight &&
        Math.abs(prev.fontSize - fontSize) < 0.05 &&
        Math.abs(prev.baselineShiftEm - style.baselineShiftEm) < 0.005) ||
        (script === 'whitespace' &&
          (prev.script === 'vietnamese_latin' ||
            prev.script === 'punctuation' ||
            prev.script === 'number')));

    if (canMerge && prev) {
      prev.text += g;
    } else {
      runs.push({
        text: g,
        script,
        fontFamily: style.fontFamily,
        fontSize,
        fontWeight: style.fontWeight,
        letterSpacingEm: style.letterSpacingEm,
        baselineShiftEm: style.baselineShiftEm,
        scaleFactor: style.scaleFactor,
      });
    }
  }

  return runs;
}

/**
 * Heuristic fallback width estimator when Canvas 2D measureText is unavailable (Node tests).
 */
export function estimateFontRunWidthFallback(run: WonderFontRun): number {
  const graphemes = segmentUnicodeGraphemes(run.text);
  let width = 0;
  for (const g of graphemes) {
    if (/^\s+$/.test(g)) {
      width += run.fontSize * 0.34;
    } else if (run.script === 'hangul_syllable' || run.script === 'hangul_jamo') {
      width += run.fontSize * 0.96;
    } else if (run.script === 'math_symbol') {
      width += run.fontSize * 0.72;
    } else if (/^[ilIjtf.,!?:;'"|]$/.test(g)) {
      width += run.fontSize * 0.36;
    } else if (/^[mwMW]$/.test(g)) {
      width += run.fontSize * 0.82;
    } else {
      width += run.fontSize * 0.56;
    }
    width += run.fontSize * run.letterSpacingEm;
  }
  return width;
}

export type MeasureRunWidthFn = (run: WonderFontRun) => number;

export function measureMixedLanguageLine(
  text: string,
  role: WonderTypographyRole,
  baseFontSize: number,
  measureRunWidth: MeasureRunWidthFn = estimateFontRunWidthFallback
): WonderMeasuredLine {
  const runs = segmentMixedLanguageRuns(text, role, baseFontSize);
  const width = runs.reduce((acc, run) => acc + measureRunWidth(run), 0);
  return {
    text: text.normalize('NFC'),
    runs,
    width: Number(width.toFixed(2)),
  };
}

/**
 * Wraps mixed-language text into visual lines using real measured font-run pixel widths.
 */
export function wrapMixedLanguageRuns(
  text: string,
  role: WonderTypographyRole,
  baseFontSize: number,
  maxLineWidth: number,
  lineHeightRatio = 1.48,
  measureRunWidth: MeasureRunWidthFn = estimateFontRunWidthFallback,
  maxLines = 8
): WonderWrappedTextMetrics {
  const normalized = text.normalize('NFC').trim();
  const lineHeight = Number((baseFontSize * lineHeightRatio).toFixed(2));
  if (!normalized) {
    return { lines: [], maxWidth: 0, totalHeight: 0, lineHeight };
  }

  const tokens = normalized.split(/\s+/);
  const lines: WonderMeasuredLine[] = [];
  let current = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!current) {
      current = token;
      continue;
    }
    const candidate = `${current} ${token}`;
    const measured = measureMixedLanguageLine(candidate, role, baseFontSize, measureRunWidth);
    if (measured.width <= maxLineWidth) {
      current = candidate;
    } else if (lines.length < maxLines - 1) {
      lines.push(measureMixedLanguageLine(current, role, baseFontSize, measureRunWidth));
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(measureMixedLanguageLine(current, role, baseFontSize, measureRunWidth));
  }

  const maxWidth = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const totalHeight = lines.length * lineHeight;
  return {
    lines,
    maxWidth: Number(maxWidth.toFixed(2)),
    totalHeight: Number(totalHeight.toFixed(2)),
    lineHeight,
  };
}

/**
 * Decouples annotation typography from raw giant handwriting while maintaining
 * crisp legibility across 45%–200% zoom levels.
 * At 100% zoom:
 * - Correction: 24–36 CSS px
 * - Explanation: 16–21 CSS px
 * - Line height: 1.48 (within 1.4–1.55)
 * - Safe gap: 24–40 CSS px
 */
export function computeAdaptiveAnnotationTypography(
  targetHeightWorld: number,
  viewportScale = 1
): WonderAdaptiveTypographySpec {
  const safeTargetH = Math.max(24, targetHeightWorld);
  const vScale = Math.max(0.35, Math.min(2.6, viewportScale || 1));

  const correctionCssPx = Math.round(
    Math.max(24, Math.min(36, 24 + (safeTargetH - 42) * 0.075))
  );
  const explanationCssPx = Math.round(
    Math.max(16, Math.min(21, 16 + (safeTargetH - 42) * 0.032))
  );
  const safeGapCssPx = Math.round(
    Math.max(24, Math.min(40, 26 + (safeTargetH - 42) * 0.08))
  );
  const lineHeightRatio = 1.48;

  const zoomComp =
    vScale < 1
      ? Math.min(1.85, 1 / Math.pow(vScale, 0.72))
      : Math.max(0.74, 1 / Math.pow(vScale, 0.32));

  const correctionWorldPx = Math.max(20, Math.round(correctionCssPx * zoomComp));
  const explanationWorldPx = Math.max(15, Math.round(explanationCssPx * zoomComp));
  const explLineHeightWorldPx = Math.round(explanationWorldPx * lineHeightRatio);
  const explGapTopWorldPx = Math.round(correctionWorldPx * 0.65 + explanationWorldPx * 0.9);
  const safeGapWorldPx = Math.max(24, Math.round(safeGapCssPx * Math.min(1.4, zoomComp)));
  const maxLineWidthWorldPx = Math.round(
    Math.max(280, Math.min(430, 320 * Math.min(1.35, zoomComp)))
  );

  return {
    correctionCssPx,
    explanationCssPx,
    correctionWorldPx,
    explanationWorldPx,
    lineHeightRatio,
    explLineHeightWorldPx,
    explGapTopWorldPx,
    safeGapCssPx,
    safeGapWorldPx,
    maxLineWidthWorldPx,
  };
}

/**
 * Adaptive speed multiplier based on number of pending annotations in queue.
 * 1: 1.0x | 2–3: 0.78x | 4–6: 0.55x | >6: 0.42x
 */
export function computeQueueSpeedMultiplier(pendingCount: number): number {
  if (pendingCount <= 1) return 1.0;
  if (pendingCount <= 3) return 0.78;
  if (pendingCount <= 6) return 0.55;
  return 0.42;
}

/**
 * Computes progressive single-stroke cloud animation duration adapted to path length.
 * Natural mode (1 pending):
 * - Small cloud (~380–540px): 600–900 ms
 * - Medium cloud (~560–800px): 900–1300 ms
 * - Large cloud (~820px+): 1300–1800 ms (capped at 1800 ms)
 */
export function computeCloudDurationMs(
  screenSpacePathLength: number,
  speed: WonderAnimationSpeed = 'natural',
  pendingCount = 1
): number {
  const speedFactor = WONDER_SPEED_FACTORS[speed] ?? 1.0;
  if (speedFactor <= 0) return 0;
  const queueMult = computeQueueSpeedMultiplier(pendingCount);
  const drawingSpeedPxPerSec = 820;
  const naturalMs = Math.max(
    600,
    Math.min(1800, (Math.max(120, screenSpacePathLength) / drawingSpeedPxPerSec) * 1000)
  );
  return Math.round(naturalMs * speedFactor * queueMult);
}

/**
 * Computes full phase timing schedule for one annotation, latched when its animation begins.
 */
export function computeAnnotationPhaseTimings(params: {
  cloudPathLengthWorld: number;
  viewportScale: number;
  arrowLengthWorld: number;
  correctionText: string;
  explanationText: string;
  speed: WonderAnimationSpeed;
  pendingCount: number;
}): WonderAnimationPhaseTimings {
  const speedFactor = WONDER_SPEED_FACTORS[params.speed] ?? 1.0;
  const queueMultiplier = computeQueueSpeedMultiplier(params.pendingCount);
  if (speedFactor <= 0) {
    return {
      cloudMs: 0,
      pauseAfterCloudMs: 0,
      arrowMs: 0,
      pauseBeforeExplMs: 0,
      corrMs: 0,
      explMs: 0,
      totalAnimMs: 0,
      queueMultiplier,
      speedFactor: 0,
    };
  }

  const effMult = speedFactor * queueMultiplier;
  const screenPathLen =
    params.cloudPathLengthWorld * Math.max(0.45, Math.min(2.0, params.viewportScale || 1));
  const cloudMs = computeCloudDurationMs(screenPathLen, params.speed, params.pendingCount);
  const pauseAfterCloudMs = Math.round(70 * effMult);
  const arrowMs = Math.round(
    Math.max(200, Math.min(350, Math.max(90, params.arrowLengthWorld) * 1.45)) * effMult
  );
  const pauseBeforeExplMs = Math.round(70 * effMult);

  const corrGraphemes = segmentUnicodeGraphemes(params.correctionText).length;
  const corrMs = Math.round(Math.max(180, Math.min(720, corrGraphemes * 45)) * effMult);

  const explNormalized = params.explanationText.normalize('NFC').trim();
  const explGraphemes = segmentUnicodeGraphemes(explNormalized).length;
  const wordCount = explNormalized ? explNormalized.split(/\s+/).length : 0;
  const sentenceCount = explNormalized ? (explNormalized.match(/[.!?]/g) ?? []).length : 0;
  const rawExplMs =
    explGraphemes * 24 +
    Math.min(160, Math.max(0, wordCount - 1) * 12) +
    Math.min(160, sentenceCount * 45);
  const explMs = Math.round(Math.max(320, Math.min(1450, rawExplMs)) * effMult);

  return {
    cloudMs,
    pauseAfterCloudMs,
    arrowMs,
    pauseBeforeExplMs,
    corrMs,
    explMs,
    totalAnimMs:
      cloudMs + pauseAfterCloudMs + arrowMs + pauseBeforeExplMs + corrMs + explMs,
    queueMultiplier,
    speedFactor,
  };
}

/**
 * Progressive reveal slicing by whole Unicode grapheme clusters (or word chunks for long text)
 * so Vietnamese diacritics and Hangul syllables never detach.
 */
export function sliceMixedLanguageReveal(
  text: string,
  progress: number,
  chunkLongText = false
): string {
  const normalized = text.normalize('NFC');
  if (progress <= 0.001 || !normalized) return '';
  if (progress >= 0.999) return normalized;

  const graphemes = segmentUnicodeGraphemes(normalized);
  if (chunkLongText && graphemes.length > 52) {
    const words = normalized.split(/(\s+)/);
    const count = Math.max(1, Math.ceil(words.length * progress));
    return words.slice(0, count).join('');
  }

  const count = Math.max(1, Math.ceil(graphemes.length * progress));
  return graphemes.slice(0, count).join('');
}
