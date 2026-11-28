import { WonderBBox } from '@seed/schema';

/**
 * TypeScript port of Riddle handwriting synthesis pipeline:
 * Source attribution: MaximeRivest/riddle `src/script.rs` (commit `0d1a9feea75027543e2ed49c721656cd261f03a1`, MIT License).
 *
 * Pipeline:
 * 1. Binary foreground bitmap mask (`Uint8Array`, 1 = ink, 0 = background) rasterized using
 *    SEED's Hangul/Vietnamese web fonts ('Gaegu', 'Playpen Sans') instead of DancingScript.ttf.
 * 2. Zhang-Suen 2-phase morphological thinning (`thinZhangSuen`) -> 1-pixel topological skeleton.
 * 3. Endpoint-first 8-neighbor DFS stroke tracing (`traceSkeletonStrokes`), sorted left-to-right.
 * 4. Legibility & density evaluation (`evaluateSynthesisLegibility`) with automatic fallback to
 *    SEED mixed-language grapheme reveal whenever dense Hangul batchim or stacked Vietnamese
 *    diacritics lose legibility.
 *
 * NOTE: Used strictly for animated AI chalk visual style — NOT for Hangul pedagogical stroke-order
 * instruction (which continues to use NIKL `buildHangulStrokeOrderDemo`).
 */

export interface PixelBinaryMask {
  width: number;
  height: number;
  mask: Uint8Array;
}

export interface WonderSynthesizedStroke {
  points: Array<{ x: number; y: number }>;
}

export interface SynthesisLegibilityResult {
  usable: boolean;
  reason: string;
  strokeCount: number;
  pointCount: number;
  avgPointsPerStroke: number;
}

export interface HandwritingSynthesisOutput {
  strokes: WonderSynthesizedStroke[];
  legibility: SynthesisLegibilityResult;
  fallbackToGraphemeReveal: boolean;
}

const NEIGHBOR_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // P2 N
  [1, -1], // P3 NE
  [1, 0], // P4 E
  [1, 1], // P5 SE
  [0, 1], // P6 S
  [-1, 1], // P7 SW
  [-1, 0], // P8 W
  [-1, -1], // P9 NW
];

/**
 * Pure TypeScript Zhang-Suen 2-phase thinning algorithm (ported from MaximeRivest/riddle `src/script.rs` `thin`).
 * Modifies a cloned mask up to `maxIterations` passes and returns the thinned 1px skeleton mask.
 */
export function thinZhangSuen(
  width: number,
  height: number,
  inputMask: Uint8Array,
  maxIterations = 64
): Uint8Array {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const buf = new Uint8Array(w * h);
  if (w < 3 || h < 3 || inputMask.length < w * h) {
    buf.set(inputMask.subarray(0, buf.length));
    return buf;
  }
  for (let i = 0; i < buf.length; i++) {
    buf[i] = inputMask[i] ? 1 : 0;
  }

  const toDelete: number[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    let anyChanged = false;

    for (let step = 0; step < 2; step++) {
      toDelete.length = 0;
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const idx = row + x;
          if (!buf[idx]) continue;

          const p2 = buf[idx - w];
          const p3 = buf[idx - w + 1];
          const p4 = buf[idx + 1];
          const p5 = buf[idx + w + 1];
          const p6 = buf[idx + w];
          const p7 = buf[idx + w - 1];
          const p8 = buf[idx - 1];
          const p9 = buf[idx - w - 1];

          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;

          let a = 0;
          if (p2 === 0 && p3 === 1) a++;
          if (p3 === 0 && p4 === 1) a++;
          if (p4 === 0 && p5 === 1) a++;
          if (p5 === 0 && p6 === 1) a++;
          if (p6 === 0 && p7 === 1) a++;
          if (p7 === 0 && p8 === 1) a++;
          if (p8 === 0 && p9 === 1) a++;
          if (p9 === 0 && p2 === 1) a++;
          if (a !== 1) continue;

          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }

          toDelete.push(idx);
        }
      }

      if (toDelete.length > 0) {
        anyChanged = true;
        for (let i = 0; i < toDelete.length; i++) {
          buf[toDelete[i]] = 0;
        }
      }
    }

    if (!anyChanged) break;
  }

  return buf;
}

