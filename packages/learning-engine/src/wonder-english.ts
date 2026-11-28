import type {
  WonderAnnotation,
  WonderBBox,
  WonderRecognitionRegion,
  WonderRecognitionSpan,
  WonderStroke,
  WonderStrokePoint,
} from '@seed/schema';

export interface EnglishPedagogyIssue {
  targetText: string;
  suggestedCorrection: string;
  bbox: WonderBBox;
  strokeIds: string[];
  spanStart: number;
  spanEnd: number;
  category: WonderAnnotation['linguistic_category'];
  annotationType: WonderAnnotation['annotation_type'];
  explanationVi: string;
  hintVi: string;
  conceptIds: string[];
}

export interface EnglishWordDescription {
  header: string;
  explanation: string;
  hint: string;
}

export interface EnglishDiscoveryCardContent {
  phrase: string;
  ipa: string;
  explanation: string;
  breakdown: Array<{ token: string; meaningVi: string }>;
}

/** Normalized polyline strokes in [0..1] x [0..1] character box */
type NormStroke = ReadonlyArray<readonly [number, number]>;

function arcPts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startRad: number,
  endRad: number,
  steps = 8
): NormStroke {
  const pts: Array<readonly [number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const a = startRad + ((endRad - startRad) * i) / steps;
    pts.push([
      Number((cx + Math.cos(a) * rx).toFixed(3)),
      Number((cy + Math.sin(a) * ry).toFixed(3)),
    ]);
  }
  return pts;
}

const LATIN_GLYPH_MAP: Record<string, ReadonlyArray<NormStroke>> = {
  A: [[[0.5, 0.1], [0.12, 0.9]], [[0.5, 0.1], [0.88, 0.9]], [[0.25, 0.62], [0.75, 0.62]]],
  B: [[[0.18, 0.1], [0.18, 0.9]], [[0.18, 0.1], [0.68, 0.12], [0.78, 0.28], [0.65, 0.48], [0.18, 0.48]], [[0.18, 0.48], [0.74, 0.52], [0.82, 0.72], [0.68, 0.9], [0.18, 0.9]]],
  C: [arcPts(0.55, 0.5, 0.36, 0.38, -Math.PI * 0.25, -Math.PI * 1.75, 9)],
  D: [[[0.18, 0.1], [0.18, 0.9]], [[0.18, 0.1], [0.66, 0.16], [0.84, 0.5], [0.66, 0.84], [0.18, 0.9]]],
  E: [[[0.2, 0.1], [0.2, 0.9]], [[0.2, 0.1], [0.82, 0.1]], [[0.2, 0.48], [0.7, 0.48]], [[0.2, 0.9], [0.84, 0.9]]],
  F: [[[0.2, 0.1], [0.2, 0.9]], [[0.2, 0.1], [0.84, 0.1]], [[0.2, 0.48], [0.72, 0.48]]],
  G: [[...arcPts(0.54, 0.5, 0.36, 0.38, -Math.PI * 0.25, -Math.PI * 1.9, 9), [0.88, 0.54], [0.56, 0.54]]],
  H: [[[0.2, 0.1], [0.2, 0.9]], [[0.8, 0.1], [0.8, 0.9]], [[0.2, 0.5], [0.8, 0.5]]],
  I: [[[0.26, 0.12], [0.74, 0.12]], [[0.5, 0.12], [0.5, 0.88]], [[0.26, 0.88], [0.74, 0.88]]],
  J: [[[0.72, 0.12], [0.72, 0.72], [0.54, 0.9], [0.3, 0.86], [0.2, 0.7]]],
  K: [[[0.2, 0.1], [0.2, 0.9]], [[0.82, 0.12], [0.22, 0.52], [0.84, 0.9]]],
  L: [[[0.22, 0.1], [0.22, 0.88], [0.82, 0.88]]],
  M: [[[0.14, 0.9], [0.18, 0.1], [0.5, 0.58], [0.82, 0.1], [0.86, 0.9]]],
  N: [[[0.18, 0.9], [0.18, 0.1], [0.82, 0.9], [0.82, 0.1]]],
  O: [arcPts(0.5, 0.5, 0.36, 0.4, 0, Math.PI * 2, 10)],
  P: [[[0.2, 0.1], [0.2, 0.9]], [[0.2, 0.1], [0.72, 0.14], [0.82, 0.32], [0.68, 0.52], [0.2, 0.52]]],
  Q: [arcPts(0.5, 0.5, 0.36, 0.38, 0, Math.PI * 2, 10), [[0.58, 0.66], [0.88, 0.92]]],
  R: [[[0.2, 0.1], [0.2, 0.9]], [[0.2, 0.1], [0.72, 0.14], [0.8, 0.32], [0.66, 0.5], [0.2, 0.5]], [[0.48, 0.5], [0.84, 0.9]]],
  S: [[[0.8, 0.22], [0.56, 0.1], [0.26, 0.2], [0.24, 0.38], [0.52, 0.5], [0.8, 0.62], [0.78, 0.82], [0.48, 0.9], [0.2, 0.8]]],
  T: [[[0.12, 0.12], [0.88, 0.12]], [[0.5, 0.12], [0.5, 0.9]]],
  U: [[[0.2, 0.12], [0.2, 0.72], [0.38, 0.9], [0.62, 0.9], [0.8, 0.72], [0.8, 0.12]]],
  V: [[[0.16, 0.12], [0.5, 0.9], [0.84, 0.12]]],
  W: [[[0.1, 0.12], [0.28, 0.9], [0.5, 0.4], [0.72, 0.9], [0.9, 0.12]]],
  X: [[[0.16, 0.12], [0.84, 0.9]], [[0.84, 0.12], [0.16, 0.9]]],
  Y: [[[0.16, 0.12], [0.5, 0.52], [0.84, 0.12]], [[0.5, 0.52], [0.5, 0.9]]],
  Z: [[[0.18, 0.14], [0.82, 0.14], [0.18, 0.88], [0.84, 0.88]]],

  a: [arcPts(0.48, 0.64, 0.28, 0.24, 0, Math.PI * 2, 8), [[0.78, 0.42], [0.78, 0.88]]],
  b: [[[0.22, 0.1], [0.22, 0.88]], arcPts(0.5, 0.64, 0.28, 0.24, Math.PI, -Math.PI, 8)],
  c: [arcPts(0.56, 0.64, 0.3, 0.25, -Math.PI * 0.25, -Math.PI * 1.75, 8)],
  d: [[[0.78, 0.1], [0.78, 0.88]], arcPts(0.48, 0.64, 0.28, 0.24, 0, Math.PI * 2, 8)],
  e: [[[0.24, 0.62], [0.78, 0.62], [0.74, 0.44], [0.48, 0.38], [0.22, 0.54], [0.24, 0.78], [0.52, 0.88], [0.78, 0.82]]],
  f: [[[0.72, 0.14], [0.52, 0.1], [0.42, 0.24], [0.42, 0.9]], [[0.22, 0.44], [0.68, 0.44]]],
  g: [arcPts(0.48, 0.54, 0.26, 0.22, 0, Math.PI * 2, 8), [[0.76, 0.34], [0.76, 0.88], [0.54, 0.98], [0.28, 0.92]]],
  h: [[[0.22, 0.1], [0.22, 0.88]], [[0.22, 0.52], [0.5, 0.38], [0.74, 0.48], [0.76, 0.88]]],
  i: [[[0.5, 0.18], [0.52, 0.24]], [[0.5, 0.4], [0.5, 0.88]]],
  j: [[[0.58, 0.18], [0.6, 0.24]], [[0.58, 0.4], [0.58, 0.86], [0.4, 0.98], [0.24, 0.9]]],
  k: [[[0.24, 0.1], [0.24, 0.88]], [[0.76, 0.42], [0.26, 0.64], [0.78, 0.88]]],
  l: [[[0.5, 0.12], [0.5, 0.88]]],
  m: [[[0.14, 0.4], [0.14, 0.88]], [[0.14, 0.5], [0.34, 0.38], [0.5, 0.5], [0.5, 0.88]], [[0.5, 0.5], [0.7, 0.38], [0.86, 0.5], [0.86, 0.88]]],
  n: [[[0.22, 0.4], [0.22, 0.88]], [[0.22, 0.52], [0.5, 0.38], [0.76, 0.5], [0.78, 0.88]]],
  o: [arcPts(0.5, 0.64, 0.3, 0.24, 0, Math.PI * 2, 8)],
  p: [[[0.24, 0.38], [0.24, 0.98]], arcPts(0.52, 0.58, 0.28, 0.22, Math.PI, -Math.PI, 8)],
  q: [[[0.76, 0.38], [0.76, 0.98]], arcPts(0.48, 0.58, 0.28, 0.22, 0, Math.PI * 2, 8)],
  r: [[[0.28, 0.4], [0.28, 0.88]], [[0.28, 0.54], [0.52, 0.4], [0.74, 0.44]]],
  s: [[[0.74, 0.46], [0.48, 0.38], [0.26, 0.48], [0.52, 0.64], [0.76, 0.74], [0.5, 0.88], [0.24, 0.82]]],
  t: [[[0.48, 0.14], [0.48, 0.84], [0.68, 0.88]], [[0.24, 0.4], [0.72, 0.4]]],
  u: [[[0.22, 0.4], [0.22, 0.76], [0.48, 0.88], [0.76, 0.76], [0.76, 0.4]]],
  v: [[[0.2, 0.4], [0.5, 0.88], [0.8, 0.4]]],
  w: [[[0.12, 0.4], [0.28, 0.88], [0.5, 0.52], [0.72, 0.88], [0.88, 0.4]]],
  x: [[[0.22, 0.4], [0.78, 0.88]], [[0.78, 0.4], [0.22, 0.88]]],
  y: [[[0.22, 0.4], [0.5, 0.78]], [[0.8, 0.4], [0.36, 0.98]]],
  z: [[[0.22, 0.42], [0.78, 0.42], [0.22, 0.88], [0.8, 0.88]]],

  '0': [arcPts(0.5, 0.5, 0.32, 0.38, 0, Math.PI * 2, 9)],
  '1': [[[0.34, 0.24], [0.52, 0.12], [0.52, 0.88]]],
  '2': [[[0.22, 0.28], [0.5, 0.12], [0.78, 0.28], [0.22, 0.88], [0.82, 0.88]]],
  '3': [[[0.24, 0.2], [0.68, 0.14], [0.74, 0.38], [0.44, 0.48], [0.76, 0.64], [0.68, 0.88], [0.22, 0.84]]],
  '4': [[[0.24, 0.14], [0.24, 0.58], [0.8, 0.58]], [[0.66, 0.14], [0.66, 0.9]]],
  '5': [[[0.76, 0.14], [0.26, 0.14], [0.24, 0.46], [0.68, 0.48], [0.78, 0.72], [0.52, 0.88], [0.22, 0.84]]],
  '6': [[[0.68, 0.14], [0.32, 0.32], [0.22, 0.66], [0.48, 0.88], [0.78, 0.72], [0.62, 0.5], [0.26, 0.54]]],
  '7': [[[0.2, 0.14], [0.8, 0.14], [0.38, 0.9]]],
  '8': [arcPts(0.5, 0.32, 0.24, 0.18, 0, Math.PI * 2, 7), arcPts(0.5, 0.7, 0.28, 0.2, 0, Math.PI * 2, 7)],
  '9': [arcPts(0.5, 0.34, 0.26, 0.2, 0, Math.PI * 2, 8), [[0.76, 0.32], [0.68, 0.88]]],

  "'": [[[0.5, 0.14], [0.44, 0.34]]],
  ',': [[[0.52, 0.74], [0.42, 0.92]]],
  '-': [[[0.22, 0.54], [0.78, 0.54]]],
  ':': [[[0.48, 0.36], [0.52, 0.42]], [[0.48, 0.72], [0.52, 0.78]]],
};

/**
 * Generates readable multi-stroke vector letterforms for ASCII Latin letters,
 * digits, and punctuation; returns null for non-Latin characters.
 */
export function latinGlyphStrokes(
  ch: string,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  strokeIdx: number
): WonderStrokePoint[][] | null {
  const spec = LATIN_GLYPH_MAP[ch];
  if (!spec) return null;
  const now = Date.now();
  return spec.map((poly, sIdx) =>
    poly.map(([rx, ry], pIdx) => ({
      x: bx + rx * bw,
      y: by + ry * bh,
      pressure: 0.52 + 0.25 * Math.sin(((pIdx + 1) / Math.max(2, poly.length)) * Math.PI),
      t: now + (strokeIdx + sIdx) * 14 + pIdx * 4,
    }))
  );
}

// ---------------------------------------------------------------------------
// Printed-Latin Freehand Recognizer (deterministic template point-cloud match)
// ---------------------------------------------------------------------------

function resamplePolyline(pts: ReadonlyArray<readonly [number, number]>, n: number): Array<[number, number]> {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-4) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    let seg = 0;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = Math.max(1e-5, cum[seg + 1] - cum[seg]);
    const t = (target - cum[seg]) / segLen;
    out.push([
      pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t,
      pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t,
    ]);
  }
  return out;
}

function normalizeStrokeGroupCloud(
  groups: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  pointsPerStroke = 12
): { pts: Array<[number, number]>; aspect: number; strokeCount: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of groups) {
    for (const [x, y] of g) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const w = Math.max(1e-4, maxX - minX);
  const h = Math.max(1e-4, maxY - minY);
  const scaleX = Math.max(w, h * 0.22);
  const scaleY = Math.max(h, w * 0.22);
  const padX = (scaleX - w) / 2;
  const padY = (scaleY - h) / 2;
  const pts: Array<[number, number]> = [];
  for (const g of groups) {
    const sampled = resamplePolyline(g, pointsPerStroke);
    for (const [x, y] of sampled) {
      pts.push([(x - minX + padX) / scaleX, (y - minY + padY) / scaleY]);
    }
  }
  return { pts, aspect: w / h, strokeCount: groups.length };
}