export function decimatePolyline(
  points: Array<{ x: number; y: number }>,
  minDistSq = 2.25
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
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
 * Traces connected 1px skeleton chains into ordered polylines (endpoints first, then closed loops),
 * sorted left-to-right by starting X coordinate (ported from MaximeRivest/riddle `src/script.rs` `trace`).
 */
export function traceSkeletonStrokes(
  width: number,
  height: number,
  skeletonMask: Uint8Array,
  minPoints = 2
): WonderSynthesizedStroke[] {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w < 3 || h < 3 || skeletonMask.length < w * h) return [];

  const visited = new Uint8Array(w * h);
  const strokes: WonderSynthesizedStroke[] = [];

  const neighborCount = (x: number, y: number): number => {
    let cnt = 0;
    for (const [dx, dy] of NEIGHBOR_DELTAS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && skeletonMask[ny * w + nx]) {
        cnt++;
      }
    }
    return cnt;
  };

  const walkChain = (startX: number, startY: number): Array<{ x: number; y: number }> => {
    const chain: Array<{ x: number; y: number }> = [];
    let cx = startX;
    let cy = startY;
    while (true) {
      const idx = cy * w + cx;
      if (visited[idx]) break;
      visited[idx] = 1;
      chain.push({ x: cx, y: cy });

      let nextPt: { x: number; y: number } | null = null;
      // Prefer cardinal 4-neighbors before diagonal neighbors for clean glyph tracing
      for (const [dx, dy] of NEIGHBOR_DELTAS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nIdx = ny * w + nx;
          if (skeletonMask[nIdx] && !visited[nIdx]) {
            nextPt = { x: nx, y: ny };
            if (dx === 0 || dy === 0) break;
          }
        }
      }
      if (!nextPt) break;
      cx = nextPt.x;
      cy = nextPt.y;
    }
    return chain;
  };

  // Pass 1: start from degree <= 1 endpoints so open strokes trace end-to-end
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const idx = y * w + x;
      if (skeletonMask[idx] && !visited[idx] && neighborCount(x, y) <= 1) {
        const pts = decimatePolyline(walkChain(x, y));
        if (pts.length >= minPoints) strokes.push({ points: pts });
      }
    }
  }

  // Pass 2: remaining closed loops (such as Hangul ㅇ or Latin o/e/a bowls)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const idx = y * w + x;
      if (skeletonMask[idx] && !visited[idx]) {
        const pts = decimatePolyline(walkChain(x, y));
        if (pts.length >= minPoints) strokes.push({ points: pts });
      }
    }
  }

  strokes.sort((a, b) => (a.points[0]?.x ?? 0) - (b.points[0]?.x ?? 0));
  return strokes;
}

/**
 * Evaluates synthesized skeleton strokes for Hangul/Vietnamese legibility & anti-flicker safety.
 */
export function evaluateSynthesisLegibility(
  strokes: WonderSynthesizedStroke[],
  text: string
): SynthesisLegibilityResult {
  const clean = text.trim();
  const graphemeCount = Math.max(1, Array.from(clean.replace(/\s+/g, '')).length);
  const pointCount = strokes.reduce((acc, s) => acc + s.points.length, 0);
  const avgPointsPerStroke = strokes.length > 0 ? pointCount / strokes.length : 0;

  if (clean.length === 0 || strokes.length === 0 || pointCount < 4) {
    return {
      usable: false,
      reason: 'EMPTY_SKELETON',
      strokeCount: strokes.length,
      pointCount,
      avgPointsPerStroke,
    };
  }

  // Dense multi-clause text (> 24 graphemes) or hyper-fragmented micro-segments lose chalk clarity
  if (graphemeCount > 24) {
    return {
      usable: false,
      reason: 'TEXT_TOO_DENSE_FOR_SKELETON_REPLAY',
      strokeCount: strokes.length,
      pointCount,
      avgPointsPerStroke,
    };
  }

  if (strokes.length > graphemeCount * 10 || avgPointsPerStroke < 2.1) {
    return {
      usable: false,
      reason: 'SKELETON_FRAGMENTED_FALLBACK_TO_GRAPHEME',
      strokeCount: strokes.length,
      pointCount,
      avgPointsPerStroke,
    };
  }

  return {
    usable: true,
    reason: 'LEGIBLE_SKELETON',
    strokeCount: strokes.length,
    pointCount,
    avgPointsPerStroke,
  };
}