function symmetricChamferDist(a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  const oneWay = (src: ReadonlyArray<readonly [number, number]>, dst: ReadonlyArray<readonly [number, number]>) => {
    let sum = 0;
    for (const [ax, ay] of src) {
      let best = Infinity;
      for (const [bx, by] of dst) {
        const d = Math.hypot(ax - bx, ay - by);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum / src.length;
  };
  return (oneWay(a, b) + oneWay(b, a)) / 2;
}

interface LatinTemplate {
  ch: string;
  pts: Array<[number, number]>;
  aspect: number;
  strokeCount: number;
}

const RECOGNIZABLE_LATIN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const LATIN_TEMPLATES: LatinTemplate[] = Array.from(RECOGNIZABLE_LATIN_CHARS).map((ch) => {
  const cloud = normalizeStrokeGroupCloud(LATIN_GLYPH_MAP[ch]);
  return { ch, ...cloud };
});

const AUTO_MODE_ENGLISH_LEXICON = new Set([
  'am', 'an', 'and', 'apple', 'are', 'at', 'bad', 'be', 'book', 'boy', 'buy', 'by',
  'can', 'car', 'cat', 'coffee', 'come', 'day', 'did', 'do', 'dog', 'eat', 'egg',
  'english', 'for', 'friend', 'from', 'girl', 'go', 'goes', 'good', 'great', 'had',
  'happy', 'has', 'have', 'he', 'hello', 'her', 'hi', 'his', 'home', 'hot', 'house',
  'how', 'in', 'is', 'it', 'like', 'love', 'make', 'me', 'milk', 'morning', 'my',
  'name', 'new', 'nice', 'no', 'not', 'of', 'ok', 'on', 'one', 'or', 'our', 'pen',
  'play', 'please', 'read', 'red', 'run', 'saw', 'say', 'school', 'see', 'she',
  'sleep', 'sorry', 'speak', 'student', 'study', 'tea', 'teacher', 'thank', 'thanks',
  'that', 'the', 'their', 'them', 'there', 'they', 'this', 'time', 'to', 'today',
  'too', 'two', 'use', 'very', 'want', 'was', 'water', 'we', 'went', 'were', 'what',
  'where', 'who', 'why', 'will', 'with', 'work', 'write', 'yes', 'yesterday', 'you', 'your',
]);

function groupClusterStrokesIntoLatinChars(cluster: WonderStroke[]): WonderStroke[][] {
  const ordered = [...cluster].sort((a, b) => a.bbox.minX - b.bbox.minX || a.bbox.minY - b.bbox.minY);
  if (ordered.length <= 1) return ordered.map((s) => [s]);

  const hSamples = ordered.map((s) => s.bbox.height).filter((h) => h >= 8).sort((a, b) => a - b);
  const medianH = hSamples.length > 0 ? hSamples[Math.floor(hSamples.length / 2)] : 42;
  const groups: WonderStroke[][] = [];

  for (const st of ordered) {
    if (groups.length === 0) {
      groups.push([st]);
      continue;
    }
    const cur = groups[groups.length - 1];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of cur) {
      if (s.bbox.minX < minX) minX = s.bbox.minX;
      if (s.bbox.maxX > maxX) maxX = s.bbox.maxX;
      if (s.bbox.minY < minY) minY = s.bbox.minY;
      if (s.bbox.maxY > maxY) maxY = s.bbox.maxY;
    }
    const overlapX = Math.max(0, Math.min(maxX, st.bbox.maxX) - Math.max(minX, st.bbox.minX));
    const minW = Math.max(1, Math.min(maxX - minX, st.bbox.width));
    const overlapRatio = overlapX / minW;
    const gap = st.bbox.minX - maxX;

    const isTinyDotOverStem =
      st.bbox.width <= 16 &&
      st.bbox.height <= 16 &&
      st.bbox.minX >= minX - 12 &&
      st.bbox.maxX <= maxX + 12;

    if (overlapRatio >= 0.22 || gap <= Math.max(3, medianH * 0.08) || isTinyDotOverStem) {
      cur.push(st);
    } else {
      groups.push([st]);
    }
  }
  return groups;
}

function matchSingleLatinCharCluster(
  strokes: WonderStroke[]
): { ch: string; confidence: number } | null {
  const mergedW = Math.max(...strokes.map((s) => s.bbox.maxX)) - Math.min(...strokes.map((s) => s.bbox.minX));
  const mergedH = Math.max(...strokes.map((s) => s.bbox.maxY)) - Math.min(...strokes.map((s) => s.bbox.minY));
  if (mergedH < 10 || strokes.length > 5) return null;

  // Guard against wild scribble/zigzag strokes with excessive direction reversals
  let totalTurns = 0;
  let totalSegs = 0;
  for (const s of strokes) {
    if (s.points.length >= 4) {
      for (let i = 2; i < s.points.length; i++) {
        const dx1 = s.points[i - 1].x - s.points[i - 2].x;
        const dy1 = s.points[i - 1].y - s.points[i - 2].y;
        const dx2 = s.points[i].x - s.points[i - 1].x;
        const dy2 = s.points[i].y - s.points[i - 1].y;
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);
        if (len1 > 3 && len2 > 3) {
          const cross = (dx1 * dy2 - dy1 * dx2) / (len1 * len2);
          const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
          if (dot < -0.25 && Math.abs(cross) < 0.95) totalTurns++;
          totalSegs++;
        }
      }
    }
  }
  if (strokes.length === 1 && totalTurns >= 5 && totalSegs >= 8) return null;

  const polyGroups: Array<Array<[number, number]>> = strokes.map((s) =>
    s.points.map((p) => [p.x + s.transform.dx, p.y + s.transform.dy])
  );
  const obs = normalizeStrokeGroupCloud(polyGroups);

  // Quick check for trailing dot punctuation
  if (strokes.length === 1 && mergedW <= 14 && mergedH <= 14) {
    return { ch: '.', confidence: 0.85 };
  }

  let best: { ch: string; dist: number } | null = null;
  for (const tpl of LATIN_TEMPLATES) {
    if (Math.abs(tpl.strokeCount - obs.strokeCount) > 1) continue;
    const expectedNaturalAspect = tpl.aspect * 0.65;
    const aspectRatioDiff =
      Math.max(expectedNaturalAspect, obs.aspect) /
      Math.max(0.12, Math.min(expectedNaturalAspect, obs.aspect));
    if (aspectRatioDiff > 2.8) continue;

    const d = symmetricChamferDist(obs.pts, tpl.pts);
    const strokePenalty = tpl.strokeCount === obs.strokeCount ? 0 : 0.035;
    const total = d + strokePenalty;
    if (!best || total < best.dist) {
      best = { ch: tpl.ch, dist: total };
    }
  }

  if (!best || best.dist > 0.22) return null;
  const conf = Math.max(0.76, Math.min(0.95, 1.0 - best.dist * 1.1));
  return { ch: best.ch, confidence: conf };
}

/**
 * Recognizes a neatly hand-printed English word cluster from freehand strokes.
 * In 'auto' mode (allowSingleLetter=false), requires >= 2 letters and lexicon match
 * so Korean Jamo or scribbles never trigger false English matches.
 */
export function recognizeFreehandLatinCluster(
  cluster: WonderStroke[],
  allowSingleLetter = false
): { text: string; confidence: number } | null {
  if (cluster.length === 0) return null;
  const charGroups = groupClusterStrokesIntoLatinChars(cluster);
  if (charGroups.length === 0) return null;
  if (!allowSingleLetter && charGroups.length < 2) return null;

  const wordMaxH = Math.max(
    1,
    ...charGroups.map(
      (cg) => Math.max(...cg.map((s) => s.bbox.maxY)) - Math.min(...cg.map((s) => s.bbox.minY))
    )
  );
  const rawDecoded: Array<{ ch: string; h: number; confidence: number }> = [];
  for (const cg of charGroups) {
    const match = matchSingleLatinCharCluster(cg);
    if (!match) return null;
    const h = Math.max(...cg.map((s) => s.bbox.maxY)) - Math.min(...cg.map((s) => s.bbox.minY));
    rawDecoded.push({ ch: match.ch, h, confidence: match.confidence });
  }

  const hasClearLower = rawDecoded.some((d) => /[a-z]/.test(d.ch));
  const decoded = rawDecoded.map((d, idx) => {
    if (
      /^[COSVWXZ]$/.test(d.ch) &&
      (d.h < wordMaxH * 0.78 || (hasClearLower && idx > 0))
    ) {
      return { ...d, ch: d.ch.toLowerCase() };
    }
    return d;
  });

  const word = decoded.map((d) => d.ch).join('');
  const alphaOnly = word.replace(/[.!?]+$/, '');
  if (!/^[A-Za-z]+$/.test(alphaOnly)) return null;
  if (!allowSingleLetter) {
    if (alphaOnly.length < 2) return null;
    if (!AUTO_MODE_ENGLISH_LEXICON.has(alphaOnly.toLowerCase())) return null;
  } else if (alphaOnly.length === 1 && alphaOnly !== 'I' && alphaOnly !== 'a' && alphaOnly !== 'A') {
    return null;
  }

  const avgConf = decoded.reduce((acc, d) => acc + d.confidence, 0) / decoded.length;
  return { text: word, confidence: Number(avgConf.toFixed(3)) };
}