/**
 * Maps pixel skeleton strokes onto a world-space target bounding box.
 */
export function synthesizeHandwritingFromMask(
  pixelMask: PixelBinaryMask,
  targetBox: WonderBBox,
  text: string
): HandwritingSynthesisOutput {
  const thinned = thinZhangSuen(pixelMask.width, pixelMask.height, pixelMask.mask);
  const rawStrokes = traceSkeletonStrokes(pixelMask.width, pixelMask.height, thinned, 2);
  const legibility = evaluateSynthesisLegibility(rawStrokes, text);

  if (!legibility.usable) {
    return {
      strokes: [],
      legibility,
      fallbackToGraphemeReveal: true,
    };
  }

  const scaleX = targetBox.width / Math.max(1, pixelMask.width);
  const scaleY = targetBox.height / Math.max(1, pixelMask.height);
  const worldStrokes: WonderSynthesizedStroke[] = rawStrokes.map((st) => ({
    points: st.points.map((pt) => ({
      x: Number((targetBox.minX + pt.x * scaleX).toFixed(2)),
      y: Number((targetBox.minY + pt.y * scaleY).toFixed(2)),
    })),
  }));

  return {
    strokes: worldStrokes,
    legibility,
    fallbackToGraphemeReveal: false,
  };
}

/**
 * Browser Canvas2D rasterizer helper for short AI chalk text using SEED fonts
 * ('Gaegu' for Hangul, 'Playpen Sans' for Vietnamese/English). Returns null cleanly in Node tests.
 */
export function rasterizeTextToBinaryMask(
  text: string,
  fontSizePx = 28
): PixelBinaryMask | null {
  const g = globalThis as unknown as {
    document?: {
      createElement(tag: string): {
        width: number;
        height: number;
        getContext(kind: '2d'): {
          clearRect(x: number, y: number, w: number, h: number): void;
          font: string;
          textBaseline: string;
          fillStyle: string;
          measureText(s: string): { width: number };
          fillText(s: string, x: number, y: number): void;
          getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
        } | null;
      };
    };
  };
  if (!g.document || typeof g.document.createElement !== 'function') return null;
  const clean = text.trim();
  if (!clean) return null;

  const probe = g.document.createElement('canvas');
  const pCtx = probe.getContext('2d');
  if (!pCtx) return null;

  const hasKo = /[\uAC00-\uD7A3]/.test(clean);
  const fontFamily = hasKo
    ? "'Gaegu', 'Noto Sans KR', sans-serif"
    : "'Playpen Sans', 'Be Vietnam Pro', sans-serif";
  const fontSpec = `600 ${fontSizePx}px ${fontFamily}`;
  pCtx.font = fontSpec;
  const measured = Math.ceil(pCtx.measureText(clean).width);
  const width = Math.min(640, Math.max(32, measured + 16));
  const height = Math.max(32, Math.round(fontSizePx * 1.5));

  probe.width = width;
  probe.height = height;
  const ctx = probe.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.font = fontSpec;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.fillText(clean, 8, Math.round(height / 2));

  const imgData = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = imgData[i * 4 + 3] >= 96 ? 1 : 0;
  }
  return { width, height, mask };
}