// ---------------------------------------------------------------------------
// Deterministic English Grammar & Learner L1 Interference Analyzer
// ---------------------------------------------------------------------------

function mergeBoxes(boxes: WonderBBox[]): WonderBBox {
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

interface CleanSpanToken {
  raw: string;
  clean: string;
  lower: string;
  trailingPunct: string;
  span: WonderRecognitionSpan;
}

const PAST_VERB_MAP: Record<string, string> = {
  go: 'went',
  goes: 'went',
  eat: 'ate',
  eats: 'ate',
  buy: 'bought',
  buys: 'bought',
  see: 'saw',
  sees: 'saw',
  come: 'came',
  comes: 'came',
  do: 'did',
  does: 'did',
  have: 'had',
  has: 'had',
  make: 'made',
  makes: 'made',
  take: 'took',
  takes: 'took',
  give: 'gave',
  gives: 'gave',
  write: 'wrote',
  writes: 'wrote',
  drink: 'drank',
  drinks: 'drank',
  sleep: 'slept',
  sleeps: 'slept',
  study: 'studied',
  studies: 'studied',
  play: 'played',
  plays: 'played',
  visit: 'visited',
  visits: 'visited',
  work: 'worked',
  works: 'worked',
  walk: 'walked',
  walks: 'walked',
  watch: 'watched',
  watches: 'watched',
  meet: 'met',
  meets: 'met',
  run: 'ran',
  runs: 'ran',
  speak: 'spoke',
  speaks: 'spoke',
  teach: 'taught',
  teaches: 'taught',
};

const BASE_FROM_PAST_MAP: Record<string, string> = {
  went: 'go',
  ate: 'eat',
  bought: 'buy',
  saw: 'see',
  came: 'come',
  did: 'do',
  had: 'have',
  made: 'make',
  took: 'take',
  gave: 'give',
  wrote: 'write',
  drank: 'drink',
  slept: 'sleep',
  studied: 'study',
  played: 'play',
  visited: 'visit',
  worked: 'work',
  walked: 'walk',
  watched: 'watch',
  met: 'meet',
  ran: 'run',
  spoke: 'speak',
  taught: 'teach',
};

const THIRD_SG_VERB_MAP: Record<string, string> = {
  go: 'goes',
  do: 'does',
  watch: 'watches',
  teach: 'teaches',
  study: 'studies',
  eat: 'eats',
  like: 'likes',
  play: 'plays',
  work: 'works',
  live: 'lives',
  want: 'wants',
  need: 'needs',
  know: 'knows',
  speak: 'speaks',
  read: 'reads',
  write: 'writes',
  drink: 'drinks',
  make: 'makes',
  take: 'takes',
  love: 'loves',
};

const VOWEL_SOUND_NOUNS = new Set([
  'apple', 'orange', 'umbrella', 'elephant', 'egg', 'idea', 'hour', 'honest',
  'english', 'animal', 'email', 'exam', 'office', 'island', 'artist', 'engineer',
  'ice', 'old', 'easy', 'important', 'interesting',
]);

const CONSONANT_SOUND_NOUNS = new Set([
  'book', 'car', 'cat', 'dog', 'pen', 'cup', 'house', 'school', 'student',
  'teacher', 'friend', 'phone', 'table', 'coffee', 'computer', 'university',
  'uniform', 'user', 'useful', 'one', 'banana', 'tree',
]);

const DOUBLE_COMPARATIVES: Record<string, string> = {
  better: 'better',
  bigger: 'bigger',
  easier: 'easier',
  faster: 'faster',
  cheaper: 'cheaper',
  taller: 'taller',
  smaller: 'smaller',
  older: 'older',
};

const UNCOUNTABLE_OR_PLURAL_FIX: Record<string, string> = {
  informations: 'information',
  advices: 'advice',
  homeworks: 'homework',
  peoples: 'people',
  childrens: 'children',
};

function matchCase(source: string, replacement: string): string {
  if (/^[A-Z]/.test(source) && replacement.length > 0) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function analyzeEnglishPedagogyForRegion(
  region: WonderRecognitionRegion
): EnglishPedagogyIssue[] {
  const tokens: CleanSpanToken[] = region.spans.map((sp) => {
    const raw = sp.text.trim();
    const m = raw.match(/^(.*?)([.,!?;:]*)$/);
    const clean = (m?.[1] ?? raw).trim();
    return {
      raw,
      clean,
      lower: clean.toLowerCase(),
      trailingPunct: m?.[2] ?? '',
      span: sp,
    };
  });

  if (tokens.length === 0) return [];

  const fullLower = region.recognizedText.toLowerCase();
  const hasPastMarker = /\b(yesterday|last\s+(night|week|month|year)|ago)\b/.test(fullLower);
  const coveredTokenIdx = new Set<number>();
  const issues: EnglishPedagogyIssue[] = [];

  const pushSpanIssue = (
    indices: number[],
    targetText: string,
    suggestedCorrection: string,
    category: WonderAnnotation['linguistic_category'],
    annotationType: WonderAnnotation['annotation_type'],
    explanationVi: string,
    hintVi: string,
    conceptIds: string[]
  ) => {
    if (indices.some((idx) => coveredTokenIdx.has(idx))) return;
    const spans = indices.map((idx) => tokens[idx].span);
    const strokeIds = Array.from(new Set(spans.flatMap((sp) => sp.strokeIds)));
    if (strokeIds.length === 0) return;
    indices.forEach((idx) => coveredTokenIdx.add(idx));
    issues.push({
      targetText,
      suggestedCorrection,
      bbox: mergeBoxes(spans.map((sp) => sp.bbox)),
      strokeIds,
      spanStart: spans[0].startIndex,
      spanEnd: spans[spans.length - 1].endIndex,
      category,
      annotationType,
      explanationVi,
      hintVi,
      conceptIds,
    });
  };

  // Multi-word checks first (2-word phrases)
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const prev = i > 0 ? tokens[i - 1].lower : '';

    // 1. Article "a" / "an"
    if (a.lower === 'a' && VOWEL_SOUND_NOUNS.has(b.lower)) {
      const target = `${a.clean} ${b.clean}`;
      const corr = `${matchCase(a.clean, 'an')} ${b.clean}`;
      pushSpanIssue(
        [i, i + 1],
        target,
        corr,
        'spelling',
        'grammar_correction',
        `Trước "${b.clean}" bắt đầu bằng âm nguyên âm, hãy dùng mạo từ "an" thay vì "a".`,
        'Dùng "an" trước âm nguyên âm (u, e, o, a, i) và giờ câm ("an hour").',
        ['kc_en_articles']
      );
      continue;
    }
    if (a.lower === 'an' && CONSONANT_SOUND_NOUNS.has(b.lower)) {
      const target = `${a.clean} ${b.clean}`;
      const corr = `${matchCase(a.clean, 'a')} ${b.clean}`;
      pushSpanIssue(
        [i, i + 1],
        target,
        corr,
        'spelling',
        'grammar_correction',
        `Từ "${b.clean}" bắt đầu bằng âm phụ âm, nên dùng "a" thay vì "an".`,
        'Ví dụ: "a book", "a university" (âm /j/).',
        ['kc_en_articles']
      );
      continue;
    }

    // 2. Vietnamese L1: "am/is/are/'m agree" -> "agree / agrees"
    if ((a.lower === 'am' || a.lower === 'is' || a.lower === 'are' || a.lower === "'m") && b.lower === 'agree') {
      const isThird = a.lower === 'is';
      const corr = isThird ? 'agrees' : 'agree';
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        corr,
        'naturalness',
        'grammar_correction',
        `Trong tiếng Anh, "agree" là động từ thường, KHÔNG đi cùng "to be" (${a.clean} ${b.clean} → ${corr}).`,
        'Chỉ cần viết "I agree." hoặc "She agrees.".',
        ['kc_en_l1_be_verb']
      );
      continue;
    }

    // 3. "go to home" / "went to home" -> "go home" / "went home"
    if (
      (prev === 'go' || prev === 'went' || prev === 'going' || prev === 'come' || prev === 'came') &&
      a.lower === 'to' &&
      b.lower === 'home'
    ) {
      pushSpanIssue(
        [i - 1, i, i + 1],
        `${tokens[i - 1].clean} ${a.clean} ${b.clean}`,
        `${tokens[i - 1].clean} home`,
        'naturalness',
        'grammar_correction',
        'Trước "home" khi đi với động từ chỉ hướng (go/come) không cần giới từ "to".',
        'Cụm chuẩn: "go home", "went home", "come home".',
        ['kc_en_prepositions']
      );
      continue;
    }

    // 4. Subject + Be agreement
    if (a.lower === 'i' && b.lower === 'is') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} am`,
        'particle',
        'grammar_correction',
        'Chủ ngữ "I" luôn đi với "am" (I am), không dùng "is".',
        'Ghi nhớ: I am, You/We/They are, He/She/It is.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'you' || a.lower === 'we' || a.lower === 'they') && b.lower === 'is') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} are`,
        'particle',
        'grammar_correction',
        `Chủ ngữ số nhiều "${a.clean}" phải đi với "are" thay vì "is".`,
        'Hiện tại: You/We/They are.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'he' || a.lower === 'she' || a.lower === 'it') && b.lower === 'are') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} is`,
        'particle',
        'grammar_correction',
        `Chủ ngữ ngôi 3 số ít "${a.clean}" dùng "is" chứ không dùng "are".`,
        'Ngôi 3 số ít hiện tại: He/She/It is.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'you' || a.lower === 'we' || a.lower === 'they') && b.lower === 'was') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} were`,
        'tense',
        'grammar_correction',
        `Ở thì quá khứ đơn, "${a.clean}" đi với "were" thay vì "was".`,
        'Quá khứ: I/He/She/It was; You/We/They were.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'he' || a.lower === 'she' || a.lower === 'it') && b.lower === 'were' && prev !== 'if') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} was`,
        'tense',
        'grammar_correction',
        `Ở câu trần thuật quá khứ, "${a.clean}" đi với "was" thay vì "were".`,
        'Ví dụ: "She was at school yesterday."',
        ['kc_en_sv_agreement']
      );
      continue;
    }

    // 5. didn't / doesn't / don't + past tense verb
    if ((a.lower === "didn't" || a.lower === "doesn't" || a.lower === "don't") && BASE_FROM_PAST_MAP[b.lower]) {
      const baseVerb = BASE_FROM_PAST_MAP[b.lower];
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} ${baseVerb}`,
        'tense',
        'grammar_correction',
        `Sau trợ động từ "${a.clean}", động từ chính phải giữ ở dạng nguyên mẫu "${baseVerb}" (không chia quá khứ "${b.clean}").`,
        `Ví dụ chuẩn: "${a.clean} ${baseVerb}".`,
        ['kc_en_aux_infinitive']
      );
      continue;
    }

    // 6. Modal + "to" or + "-s" verb
    if (
      (a.lower === 'can' || a.lower === 'should' || a.lower === 'must' || a.lower === 'will' || a.lower === 'would' || a.lower === 'could') &&
      b.lower === 'to'
    ) {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} to`,
        a.clean,
        'naturalness',
        'grammar_correction',
        `Sau động từ khuyết thiếu "${a.clean}" dùng thẳng động từ nguyên mẫu, bỏ "to".`,
        `Cấu trúc chuẩn: ${a.clean} + V (không "to").`,
        ['kc_en_modals']
      );
      continue;
    }

    // 7. Subject + have/has / don't/doesn't / 3rd person present verb (when NO past marker)
    if ((a.lower === 'he' || a.lower === 'she' || a.lower === 'it') && b.lower === "don't") {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} doesn't`,
        'particle',
        'grammar_correction',
        `Chủ ngữ "${a.clean}" phủ định ở hiện tại đơn phải dùng "doesn't" thay vì "don't".`,
        'He/She/It doesn\'t + V nguyên mẫu.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'i' || a.lower === 'you' || a.lower === 'we' || a.lower === 'they') && b.lower === "doesn't") {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} don't`,
        'particle',
        'grammar_correction',
        `Với chủ ngữ "${a.clean}", hãy dùng "don't" thay vì "doesn't".`,
        'I/You/We/They don\'t + V nguyên mẫu.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'he' || a.lower === 'she' || a.lower === 'it') && b.lower === 'have' && !hasPastMarker) {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} has`,
        'particle',
        'grammar_correction',
        `Ở hiện tại đơn, "${a.clean}" đi với "has" thay vì "have".`,
        'He/She/It has.',
        ['kc_en_sv_agreement']
      );
      continue;
    }
    if ((a.lower === 'i' || a.lower === 'you' || a.lower === 'we' || a.lower === 'they') && b.lower === 'has' && !hasPastMarker) {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} have`,
        'particle',
        'grammar_correction',
        `Với chủ ngữ "${a.clean}", hãy dùng "have" thay vì "has".`,
        'I/You/We/They have.',
        ['kc_en_sv_agreement']
      );
      continue;
    }

    // 8. Collocations & double comparatives & quantifiers
    if (a.lower === 'discuss' && b.lower === 'about') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        a.clean,
        'naturalness',
        'grammar_correction',
        '"discuss" đã mang nghĩa "thảo luận về", nên không thêm "about" phía sau.',
        'Dùng "discuss something" (hoặc "talk about something").',
        ['kc_en_collocations']
      );
      continue;
    }
    if (a.lower === 'good' && b.lower === 'in') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} at`,
        'naturalness',
        'grammar_correction',
        'Khi nói giỏi kỹ năng/môn gì, cụm chuẩn là "good at" (không dùng "good in").',
        'Ví dụ: "good at English".',
        ['kc_en_collocations']
      );
      continue;
    }
    if (a.lower === 'interested' && (b.lower === 'on' || b.lower === 'about')) {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${a.clean} in`,
        'naturalness',
        'grammar_correction',
        'Tính từ "interested" đi với giới từ "in": "interested in".',
        'Ví dụ: "interested in learning English".',
        ['kc_en_collocations']
      );
      continue;
    }
    if (a.lower === 'more' && DOUBLE_COMPARATIVES[b.lower]) {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        matchCase(b.clean, DOUBLE_COMPARATIVES[b.lower]),
        'naturalness',
        'grammar_correction',
        `"${b.clean}" đã là dạng so sánh hơn rồi, nên bỏ "more" phía trước để tránh lặp so sánh.`,
        'Chỉ dùng 1 dạng so sánh hơn ("better", "bigger", "easier").',
        ['kc_en_comparatives']
      );
      continue;
    }
    if (a.lower === 'much' && b.lower === 'people') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${matchCase(a.clean, 'many')} ${b.clean}`,
        'naturalness',
        'grammar_correction',
        '"people" là danh từ đếm được số nhiều, nên dùng "many people" thay vì "much people".',
        '"many" + danh từ đếm được số nhiều; "much" + không đếm được.',
        ['kc_en_quantifiers']
      );
      continue;
    }
    if (a.lower === 'many' && b.lower === 'money') {
      pushSpanIssue(
        [i, i + 1],
        `${a.clean} ${b.clean}`,
        `${matchCase(a.clean, 'much')} ${b.clean}`,
        'naturalness',
        'grammar_correction',
        '"money" là danh từ không đếm được, nên dùng "much money" thay vì "many money".',
        'Hoặc dùng "a lot of money".',
        ['kc_en_quantifiers']
      );
      continue;
    }
  }

  // Single-token verb tense, S-V agreement, & uncountable noun checks
  for (let i = 0; i < tokens.length; i++) {
    if (coveredTokenIdx.has(i)) continue;
    const tok = tokens[i];
    const prev = i > 0 ? tokens[i - 1].lower : '';
    const isAfterAuxOrInfinitive =
      prev === 'to' ||
      prev === 'did' ||
      prev === "didn't" ||
      prev === 'does' ||
      prev === "doesn't" ||
      prev === 'do' ||
      prev === "don't" ||
      prev === 'will' ||
      prev === "won't" ||
      prev === 'can' ||
      prev === "can't" ||
      prev === 'could' ||
      prev === 'should' ||
      prev === 'would' ||
      prev === 'must' ||
      prev === 'may' ||
      prev === 'might';

    if (UNCOUNTABLE_OR_PLURAL_FIX[tok.lower]) {
      const fix = matchCase(tok.clean, UNCOUNTABLE_OR_PLURAL_FIX[tok.lower]);
      pushSpanIssue(
        [i],
        tok.clean,
        fix,
        'spelling',
        'spelling_correction',
        `"${tok.clean}" là danh từ không đếm được / bất quy tắc — dạng đúng là "${fix}".`,
        'Danh từ không đếm được như information, advice, homework không thêm "-s".',
        ['kc_en_nouns']
      );
      continue;
    }

    if (hasPastMarker && !isAfterAuxOrInfinitive && PAST_VERB_MAP[tok.lower]) {
      const pastForm = matchCase(tok.clean, PAST_VERB_MAP[tok.lower]);
      pushSpanIssue(
        [i],
        tok.clean,
        pastForm,
        'tense',
        'grammar_correction',
        `Câu có dấu hiệu quá khứ ("yesterday / last... / ago"), nên cần chia động từ ở quá khứ đơn (${tok.clean} → ${pastForm}).`,
        `Quá khứ đơn của "${tok.lower}" là "${PAST_VERB_MAP[tok.lower]}".`,
        ['kc_en_past_tense']
      );
      continue;
    }

    if (
      !hasPastMarker &&
      !isAfterAuxOrInfinitive &&
      (prev === 'he' || prev === 'she' || prev === 'it') &&
      THIRD_SG_VERB_MAP[tok.lower]
    ) {
      const verb3 = matchCase(tok.clean, THIRD_SG_VERB_MAP[tok.lower]);
      pushSpanIssue(
        [i],
        tok.clean,
        verb3,
        'particle',
        'grammar_correction',
        `Chủ ngữ ngôi 3 số ít ("${tokens[i - 1].clean}") ở hiện tại đơn cần thêm -s/-es (${tok.clean} → ${verb3}).`,
        'He/She/It + V-s/-es ở thì hiện tại đơn.',
        ['kc_en_sv_agreement']
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// English Dictionary + Morphological Fallback & Discovery Topics
// ---------------------------------------------------------------------------

const EN_WORD_DICTIONARY: Record<string, EnglishWordDescription> = {
  apple: {
    header: 'apple /ˈæp.əl/',
    explanation: '"quả táo" (danh từ đếm được). Dùng mạo từ "an apple" vì bắt đầu bằng âm nguyên âm.',
    hint: 'Ví dụ: I eat an apple every day.',
  },
  coffee: {
    header: 'coffee /ˈkɒf.i/',
    explanation: '"cà phê" (danh từ không đếm được). Khi gọi ly, dùng "a cup of coffee".',
    hint: 'Ví dụ: Could I have a cup of coffee, please?',
  },
  school: {
    header: 'school /skuːl/',
    explanation: '"trường học". Cụm hay dùng: "go to school" (đi học), "at school" (ở trường).',
    hint: 'Lưu ý: "go to school" (không cần "the" khi nói việc đi học nói chung).',
  },
  yesterday: {
    header: 'yesterday /ˈjes.tə.deɪ/',
    explanation: '"hôm qua" — dấu hiệu nhận biết thì quá khứ đơn (V2/V-ed).',
    hint: 'Ví dụ: I went to school yesterday.',
  },
  today: {
    header: 'today /təˈdeɪ/',
    explanation: '"hôm nay". Có thể dùng với hiện tại đơn, hiện tại tiếp diễn hoặc tương lai gần.',
    hint: 'Ví dụ: I am studying English today.',
  },
  tomorrow: {
    header: 'tomorrow /təˈmɒr.əʊ/',
    explanation: '"ngày mai" — thường dùng với thì tương lai (will / be going to).',
    hint: 'Ví dụ: We will meet tomorrow.',
  },
  friend: {
    header: 'friend /frend/',
    explanation: '"bạn bè" (danh từ). Số nhiều: "friends" /frendz/.',
    hint: 'Ví dụ: She is my best friend.',
  },
  happy: {
    header: 'happy /ˈhæp.i/',
    explanation: '"vui vẻ, hạnh phúc" (tính từ). Đi cùng động từ "to be" hoặc "feel".',
    hint: 'Ví dụ: I feel very happy today.',
  },
  beautiful: {
    header: 'beautiful /ˈbjuː.tɪ.fəl/',
    explanation: '"xinh đẹp, tuyệt đẹp" (tính từ dài). So sánh hơn dùng "more beautiful".',
    hint: 'Trạng từ tương ứng: beautifully.',
  },
  practice: {
    header: 'practice /ˈpræk.tɪs/',
    explanation: '"luyện tập, thực hành" (danh từ/động từ tiếng Anh-Mỹ). Đi sau là V-ing hoặc danh từ.',
    hint: 'Ví dụ: Let\'s practice speaking English!',
  },
  study: {
    header: 'study /ˈstʌd.i/',
    explanation: '"học, nghiên cứu" (động từ). Quá khứ: studied /ˈstʌd.id/.',
    hint: 'Ví dụ: I study English every evening.',
  },
  learn: {
    header: 'learn /lɜːn/',
    explanation: '"học, tiếp thu kỹ năng mới". Cấu trúc: "learn to do something".',
    hint: 'Ví dụ: I want to learn English.',
  },
  student: {
    header: 'student /ˈstjuː.dənt/',
    explanation: '"học sinh / sinh viên" (danh từ đếm được). Số ít nhớ kèm mạo từ "a student".',
    hint: 'Ví dụ: I am a university student.',
  },
  teacher: {
    header: 'teacher /ˈtiː.tʃər/',
    explanation: '"giáo viên" (danh từ chỉ nghề nghiệp).',
    hint: 'Ví dụ: My English teacher is very kind.',
  },
  book: {
    header: 'book /bʊk/',
    explanation: '"quyển sách" (n) hoặc "đặt trước vé/phòng" (v).',
    hint: 'Ví dụ: I am reading an interesting book.',
  },
  water: {
    header: 'water /ˈwɔː.tər/',
    explanation: '"nước" (danh từ không đếm được). Dùng "a glass of water" hoặc "some water".',
    hint: 'Ví dụ: Drink more water every day.',
  },
  hello: {
    header: 'hello /həˈləʊ/',
    explanation: '"xin chào" — cách chào thân thiện, dùng được trong hầu hết tình huống.',
    hint: 'Thân mật hơn: "Hi!", trang trọng hơn: "Good morning!".',
  },
  thank: {
    header: 'thank /θæŋk/',
    explanation: '"cảm ơn" (động từ). Dùng "Thank you" hoặc "Thanks" khi đáp lại.',
    hint: 'Phát âm chú ý âm /θ/ đầu lưỡi đặt nhẹ giữa hai hàm răng.',
  },
  thanks: {
    header: 'thanks /θæŋks/',
    explanation: '"cảm ơn" (thân mật). Trang trọng hơn hãy dùng "Thank you very much.".',
    hint: 'Ví dụ: Thanks for helping me!',
  },
  sorry: {
    header: 'sorry /ˈsɒr.i/',
    explanation: '"xin lỗi, lấy làm tiếc" (tính từ). Dùng câu đầy đủ: "I am sorry.".',
    hint: 'Trang trọng hơn: "I apologize for...".',
  },
  morning: {
    header: 'morning /ˈmɔː.nɪŋ/',
    explanation: '"buổi sáng". Lời chào: "Good morning!", trạng từ: "in the morning".',
    hint: 'Ví dụ: I drink coffee in the morning.',
  },
  family: {
    header: 'family /ˈfæm.əl.i/',
    explanation: '"gia đình". Khi nói các thành viên, dùng "members of my family".',
    hint: 'Ví dụ: My family lives in Hanoi.',
  },
  music: {
    header: 'music /ˈmjuː.zɪk/',
    explanation: '"âm nhạc" (danh từ không đếm được). Cụm chuẩn: "listen to music".',
    hint: 'Nhớ giới từ "to" sau "listen": listen to music.',
  },
  travel: {
    header: 'travel /ˈtræv.əl/',
    explanation: '"đi du lịch, đi lại" (động từ/danh từ không đếm được).',
    hint: 'Ví dụ: I love to travel around the world.',
  },
  weather: {
    header: 'weather /ˈweð.ər/',
    explanation: '"thời tiết" (danh từ không đếm được — không thêm "a" hay "-s").',
    hint: 'Ví dụ: The weather is nice today.',
  },
  language: {
    header: 'language /ˈlæŋ.ɡwɪdʒ/',
    explanation: '"ngôn ngữ". Tiếng Anh: the English language; ngoại ngữ: foreign language.',
    hint: 'Ví dụ: Learning a new language takes practice.',
  },
  work: {
    header: 'work /wɜːk/',
    explanation: '"làm việc" (v) hoặc "công việc" (danh từ không đếm được).',
    hint: 'Ví dụ: I go to work by bus.',
  },
  time: {
    header: 'time /taɪm/',
    explanation: '"thời gian" (không đếm được) hoặc "số lần" (đếm được: three times).',
    hint: 'Hỏi giờ: What time is it?',
  },
  love: {
    header: 'love /lʌv/',
    explanation: '"yêu, rất thích". Sau "love" có thể dùng "V-ing" hoặc "to V".',
    hint: 'Ví dụ: I love learning languages.',
  },
  good: {
    header: 'good /ɡʊd/',
    explanation: '"tốt, giỏi" (tính từ). So sánh hơn là "better" (bất quy tắc).',
    hint: 'Cụm hay dùng: "good at + V-ing / N".',
  },
  great: {
    header: 'great /ɡreɪt/',
    explanation: '"tuyệt vời, rất tốt". Hay dùng để khen hoặc bày tỏ hứng thú.',
    hint: 'Ví dụ: That is a great idea!',
  },
  delicious: {
    header: 'delicious /dɪˈlɪʃ.əs/',
    explanation: '"ngon miệng" (tính từ mô tả món ăn).',
    hint: 'Ví dụ: This pho is delicious!',
  },
  interesting: {
    header: 'interesting /ˈɪn.trəs.tɪŋ/',
    explanation: '"thú vị" (mô tả sự vật). Khi nói mình cảm thấy hứng thú dùng "interested in".',
    hint: 'Phân biệt: interesting (gây thú vị) vs interested (cảm thấy hứng thú).',
  },
  important: {
    header: 'important /ɪmˈpɔː.tənt/',
    explanation: '"quan trọng" (tính từ). Cấu trúc: "It is important to...".',
    hint: 'Ví dụ: Pronunciation is very important.',
  },
  agree: {
    header: 'agree /əˈɡriː/',
    explanation: '"đồng ý" (động từ thường — KHÔNG kèm "am/is/are").',
    hint: 'Ví dụ: I agree with you.',
  },
  home: {
    header: 'home /həʊm/',
    explanation: '"nhà, tổ ấm". Sau go/come không dùng "to": "go home", "at home".',
    hint: 'Ví dụ: I am at home now.',
  },
  house: {
    header: 'house /haʊs/',
    explanation: '"ngôi nhà" (chỉ kiến trúc vật lý, khác với "home" mang nghĩa mái ấm).',
    hint: 'Ví dụ: They bought a new house.',
  },
  cat: {
    header: 'cat /kæt/',
    explanation: '"con mèo" (danh từ đếm được). Âm /æ/ mở miệng rộng hơn âm /e/.',
    hint: 'Ví dụ: The cat is sleeping on the sofa.',
  },
  dog: {
    header: 'dog /dɒɡ/',
    explanation: '"con chó" (danh từ đếm được).',
    hint: 'Ví dụ: Do you have a dog?',
  },
  eat: {
    header: 'eat /iːt/',
    explanation: '"ăn" (động từ bất quy tắc). Quá khứ: ate /eɪt/, phân từ 2: eaten.',
    hint: 'Ví dụ: Let\'s eat lunch together.',
  },
  go: {
    header: 'go /ɡəʊ/',
    explanation: '"đi" (động từ bất quy tắc). Quá khứ: went /went/, ngôi 3 số ít: goes.',
    hint: 'Cụm hay dùng: go to school, go home, go shopping.',
  },
  drink: {
    header: 'drink /drɪŋk/',
    explanation: '"uống" (động từ bất quy tắc). Quá khứ: drank, phân từ 2: drunk.',
    hint: 'Ví dụ: I usually drink tea in the morning.',
  },
  sleep: {
    header: 'sleep /sliːp/',
    explanation: '"ngủ" (động từ bất quy tắc). Quá khứ: slept /slept/.',
    hint: 'Ví dụ: I slept well last night.',
  },
  read: {
    header: 'read /riːd/',
    explanation: '"đọc". Quá khứ viết giống hệt là "read" nhưng phát âm đổi thành /red/!',
    hint: 'Ví dụ: I read a book yesterday (/red/).',
  },
  write: {
    header: 'write /raɪt/',
    explanation: '"viết" (âm "w" đầu câm!). Quá khứ: wrote /rəʊt/.',
    hint: 'Ví dụ: Practice writing English on the board.',
  },
  speak: {
    header: 'speak /spiːk/',
    explanation: '"nói (ngôn ngữ / phát biểu)". Quá khứ: spoke /spəʊk/.',
    hint: 'Ví dụ: Can you speak English?',
  },
  listen: {
    header: 'listen /ˈlɪs.ən/',
    explanation: '"lắng nghe" (âm "t" câm!). Luôn kèm giới từ "to" trước tân ngữ.',
    hint: 'Ví dụ: Listen to the teacher carefully.',
  },
  understand: {
    header: 'understand /ˌʌn.dəˈstænd/',
    explanation: '"hiểu". Quá khứ: understood.',
    hint: 'Ví dụ: I understand this grammar rule now.',
  },
};

export function describeEnglishWordVi(word: string): EnglishWordDescription | null {
  const clean = word.replace(/^[.,!?;:'"()]+|[.,!?;:'"()]+$/g, '').trim();
  if (!clean || !/^[A-Za-z][A-Za-z'-]{0,24}$/.test(clean)) return null;
  const lower = clean.toLowerCase();
  if (EN_WORD_DICTIONARY[lower]) {
    return EN_WORD_DICTIONARY[lower];
  }
  if (clean.length === 1 && lower !== 'i' && lower !== 'a') {
    return null;
  }
  if (lower === 'i') {
    return {
      header: 'I /aɪ/',
      explanation: 'Đại từ ngôi thứ nhất số ít ("tôi") — luôn viết hoa "I" ở mọi vị trí trong câu.',
      hint: 'Đi với "am" (hiện tại) và "was" (quá khứ).',
    };
  }
  if (lower === 'a') {
    return {
      header: 'a /ə/',
      explanation: 'Mạo từ bất định ("một") đứng trước danh từ đếm được số ít bắt đầu bằng âm phụ âm.',
      hint: 'Đổi sang "an" nếu từ sau bắt đầu bằng âm nguyên âm.',
    };
  }
  if (/ly$/.test(lower) && clean.length >= 4) {
    return {
      header: `${clean} (trạng từ)`,
      explanation: `Từ "${clean}" có đuôi "-ly", thường là trạng từ bổ nghĩa cho động từ hoặc tính từ.`,
      hint: 'Thử đặt câu đầy đủ với từ này trên bảng để AI kiểm tra ngữ pháp.',
    };
  }
  if (/ing$/.test(lower) && clean.length >= 5) {
    return {
      header: `${clean} (V-ing / danh động từ)`,
      explanation: `Dạng "-ing" của động từ: dùng sau "am/is/are" (đang làm) hoặc sau các động từ như "like/enjoy".`,
      hint: 'Thử viết cả câu chứa từ này để AI kiểm tra cấu trúc câu.',
    };
  }
  if (/(tion|ment|ness)$/.test(lower) && clean.length >= 6) {
    return {
      header: `${clean} (danh từ)`,
      explanation: `Hậu tố "-tion / -ment / -ness" thường tạo thành danh từ chỉ khái niệm hoặc trạng thái.`,
      hint: 'Kiểm tra mạo từ (a/an/the) khi đưa vào câu.',
    };
  }
  if (/(ful|ous|able|ible)$/.test(lower) && clean.length >= 5) {
    return {
      header: `${clean} (tính từ)`,
      explanation: `Từ "${clean}" mang hậu tố tính từ, dùng sau động từ "to be" hoặc đứng trước danh từ.`,
      hint: 'Thử viết thêm danh từ bên cạnh để tạo thành cụm hoặc câu.',
    };
  }

  return {
    header: `${clean} [EN]`,
    explanation: `Từ tiếng Anh "${clean}". Hãy viết thêm chủ ngữ/động từ bên cạnh thành câu hoàn chỉnh để AI kiểm tra thì và ngữ pháp.`,
    hint: 'Ví dụ: "I like ..." hoặc "Yesterday I ...".',
  };
}

export function buildEnglishDiscoveryCard(viPrompt: string): EnglishDiscoveryCardContent {
  const lower = viPrompt.toLowerCase();
  if (lower.includes('cà phê') || lower.includes('trà') || lower.includes('gọi')) {
    return {
      phrase: 'Could I have a cup of coffee, please?',
      ipa: '/kʊd aɪ hæv ə kʌp əv ˈkɒf.i pliːz/',
      explanation:
        'Mẫu câu lịch sự, tự nhiên nhất khi gọi đồ uống trong quán cà phê bằng tiếng Anh.',
      breakdown: [
        { token: 'Could I have...', meaningVi: 'Cho tôi xin / gọi...' },
        { token: 'a cup of coffee', meaningVi: 'một tách cà phê' },
        { token: 'please', meaningVi: 'làm ơn (lịch sự)' },
      ],
    };
  }
  if (lower.includes('giới thiệu') || lower.includes('tên')) {
    return {
      phrase: 'Hi, my name is Linh. Nice to meet you!',
      ipa: '/haɪ maɪ neɪm ɪz lɪn naɪs tə miːt juː/',
      explanation:
        'Mẫu câu giới thiệu bản thân cơ bản khi lần đầu gặp gỡ.',
      breakdown: [
        { token: 'My name is...', meaningVi: 'Tên tôi là...' },
        { token: 'Nice to meet you', meaningVi: 'Rất vui được gặp bạn' },
      ],
    };
  }
  if (lower.includes('cảm ơn')) {
    return {
      phrase: 'Thank you so much!',
      ipa: '/θæŋk juː səʊ mʌtʃ/',
      explanation: 'Lời cảm ơn chân thành, dùng được cả với bạn bè lẫn đồng nghiệp.',
      breakdown: [
        { token: 'Thank you', meaningVi: 'Cảm ơn bạn' },
        { token: 'so much', meaningVi: 'rất nhiều' },
      ],
    };
  }
  if (lower.includes('xin lỗi')) {
    return {
      phrase: "I'm sorry about that.",
      ipa: '/aɪm ˈsɒr.i əˈbaʊt ðæt/',
      explanation: 'Câu xin lỗi tự nhiên và lịch sự trong giao tiếp hằng ngày.',
      breakdown: [
        { token: "I'm sorry", meaningVi: 'Tôi xin lỗi' },
        { token: 'about that', meaningVi: 'về chuyện đó' },
      ],
    };
  }
  if (lower.includes('bao nhiêu')) {
    return {
      phrase: 'How much is this?',
      ipa: '/haʊ mʌtʃ ɪz ðɪs/',
      explanation: 'Câu hỏi giá tiền phổ biến nhất khi mua sắm.',
      breakdown: [
        { token: 'How much', meaningVi: 'Bao nhiêu (tiền)' },
        { token: 'is this?', meaningVi: 'cái này?' },
      ],
    };
  }
  return {
    phrase: 'Hello! How are you today?',
    ipa: '/həˈləʊ haʊ ɑːr juː təˈdeɪ/',
    explanation:
      'Câu chào mở đầu hội thoại tiếng Anh thông dụng nhất.',
    breakdown: [
      { token: 'Hello', meaningVi: 'Xin chào' },
      { token: 'How are you?', meaningVi: 'Bạn có khỏe không?' },
      { token: 'today', meaningVi: 'hôm nay' },
    ],
  };
}
