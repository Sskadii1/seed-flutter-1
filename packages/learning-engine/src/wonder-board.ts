import {
  AdaptiveAiProfile,
  Exercise,
  WONDER_BOARD_THEMES,
  WonderAiMode,
  WonderAnnotation,
  WonderAnnotationSchema,
  WonderArrowPath,
  WonderBBox,
  WonderBoardDocument,
  WonderBoardThemeId,
  WonderGestureIntent,
  WonderLanguage,
  WonderLearningEvent,
  WonderPlacementPreference,
  WonderReconciliationAction,
  WonderRecognitionRegion,
  WonderRecognitionSpan,
  WonderStroke,
  WonderStrokePoint,
  WonderStrokeProvenance,
  WonderTargetLanguage,
  WonderTeachingCard,
  WonderThemeTokens,
} from '@seed/schema';
import { attachParticle, hasBatchim } from './hangul';
import { decomposeHangulUnit, inspectHangulBranch } from './wonder-hangul';
import { updateAdaptiveAiProfile } from './adaptive-ai';
import {
  decodeKoreanSpacingHypotheses,
  estimateLocalHandwritingScale,
} from './wonder-hierarchy';
import {
  analyzeEnglishPedagogyForRegion,
  buildEnglishDiscoveryCard,
  describeEnglishWordVi,
  latinGlyphStrokes,
  recognizeFreehandLatinCluster,
} from './wonder-english';

// ---------------------------------------------------------------------------
// 1. Geometry & Non-Destructive Layer 2 Ink Helpers
// ---------------------------------------------------------------------------

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

export function computeStrokeBoundingBox(
  points: WonderStrokePoint[],
  dx = 0,
  dy = 0,
  strokeWidth = 3.4,
  tool: 'chalk' | 'pencil' | 'highlighter' | 'eraser_pixel' = 'chalk'
): WonderBBox {
  if (points.length === 0) {
    return { minX: dx, minY: dy, maxX: dx, maxY: dy, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxPressure = 0.55;
  for (const pt of points) {
    const px = pt.x + dx;
    const py = pt.y + dy;
    if (pt.pressure > maxPressure) maxPressure = pt.pressure;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  // Account for visual ink thickness, pressure expansion, and rounded caps/joins
  const mult = tool === 'highlighter' ? 3.8 : 0.55 + maxPressure * 0.85;
  const visualPad = Math.max(2, (strokeWidth * mult) / 2 + 1.5);
  const vMinX = minX - visualPad;
  const vMinY = minY - visualPad;
  const vMaxX = maxX + visualPad;
  const vMaxY = maxY + visualPad;
  return {
    minX: vMinX,
    minY: vMinY,
    maxX: vMaxX,
    maxY: vMaxY,
    width: Math.max(0, vMaxX - vMinX),
    height: Math.max(0, vMaxY - vMinY),
  };
}

export function mergeBoundingBoxes(boxes: WonderBBox[]): WonderBBox {
  if (boxes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function expandBoundingBox(box: WonderBBox, padX: number, padY = padX): WonderBBox {
  const minX = box.minX - padX;
  const minY = box.minY - padY;
  const maxX = box.maxX + padX;
  const maxY = box.maxY + padY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function boxesIntersect(a: WonderBBox, b: WonderBBox, padding = 0): boolean {
  return !(
    a.maxX + padding < b.minX ||
    a.minX - padding > b.maxX ||
    a.maxY + padding < b.minY ||
    a.minY - padding > b.maxY
  );
}

export function pointInPolygon(
  px: number,
  py: number,
  polygon: Array<{ x: number; y: number }>
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findStrokesInPolygon(
  strokes: WonderStroke[],
  polygon: Array<{ x: number; y: number }>
): string[] {
  const hit: string[] = [];
  for (const s of strokes) {
    if (s.deleted || s.tool === 'eraser_pixel') continue;
    const cx = (s.bbox.minX + s.bbox.maxX) / 2;
    const cy = (s.bbox.minY + s.bbox.maxY) / 2;
    if (
      pointInPolygon(cx, cy, polygon) ||
      s.points.some((p) => pointInPolygon(p.x + s.transform.dx, p.y + s.transform.dy, polygon))
    ) {
      hit.push(s.id);
    }
  }
  return hit;
}

export function translateStrokes(
  strokes: WonderStroke[],
  targetIds: Set<string>,
  dx: number,
  dy: number,
  nextRevision: number
): WonderStroke[] {
  return strokes.map((s) => {
    if (!targetIds.has(s.id)) return s;
    const nextPoints = s.points.map((p) => ({
      ...p,
      x: p.x + dx,
      y: p.y + dy,
    }));
    return {
      ...s,
      points: nextPoints,
      bbox: computeStrokeBoundingBox(
        nextPoints,
        s.transform.dx,
        s.transform.dy,
        s.width,
        s.tool
      ),
      revision: nextRevision,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Organic Cloud Geometry V2 & Curved Chalk Arrows (Single Continuous Path)
// ---------------------------------------------------------------------------

function seededUnit(seed: number, index: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface WonderCloudSamplePoint {
  x: number;
  y: number;
  angle: number;
  cumLength: number;
}

export interface WonderCloudGeometry {
  pathId: string;
  pathData: string;
  sampledPoints: WonderCloudSamplePoint[];
  totalLength: number;
  outerBounds: WonderBBox;
  safeInteriorBounds: WonderBBox;
  connectionAnchors: Record<WonderPlacementPreference, { x: number; y: number }>;
}

/**
 * Computes an organic, cute, hand-drawn puffy cloud contour around the target visual
 * ink bounding box using a rounded-capsule safe boundary + cubic Bezier lobes,
 * adapting padding around neighboring unrelated words so no ink is clipped.
 */
export function generateScallopedCloudGeometry(
  bbox: WonderBBox,
  seed = 1,
  neighborBoxes: WonderBBox[] = [],
  compact = false
): WonderCloudGeometry {
  const h = Math.max(28, bbox.height);
  // Generous proportional padding (35–55% horizontal, 30–45% vertical) scaled with ink height
  const baseClearX = compact ? Math.max(9, Math.min(20, h * 0.16)) : Math.max(24, Math.min(180, h * 0.44));
  const baseClearY = compact ? Math.max(8, Math.min(18, h * 0.14)) : Math.max(20, Math.min(150, h * 0.36));
  const minNeighborFloor = compact ? 6 : Math.max(12, Math.min(24, h * 0.18));

  let leftClear = baseClearX;
  let rightClear = baseClearX;
  let topClear = baseClearY;
  let bottomClear = baseClearY;

  for (const nb of neighborBoxes) {
    if (boxesIntersect(nb, bbox, 0)) continue;
    const vertOverlap = nb.maxY > bbox.minY - 8 && nb.minY < bbox.maxY + 8;
    const horizOverlap = nb.maxX > bbox.minX - 8 && nb.minX < bbox.maxX + 8;
    if (vertOverlap && nb.maxX <= bbox.minX && bbox.minX - nb.maxX < baseClearX + 18) {
      leftClear = Math.max(minNeighborFloor, Math.min(leftClear, (bbox.minX - nb.maxX) * 0.55));
    }
    if (vertOverlap && nb.minX >= bbox.maxX && nb.minX - bbox.maxX < baseClearX + 18) {
      rightClear = Math.max(minNeighborFloor, Math.min(rightClear, (nb.minX - bbox.maxX) * 0.55));
    }
    if (horizOverlap && nb.maxY <= bbox.minY && bbox.minY - nb.maxY < baseClearY + 16) {
      topClear = Math.max(minNeighborFloor, Math.min(topClear, (bbox.minY - nb.maxY) * 0.55));
    }
    if (horizOverlap && nb.minY >= bbox.maxY && nb.minY - bbox.maxY < baseClearY + 16) {
      bottomClear = Math.max(minNeighborFloor, Math.min(bottomClear, (nb.minY - bbox.maxY) * 0.55));
    }
  }

  const safeInteriorBounds: WonderBBox = {
    minX: bbox.minX - leftClear,
    minY: bbox.minY - topClear,
    maxX: bbox.maxX + rightClear,
    maxY: bbox.maxY + bottomClear,
    width: bbox.width + leftClear + rightClear,
    height: bbox.height + topClear + bottomClear,
  };

  // Bowed organic super-ellipse base contour around safeInteriorBounds (no flat top/bottom lines!)
  const rx = Math.max(12, safeInteriorBounds.width / 2);
  const ry = Math.max(12, safeInteriorBounds.height / 2);
  const cx = (safeInteriorBounds.minX + safeInteriorBounds.maxX) / 2;
  const cy = (safeInteriorBounds.minY + safeInteriorBounds.maxY) / 2;
  const ax = rx * 1.15;
  const ay = ry * 1.19;
  const pExp = 2.75;
  const phase1 = seededUnit(seed, 31) * Math.PI * 2;
  const phase2 = seededUnit(seed, 57) * Math.PI * 2;

  const perimeterPointAt = (u: number): { x: number; y: number } => {
    const theta = -Math.PI * 0.78 + u * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const denom = Math.pow(
      Math.pow(Math.abs(c) / ax, pExp) + Math.pow(Math.abs(s) / ay, pExp),
      1 / pExp
    );
    const superEllipseR = 1 / Math.max(0.0001, denom);
    const boxR = Math.min(
      Math.abs(c) > 1e-4 ? rx / Math.abs(c) : 1e9,
      Math.abs(s) > 1e-4 ? ry / Math.abs(s) : 1e9
    );
    const baseR = Math.max(superEllipseR, boxR * 1.02);
    const archMod = Math.max(
      1.0,
      1.03 + 0.048 * Math.sin(theta * 2 + phase1) + 0.032 * Math.cos(theta * 3 + phase2)
    );
    const r = baseR * archMod;
    return {
      x: cx + r * c,
      y: cy + r * s,
    };
  };

  // Adaptive count of large rounded lobes: Small 6-9, Medium 8-12, Long phrase up to 15
  const aspect = safeInteriorBounds.width / Math.max(1, safeInteriorBounds.height);
  const lobes =
    aspect < 1.45
      ? 7 + Math.floor(seededUnit(seed, 9) * 2)
      : aspect < 2.6
        ? 9 + Math.floor(seededUnit(seed, 11) * 3)
        : Math.min(15, 10 + Math.round(aspect * 1.1));

  // Alternate large and medium lobe arc spans for authentic hand-drawn cloud silhouette
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < lobes; i++) {
    const altBoost = i % 2 === 0 ? 1.24 : 0.84;
    const w = (0.72 + seededUnit(seed, i + 100) * 0.5) * altBoost;
    weights.push(w);
    weightSum += w;
  }

  const anchors: Array<{ x: number; y: number }> = [];
  let accU = 0;
  for (let i = 0; i < lobes; i++) {
    anchors.push(perimeterPointAt(accU));
    accU += weights[i] / weightSum;
  }

  let d = `M ${anchors[0].x.toFixed(1)} ${anchors[0].y.toFixed(1)}`;
  const sampledPoints: WonderCloudSamplePoint[] = [];
  let cumLength = 0;
  let oMinX = Infinity;
  let oMinY = Infinity;
  let oMaxX = -Infinity;
  let oMaxY = -Infinity;

  const pushSample = (x: number, y: number, angle: number) => {
    if (sampledPoints.length > 0) {
      const prev = sampledPoints[sampledPoints.length - 1];
      cumLength += Math.hypot(x - prev.x, y - prev.y);
    }
    if (x < oMinX) oMinX = x;
    if (y < oMinY) oMinY = y;
    if (x > oMaxX) oMaxX = x;
    if (y > oMaxY) oMaxY = y;
    sampledPoints.push({ x, y, angle, cumLength });
  };

  for (let i = 0; i < lobes; i++) {
    const p1 = anchors[i];
    const p2 = anchors[(i + 1) % lobes];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const chord = Math.hypot(dx, dy) || 1;
    const tx = dx / chord;
    const ty = dy / chord;
    const outNx = ty;
    const outNy = -tx;
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const sign = (mx - cx) * outNx + (my - cy) * outNy >= 0 ? 1 : -1;
    const nx = outNx * sign;
    const ny = outNy * sign;

    // Height- and chord-scaled lobe puff depth (billowy round puffs without fixed 18px cap!)
    const lobeScale = 0.84 + seededUnit(seed + 17, i) * 0.4;
    const maxSafePuff = Math.max(32, h * 0.56);
    const puffDepth = Math.max(
      14,
      Math.min(maxSafePuff, Math.max(h * 0.24, chord * 0.42) * lobeScale)
    );
    const cpSpread = chord * 0.27;
    const cp1x = p1.x + tx * cpSpread + nx * puffDepth;
    const cp1y = p1.y + ty * cpSpread + ny * puffDepth;
    const cp2x = p2.x - tx * cpSpread + nx * puffDepth;
    const cp2y = p2.y - ty * cpSpread + ny * puffDepth;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;

    // Sample 12 points along this cubic Bezier for smooth arc-length traversal
    const steps = 12;
    for (let st = i === 0 ? 0 : 1; st <= steps; st++) {
      const t = st / steps;
      const omt = 1 - t;
      const x =
        omt * omt * omt * p1.x +
        3 * omt * omt * t * cp1x +
        3 * omt * t * t * cp2x +
        t * t * t * p2.x;
      const y =
        omt * omt * omt * p1.y +
        3 * omt * omt * t * cp1y +
        3 * omt * t * t * cp2y +
        t * t * t * p2.y;
      const dxdt =
        3 * omt * omt * (cp1x - p1.x) +
        6 * omt * t * (cp2x - cp1x) +
        3 * t * t * (p2.x - cp2x);
      const dydt =
        3 * omt * omt * (cp1y - p1.y) +
        6 * omt * t * (cp2y - cp1y) +
        3 * t * t * (p2.y - cp2y);
      pushSample(x, y, Math.atan2(dydt, dxdt));
    }
  }

  const outerBounds: WonderBBox = {
    minX: oMinX,
    minY: oMinY,
    maxX: oMaxX,
    maxY: oMaxY,
    width: Math.max(0, oMaxX - oMinX),
    height: Math.max(0, oMaxY - oMinY),
  };

  return {
    pathId: `cloud_${Math.round(bbox.minX)}_${Math.round(bbox.minY)}_${seed}`,
    pathData: `${d} Z`,
    sampledPoints,
    totalLength: cumLength,
    outerBounds,
    safeInteriorBounds,
    connectionAnchors: {
      below: { x: cx, y: oMaxY + 2 },
      above: { x: cx, y: oMinY - 2 },
      right: { x: oMaxX + 2, y: cy },
      left: { x: oMinX - 2, y: cy },
    },
  };
}

export function generateScallopedCloudSvgPath(bbox: WonderBBox, seed = 1): string {
  return generateScallopedCloudGeometry(bbox, seed).pathData;
}

/**
 * Returns an open progressive SVG stroke slice at progress in [0, 1].
 * Never draws a closing straight segment across target strokes while progress < 1.
 */
export function sliceCloudPathAtProgress(
  cloud: WonderCloudGeometry,
  progress: number
): { pathData: string; headX: number; headY: number; headAngle: number; isClosed: boolean } {
  const pts = cloud.sampledPoints;
  if (pts.length === 0 || progress <= 0.001) {
    return {
      pathData: '',
      headX: pts[0]?.x ?? 0,
      headY: pts[0]?.y ?? 0,
      headAngle: pts[0]?.angle ?? 0,
      isClosed: false,
    };
  }
  if (progress >= 0.999) {
    const last = pts[pts.length - 1];
    return {
      pathData: cloud.pathData,
      headX: last.x,
      headY: last.y,
      headAngle: last.angle,
      isClosed: true,
    };
  }

  const targetLen = progress * cloud.totalLength;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let headX = pts[0].x;
  let headY = pts[0].y;
  let headAngle = pts[0].angle;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    if (curr.cumLength <= targetLen) {
      d += ` L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
      headX = curr.x;
      headY = curr.y;
      headAngle = curr.angle;
    } else {
      const span = Math.max(0.0001, curr.cumLength - prev.cumLength);
      const frac = Math.max(0, Math.min(1, (targetLen - prev.cumLength) / span));
      headX = prev.x + (curr.x - prev.x) * frac;
      headY = prev.y + (curr.y - prev.y) * frac;
      headAngle = curr.angle;
      d += ` L ${headX.toFixed(1)} ${headY.toFixed(1)}`;
      break;
    }
  }

  return { pathData: d, headX, headY, headAngle, isClosed: false };
}

/**
 * Slices a quadratic Bezier chalk arrow progressively from 0 -> 1.
 */
export function sliceArrowPathAtProgress(
  arrow: WonderArrowPath,
  progress: number
): { shaftPath: string; headPath: string; headX: number; headY: number; headAngle: number } {
  if (progress <= 0.001 || (arrow.fromX === arrow.toX && arrow.fromY === arrow.toY)) {
    return {
      shaftPath: '',
      headPath: '',
      headX: arrow.fromX,
      headY: arrow.fromY,
      headAngle: Math.atan2(arrow.ctrlY - arrow.fromY, arrow.ctrlX - arrow.fromX),
    };
  }
  if (progress >= 0.999) {
    const full = generateCurvedChalkArrowSvgPath(arrow);
    return {
      shaftPath: full.shaftPath,
      headPath: full.headPath,
      headX: arrow.toX,
      headY: arrow.toY,
      headAngle: Math.atan2(arrow.toY - arrow.ctrlY, arrow.toX - arrow.ctrlX),
    };
  }

  const shaftP = Math.min(1, progress / 0.82);
  let d = `M ${arrow.fromX.toFixed(1)} ${arrow.fromY.toFixed(1)}`;
  let headX = arrow.fromX;
  let headY = arrow.fromY;
  let headAngle = 0;
  const steps = 16;
  const maxStep = Math.max(1, Math.ceil(shaftP * steps));
  for (let i = 1; i <= maxStep; i++) {
    const t = Math.min(shaftP, i / steps);
    const omt = 1 - t;
    const x = omt * omt * arrow.fromX + 2 * omt * t * arrow.ctrlX + t * t * arrow.toX;
    const y = omt * omt * arrow.fromY + 2 * omt * t * arrow.ctrlY + t * t * arrow.toY;
    const dx = 2 * omt * (arrow.ctrlX - arrow.fromX) + 2 * t * (arrow.toX - arrow.ctrlX);
    const dy = 2 * omt * (arrow.ctrlY - arrow.fromY) + 2 * t * (arrow.toY - arrow.ctrlY);
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    headX = x;
    headY = y;
    headAngle = Math.atan2(dy, dx);
  }

  let headPath = '';
  if (progress > 0.82) {
    const fullHead = generateCurvedChalkArrowSvgPath(arrow);
    headPath = fullHead.headPath;
    headX = arrow.toX;
    headY = arrow.toY;
  }

  return { shaftPath: d, headPath, headX, headY, headAngle };
}

/**
 * Verifies that every stroke point + visual ink radius lies strictly inside the cloud's
 * safe interior contour and outside any cloud boundary path segments.
 */
export function verifyCloudClearance(
  cloud: WonderCloudGeometry,
  targetStrokes: WonderStroke[]
): { valid: boolean; minClearance: number; clippedStrokeIds: string[] } {
  const clippedStrokeIds: string[] = [];
  let minClearance = Infinity;

  for (const s of targetStrokes) {
    const b = s.bbox;
    if (
      b.minX < cloud.outerBounds.minX ||
      b.maxX > cloud.outerBounds.maxX ||
      b.minY < cloud.outerBounds.minY ||
      b.maxY > cloud.outerBounds.maxY
    ) {
      clippedStrokeIds.push(s.id);
    }
    for (const cPt of cloud.sampledPoints) {
      const clampedX = Math.max(b.minX, Math.min(b.maxX, cPt.x));
      const clampedY = Math.max(b.minY, Math.min(b.maxY, cPt.y));
      const dist = Math.hypot(cPt.x - clampedX, cPt.y - clampedY);
      if (dist < minClearance) minClearance = dist;
    }
  }

  return {
    valid: clippedStrokeIds.length === 0 && minClearance >= 6,
    minClearance: Number.isFinite(minClearance) ? minClearance : 0,
    clippedStrokeIds,
  };
}

/**
 * Generates hand-drawn quadratic Bezier shaft and open chevron arrowhead SVG paths.
 */
export function generateCurvedChalkArrowSvgPath(arrow: WonderArrowPath): {
  shaftPath: string;
  headPath: string;
} {
  if (arrow.fromX === arrow.toX && arrow.fromY === arrow.toY) return { shaftPath: '', headPath: '' };
  const shaftPath = `M ${arrow.fromX.toFixed(1)} ${arrow.fromY.toFixed(1)} Q ${arrow.ctrlX.toFixed(1)} ${arrow.ctrlY.toFixed(1)} ${arrow.toX.toFixed(1)} ${arrow.toY.toFixed(1)}`;
  const [left, , right] = arrowHeadPoints(arrow);
  const headPath = `M ${left.x.toFixed(1)} ${left.y.toFixed(1)} L ${arrow.toX.toFixed(1)} ${arrow.toY.toFixed(1)} L ${right.x.toFixed(1)} ${right.y.toFixed(1)}`;
  return { shaftPath, headPath };
}

function arrowHeadPoints(arrow: WonderArrowPath) {
  const angle = Math.atan2(arrow.toY - arrow.ctrlY, arrow.toX - arrow.ctrlX);
  const headLen = 9.5;
  const spread = Math.PI / 6;
  return [
    { x: arrow.toX - headLen * Math.cos(angle - spread), y: arrow.toY - headLen * Math.sin(angle - spread) },
    { x: arrow.toX, y: arrow.toY },
    { x: arrow.toX - headLen * Math.cos(angle + spread), y: arrow.toY - headLen * Math.sin(angle + spread) },
  ];
}

// ---------------------------------------------------------------------------
// 3. Collision-Free Spatial Annotation Placement (Section 13)
// ---------------------------------------------------------------------------

type SpatialPlacementDirection =
  | 'below'
  | 'right'
  | 'above'
  | 'left'
  | 'below_right'
  | 'below_left'
  | 'above_right'
  | 'above_left';

function toBasePlacement(dir: SpatialPlacementDirection): WonderPlacementPreference {
  if (dir === 'below_right' || dir === 'below_left') return 'below';
  if (dir === 'above_right' || dir === 'above_left') return 'above';
  return dir;
}

function makeArrowBetween(
  targetBox: WonderBBox,
  noteBox: WonderBBox,
  placement: WonderPlacementPreference,
  cloud?: WonderCloudGeometry,
  bend = 0,
  anchorShift = 0
): WonderArrowPath {
  const resolvedCloud = cloud ?? generateScallopedCloudGeometry(targetBox, 1);
  const cloudBox = resolvedCloud.outerBounds;
  const cloudCx = (cloudBox.minX + cloudBox.maxX) / 2;
  const cloudCy = (cloudBox.minY + cloudBox.maxY) / 2;
  const noteCx = (noteBox.minX + noteBox.maxX) / 2;
  const noteCy = (noteBox.minY + noteBox.maxY) / 2;
  const stopPad = 12;

  let toX = noteCx;
  let toY = noteBox.minY - stopPad;
  if (placement === 'above') {
    toX = noteCx;
    toY = noteBox.maxY + stopPad;
  } else if (placement === 'right') {
    toX = noteBox.minX - stopPad;
    toY = noteCy;
  } else if (placement === 'left') {
    toX = noteBox.maxX + stopPad;
    toY = noteCy;
  }

  // Clamp arrow entry near the side of the note facing the cloud if diagonally offset
  if (placement === 'below' || placement === 'above') {
    toX = Math.max(noteBox.minX + 12, Math.min(noteBox.maxX - 12, cloudCx + anchorShift));
  } else {
    toY = Math.max(noteBox.minY + 12, Math.min(noteBox.maxY - 12, cloudCy + anchorShift));
  }

  // Pick closest point along actual exterior cloud boundary facing the arrow destination
  let fromX = resolvedCloud.connectionAnchors[placement].x;
  let fromY = resolvedCloud.connectionAnchors[placement].y;
  if (resolvedCloud.sampledPoints.length > 0) {
    let bestDist = Infinity;
    for (const pt of resolvedCloud.sampledPoints) {
      if (placement === 'below' && pt.y < cloudCy) continue;
      if (placement === 'above' && pt.y > cloudCy) continue;
      if (placement === 'right' && pt.x < cloudCx) continue;
      if (placement === 'left' && pt.x > cloudCx) continue;
      const d = Math.hypot(pt.x - toX, pt.y - toY);
      if (d < bestDist) {
        bestDist = d;
        fromX = pt.x;
        fromY = pt.y;
      }
    }
    const outX = fromX - cloudCx;
    const outY = fromY - cloudCy;
    const outLen = Math.hypot(outX, outY) || 1;
    fromX += (outX / outLen) * 5;
    fromY += (outY / outLen) * 5;
  }

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  return {
    fromX: Number(fromX.toFixed(1)),
    fromY: Number(fromY.toFixed(1)),
    ctrlX: Number(((fromX + toX) / 2 + nx * bend).toFixed(1)),
    ctrlY: Number(((fromY + toY) / 2 + ny * bend).toFixed(1)),
    toX: Number(toX.toFixed(1)),
    toY: Number(toY.toFixed(1)),
  };
}

type RoutePoint = { x: number; y: number };
type RouteBounds = Pick<WonderBBox, 'minX' | 'minY' | 'maxX' | 'maxY'>;

function arrowSegments(arrow: WonderArrowPath): Array<[RoutePoint, RoutePoint]> {
  if (arrow.fromX === arrow.toX && arrow.fromY === arrow.toY) return [];
  const [left, tip, right] = arrowHeadPoints(arrow);
  const segments: Array<[RoutePoint, RoutePoint]> = [[left, tip], [tip, right]];
  let last = { x: arrow.fromX, y: arrow.fromY };
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const rest = 1 - t;
    const point = {
      x: rest * rest * arrow.fromX + 2 * rest * t * arrow.ctrlX + t * t * arrow.toX,
      y: rest * rest * arrow.fromY + 2 * rest * t * arrow.ctrlY + t * t * arrow.toY,
    };
    segments.push([last, point]);
    last = point;
  }
  return segments;
}

function segmentIntersectsBox(a: RoutePoint, b: RoutePoint, box: RouteBounds, pad: number) {
  let entry = 0;
  let exit = 1;
  for (const [from, to, min, max] of [
    [a.x, b.x, box.minX - pad, box.maxX + pad],
    [a.y, b.y, box.minY - pad, box.maxY + pad],
  ]) {
    const delta = to - from;
    if (delta === 0) {
      if (from < min || from > max) return false;
      continue;
    }
    const t0 = (min - from) / delta;
    const t1 = (max - from) / delta;
    entry = Math.max(entry, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
    if (entry > exit) return false;
  }
  return true;
}

export function hiddenAnnotationArrow(box: WonderBBox): WonderArrowPath {
  return {
    fromX: box.minX, ctrlX: box.minX, toX: box.minX,
    fromY: box.minY, ctrlY: box.minY, toY: box.minY,
  };
}

export function routeAnnotationArrow(params: {
  targetBox: WonderBBox;
  cloud: WonderCloudGeometry;
  noteBox: WonderBBox;
  placement: WonderPlacementPreference;
  obstacles: WonderBBox[];
  existingRoutes?: WonderArrowPath[];
  safeBounds?: RouteBounds;
  maxLength?: number;
}): WonderArrowPath | undefined {
  const { targetBox, cloud, noteBox, placement, obstacles, existingRoutes = [], safeBounds } = params;
  const maxLength = params.maxLength ?? 150;
  const priorShaftBoxes = existingRoutes.flatMap((arrow) => arrowSegments(arrow).map(([a, b]) => ({
    minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y),
  })));
  const insideViewport = (p: RoutePoint) => !safeBounds || (
    p.x >= safeBounds.minX + 3 && p.x <= safeBounds.maxX - 3 &&
    p.y >= safeBounds.minY + 3 && p.y <= safeBounds.maxY - 3
  );
  const clear = (arrow: WonderArrowPath) => {
    const controlLength = Math.hypot(arrow.ctrlX - arrow.fromX, arrow.ctrlY - arrow.fromY) +
      Math.hypot(arrow.toX - arrow.ctrlX, arrow.toY - arrow.ctrlY);
    const chord = Math.hypot(arrow.toX - arrow.fromX, arrow.toY - arrow.fromY);
    if (chord < 9 || controlLength > maxLength) return false;
    if (!insideViewport({ x: arrow.ctrlX, y: arrow.ctrlY })) return false;
    const padding = 6;
    const routeMinX = Math.min(arrow.fromX, arrow.ctrlX, arrow.toX) - 10 - padding;
    const routeMaxX = Math.max(arrow.fromX, arrow.ctrlX, arrow.toX) + 10 + padding;
    const routeMinY = Math.min(arrow.fromY, arrow.ctrlY, arrow.toY) - 10 - padding;
    const routeMaxY = Math.max(arrow.fromY, arrow.ctrlY, arrow.toY) + 10 + padding;
    const nearby = (box: RouteBounds) => box.minX <= routeMaxX && box.maxX >= routeMinX &&
      box.minY <= routeMaxY && box.maxY >= routeMinY;
    const nearbyObstacles = obstacles.filter(nearby);
    const nearbyShaft = priorShaftBoxes.filter(nearby);
    // Curve deviation from each chord is below 0.1 world units for these bends.
    // The clearance also covers the visible shaft, arrowhead, and SVG rounding.
    return arrowSegments(arrow).every(([a, b]) =>
      insideViewport(a) && insideViewport(b) &&
      !segmentIntersectsBox(a, b, noteBox, 5) &&
      !nearbyObstacles.some((box) => segmentIntersectsBox(a, b, box, 5)) &&
      !nearbyShaft.some((box) => segmentIntersectsBox(a, b, box, 6)) &&
      !pointInPolygon(b.x, b.y, cloud.sampledPoints));
  };
  for (const shift of [0, -26, 26]) {
    for (const bend of [0, -15, 15, -28, 28]) {
      const arrow = makeArrowBetween(targetBox, noteBox, placement, cloud, bend, shift);
      if (clear(arrow)) return arrow;
    }
  }
  return undefined;
}

export function computeCollisionFreePlacement(params: {
  targetBox: WonderBBox;
  desiredWidth: number;
  desiredHeight: number;
  preferredOrder?: WonderPlacementPreference[];
  occupiedBoxes: WonderBBox[];
  activeWritingBox?: WonderBBox | null;
  safeGap?: number;
  maxWorldRight?: number;
  worldSafeBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  uiOverlayBlockers?: WonderBBox[];
  cloudSeed?: number;
  resolvedCloud?: WonderCloudGeometry;
}): {
  noteBox: WonderBBox;
  placement: WonderPlacementPreference;
  arrow: WonderArrowPath;
} {
  const {
    targetBox,
    desiredWidth,
    desiredHeight,
    preferredOrder = ['below', 'right', 'above', 'left'],
    occupiedBoxes,
    activeWritingBox,
    safeGap = 28,
    maxWorldRight = 1040,
    worldSafeBounds,
    uiOverlayBlockers = [],
    cloudSeed = 1,
  } = params;

  const cloud = params.resolvedCloud ?? generateScallopedCloudGeometry(targetBox, cloudSeed, occupiedBoxes);
  const cloudOuterBox = cloud.outerBounds;

  const worldBlockers = [
    cloudOuterBox,
    ...(activeWritingBox ? [...occupiedBoxes, activeWritingBox] : occupiedBoxes),
  ];
  const blockers = [...worldBlockers, ...uiOverlayBlockers];
  const findRoute = (noteBox: WonderBBox, placement: WonderPlacementPreference) =>
    routeAnnotationArrow({
      targetBox, cloud, noteBox, placement,
      obstacles: [...occupiedBoxes, ...uiOverlayBlockers, ...(activeWritingBox ? [activeWritingBox] : [])],
      safeBounds: worldSafeBounds,
    });
  let nearestClearNote: { noteBox: WonderBBox; placement: WonderPlacementPreference } | undefined;
  const routeCandidate = (noteBox: WonderBBox, placement: WonderPlacementPreference) => {
    nearestClearNote ??= { noteBox, placement };
    return findRoute(noteBox, placement);
  };
  const cx = (targetBox.minX + targetBox.maxX) / 2;
  const cy = (targetBox.minY + targetBox.maxY) / 2;
  const clampedBaseGap = Math.max(24, Math.min(44, Math.round(safeGap)));

  const minWorldX = worldSafeBounds ? worldSafeBounds.minX : 16;
  const minWorldY = worldSafeBounds ? worldSafeBounds.minY : 16;
  const maxWorldX = worldSafeBounds ? worldSafeBounds.maxX : maxWorldRight;
  const maxWorldY = worldSafeBounds ? worldSafeBounds.maxY : Infinity;

  const clampCandidate = (minX: number, minY: number): WonderBBox => {
    const availW = maxWorldX - minWorldX;
    const clampedX =
      availW >= desiredWidth
        ? Math.max(minWorldX, Math.min(maxWorldX - desiredWidth, minX))
        : minWorldX;
    const clampedY =
      Number.isFinite(maxWorldY) && maxWorldY - minWorldY >= desiredHeight
        ? Math.max(minWorldY, Math.min(maxWorldY - desiredHeight, minY))
        : Math.max(minWorldY, minY);
    return {
      minX: clampedX,
      minY: clampedY,
      maxX: clampedX + desiredWidth,
      maxY: clampedY + desiredHeight,
      width: desiredWidth,
      height: desiredHeight,
    };
  };

  const fitsSafeBounds = (b: WonderBBox): boolean => {
    if (b.minX < minWorldX - 1 || b.maxX > maxWorldX + 1) return false;
    if (b.minY < minWorldY - 1) return false;
    if (Number.isFinite(maxWorldY) && b.maxY > maxWorldY + 1) return false;
    return true;
  };

  const expandedDirs: SpatialPlacementDirection[] = [];
  for (const p of preferredOrder) expandedDirs.push(p);
  for (const diag of ['below_right', 'below_left', 'above_right', 'above_left'] as const) {
    expandedDirs.push(diag);
  }

  const makeCandidate = (dir: SpatialPlacementDirection, stepGap: number): WonderBBox => {
    let minX = cx - desiredWidth / 2;
    let minY = cloudOuterBox.maxY + stepGap;
    switch (dir) {
      case 'above':
        minY = cloudOuterBox.minY - stepGap - desiredHeight;
        break;
      case 'right':
        minX = cloudOuterBox.maxX + stepGap;
        minY = cy - desiredHeight / 2;
        break;
      case 'left':
        minX = cloudOuterBox.minX - stepGap - desiredWidth;
        minY = cy - desiredHeight / 2;
        break;
      case 'below_right':
        minX = cloudOuterBox.maxX - desiredWidth * 0.28 + Math.round(stepGap * 0.45);
        minY = cloudOuterBox.maxY + stepGap;
        break;
      case 'below_left':
        minX = cloudOuterBox.minX - desiredWidth * 0.72 - Math.round(stepGap * 0.45);
        minY = cloudOuterBox.maxY + stepGap;
        break;
      case 'above_right':
        minX = cloudOuterBox.maxX - desiredWidth * 0.28 + Math.round(stepGap * 0.45);
        minY = cloudOuterBox.minY - stepGap - desiredHeight;
        break;
      case 'above_left':
        minX = cloudOuterBox.minX - desiredWidth * 0.72 - Math.round(stepGap * 0.45);
        minY = cloudOuterBox.minY - stepGap - desiredHeight;
        break;
      case 'below':
      default:
        break;
    }
    const availW = maxWorldX - minWorldX;
    minX = availW >= desiredWidth ? Math.max(minWorldX, Math.min(maxWorldX - desiredWidth, minX)) : minWorldX;
    minY = Math.max(minWorldY, minY);
    return {
      minX,
      minY,
      maxX: minX + desiredWidth,
      maxY: minY + desiredHeight,
      width: desiredWidth,
      height: desiredHeight,
    };
  };

  for (const extra of [0, 28, 64, 112, 170, 230]) {
    const stepGap = clampedBaseGap + extra;
    for (const dir of expandedDirs) {
      const candidate = makeCandidate(dir, stepGap);
      if (!fitsSafeBounds(candidate)) continue;
      const collides = blockers.some((b) => boxesIntersect(candidate, b, 12));
      if (!collides) {
        const basePlacement = toBasePlacement(dir);
        const arrow = routeCandidate(candidate, basePlacement);
        if (arrow) {
          return {
            noteBox: candidate,
            placement: basePlacement,
            arrow,
          };
        }
      }
    }
  }

  // Sliding-edge search along right/left/below/above edges of cloudOuterBox (finds adjacent empty pockets cleanly)
  for (const sideGap of [clampedBaseGap, clampedBaseGap + 36, clampedBaseGap + 80]) {
    const ySlots = [
      Math.round(cy - desiredHeight * 0.15),
      Math.round(cy - desiredHeight * 0.85),
      Number.isFinite(maxWorldY) ? Math.round(maxWorldY - desiredHeight - 4) : Math.round(cy + 24),
      Math.round(minWorldY + 4),
    ];
    for (const pDir of ['right', 'left'] as const) {
      const xPos =
        pDir === 'right'
          ? cloudOuterBox.maxX + sideGap
          : cloudOuterBox.minX - sideGap - desiredWidth;
      for (const yPos of ySlots) {
        const cand = clampCandidate(xPos, yPos);
        if (!fitsSafeBounds(cand)) continue;
        if (blockers.some((b) => boxesIntersect(cand, b, 12))) continue;
        const arrow = routeCandidate(cand, pDir);
        if (arrow) {
          return { noteBox: cand, placement: pDir, arrow };
        }
      }
    }

    const xSlots = [
      Math.round(cx - desiredWidth * 0.15),
      Math.round(cx - desiredWidth * 0.85),
      Math.round(minWorldX + 4),
      Number.isFinite(maxWorldX) ? Math.round(maxWorldX - desiredWidth - 4) : Math.round(cx + 24),
    ];
    for (const pDir of ['below', 'above'] as const) {
      const yPos =
        pDir === 'below'
          ? cloudOuterBox.maxY + sideGap
          : cloudOuterBox.minY - sideGap - desiredHeight;
      for (const xPos of xSlots) {
        const cand = clampCandidate(xPos, yPos);
        if (!fitsSafeBounds(cand)) continue;
        if (blockers.some((b) => boxesIntersect(cand, b, 12))) continue;
        const arrow = routeCandidate(cand, pDir);
        if (arrow) {
          return { noteBox: cand, placement: pDir, arrow };
        }
      }
    }
  }

  // Secondary 2D radial ring search: find any free pocket strictly inside safe bounds & outside toolbars
  const cloudHalfW = cloudOuterBox.width / 2;
  const cloudHalfH = cloudOuterBox.height / 2;
  const candidateAngles = [
    Math.PI / 2,
    0,
    Math.PI / 4,
    (3 * Math.PI) / 4,
    -Math.PI / 4,
    (-3 * Math.PI) / 4,
    Math.PI,
    -Math.PI / 2,
    Math.PI / 6,
    (5 * Math.PI) / 6,
    -Math.PI / 6,
    (-5 * Math.PI) / 6,
  ];
  for (const distOut of [clampedBaseGap, clampedBaseGap + 45, clampedBaseGap + 95, clampedBaseGap + 150, clampedBaseGap + 220]) {
    for (const ang of candidateAngles) {
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const anchorX = cx + cosA * (cloudHalfW + distOut + desiredWidth / 2);
      const anchorY = cy + sinA * (cloudHalfH + distOut + desiredHeight / 2);
      const candidate = clampCandidate(
        Math.round(anchorX - desiredWidth / 2),
        Math.round(anchorY - desiredHeight / 2)
      );
      if (!fitsSafeBounds(candidate)) continue;
      if (blockers.some((b) => boxesIntersect(candidate, b, 12))) continue;
      const basePlacement: WonderPlacementPreference =
        Math.abs(cosA) > Math.abs(sinA)
          ? cosA >= 0
            ? 'right'
            : 'left'
          : sinA >= 0
            ? 'below'
            : 'above';
      const arrow = routeCandidate(candidate, basePlacement);
      if (arrow) {
        return {
          noteBox: candidate,
          placement: basePlacement,
          arrow,
        };
      }
    }
  }

  if (nearestClearNote) {
    return { ...nearestClearNote, arrow: hiddenAnnotationArrow(nearestClearNote.noteBox) };
  }

  // Pass 3: Strictly avoid UI toolbars & viewport overflow even in crowded extreme zooms
  const fallbackDirs: SpatialPlacementDirection[] = [
    'above',
    'right',
    'left',
    'above_right',
    'above_left',
    'below',
    'below_right',
    'below_left',
  ];
  let bestUiClear: {
    box: WonderBBox;
    dir: WonderPlacementPreference;
    overlapScore: number;
    totalScore: number;
  } | null = null;
  const evalUiClear = (cand: WonderBBox, pDir: WonderPlacementPreference) => {
    if (uiOverlayBlockers.some((ub) => boxesIntersect(cand, ub, 6))) return false;
    let overlapScore = 0;
    for (let wbIdx = 0; wbIdx < worldBlockers.length; wbIdx++) {
      const wb = worldBlockers[wbIdx];
      const ox = Math.max(0, Math.min(cand.maxX, wb.maxX) - Math.max(cand.minX, wb.minX));
      const oy = Math.max(0, Math.min(cand.maxY, wb.maxY) - Math.max(cand.minY, wb.minY));
      // Weight actual ink strokes / existing annotations (index >= 1) 12x above outer cloud padding
      const weight = wbIdx === 0 ? 1 : 12;
      overlapScore += ox * oy * weight;
    }
    const distPenalty =
      Math.hypot((cand.minX + cand.maxX) / 2 - cx, (cand.minY + cand.maxY) / 2 - cy) * 0.05;
    const totalScore = overlapScore + distPenalty;
    if (!bestUiClear || totalScore < bestUiClear.totalScore) {
      bestUiClear = { box: cand, dir: pDir, overlapScore, totalScore };
    }
    return overlapScore === 0;
  };

  for (const gapStep of [clampedBaseGap, clampedBaseGap + 36, clampedBaseGap + 84]) {
    for (const dir of fallbackDirs) {
      const raw = makeCandidate(dir, gapStep);
      const cand = clampCandidate(raw.minX, raw.minY);
      const pDir = toBasePlacement(dir);
      if (evalUiClear(cand, pDir)) {
        return {
          noteBox: cand,
          placement: pDir,
          arrow: findRoute(cand, pDir) ?? hiddenAnnotationArrow(cand),
        };
      }
    }
  }

  // Scan clean perimeter pockets inside worldSafeBounds so stroke/note overlap becomes zero if any pocket exists
  const bestAfterFallback = bestUiClear as {
    box: WonderBBox;
    dir: WonderPlacementPreference;
    overlapScore: number;
    totalScore: number;
  } | null;
  if (worldSafeBounds && (!bestAfterFallback || bestAfterFallback.overlapScore > 0)) {
    const maxSpanX = Math.max(minWorldX, maxWorldX - desiredWidth);
    const xPockets = [0, 0.33, 0.66, 1].map((t) => Math.round(minWorldX + (maxSpanX - minWorldX) * t));
    const maxSpanY = Number.isFinite(maxWorldY)
      ? Math.max(minWorldY, maxWorldY - desiredHeight)
      : minWorldY + 320;
    const yPockets = [0, 0.33, 0.66, 1].map((t) => Math.round(minWorldY + (maxSpanY - minWorldY) * t));
    for (const py of yPockets) {
      for (const px of xPockets) {
        const cand = clampCandidate(px, py);
        const dxCenter = (cand.minX + cand.maxX) / 2 - cx;
        const dyCenter = (cand.minY + cand.maxY) / 2 - cy;
        const pDir: WonderPlacementPreference =
          Math.abs(dxCenter) > Math.abs(dyCenter)
            ? dxCenter >= 0
              ? 'right'
              : 'left'
            : dyCenter >= 0
              ? 'below'
              : 'above';
        evalUiClear(cand, pDir);
      }
    }
  }
  const finalBestUiClear = bestUiClear as {
    box: WonderBBox;
    dir: WonderPlacementPreference;
    overlapScore: number;
    totalScore: number;
  } | null;
  if (finalBestUiClear) {
    return {
      noteBox: finalBestUiClear.box,
      placement: finalBestUiClear.dir,
      arrow: hiddenAnnotationArrow(finalBestUiClear.box),
    };
  }

  // Final fallback if no UI constraints apply: place below world blockers (not UI toolbars)
  const lowestMaxY = worldBlockers.reduce((acc, b) => Math.max(acc, b.maxY), targetBox.maxY);
  const fallbackBox = clampCandidate(cx - desiredWidth / 2, lowestMaxY + clampedBaseGap);
  const finalPlacement: WonderPlacementPreference =
    fallbackBox.maxY <= targetBox.minY ? 'above' : 'below';
  return {
    noteBox: fallbackBox,
    placement: finalPlacement,
    arrow: hiddenAnnotationArrow(fallbackBox),
  };
}

export type WonderDirtyEventType =
  | 'stroke_added'
  | 'stroke_removed'
  | 'stroke_modified'
  | 'stroke_moved'
  | 'region_created'
  | 'region_updated'
  | 'region_merged'
  | 'region_split';

export interface WonderDirtyRegionReport {
  dirtyRegionIds: string[];
  geometryOnlyRegionIds: string[];
  events: WonderDirtyEventType[];
}

export function computeDirtyRegions(
  prevRegions: WonderRecognitionRegion[],
  nextRegions: WonderRecognitionRegion[]
): WonderDirtyRegionReport {
  const prevById = new Map(prevRegions.map((r) => [r.regionId, r]));
  const dirtyRegionIds: string[] = [];
  const geometryOnlyRegionIds: string[] = [];
  const events = new Set<WonderDirtyEventType>();

  for (const nextR of nextRegions) {
    const matchByStrokes = prevRegions.find(
      (pr) =>
        pr.strokeIds.length === nextR.strokeIds.length &&
        pr.strokeIds.every((id, idx) => nextR.strokeIds[idx] === id)
    );
    const prevR = prevById.get(nextR.regionId) ?? matchByStrokes;

    if (!prevR) {
      dirtyRegionIds.push(nextR.regionId);
      events.add('region_created');
      events.add('stroke_added');
      continue;
    }

    const sameStrokes =
      prevR.strokeIds.length === nextR.strokeIds.length &&
      prevR.strokeIds.every((id) => nextR.strokeIds.includes(id));
    const sameSize =
      Math.abs(prevR.bbox.width - nextR.bbox.width) < 6 &&
      Math.abs(prevR.bbox.height - nextR.bbox.height) < 6;
    const moved =
      Math.abs(prevR.bbox.minX - nextR.bbox.minX) >= 1 ||
      Math.abs(prevR.bbox.minY - nextR.bbox.minY) >= 1;

    if (sameStrokes && sameSize && moved) {
      geometryOnlyRegionIds.push(nextR.regionId);
      events.add('stroke_moved');
    } else if (!sameStrokes || prevR.recognizedText !== nextR.recognizedText) {
      dirtyRegionIds.push(nextR.regionId);
      events.add(nextR.strokeIds.length > prevR.strokeIds.length ? 'stroke_added' : 'stroke_removed');
      events.add('region_updated');
    }
  }

  if (prevRegions.length > nextRegions.length && nextRegions.length > 0) {
    events.add('region_merged');
  } else if (nextRegions.length > prevRegions.length && prevRegions.length > 0) {
    events.add('region_split');
  }

  return {
    dirtyRegionIds,
    geometryOnlyRegionIds,
    events: Array.from(events),
  };
}

export function reconcileAnnotationsWithStrokes(
  annotations: WonderAnnotation[],
  strokes: WonderStroke[],
  nextRegions?: WonderRecognitionRegion[]
): WonderAnnotation[] {
  const activeStrokeMap = new Map<string, WonderStroke>();
  for (const s of strokes) {
    if (!s.deleted && s.tool !== 'eraser_pixel' && s.provenance !== 'ai_teaching') {
      activeStrokeMap.set(s.id, s);
    }
  }

  const allCompleteTexts = (nextRegions ?? [])
    .filter((r) => r.completeness === 'complete')
    .map((r) => r.recognizedText);

  return annotations.map((ann) => {
    if (ann.status === 'dismissed' || ann.status === 'stale') {
      return { ...ann, reconciliation_action: ann.status === 'dismissed' ? 'DISMISSED' : 'INVALIDATED' };
    }

    const linked: WonderStroke[] = [];
    for (const id of ann.source_stroke_ids) {
      const st = activeStrokeMap.get(id);
      if (!st) {
        return {
          ...ann,
          status: 'stale',
          lifecycle_state: 'stale',
          reconciliation_action: 'INVALIDATED',
        };
      }
      linked.push(st);
    }

    // Check if an added/edited word around or after the original strokes fixed the error
    if (
      ann.suggested_correction &&
      (ann.annotation_type === 'grammar_correction' ||
        ann.annotation_type === 'particle_correction') &&
      allCompleteTexts.some((txt) => txt.includes(ann.suggested_correction) && !txt.includes(ann.recognized_text))
    ) {
      return {
        ...ann,
        status: 'resolved',
        reconciliation_action: 'RESOLVED',
      };
    }

    const latestBox = mergeBoundingBoxes(linked.map((s) => s.bbox));
    const widthDelta = Math.abs(latestBox.width - ann.target_geometry.width);
    const heightDelta = Math.abs(latestBox.height - ann.target_geometry.height);
    if (widthDelta > 10 || heightDelta > 10) {
      return {
        ...ann,
        status: 'stale',
        lifecycle_state: 'stale',
        reconciliation_action: 'INVALIDATED',
      };
    }

    const dx = latestBox.minX - ann.target_geometry.minX;
    const dy = latestBox.minY - ann.target_geometry.minY;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      return {
        ...ann,
        reconciliation_action: 'UNCHANGED' as WonderReconciliationAction,
      };
    }

    const shiftedNote: WonderBBox = {
      minX: ann.note_geometry.minX + dx,
      minY: ann.note_geometry.minY + dy,
      maxX: ann.note_geometry.maxX + dx,
      maxY: ann.note_geometry.maxY + dy,
      width: ann.note_geometry.width,
      height: ann.note_geometry.height,
    };

    return {
      ...ann,
      target_geometry: latestBox,
      note_geometry: shiftedNote,
      arrow_path: makeArrowBetween(latestBox, shiftedNote, ann.placement_preference),
      reconciliation_action: 'GEOMETRY_UPDATED',
    };
  });
}

// ---------------------------------------------------------------------------
// 4. Handwriting Stroke Generator & Hybrid Recognition Engine (AC-04)
// ---------------------------------------------------------------------------

interface PhrasePrototype {
  text: string;
  language: WonderLanguage;
  tokens: string[];
}

const KNOWN_PHRASE_PROTOTYPES: PhrasePrototype[] = [
  {
    text: '저는 어제 학교에 가요.',
    language: 'ko',
    tokens: ['저는', '어제', '학교에', '가요.'],
  },
  {
    text: '저는 어제 학교에 갔어요.',
    language: 'ko',
    tokens: ['저는', '어제', '학교에', '갔어요.'],
  },
  {
    text: '저는 오늘 학교에 가요.',
    language: 'ko',
    tokens: ['저는', '오늘', '학교에', '가요.'],
  },
  {
    text: '저는 사과가 먹어요.',
    language: 'ko',
    tokens: ['저는', '사과가', '먹어요.'],
  },
  {
    text: '저는 사과를 먹어요.',
    language: 'ko',
    tokens: ['저는', '사과를', '먹어요.'],
  },
  {
    text: '사과가 맛있어요.',
    language: 'ko',
    tokens: ['사과가', '맛있어요.'],
  },
  {
    text: '저는 베트남 사람이에요.',
    language: 'ko',
    tokens: ['저는', '베트남', '사람이에요.'],
  },
  {
    text: '저은 학생예요.',
    language: 'ko',
    tokens: ['저은', '학생예요.'],
  },
  {
    text: '저는 학생이에요.',
    language: 'ko',
    tokens: ['저는', '학생이에요.'],
  },
  {
    text: '이름는 린이에요.',
    language: 'ko',
    tokens: ['이름는', '린이에요.'],
  },
  {
    text: '커피 한 잔 주세요.',
    language: 'ko',
    tokens: ['커피', '한', '잔', '주세요.'],
  },
  {
    text: 'Tôi muốn học cách gọi cà phê.',
    language: 'vi',
    tokens: ['Tôi', 'muốn', 'học', 'cách', 'gọi', 'cà', 'phê.'],
  },
];

function deterministicCharSignature(ch: string, strokeIdx: number): number[] {
  const code = ch.charCodeAt(0);
  return [
    ((code * 17 + strokeIdx * 31) % 24) / 24,
    ((code * 29 + strokeIdx * 13) % 24) / 24,
    ((code * 7 + strokeIdx * 43) % 24) / 24,
    ((code * 53 + strokeIdx * 19) % 24) / 24,
  ];
}

function charStrokeCount(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const idx = code - 0xac00;
    const jong = idx % 28;
    return jong > 0 ? 3 : 2;
  }
  return 2;
}

const JAMO_CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const JAMO_JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];
const JAMO_JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

function jamoGlyphPoints(
  jamo: string,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  strokeIdx: number
): WonderStrokePoint[][] {
  const s = strokeIdx;
  const pt = (rx: number, ry: number, idx: number): WonderStrokePoint => ({
    x: bx + rx * bw,
    y: by + ry * bh,
    pressure: 0.48 + 0.32 * Math.sin((idx / 4) * Math.PI),
    t: Date.now() + s * 16 + idx * 4,
  });

  if (jamo === 'ㅇ' || jamo === 'ㅎ') {
    const oval = [0, 1, 2, 3, 4, 5, 6].map((k) => {
      const a = (k / 6) * Math.PI * 2;
      return pt(0.5 + Math.cos(a) * 0.36, (jamo === 'ㅎ' ? 0.62 : 0.5) + Math.sin(a) * 0.32, k);
    });
    if (jamo === 'ㅎ') {
      return [[pt(0.2, 0.14, 0), pt(0.8, 0.14, 1)], oval];
    }
    return [oval];
  }
  if (jamo === 'ㄱ' || jamo === 'ㄲ' || jamo === 'ㅋ') {
    return [[pt(0.15, 0.2, 0), pt(0.85, 0.2, 1), pt(0.8, 0.85, 2)]];
  }
  if (jamo === 'ㄹ') {
    return [
      [pt(0.18, 0.18, 0), pt(0.82, 0.18, 1), pt(0.82, 0.48, 2), pt(0.18, 0.48, 3)],
      [pt(0.2, 0.48, 0), pt(0.2, 0.82, 1), pt(0.84, 0.82, 2)],
    ];
  }
  if (jamo === 'ㄴ' || jamo === 'ㄷ' || jamo === 'ㅌ') {
    const base = [pt(0.2, 0.2, 0), pt(0.2, 0.82, 1), pt(0.85, 0.82, 2)];
    if (jamo === 'ㄷ' || jamo === 'ㅌ') {
      return [[pt(0.2, 0.2, 0), pt(0.85, 0.2, 1)], base];
    }
    return [base];
  }
  if (jamo === 'ㅁ') {
    return [
      [pt(0.2, 0.2, 0), pt(0.2, 0.82, 1), pt(0.82, 0.82, 2), pt(0.82, 0.2, 3), pt(0.2, 0.2, 4)],
    ];
  }
  if (jamo === 'ㅂ' || jamo === 'ㅃ' || jamo === 'ㅍ') {
    return [
      [pt(0.22, 0.14, 0), pt(0.22, 0.84, 1)],
      [pt(0.8, 0.14, 0), pt(0.8, 0.84, 1)],
      [pt(0.22, 0.48, 0), pt(0.8, 0.48, 1)],
      [pt(0.22, 0.84, 0), pt(0.8, 0.84, 1)],
    ];
  }
  if (jamo === 'ㅅ' || jamo === 'ㅈ' || jamo === 'ㅊ' || jamo === 'ㅆ') {
    const legs = [pt(0.5, 0.22, 0), pt(0.15, 0.85, 1), pt(0.5, 0.45, 2), pt(0.85, 0.85, 3)];
    if (jamo === 'ㅈ' || jamo === 'ㅊ') {
      return [[pt(0.18, 0.22, 0), pt(0.82, 0.22, 1)], legs];
    }
    return [legs];
  }
  if (jamo === 'ㅏ' || jamo === 'ㅑ' || jamo === 'ㅐ' || jamo === 'ㅒ' || jamo === 'ㅣ') {
    const vert = [pt(0.42, 0.08, 0), pt(0.42, 0.92, 1)];
    if (jamo === 'ㅣ') return [vert];
    if (jamo === 'ㅐ') {
      return [
        vert,
        [pt(0.42, 0.48, 0), pt(0.78, 0.48, 1)],
        [pt(0.78, 0.08, 0), pt(0.78, 0.92, 1)],
      ];
    }
    if (jamo === 'ㅒ') {
      return [
        vert,
        [pt(0.42, 0.36, 0), pt(0.78, 0.36, 1)],
        [pt(0.42, 0.6, 0), pt(0.78, 0.6, 1)],
        [pt(0.78, 0.08, 0), pt(0.78, 0.92, 1)],
      ];
    }
    if (jamo === 'ㅑ') {
      return [
        vert,
        [pt(0.42, 0.36, 0), pt(0.88, 0.36, 1)],
        [pt(0.42, 0.6, 0), pt(0.88, 0.6, 1)],
      ];
    }
    return [vert, [pt(0.42, 0.48, 0), pt(0.88, 0.48, 1)]];
  }
  if (jamo === 'ㅓ' || jamo === 'ㅕ' || jamo === 'ㅔ' || jamo === 'ㅖ') {
    if (jamo === 'ㅔ') {
      return [
        [pt(0.1, 0.48, 0), pt(0.5, 0.48, 1)],
        [pt(0.5, 0.08, 0), pt(0.5, 0.92, 1)],
        [pt(0.82, 0.08, 0), pt(0.82, 0.92, 1)],
      ];
    }
    if (jamo === 'ㅖ') {
      return [
        [pt(0.1, 0.36, 0), pt(0.5, 0.36, 1)],
        [pt(0.1, 0.6, 0), pt(0.5, 0.6, 1)],
        [pt(0.5, 0.08, 0), pt(0.5, 0.92, 1)],
        [pt(0.82, 0.08, 0), pt(0.82, 0.92, 1)],
      ];
    }
    if (jamo === 'ㅕ') {
      return [
        [pt(0.1, 0.36, 0), pt(0.62, 0.36, 1)],
        [pt(0.1, 0.6, 0), pt(0.62, 0.6, 1)],
        [pt(0.62, 0.08, 0), pt(0.62, 0.92, 1)],
      ];
    }
    return [
      [pt(0.1, 0.48, 0), pt(0.62, 0.48, 1)],
      [pt(0.62, 0.08, 0), pt(0.62, 0.92, 1)],
    ];
  }
  if (jamo === 'ㅗ' || jamo === 'ㅛ') {
    if (jamo === 'ㅛ') {
      return [
        [pt(0.35, 0.15, 0), pt(0.35, 0.65, 1)],
        [pt(0.65, 0.15, 0), pt(0.65, 0.65, 1)],
        [pt(0.1, 0.65, 0), pt(0.9, 0.65, 1)],
      ];
    }
    return [
      [pt(0.5, 0.15, 0), pt(0.5, 0.65, 1)],
      [pt(0.1, 0.65, 0), pt(0.9, 0.65, 1)],
    ];
  }
  if (jamo === 'ㅜ' || jamo === 'ㅠ' || jamo === 'ㅡ') {
    const bar = [pt(0.1, 0.38, 0), pt(0.9, 0.38, 1)];
    if (jamo === 'ㅡ') return [bar];
    if (jamo === 'ㅠ') {
      return [
        bar,
        [pt(0.35, 0.38, 0), pt(0.35, 0.88, 1)],
        [pt(0.65, 0.38, 0), pt(0.65, 0.88, 1)],
      ];
    }
    return [bar, [pt(0.5, 0.38, 0), pt(0.5, 0.88, 1)]];
  }
  if (jamo === 'ㅘ' || jamo === 'ㅙ' || jamo === 'ㅚ') {
    const strokes: WonderStrokePoint[][] = [
      [pt(0.18, 0.56, 0), pt(0.18, 0.78, 1)],
      [pt(0.05, 0.78, 0), pt(0.45, 0.78, 1)],
      [pt(0.58, 0.1, 0), pt(0.58, 0.9, 1)],
    ];
    if (jamo !== 'ㅚ') {
      strokes.push([pt(0.58, 0.46, 0), pt(0.92, 0.46, 1)]);
    }
    if (jamo === 'ㅙ') {
      strokes.push([pt(0.9, 0.1, 0), pt(0.9, 0.9, 1)]);
    }
    return strokes;
  }
  if (jamo === 'ㅝ' || jamo === 'ㅞ' || jamo === 'ㅟ' || jamo === 'ㅢ') {
    const strokes: WonderStrokePoint[][] = [
      [pt(0.05, 0.62, 0), pt(0.48, 0.62, 1)],
      [pt(0.62, 0.1, 0), pt(0.62, 0.9, 1)],
    ];
    if (jamo !== 'ㅢ') {
      strokes.push([pt(0.26, 0.62, 0), pt(0.26, 0.88, 1)]);
    }
    if (jamo === 'ㅝ' || jamo === 'ㅞ') {
      strokes.push([pt(0.32, 0.48, 0), pt(0.62, 0.48, 1)]);
    }
    if (jamo === 'ㅞ') {
      strokes.push([pt(0.9, 0.1, 0), pt(0.9, 0.9, 1)]);
    }
    return strokes;
  }
  if (jamo === '.') {
    return [
      [pt(0.3, 0.78, 0), pt(0.38, 0.78, 1), pt(0.38, 0.85, 2), pt(0.3, 0.85, 3)],
    ];
  }
  if (jamo === '?') {
    return [
      [pt(0.3, 0.25, 0), pt(0.5, 0.15, 1), pt(0.68, 0.28, 2), pt(0.5, 0.52, 3), pt(0.5, 0.65, 4)],
      [pt(0.48, 0.8, 0), pt(0.52, 0.85, 1)],
    ];
  }
  if (jamo === '!') {
    return [
      [pt(0.5, 0.16, 0), pt(0.5, 0.66, 1)],
      [pt(0.48, 0.8, 0), pt(0.52, 0.85, 1)],
    ];
  }
  // Fallback curved glyph stroke for Latin/punctuation
  const sig = deterministicCharSignature(jamo, strokeIdx);
  return [
    [0, 1, 2, 3].map((pIdx) =>
      pt(sig[pIdx] * 0.65 + (pIdx / 3) * 0.35, sig[(pIdx + 1) % 4] * 0.7 + 0.15, pIdx)
    ),
  ];
}

/**
 * Generates deterministic multi-stroke vector ink trajectories for Korean,
 * Vietnamese, or English phrases using recognizable Hangul Jamo grids.
 */
export function generateHandwrittenStrokesForText(params: {
  boardId: string;
  text: string;
  startX: number;
  startY: number;
  revision: number;
  color: string;
  tool?: 'chalk' | 'pencil' | 'highlighter';
  jitter?: number;
  seed?: number;
  idPrefix?: string;
  provenance?: WonderStrokeProvenance;
}): WonderStroke[] {
  const {
    boardId,
    text,
    startX,
    startY,
    revision,
    color,
    tool = 'chalk',
    jitter = 0,
    seed = 1,
    idPrefix = `st_${revision}_${Math.round(startX)}_${Math.round(startY)}`,
    provenance = 'fixture_sample',
  } = params;

  const strokes: WonderStroke[] = [];
  let cursorX = startX;
  const baseHeight = 32;
  let globalIdx = 0;

  const addStrokePts = (pts: WonderStrokePoint[], id: string, carryHint: boolean) => {
    const jittered =
      jitter > 0
        ? pts.map((p, idx) => ({
          ...p,
          x: p.x + (seededUnit(seed + globalIdx, idx * 2) - 0.5) * 2 * jitter,
          y: p.y + (seededUnit(seed + globalIdx, idx * 2 + 1) - 0.5) * 2 * jitter,
        }))
        : pts;
    strokes.push({
      id,
      boardId,
      points: jittered,
      color,
      width: 3.4,
      tool,
      bbox: computeStrokeBoundingBox(jittered, 0, 0, 3.4, tool),
      transform: { dx: 0, dy: 0 },
      revision,
      createdAt: Date.now(),
      provenance,
      fixtureHintText: carryHint ? text : undefined,
    });
    globalIdx++;
  };

  const tokens = text.trim().split(/\s+/);
  tokens.forEach((token, tokenIdx) => {
    const chars = Array.from(token);
    chars.forEach((ch, charIdx) => {
      const isHangul = ch >= '\uAC00' && ch <= '\uD7A3';
      const latinPts = !isHangul
        ? latinGlyphStrokes(
            ch,
            cursorX,
            startY,
            /[mwMW]/.test(ch) ? 20 : /[ilI1.,!':-]/.test(ch) ? 10 : 16,
            baseHeight,
            globalIdx
          )
        : null;
      const charWidth = isHangul
        ? 30
        : /[mwMW]/.test(ch)
          ? 20
          : /[ilI1.,!':-]/.test(ch)
            ? 10
            : latinPts
              ? 16
              : 14;

      if (isHangul) {
        const sIndex = ch.charCodeAt(0) - 0xac00;
        const cho = JAMO_CHOSEONG[Math.floor(sIndex / 588)];
        const jung = JAMO_JUNGSEONG[Math.floor((sIndex % 588) / 28)];
        const jong = JAMO_JONGSEONG[sIndex % 28];
        const hasJong = jong.length > 0;
        const isBottomVowel = jung === 'ㅗ' || jung === 'ㅛ' || jung === 'ㅜ' || jung === 'ㅠ' || jung === 'ㅡ';

        const choBox = isBottomVowel
          ? { x: cursorX + 3, y: startY, w: charWidth - 6, h: hasJong ? 13 : 16 }
          : { x: cursorX, y: startY + 1, w: 16, h: hasJong ? 19 : 28 };
        const jungBox = isBottomVowel
          ? { x: cursorX, y: startY + (hasJong ? 12 : 16), w: charWidth, h: 11 }
          : { x: cursorX + 16, y: startY, w: 13, h: hasJong ? 20 : 30 };

        const subGroups: WonderStrokePoint[][] = [
          ...jamoGlyphPoints(cho, choBox.x, choBox.y, choBox.w, choBox.h, globalIdx),
          ...jamoGlyphPoints(jung, jungBox.x, jungBox.y, jungBox.w, jungBox.h, globalIdx + 1),
        ];
        if (hasJong) {
          subGroups.push(
            ...jamoGlyphPoints(jong, cursorX + 3, startY + 21, charWidth - 6, 11, globalIdx + 2)
          );
        }

        subGroups.forEach((pts, sIdx) => {
          const carryHint = tokenIdx === 0 && charIdx === 0 && sIdx === 0;
          addStrokePts(pts, `${idPrefix}_${tokenIdx}_${charIdx}_${sIdx}`, carryHint);
        });
      } else if (ch === '.' || ch === '?' || ch === '!') {
        const subGroups = jamoGlyphPoints(ch, cursorX, startY, charWidth, baseHeight, globalIdx);
        subGroups.forEach((pts, sIdx) => {
          const carryHint = tokenIdx === 0 && charIdx === 0 && sIdx === 0;
          addStrokePts(pts, `${idPrefix}_${tokenIdx}_${charIdx}_${sIdx}`, carryHint);
        });
      } else if (latinPts) {
        latinPts.forEach((pts, sIdx) => {
          const carryHint = tokenIdx === 0 && charIdx === 0 && sIdx === 0;
          addStrokePts(pts, `${idPrefix}_${tokenIdx}_${charIdx}_${sIdx}`, carryHint);
        });
      } else {
        const count = charStrokeCount(ch);
        for (let sIdx = 0; sIdx < count; sIdx++) {
          const sig = deterministicCharSignature(ch, sIdx);
          const pts: WonderStrokePoint[] = [0, 1, 2, 3].map((pIdx) => {
            const tNorm = pIdx / 3;
            return {
              x: cursorX + (sig[pIdx] * 0.65 + tNorm * 0.35) * (charWidth - 2),
              y:
                startY +
                ((sIdx / count) * 0.45 + sig[(pIdx + 1) % 4] * 0.45) * baseHeight,
              pressure: 0.45 + 0.35 * Math.sin(tNorm * Math.PI),
              t: Date.now() + globalIdx * 18 + pIdx * 4,
            };
          });
          const carryHint = tokenIdx === 0 && charIdx === 0 && sIdx === 0;
          addStrokePts(pts, `${idPrefix}_${tokenIdx}_${charIdx}_${sIdx}`, carryHint);
        }
      }
      cursorX += charWidth + 3;
    });
    cursorX += 34; // Clear inter-word gap for reliable word cluster segmentation
  });

  return strokes;
}

/**
 * Classifies whether a cluster of strokes represents non-text artwork/doodle
 * vs meaningful handwriting.
 */
function isLikelyNonTextCluster(cluster: WonderStroke[]): boolean {
  if (cluster.length === 0) return true;
  const merged = mergeBoundingBoxes(cluster.map((s) => s.bbox));
  // Very large hollow/single scribble frame or zig-zag doodle without short glyph rhythm
  if (cluster.length === 1) {
    const pts = cluster[0].points;
    if (pts.length >= 10) {
      const start = pts[0];
      const end = pts[pts.length - 1];
      const closedLoop = Math.hypot(end.x - start.x, end.y - start.y) < 18;
      if (closedLoop && merged.width > 95 && merged.height > 70) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Groups Layer 2 strokes into vertical writing lines and horizontal word/phrase clusters.
 */
export function segmentStrokesIntoRegions(strokes: WonderStroke[], separateHangulOccurrences = false): Array<{
  strokes: WonderStroke[];
  wordClusters: WonderStroke[][];
  bbox: WonderBBox;
  kind: 'text_candidate' | 'in_progress' | 'non_text';
}> {
  const active = strokes.filter(
    (s) => !s.deleted && s.tool !== 'eraser_pixel' && s.provenance !== 'ai_teaching'
  );
  if (active.length === 0) return [];

  if (separateHangulOccurrences) {
    const textInputKey = (s: WonderStroke) => {
      if (s.provenance !== 'typed_vector' && s.provenance !== 'fixture_sample') return undefined;
      const source = s.id.match(/^(.*)_\d+_\d+_\d+$/)?.[1];
      return source ? JSON.stringify([s.provenance, source]) : undefined;
    };
    // An insertion carries its own transcript on one stroke. Keep its identity
    // through spatial grouping so it cannot label a neighboring insertion or raw ink.
    const labeledInputs = new Set(active.filter((s) => s.fixtureHintText?.trim()).map(textInputKey));
    labeledInputs.delete(undefined);
    if (labeledInputs.size > 0) {
      const typed = new Map<string, WonderStroke[]>();
      const unassigned: WonderStroke[] = [];
      for (const stroke of active) {
        const key = textInputKey(stroke);
        if (!key || !labeledInputs.has(key)) {
          unassigned.push(stroke);
          continue;
        }
        const group = typed.get(key);
        if (group) group.push(stroke);
        else typed.set(key, [stroke]);
      }
      if (typed.size > 1 || unassigned.length > 0) {
        return [
          ...[...typed.values()].flatMap((group) => segmentStrokesIntoRegions(group)),
          ...segmentStrokesIntoRegions(unassigned, true),
        ].sort((a, b) => a.bbox.minY - b.bbox.minY || a.bbox.minX - b.bbox.minX);
      }
    }
  }

  // Step 1: Group vertically+horizontally close strokes into local word/syllable islands first
  // (prevents thin top/bottom strokes from forming spurious single-stroke seed lines in Y-sort).
  const n = active.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const findRoot = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unionIdx = (a: number, b: number) => {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = active[i].bbox;
      const b = active[j].bbox;
      const maxH = Math.max(a.height, b.height);
      const minH = Math.max(1, Math.min(a.height, b.height));
      const scaleDiff = Math.abs(a.height - b.height) / Math.max(1, maxH);
      const hGap = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
      if (hGap > Math.max(44, maxH * 0.65)) continue;
      if (hGap > 12 && minH >= 32 && maxH >= 110 && scaleDiff > 0.62) continue;
      const aCy = (a.minY + a.maxY) / 2;
      const bCy = (b.minY + b.maxY) / 2;
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      const vDist = Math.abs(aCy - bCy);
      // Either overlapping vertically, OR X-overlapping stacked strokes of the same syllable/word
      const xOverlapping = hGap <= 6;
      if (
        overlapY >= minH * 0.3 ||
        vDist <= Math.max(44, maxH * 0.58) ||
        (xOverlapping && vDist <= Math.max(54, maxH * 0.72))
      ) {
        unionIdx(i, j);
      }
    }
  }

  const islandMap = new Map<number, WonderStroke[]>();
  for (let i = 0; i < n; i++) {
    const r = findRoot(i);
    const arr = islandMap.get(r);
    if (arr) arr.push(active[i]);
    else islandMap.set(r, [active[i]]);
  }
  const islands = Array.from(islandMap.values())
    .map((strokesInIsland) => ({
      strokes: strokesInIsland,
      bbox: mergeBoundingBoxes(strokesInIsland.map((s) => s.bbox)),
    }))
    .sort((a, b) => {
      const ay = (a.bbox.minY + a.bbox.maxY) / 2;
      const by = (b.bbox.minY + b.bbox.maxY) / 2;
      return ay - by || a.bbox.minX - b.bbox.minX;
    });

  // Step 2: Merge horizontally collinear word islands belonging to the same writing line,
  // then split each Y-line left-to-right only at wide column gaps (> max(160, 1.6*maxH))
  // so 3+ word sentences stay unified while distant columns remain separate regions.
  const yBandGroups: Array<typeof islands> = [];
  for (const isl of islands) {
    const sCy = (isl.bbox.minY + isl.bbox.maxY) / 2;
    const match = yBandGroups.find((g) => {
      const box = mergeBoundingBoxes(g.map((x) => x.bbox));
      const gCy = (box.minY + box.maxY) / 2;
      const maxH = Math.max(box.height, isl.bbox.height);
      const minH = Math.max(1, Math.min(box.height, isl.bbox.height));
      const isTinyPunct = isl.bbox.width < 18 && isl.bbox.height < 18;
      const isSmallPunct =
        isl.strokes.length <= 2 &&
        isl.bbox.width <= 24 &&
        isl.bbox.height <= 38;
      const nearBandVertically =
        isl.bbox.minY <= box.maxY + Math.max(42, box.height * 0.35) &&
        isl.bbox.maxY >= box.minY - Math.max(16, box.height * 0.15);
      if (isSmallPunct && nearBandVertically) {
        return true;
      }
      const scaleDiff = Math.abs(box.height - isl.bbox.height) / Math.max(1, maxH);
      if (
        !isTinyPunct &&
        isl.strokes.length >= 2 &&
        g.some((x) => x.strokes.length >= 2) &&
        minH >= 28 &&
        scaleDiff > 0.58
      ) {
        return false;
      }
      const overlapY = Math.min(box.maxY, isl.bbox.maxY) - Math.max(box.minY, isl.bbox.minY);
      return Math.abs(sCy - gCy) <= Math.max(36, maxH * 0.42) || overlapY >= minH * 0.5;
    });
    if (match) {
      match.push(isl);
    } else {
      yBandGroups.push([isl]);
    }
  }

  const lineGroups: WonderStroke[][] = [];
  for (const band of yBandGroups) {
    const glyphIslands = band.filter(
      (x) => x.strokes.length >= 2 || x.bbox.height >= 28
    );
    const scaleSource = glyphIslands.length > 0 ? glyphIslands : band;
    const maxBandHeight = Math.max(...band.map((x) => x.bbox.height));
    const localBandScale = Math.max(
      estimateLocalHandwritingScale(scaleSource.map((x) => x.bbox)).medianHeight,
      maxBandHeight * 0.72
    );
    const sortedByX = [...band].sort((a, b) => a.bbox.minX - b.bbox.minX);
    let currentGroup: WonderStroke[] = [];
    let currentMaxX = -Infinity;
    for (const isl of sortedByX) {
      if (currentGroup.length === 0) {
        currentGroup = [...isl.strokes];
        currentMaxX = isl.bbox.maxX;
        continue;
      }
      const gap = isl.bbox.minX - currentMaxX;
      if (gap > Math.max(120, localBandScale * 2.15)) {
        lineGroups.push(currentGroup);
        currentGroup = [...isl.strokes];
        currentMaxX = isl.bbox.maxX;
      } else {
        currentGroup.push(...isl.strokes);
        currentMaxX = Math.max(currentMaxX, isl.bbox.maxX);
      }
    }
    if (currentGroup.length > 0) {
      lineGroups.push(currentGroup);
    }
  }

  return lineGroups.flatMap((line): Array<{
    strokes: WonderStroke[];
    wordClusters: WonderStroke[][];
    bbox: WonderBBox;
    kind: 'text_candidate' | 'in_progress' | 'non_text';
  }> => {
    const sortedX = [...line].sort((a, b) => a.bbox.minX - b.bbox.minX);
    const wordClusters: WonderStroke[][] = [];
    for (const s of sortedX) {
      const prevCluster = wordClusters[wordClusters.length - 1];
      if (!prevCluster) {
        wordClusters.push([s]);
        continue;
      }
      const prevBox = mergeBoundingBoxes(prevCluster.map((x) => x.bbox));
      const gap = s.bbox.minX - prevBox.maxX;
      const wordSplitGap = Math.max(
        21,
        0.42 * Math.max(prevBox.height, s.bbox.height)
      );
      if (gap > wordSplitGap) {
        wordClusters.push([s]);
      } else {
        prevCluster.push(s);
      }
    }

    const bbox = mergeBoundingBoxes(sortedX.map((s) => s.bbox));
    if (isLikelyNonTextCluster(sortedX)) {
      return [{ strokes: sortedX, wordClusters, bbox, kind: 'non_text' }];
    }
    if (sortedX.length === 1 && bbox.width < 26 && bbox.height < 36 && !sortedX[0].fixtureHintText && lineGroups.length === 1) {
      return [{ strokes: sortedX, wordClusters, bbox, kind: 'in_progress' }];
    }
    if (separateHangulOccurrences && wordClusters.length > 1 &&
      wordClusters.every((cluster) =>
        cluster.every((s) => (s.provenance ?? 'freehand_ink') === 'freehand_ink') &&
        inspectHangulBranch(cluster) !== undefined
      )) {
      return wordClusters.map((cluster) => ({
        strokes: cluster, wordClusters: [cluster],
        bbox: mergeBoundingBoxes(cluster.map((s) => s.bbox)), kind: 'text_candidate',
      }));
    }
    return [{ strokes: sortedX, wordClusters, bbox, kind: 'text_candidate' }];
  });
}

type FreehandPrimKind =
  | 'LOOP'
  | 'VERT'
  | 'HORIZ'
  | 'CORNER_TR'
  | 'CORNER_BL'
  | 'C_BRACKET'
  | 'DIAG_SLASH'
  | 'DIAG_BACKSLASH'
  | 'LAMBDA'
  | 'TOP_DIAG_SLASH'
  | 'OTHER';

interface ClassifiedPrim {
  stroke: WonderStroke;
  kind: FreehandPrimKind;
  cxNorm: number;
  cyNorm: number;
  minXNorm: number;
  maxXNorm: number;
  minYNorm: number;
  maxYNorm: number;
  wNorm: number;
  hNorm: number;
}

function classifyStrokePrimitive(s: WonderStroke, box: WonderBBox): ClassifiedPrim {
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const pts = s.points;
  const dx = s.transform.dx;
  const dy = s.transform.dy;
  const minX = s.bbox.minX;
  const maxX = s.bbox.maxX;
  const minY = s.bbox.minY;
  const maxY = s.bbox.maxY;
  const sw = Math.max(1, maxX - minX);
  const sh = Math.max(1, maxY - minY);
  const cxNorm = ((minX + maxX) / 2 - box.minX) / w;
  const cyNorm = ((minY + maxY) / 2 - box.minY) / h;
  const minXNorm = (minX - box.minX) / w;
  const maxXNorm = (maxX - box.minX) / w;
  const minYNorm = (minY - box.minY) / h;
  const maxYNorm = (maxY - box.minY) / h;
  const wNorm = sw / w;
  const hNorm = sh / h;

  const mk = (kind: FreehandPrimKind): ClassifiedPrim => ({
    stroke: s,
    kind,
    cxNorm,
    cyNorm,
    minXNorm,
    maxXNorm,
    minYNorm,
    maxYNorm,
    wNorm,
    hNorm,
  });

  // Detect 1-stroke left-opening ㄷ (C_BRACKET) before LOOP so open C-shapes never match ㅇ
  if (pts.length >= 4 && sw >= 14 && sh >= 14 && sw >= sh * 0.2 && sh >= sw * 0.2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const [top, bottom] = first.y <= last.y ? [first, last] : [last, first];
    const p0x = (top.x + dx - minX) / sw;
    const p0y = (top.y + dy - minY) / sh;
    const pLx = (bottom.x + dx - minX) / sw;
    const pLy = (bottom.y + dy - minY) / sh;
    let hasTopLeft = false;
    let hasBotLeft = false;
    let hasRightMid = false;
    let hasTopRightArc = false;
    let sumNx = 0;
    for (const p of pts) {
      const nx = (p.x + dx - minX) / sw;
      const ny = (p.y + dy - minY) / sh;
      sumNx += nx;
      if (nx < 0.35 && ny < 0.42) hasTopLeft = true;
      if (nx < 0.35 && ny > 0.58) hasBotLeft = true;
      if (nx > 0.65 && ny > 0.32 && ny < 0.68) hasRightMid = true;
      if (nx > 0.72 && ny < 0.45) hasTopRightArc = true;
    }
    const cxNormInStroke = sumNx / pts.length;
    if (
      p0x > 0.42 &&
      p0y < 0.45 &&
      pLx > 0.42 &&
      pLy > 0.55 &&
      hasTopLeft &&
      hasBotLeft &&
      !hasRightMid &&
      !(hasTopRightArc && p0y > 0.16 && pLx > 0.6) &&
      cxNormInStroke < 0.65
    ) {
      return mk('C_BRACKET');
    }
  }

  if (pts.length >= 5) {
    const p0 = pts[0];
    const pEnd = pts[pts.length - 1];
    const endDist = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);
    const diag = Math.hypot(sw, sh) || 1;
    const sx = (minX + maxX) / 2;
    const sy = (minY + maxY) / 2;
    let totalTurn = 0;
    for (let i = 1; i < pts.length; i++) {
      const a1 = Math.atan2(pts[i - 1].y + dy - sy, pts[i - 1].x + dx - sx);
      const a2 = Math.atan2(pts[i].y + dy - sy, pts[i].x + dx - sx);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      totalTurn += diff;
    }
    const aspect = sw / Math.max(1, sh);
    if (
      (endDist < diag * 0.58 || Math.abs(totalTurn) >= Math.PI * 1.30) &&
      aspect >= 0.22 &&
      aspect <= 2.8 &&
      sh >= 12
    ) {
      return mk('LOOP');
    }
  }

  // Corner & chevron detection (ㄱ CORNER_TR, ㄴ CORNER_BL, 7 TOP_DIAG_SLASH, ∧ LAMBDA)
  if (pts.length >= 3 && sw >= 12 && sh >= 12 && sw >= sh * 0.2 && sh >= sw * 0.2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const [left, right] = first.x <= last.x ? [first, last] : [last, first];
    const p0x = (left.x + dx - minX) / sw;
    const p0y = (left.y + dy - minY) / sh;
    const pLx = (right.x + dx - minX) / sw;
    const pLy = (right.y + dy - minY) / sh;

    let bestTR = -Infinity;
    let trPt = { x: 0, y: 0 };
    let bestBL = -Infinity;
    let blPt = { x: 0, y: 0 };
    let topMid = false;
    for (const p of pts) {
      const nx = (p.x + dx - minX) / sw;
      const ny = (p.y + dy - minY) / sh;
      if (nx - ny > bestTR) {
        bestTR = nx - ny;
        trPt = { x: nx, y: ny };
      }
      if (ny - nx > bestBL) {
        bestBL = ny - nx;
        blPt = { x: nx, y: ny };
      }
      if (ny < 0.35 && nx > 0.25 && nx < 0.75) {
        topMid = true;
      }
    }

    if (p0x < 0.45 && p0y < 0.45 && trPt.x > 0.58 && trPt.y < 0.45 && pLy > 0.58) {
      return mk(pLx > 0.45 ? 'CORNER_TR' : 'TOP_DIAG_SLASH');
    }
    if (p0x < 0.45 && p0y < 0.45 && blPt.x < 0.45 && blPt.y > 0.58 && pLx > 0.58 && pLy > 0.45) {
      return mk('CORNER_BL');
    }
    // 1-stroke ㅅ chevron (starts bottom-left -> top peak -> bottom-right)
    if (p0x < 0.38 && p0y > 0.55 && topMid && pLx > 0.62 && pLy > 0.55) {
      return mk('LAMBDA');
    }
  }

  // Compute unpadded point span first so visualPad & mouse wobble never misclassify short ㅏ/ㅓ ticks as diagonals
  let rawMinX = Infinity;
  let rawMaxX = -Infinity;
  let rawMinY = Infinity;
  let rawMaxY = -Infinity;
  for (const p of pts) {
    const px = p.x + dx;
    const py = p.y + dy;
    if (px < rawMinX) rawMinX = px;
    if (px > rawMaxX) rawMaxX = px;
    if (py < rawMinY) rawMinY = py;
    if (py > rawMaxY) rawMaxY = py;
  }
  const rawW = Math.max(0, rawMaxX - rawMinX);
  const rawH = Math.max(0, rawMaxY - rawMinY);

  // Diagonal straight strokes (/ DIAG_SLASH or \ DIAG_BACKSLASH) for ㅅ/ㅆ/ㅈ/ㅊ.
  // Check BEFORE strict VERT/HORIZ when horizontal travel is clearly slanted (>= 45% vertical ratio & >= 16px).
  if (pts.length >= 2) {
    const p0 = pts[0];
    const pEnd = pts[pts.length - 1];
    const ddx = pEnd.x + dx - (p0.x + dx);
    const ddy = pEnd.y + dy - (p0.y + dy);
    const endDist = Math.hypot(ddx, ddy);
    const diag = Math.hypot(sw, sh) || 1;
    if (
      rawH >= 16 &&
      Math.abs(ddy) >= Math.abs(ddx) * 0.45 &&
      endDist >= diag * 0.72 &&
      Math.abs(ddx) >= Math.max(6, sh * 0.11) &&
      Math.abs(ddx) / sw >= 0.42 &&
      Math.abs(ddy) >= Math.max(10, sw * 0.42)
    ) {
      return mk(ddx * ddy < 0 ? 'DIAG_SLASH' : 'DIAG_BACKSLASH');
    }
  }

  if (
    (rawH >= Math.max(1, rawW) * 1.85 && rawH >= 6) ||
    sh >= sw * 2.2
  ) {
    return mk('VERT');
  }
  if (
    (rawW >= Math.max(1, rawH) * 1.35 && rawW >= 5) ||
    sw >= sh * 1.85
  ) {
    return mk('HORIZ');
  }

  return mk('OTHER');
}

function classifyFreehandConsonant(prims: ClassifiedPrim[]): string | null {
  if (prims.length === 0) return null;
  const loops = prims.filter((p) => p.kind === 'LOOP');
  const verts = prims.filter((p) => p.kind === 'VERT');
  const horizs = prims.filter((p) => p.kind === 'HORIZ');
  const trs = prims.filter((p) => p.kind === 'CORNER_TR');
  const bls = prims.filter((p) => p.kind === 'CORNER_BL');
  const cBrackets = prims.filter((p) => p.kind === 'C_BRACKET');
  const slashes = prims.filter((p) => p.kind === 'DIAG_SLASH');
  const backslashes = prims.filter((p) => p.kind === 'DIAG_BACKSLASH');
  const lambdas = prims.filter((p) => p.kind === 'LAMBDA');
  const topDiagSlashes = prims.filter((p) => p.kind === 'TOP_DIAG_SLASH');
  const others = prims.filter((p) => p.kind === 'OTHER');

  if (
    others.length > 0 &&
    loops.length === 0 &&
    trs.length === 0 &&
    bls.length === 0 &&
    cBrackets.length === 0 &&
    lambdas.length === 0 &&
    topDiagSlashes.length === 0 &&
    slashes.length === 0 &&
    backslashes.length === 0
  ) {
    return null;
  }

  // ㄹ: ㄱ + (HORIZ + ㄴ) OR ㄱ + C_BRACKET (every stroke accounted for)
  if (trs.length === 1 && cBrackets.length === 1 && prims.length === 2) {
    return 'ㄹ';
  }
  if (
    trs.length === 1 &&
    bls.length === 1 &&
    horizs.length >= 1 &&
    horizs.length <= 2 &&
    prims.length === 2 + horizs.length
  ) {
    return 'ㄹ';
  }

  // ㅁ: ㄴ + ㄱ OR VERT + ㄱ + HORIZ
  if (bls.length === 1 && trs.length === 1 && prims.length === 2) {
    return 'ㅁ';
  }
  if (verts.length === 1 && trs.length === 1 && horizs.length === 1 && prims.length === 3) {
    return 'ㅁ';
  }

  // 4-stroke box variants: ㅂ vs ㅍ vs ㅁ (normalize Y relative to consonant's own height span)
  if (verts.length === 2 && horizs.length === 2 && prims.length === 4) {
    const sortedV = [...verts].sort((a, b) => a.cxNorm - b.cxNorm);
    const minAllX = Math.min(...prims.map((p) => p.minXNorm));
    const maxAllX = Math.max(...prims.map((p) => p.maxXNorm));
    const minAllY = Math.min(...prims.map((p) => p.minYNorm));
    const maxAllY = Math.max(...prims.map((p) => p.maxYNorm));
    const spanX = Math.max(0.1, maxAllX - minAllX);
    const spanY = Math.max(0.1, maxAllY - minAllY);
    const leftVertInset = (sortedV[0].cxNorm - minAllX) / spanX;
    const rightVertInset = (maxAllX - sortedV[1].cxNorm) / spanX;
    const topBarY = Math.min(horizs[0].cyNorm, horizs[1].cyNorm);
    const localMidY = (topBarY - minAllY) / spanY;
    if (leftVertInset >= 0.16 && rightVertInset >= 0.16 && localMidY <= 0.28) {
      return 'ㅍ';
    }
    if (localMidY > 0.25 && localMidY < 0.75) return 'ㅂ';
    return 'ㅁ';
  }
  if (verts.length === 1 && bls.length === 1 && horizs.length === 1 && prims.length === 3) {
    return 'ㅂ';
  }

  // ㅎ: ㅇ + 1-2 top bars/ticks strictly above ㅇ
  if (
    loops.length === 1 &&
    prims.length >= 2 &&
    prims.length <= 3 &&
    trs.length === 0 &&
    bls.length === 0 &&
    cBrackets.length === 0
  ) {
    const nonLoops = prims.filter((p) => p !== loops[0]);
    if (
      nonLoops.every(
        (p) => (p.kind === 'HORIZ' || (p.kind === 'VERT' && p.hNorm < 0.35)) && p.cyNorm < loops[0].cyNorm
      )
    ) {
      return 'ㅎ';
    }
  }
  if (loops.length === 1 && prims.length === 1) {
    return 'ㅇ';
  }

  // ㅋ: ㄱ + inner HORIZ; ㄲ: 2 ㄱ; ㄱ: 1 ㄱ
  if (trs.length === 1 && horizs.length === 1 && prims.length === 2) {
    return 'ㅋ';
  }
  if (trs.length === 2 && prims.length === 2) {
    return 'ㄲ';
  }
  if (trs.length === 1 && prims.length === 1) {
    return 'ㄱ';
  }

  // ㄷ / ㅌ / ㄴ
  if (cBrackets.length === 1 && horizs.length === 1 && prims.length === 2) {
    return 'ㅌ';
  }
  if (cBrackets.length === 1 && prims.length === 1) {
    return 'ㄷ';
  }
  if (bls.length === 1 && prims.length === 1) {
    return 'ㄴ';
  }
  if (bls.length === 1 && horizs.length === 2 && prims.length === 3) {
    return 'ㅌ';
  }
  if (verts.length === 1 && horizs.length === 3 && prims.length === 4) {
    return 'ㅌ';
  }
  if (
    (bls.length === 1 && horizs.length === 1 && prims.length === 2) ||
    (verts.length === 1 && horizs.length === 2 && prims.length === 3 && verts[0].cxNorm < 0.45)
  ) {
    return 'ㄷ';
  }

  // Helper verifying a (/ + \) pair actually forms a Hangul branching chevron (ㅅ/ㅈ/ㅊ), NOT an X-cross:
  // in an X-cross both diagonals share the same horizontal center (|cx1 - cx2| < 0.12),
  // whereas in ㅅ the right leg (\) branches rightward (backslash.cxNorm >= slash.cxNorm + 0.12).
  const isHangulChevronPair = (sl: ClassifiedPrim, bs: ClassifiedPrim): boolean =>
    bs.cxNorm >= sl.cxNorm + 0.12;

  const singleChevronPair =
    slashes.length === 1 && backslashes.length === 1 && isHangulChevronPair(slashes[0], backslashes[0]);

  // ㅅ / ㅆ / ㅈ / ㅉ / ㅊ (no unaccounted loops/corners)
  const hasSingleLambda =
    (lambdas.length === 1 && slashes.length === 0 && backslashes.length === 0) ||
    singleChevronPair ||
    (topDiagSlashes.length === 0 && trs.length === 0 && slashes.length === 1 && verts.length === 1);
  if (
    (lambdas.length === 2 && prims.length === 2) ||
    (slashes.length === 2 && backslashes.length === 2 && prims.length === 4)
  ) {
    return 'ㅆ';
  }
  if (
    (singleChevronPair && prims.length === 2) ||
    (lambdas.length === 1 && prims.length === 1)
  ) {
    return 'ㅅ';
  }
  if (topDiagSlashes.length === 1 && backslashes.length === 1 && prims.length === 2) {
    return 'ㅈ';
  }
  if (
    topDiagSlashes.length === 1 &&
    backslashes.length === 1 &&
    prims.length === 3 &&
    (horizs.length === 1 || verts.length === 1)
  ) {
    return 'ㅊ';
  }
  const diagBaseCount =
    lambdas.length === 1 ? 1 : singleChevronPair ? 2 : 0;
  if (
    diagBaseCount > 0 &&
    (horizs.length === 1 || trs.length === 1) &&
    horizs.every((h) => h.cyNorm < 0.45) &&
    prims.length === diagBaseCount + horizs.length + trs.length
  ) {
    return 'ㅈ';
  }
  const topShortVerts = verts.filter((v) => v.hNorm < 0.32).length;
  if (
    diagBaseCount > 0 &&
    horizs.length + topShortVerts === 2 &&
    prims.length === diagBaseCount + 2
  ) {
    return 'ㅊ';
  }

  return null;
}

function composeHangulSyllableChar(cho: string, jung: string, jong = ''): string | null {
  const cIdx = JAMO_CHOSEONG.indexOf(cho);
  const jIdx = JAMO_JUNGSEONG.indexOf(jung);
  const bIdx = jong ? JAMO_JONGSEONG.indexOf(jong) : 0;
  if (cIdx < 0 || jIdx < 0 || bIdx < 0) return null;
  return String.fromCharCode(0xac00 + cIdx * 588 + jIdx * 28 + bIdx);
}

/**
 * Splits a multi-stroke word cluster into horizontal Korean syllable blocks,
 * merging split consonant pieces (e.g. 2-stroke ㅁ) and right-hand vertical vowels (ㅏ/ㅓ/ㅣ).
 */
function segmentClusterIntoSyllableBlocks(cluster: WonderStroke[]): WonderStroke[][] {
  if (cluster.length <= 1) return cluster.length ? [cluster] : [];
  const box = mergeBoundingBoxes(cluster.map((s) => s.bbox));
  const sorted = [...cluster].sort((a, b) => a.bbox.minX - b.bbox.minX);

  // Build X-overlapping slices first
  const slices: WonderStroke[][] = [];
  for (const s of sorted) {
    const prev = slices[slices.length - 1];
    if (!prev) {
      slices.push([s]);
      continue;
    }
    const prevBox = mergeBoundingBoxes(prev.map((x) => x.bbox));
    if (s.bbox.minX <= prevBox.maxX + 3) {
      prev.push(s);
    } else {
      slices.push([s]);
    }
  }

  const isPureVerticalVowelSlice = (sl: WonderStroke[]): boolean => {
    const sBox = mergeBoundingBoxes(sl.map((s) => s.bbox));
    const prims = sl.map((s) => classifyStrokePrimitive(s, sBox));
    if (
      prims.some(
        (p) =>
          p.kind === 'LOOP' ||
          p.kind === 'CORNER_TR' ||
          p.kind === 'CORNER_BL' ||
          p.kind === 'C_BRACKET' ||
          p.kind === 'LAMBDA' ||
          p.kind === 'TOP_DIAG_SLASH' ||
          p.kind === 'OTHER'
      )
    ) {
      return false;
    }
    const verts = prims.filter((p) => p.kind === 'VERT');
    const horizs = prims.filter((p) => p.kind === 'HORIZ');
    const hasTallVert = verts.some((v) => v.stroke.bbox.height >= box.height * 0.42);
    return hasTallVert && verts.length <= 2 && horizs.length <= 2;
  };

  // Merge right-hand vertical vowel slices (ㅏ, ㅓ, ㅣ, ㅐ, ㅔ) into preceding syllable consonant/compound slice
  const blocks: WonderStroke[][] = [];
  for (const sl of slices) {
    const prevBlock = blocks[blocks.length - 1];
    if (!prevBlock) {
      blocks.push([...sl]);
      continue;
    }
    const prevBox = mergeBoundingBoxes(prevBlock.map((s) => s.bbox));
    const slBox = mergeBoundingBoxes(sl.map((s) => s.bbox));
    const gap = slBox.minX - prevBox.maxX;
    if (gap <= Math.max(18, box.height * 0.38) && isPureVerticalVowelSlice(sl)) {
      const prevTallRightVerts = prevBlock.filter((ps) => {
        const pKind = classifyStrokePrimitive(ps, prevBox).kind;
        return (
          pKind === 'VERT' &&
          ps.bbox.minX > prevBox.minX + prevBox.width * 0.52 &&
          ps.bbox.height >= box.height * 0.42
        );
      });
      const slPrims = sl.map((ps) => classifyStrokePrimitive(ps, slBox));
      const isSecondDoubleVowelVert =
        prevTallRightVerts.length === 1 &&
        slPrims.length === 1 &&
        slPrims[0].kind === 'VERT' &&
        gap <= Math.max(22, box.height * 0.24);
      if (prevTallRightVerts.length === 0 || isSecondDoubleVowelVert) {
        prevBlock.push(...sl);
        continue;
      }
    }
    blocks.push([...sl]);
  }
  return blocks;
}

function matchOpenSyllableParts(
  prims: ClassifiedPrim[]
): { cho: string; jung: string; confidence: number } | null {
  if (prims.filter((p) => p.kind === 'OTHER').length >= 2 && !prims.some((p) => p.kind === 'LOOP')) {
    return null;
  }

  // Check Type C: Right full-height vertical vowel stem + left top Choseong + left bottom horizontal vowel (ㅘ/ㅙ/ㅚ/ㅝ/ㅞ/ㅟ/ㅢ)
  const rightFullVertsTypeC = prims.filter(
    (p) => p.kind === 'VERT' && p.cxNorm >= 0.55 && p.hNorm >= 0.6
  );
  if (rightFullVertsTypeC.length >= 1 && rightFullVertsTypeC.length <= 2) {
    const firstRightV = rightFullVertsTypeC.reduce((a, b) => (a.cxNorm < b.cxNorm ? a : b));
    const leftPrims = prims.filter(
      (p) => !rightFullVertsTypeC.includes(p) && p.cxNorm < firstRightV.cxNorm - 0.06
    );
    const leftBotHoriz = leftPrims.find(
      (p) =>
        p.kind === 'HORIZ' &&
        p.cyNorm >= 0.35 &&
        p.cyNorm <= 0.78 &&
        firstRightV.maxYNorm >= p.cyNorm + 0.18
    );
    if (leftBotHoriz) {
      const leftTopCho = leftPrims.filter((p) => p.cyNorm < leftBotHoriz.cyNorm - 0.04);
      const cho = classifyFreehandConsonant(leftTopCho);
      const leftStem = leftPrims.find(
        (p) =>
          p.kind === 'VERT' &&
          p !== leftBotHoriz &&
          !leftTopCho.includes(p) &&
          p.cxNorm <= leftBotHoriz.maxXNorm + 0.08
      );
      const ticks = prims.filter(
        (p) =>
          p.kind === 'HORIZ' &&
          p !== leftBotHoriz &&
          !leftTopCho.includes(p) &&
          p.wNorm <= 0.48 &&
          p.maxXNorm >= firstRightV.cxNorm - 0.14
      );
      if (cho && leftTopCho.length + (leftStem ? 1 : 0) + ticks.length + rightFullVertsTypeC.length + 1 === prims.length) {
        let compoundVowel: string | null = null;
        if (rightFullVertsTypeC.length === 2) {
          compoundVowel = leftStem && leftStem.cyNorm >= leftBotHoriz.cyNorm ? 'ㅞ' : 'ㅙ';
        } else if (leftStem && leftStem.cyNorm >= leftBotHoriz.cyNorm) {
          compoundVowel = ticks.length >= 1 ? 'ㅝ' : 'ㅟ';
        } else if (leftStem && leftStem.cyNorm < leftBotHoriz.cyNorm) {
          compoundVowel = ticks.length >= 1 ? 'ㅘ' : 'ㅚ';
        } else {
          compoundVowel = ticks.length === 0 ? 'ㅢ' : null;
        }
        if (compoundVowel) {
          return { cho, jung: compoundVowel, confidence: 0.87 };
        }
      }
    }
  }

  const rightTallVerts = prims.filter(
    (p) =>
      p.kind === 'VERT' &&
      p.hNorm >= 0.48 &&
      (p.cxNorm >= 0.52 ||
        (p.cxNorm >= 0.40 &&
          prims.some((lp) => lp !== p && lp.kind !== 'HORIZ' && lp.cxNorm < p.cxNorm - 0.08) &&
          prims.every(
            (rp) =>
              rp === p ||
              rp.cxNorm <= p.cxNorm ||
              rp.kind === 'HORIZ' ||
              (rp.kind === 'VERT' && rp.hNorm >= 0.48)
          )))
  );

  // Check Type B: Left Choseong + Right vertical vowel (ㅏ, ㅑ, ㅓ, ㅕ, ㅣ, ㅐ, ㅔ, ㅒ, ㅖ)
  if (rightTallVerts.length >= 1 && rightTallVerts.length <= 2) {
    const firstRightV = rightTallVerts.reduce((a, b) => (a.cxNorm < b.cxNorm ? a : b));
    const rightTallVertSet = new Set(rightTallVerts);
    const leftConsonantAnchorMaxX = prims
      .filter((p) => !rightTallVertSet.has(p) && p.kind !== 'HORIZ' && p.cxNorm < firstRightV.cxNorm)
      .reduce((mx, p) => Math.max(mx, p.cxNorm), 0.32);
    const vowelTicks = prims.filter((p) => {
      if (rightTallVertSet.has(p) || p.kind !== 'HORIZ') return false;
      if (p.cxNorm >= firstRightV.cxNorm - 0.02) return true;
      return (
        p.maxXNorm >= firstRightV.cxNorm - 0.18 &&
        p.wNorm <= 0.44 &&
        p.cyNorm >= 0.2 &&
        p.cyNorm <= 0.8 &&
        p.cxNorm > leftConsonantAnchorMaxX + 0.06
      );
    });
    const vowelSet = new Set<ClassifiedPrim>([...rightTallVerts, ...vowelTicks]);
    const leftConsonantPrims = prims.filter(
      (p) => !vowelSet.has(p) && p.cxNorm < firstRightV.cxNorm && p.kind !== 'OTHER'
    );
    const cho = classifyFreehandConsonant(leftConsonantPrims);
    if (cho && leftConsonantPrims.length + rightTallVerts.length + vowelTicks.length === prims.length) {
      let jung: string | null = null;
      if (rightTallVerts.length === 2) {
        if (vowelTicks.length >= 2) {
          jung = vowelTicks[0].cxNorm >= firstRightV.cxNorm - 0.02 ? 'ㅒ' : 'ㅖ';
        } else {
          jung = vowelTicks[0]?.cxNorm >= firstRightV.cxNorm - 0.02 ? 'ㅐ' : 'ㅔ';
        }
      } else if (vowelTicks.length === 0) {
        jung = 'ㅣ';
      } else if (vowelTicks.length === 1) {
        jung = vowelTicks[0].cxNorm >= firstRightV.cxNorm - 0.02 ? 'ㅏ' : 'ㅓ';
      } else if (vowelTicks.length === 2) {
        const rightCnt = vowelTicks.filter((t) => t.cxNorm >= firstRightV.cxNorm - 0.02).length;
        jung = rightCnt === 2 ? 'ㅑ' : rightCnt === 0 ? 'ㅕ' : null;
      }
      if (jung) {
        return { cho, jung, confidence: 0.88 };
      }
    }
  }

  // Check Type A: Top Choseong + Bottom horizontal vowel (ㅗ, ㅛ, ㅜ, ㅠ, ㅡ)
  const wideBotHorizCandidates = prims.filter(
    (p) => p.kind === 'HORIZ' && p.wNorm >= 0.48 && p.cyNorm >= 0.42
  );
  const wideBotHoriz =
    wideBotHorizCandidates.length > 0
      ? wideBotHorizCandidates.reduce((a, b) => (a.cyNorm > b.cyNorm ? a : b))
      : undefined;
  if (wideBotHoriz) {
    const topChoPrims = prims.filter(
      (p) =>
        p !== wideBotHoriz &&
        p.cyNorm < wideBotHoriz.cyNorm - 0.08 &&
        !(
          p.kind === 'VERT' &&
          p.cxNorm > 0.22 &&
          p.cxNorm < 0.78 &&
          p.hNorm <= 0.45 &&
          p.maxYNorm >= wideBotHoriz.cyNorm - 0.1
        )
    );
    const stems = prims.filter(
      (p) => p.kind === 'VERT' && p !== wideBotHoriz && !topChoPrims.includes(p)
    );
    const cho = classifyFreehandConsonant(topChoPrims);
    if (cho && topChoPrims.length > 0 && topChoPrims.length + stems.length + 1 === prims.length) {
      const aboveStems = stems.filter((s) => s.cyNorm <= wideBotHoriz.cyNorm + 0.04).length;
      const belowStems = stems.filter((s) => s.cyNorm > wideBotHoriz.cyNorm).length;
      let jung: string | null = null;
      if (stems.length === 0) jung = 'ㅡ';
      else if (aboveStems === 1 && belowStems === 0) jung = 'ㅗ';
      else if (aboveStems === 2 && belowStems === 0) jung = 'ㅛ';
      else if (belowStems === 1 && aboveStems === 0) jung = 'ㅜ';
      else if (belowStems === 2 && aboveStems === 0) jung = 'ㅠ';
      if (jung) {
        return { cho, jung, confidence: 0.86 };
      }
    }
  }

  return null;
}

function recognizeSingleSyllableBlock(
  blockStrokes: WonderStroke[]
): { text: string; confidence: number } | null {
  if (blockStrokes.length === 0 || blockStrokes.length > 10) return null;
  const box = mergeBoundingBoxes(blockStrokes.map((s) => s.bbox));
  const prims = blockStrokes.map((s) => classifyStrokePrimitive(s, box));

  // 1. Open syllable (Choseong + Jungseong)
  const openRes = matchOpenSyllableParts(prims);
  if (openRes) {
    const ch = composeHangulSyllableChar(openRes.cho, openRes.jung);
    if (ch) return { text: ch, confidence: openRes.confidence };
  }

  // 2. Closed syllable with Jongseong / batchim (Choseong + Jungseong top, Jongseong bottom)
  if (blockStrokes.length >= 3) {
    const testedPartitions = new Set<string>();
    for (const cutY of [0.54, 0.6, 0.48, 0.66, 0.72]) {
      const upperStrokes = prims
        .filter((p) => p.cyNorm < cutY)
        .map((p) => p.stroke);
      const lowerStrokes = prims
        .filter((p) => p.cyNorm >= cutY)
        .map((p) => p.stroke);
      if (upperStrokes.length < 2 || lowerStrokes.length < 1) continue;
      const partKey = `${upperStrokes.length}:${lowerStrokes.length}`;
      if (testedPartitions.has(partKey)) continue;
      testedPartitions.add(partKey);

      const uBox = mergeBoundingBoxes(upperStrokes.map((s) => s.bbox));
      const lBox = mergeBoundingBoxes(lowerStrokes.map((s) => s.bbox));
      if (lBox.minY < uBox.minY + uBox.height * 0.35) continue;

      const uPrims = upperStrokes.map((s) => classifyStrokePrimitive(s, uBox));
      const lPrims = lowerStrokes.map((s) => classifyStrokePrimitive(s, lBox));
      const upperMatch = matchOpenSyllableParts(uPrims);
      const jong = classifyFreehandConsonant(lPrims);
      if (upperMatch && jong && JAMO_JONGSEONG.includes(jong)) {
        const ch = composeHangulSyllableChar(upperMatch.cho, upperMatch.jung, jong);
        if (ch) return { text: ch, confidence: 0.85 };
      }
    }
  }

  // 3. Standalone single Jamo consonant or vowel
  const loneCons = classifyFreehandConsonant(prims);
  if (loneCons) return { text: loneCons, confidence: 0.8 };

  const loops = prims.filter((p) => p.kind === 'LOOP');
  const verts = prims.filter((p) => p.kind === 'VERT');
  const horizs = prims.filter((p) => p.kind === 'HORIZ');
  const others = prims.filter((p) => p.kind === 'OTHER');
  if (loops.length === 0 && others.length === 0) {
    if (verts.length === 1 && horizs.length === 1) {
      const v = verts[0];
      const h = horizs[0];
      if (v.hNorm >= 0.72 && h.wNorm >= 0.35) {
        if (h.cxNorm >= v.cxNorm + 0.05) return { text: 'ㅏ', confidence: 0.84 };
        if (h.cxNorm <= v.cxNorm - 0.05) return { text: 'ㅓ', confidence: 0.84 };
      }
      if (h.wNorm >= 0.72 && v.hNorm >= 0.35) {
        if (v.cyNorm <= h.cyNorm - 0.05) return { text: 'ㅗ', confidence: 0.84 };
        if (v.cyNorm >= h.cyNorm + 0.05) return { text: 'ㅜ', confidence: 0.84 };
      }
    }
    if (blockStrokes.length === 1 && verts.length === 1) return { text: 'ㅣ', confidence: 0.78 };
    if (blockStrokes.length === 1 && horizs.length === 1) return { text: 'ㅡ', confidence: 0.78 };
  }

  return null;
}

/**
 * Scale-invariant compositional freehand recognizer supporting open and batchim Hangul syllables
 * plus trailing sentence punctuation (. or ?), without hardcoding validation phrases.
 */
function recognizeFreehandHangulCluster(
  cluster: WonderStroke[]
): { text: string; confidence: number } | null {
  if (cluster.length === 0 || cluster.length > 36) return null;

  let coreStrokes = [...cluster];
  let trailingPunct = '';
  const clusterBox = mergeBoundingBoxes(cluster.map((s) => s.bbox));
  if (cluster.length >= 3) {
    const rightTailThreshold = clusterBox.maxX - Math.max(30, clusterBox.height * 0.42);
    const tailDot = [...cluster]
      .filter(
        (s) =>
          s.bbox.width <= 18 &&
          s.bbox.height <= 18 &&
          s.bbox.minY >= clusterBox.minY + clusterBox.height * 0.58 &&
          s.bbox.minX >= rightTailThreshold
      )
      .sort((a, b) => b.bbox.maxX - a.bbox.maxX)[0];
    if (tailDot) {
      const dotCx = (tailDot.bbox.minX + tailDot.bbox.maxX) / 2;
      const topHook = cluster.find(
        (s) =>
          s.id !== tailDot.id &&
          Math.abs((s.bbox.minX + s.bbox.maxX) / 2 - dotCx) <= 24 &&
          s.bbox.minX >= rightTailThreshold - 16 &&
          s.bbox.maxY <= tailDot.bbox.minY + 8 &&
          s.bbox.height >= clusterBox.height * 0.22 &&
          classifyStrokePrimitive(s, s.bbox).kind !== 'VERT' &&
          classifyStrokePrimitive(s, s.bbox).kind !== 'LOOP'
      );
      if (topHook) {
        trailingPunct = '?';
        const rmSet = new Set([tailDot.id, topHook.id]);
        coreStrokes = cluster.filter((s) => !rmSet.has(s.id));
      } else if (tailDot.bbox.maxX >= clusterBox.maxX - 18) {
        trailingPunct = '.';
        coreStrokes = cluster.filter((s) => s.id !== tailDot.id);
      }
    }
  }

  const blocks = segmentClusterIntoSyllableBlocks(coreStrokes);
  if (blocks.length === 0) return null;
  if (blocks.length === 1) {
    const single = recognizeSingleSyllableBlock(blocks[0]);
    return single ? { text: `${single.text}${trailingPunct}`, confidence: single.confidence } : null;
  }
  const recognizedSyllables: Array<{ text: string; confidence: number }> = [];
  for (const blk of blocks) {
    const res = recognizeSingleSyllableBlock(blk);
    if (!res) return null;
    recognizedSyllables.push(res);
  }
  const joined = `${recognizedSyllables.map((r) => r.text).join('')}${trailingPunct}`;
  if (/[\u3131-\u3163]{2,}/.test(joined) && !/[\uAC00-\uD7A3]/.test(joined)) {
    return null;
  }
  const avgConf =
    recognizedSyllables.reduce((acc, r) => acc + r.confidence, 0) /
    recognizedSyllables.length;
  return { text: joined, confidence: avgConf };
}

function detectLanguageFromText(text: string): WonderLanguage {
  const hasKo = /[\uAC00-\uD7A3]/.test(text);
  const hasVi =
    /[ăâêôơưđàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(
      text
    ) || /\b(tieng han|tieng anh|muon hoc|nghia la)\b/i.test(text);
  const hasEn = /[a-z]/i.test(text) && !hasVi;
  if (hasKo && (hasVi || hasEn)) return 'mixed';
  if (hasKo) return 'ko';
  if (hasVi) return 'vi';
  if (hasEn) return 'en';
  return 'unknown';
}

function computeStrokeClusterSignature(cluster: WonderStroke[]): number[] {
  const merged = mergeBoundingBoxes(cluster.map((s) => s.bbox));
  const w = Math.max(1, merged.width);
  const h = Math.max(1, merged.height);
  const aspect = Math.min(4, w / h) / 4;
  const strokeDensity = Math.min(1, cluster.length / 18);
  const bins = [0, 0, 0, 0];
  let meanNormX = 0;
  let meanNormY = 0;
  let count = 0;
  for (const s of cluster) {
    for (const p of s.points) {
      const nx = Math.max(0, Math.min(0.999, (p.x + s.transform.dx - merged.minX) / w));
      const ny = (p.y + s.transform.dy - merged.minY) / h;
      bins[Math.floor(nx * 4)]++;
      meanNormX += nx;
      meanNormY += ny;
      count++;
    }
  }
  const denom = Math.max(1, count);
  return [
    aspect,
    strokeDensity,
    meanNormX / denom,
    meanNormY / denom,
    bins[0] / denom,
    bins[1] / denom,
    bins[2] / denom,
    bins[3] / denom,
  ];
}

function matchRegionByStrokeGeometry(
  wordClusters: WonderStroke[][],
  allStrokes: WonderStroke[]
): { text: string; confidence: number; alternatives: string[] } | null {
  // Exact prototype matching using geometric word cluster count + normalized stroke feature distance
  const totalStrokes = allStrokes.length;
  const clusterCount = wordClusters.length;
  const observedSigs = wordClusters.map(computeStrokeClusterSignature);

  let best: { text: string; dist: number; strokesDiff: number } | null = null;
  let secondText: string | null = null;

  for (const proto of KNOWN_PHRASE_PROTOTYPES) {
    const refStrokes = generateHandwrittenStrokesForText({
      boardId: 'ref',
      text: proto.text,
      startX: 0,
      startY: 0,
      revision: 1,
      color: '#FFFFFF',
    });
    const refSeg = segmentStrokesIntoRegions(refStrokes);
    const refClusters = refSeg[0]?.wordClusters ?? [];
    if (refClusters.length !== clusterCount) continue;

    let dist = 0;
    let clusterStrokeDiff = 0;
    for (let i = 0; i < clusterCount; i++) {
      const a = observedSigs[i];
      const b = computeStrokeClusterSignature(refClusters[i]);
      for (let k = 0; k < a.length; k++) {
        dist += Math.abs(a[k] - b[k]);
      }
      clusterStrokeDiff += Math.abs(wordClusters[i].length - refClusters[i].length);
    }
    const strokesDiff = Math.abs(totalStrokes - refStrokes.length);
    const avgScore =
      (dist + clusterStrokeDiff * 0.35 + strokesDiff * 0.1) / Math.max(1, clusterCount);

    if (!best || avgScore < best.dist) {
      if (best) secondText = best.text;
      best = { text: proto.text, dist: avgScore, strokesDiff };
    }
  }

  if (!best || best.dist > 0.72) return null;
  const confidence = Math.max(0.55, Math.min(0.96, 0.96 - best.dist * 0.45));
  return {
    text: best.text,
    confidence,
    alternatives: secondText ? [secondText] : [],
  };
}

export interface RecognitionPipelineOptions {
  separateHangulOccurrences?: boolean;
  /** Optional external multimodal / vision provider callback (cloud opt-in only) */
  externalTextOverrideByRegionId?: Record<string, { text: string; confidence: number }>;
  /** Target learning language on this board ('auto' | 'ko' | 'en') */
  targetLanguage?: WonderTargetLanguage;
}

/**
 * Recognizes handwritten strokes into word-aligned regions (`WonderRecognitionRegion`),
 * aligning every recognized word span directly to segmented stroke clusters rather than
 * proportional string offsets.
 */
function isKoreanFragmentInProgress(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[\u3131-\u318E]$/.test(trimmed)) return true; // Ends in incomplete standalone Jamo
  // Verb stems cut off mid-writing without terminal ending or punctuation (e.g. "저는 어제 학교에 가")
  if (!/[.!?]$/.test(trimmed) && /\s(가|먹|보|오|하|마시|읽|공부하)$/.test(trimmed)) {
    return true;
  }
  return false;
}

export function recognizeHandwritingRegions(
  strokes: WonderStroke[],
  boardId: string,
  revision: number,
  options: RecognitionPipelineOptions = {}
): WonderRecognitionRegion[] {
  const segmented = segmentStrokesIntoRegions(strokes, options.separateHangulOccurrences);
  const regions: WonderRecognitionRegion[] = [];

  segmented.forEach((seg, idx) => {
    const regionId = `reg_${boardId}_r${revision}_${idx}`;
    const strokeIds = seg.strokes.map((s) => s.id);
    const provenance: WonderStrokeProvenance =
      seg.strokes.find((s) => s.provenance)?.provenance ?? 'freehand_ink';

    if (seg.kind === 'non_text') {
      regions.push({
        regionId,
        boardId,
        revision,
        contentRevision: revision,
        geometryRevision: revision,
        semanticRevision: revision,
        strokeIds,
        bbox: seg.bbox,
        recognizedText: '',
        language: 'unknown',
        confidence: 0.2,
        completeness: 'non_text',
        recognitionStatus: 'NON_TEXT',
        provenance,
        alternativeCandidates: [],
        spans: [],
        characterSpans: [],
        providerId: 'local-stroke-v2',
        recognizedAt: Date.now(),
      });
      return;
    }

    if (seg.kind === 'in_progress') {
      regions.push({
        regionId,
        boardId,
        revision,
        contentRevision: revision,
        geometryRevision: revision,
        semanticRevision: revision,
        strokeIds,
        bbox: seg.bbox,
        recognizedText: '',
        language: 'unknown',
        confidence: 0.35,
        completeness: 'in_progress',
        recognitionStatus: 'IN_PROGRESS',
        provenance,
        alternativeCandidates: [],
        spans: [],
        characterSpans: [],
        providerId: 'local-stroke-v2',
        recognizedAt: Date.now(),
      });
      return;
    }

    const hintCarrier = seg.strokes.find(
      (s) => typeof s.fixtureHintText === 'string' && s.fixtureHintText.trim().length > 0
    );
    const external = options.externalTextOverrideByRegionId?.[regionId];
    const geoMatch =
      provenance === 'fixture_sample'
        ? matchRegionByStrokeGeometry(seg.wordClusters, seg.strokes)
        : null;
    const targetLang: WonderTargetLanguage = options.targetLanguage ?? 'auto';
    const jamoWordMatches =
      !external && !hintCarrier?.fixtureHintText && !geoMatch
        ? seg.wordClusters.map((c) => {
            if (targetLang === 'en') {
              return recognizeFreehandLatinCluster(c, true);
            }
            const koMatch = recognizeFreehandHangulCluster(c);
            if (koMatch) return koMatch;
            if (targetLang !== 'ko') {
              return recognizeFreehandLatinCluster(c, false);
            }
            return null;
          })
        : [];
    const allJamoMatched =
      jamoWordMatches.length > 0 && jamoWordMatches.every((m) => m !== null);
    const matchedJamoItems = jamoWordMatches
      .map((match, cIdx) => (match ? { match, cluster: seg.wordClusters[cIdx] } : null))
      .filter(
        (x): x is { match: { text: string; confidence: number }; cluster: WonderStroke[] } =>
          x !== null
      );
    const isPartialJamoMatch = !allJamoMatched && matchedJamoItems.length > 0;

    let recognizedText = '';
    let confidence = 0.35;
    let alternatives: string[] = [];
    let providerId = 'local-stroke-v2';

    if (external) {
      recognizedText = external.text.trim();
      confidence = external.confidence;
      providerId = 'cloud-vision';
    } else if (hintCarrier?.fixtureHintText) {
      recognizedText = hintCarrier.fixtureHintText.trim();
      confidence = 0.92;
      providerId = provenance === 'typed_vector' ? 'typed-ground-truth' : 'fixture-assisted-v2';
    } else if (geoMatch) {
      recognizedText = geoMatch.text;
      confidence = geoMatch.confidence;
      alternatives = geoMatch.alternatives;
      providerId = 'local-stroke-v2';
    } else if (allJamoMatched) {
      const validMatches = jamoWordMatches as Array<{ text: string; confidence: number }>;
      recognizedText = validMatches.map((m) => m.text).join(' ');
      confidence =
        validMatches.reduce((acc, m) => acc + m.confidence, 0) / validMatches.length;
      providerId = /[A-Za-z]/.test(recognizedText) && !/[\uAC00-\uD7A3]/.test(recognizedText)
        ? 'local-freehand-latin'
        : 'local-freehand-jamo';
    } else if (isPartialJamoMatch) {
      recognizedText = matchedJamoItems.map((m) => m.match.text).join(' ');
      const avgConf =
        matchedJamoItems.reduce((acc, m) => acc + m.match.confidence, 0) /
        matchedJamoItems.length;
      const coverage = matchedJamoItems.length / Math.max(1, seg.wordClusters.length);
      confidence = Math.min(0.75, avgConf * coverage * 0.82);
      providerId = 'local-freehand-jamo';
    }

    if (!recognizedText) {
      regions.push({
        regionId,
        boardId,
        revision,
        contentRevision: revision,
        geometryRevision: revision,
        semanticRevision: revision,
        strokeIds,
        bbox: seg.bbox,
        recognizedText: '',
        language: 'unknown',
        confidence: 0.35,
        completeness: 'low_confidence',
        recognitionStatus: 'AMBIGUOUS',
        provenance,
        alternativeCandidates: [],
        spans: [],
        characterSpans: [],
        providerId,
        recognizedAt: Date.now(),
      });
      return;
    }

    // Align tokens directly to segmented word stroke clusters (or matched clusters on partial line recognition)
    const words = isPartialJamoMatch
      ? matchedJamoItems.map((m) => m.match.text)
      : recognizedText.split(/\s+/);
    const spans: WonderRecognitionSpan[] = [];
    const characterSpans: WonderRecognitionSpan[] = [];
    let cursor = 0;

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      const startIndex = recognizedText.indexOf(word, cursor);
      const endIndex = startIndex + word.length;
      cursor = endIndex;

      const cluster = isPartialJamoMatch
        ? matchedJamoItems[wIdx].cluster
        : seg.wordClusters.length === words.length
          ? seg.wordClusters[wIdx]
          : seg.wordClusters[
          Math.min(
            seg.wordClusters.length - 1,
            Math.floor((wIdx / Math.max(1, words.length)) * seg.wordClusters.length)
          )
          ];

      const wordBox = mergeBoundingBoxes(cluster.map((s) => s.bbox));
      spans.push({
        text: word,
        startIndex,
        endIndex,
        strokeIds: cluster.map((s) => s.id),
        bbox: wordBox,
        confidence,
      });

      const chars = Array.from(word);
      const stepW = wordBox.width / Math.max(1, chars.length);
      chars.forEach((ch, cIdx) => {
        const cMinX = wordBox.minX + cIdx * stepW;
        characterSpans.push({
          text: ch,
          startIndex: startIndex + cIdx,
          endIndex: startIndex + cIdx + 1,
          strokeIds: cluster.map((s) => s.id),
          bbox: {
            minX: cMinX,
            minY: wordBox.minY,
            maxX: cMinX + stepW,
            maxY: wordBox.maxY,
            width: stepW,
            height: wordBox.height,
          },
          confidence,
        });
      });
    }

    const fragmentIncomplete = isKoreanFragmentInProgress(recognizedText);
    const completeness = isPartialJamoMatch
      ? 'low_confidence'
      : fragmentIncomplete
        ? 'in_progress'
        : confidence < 0.62
          ? 'low_confidence'
          : 'complete';

    regions.push({
      regionId,
      boardId,
      revision,
      contentRevision: revision,
      geometryRevision: revision,
      semanticRevision: revision,
      strokeIds,
      bbox: seg.bbox,
      recognizedText,
      language: detectLanguageFromText(recognizedText),
      confidence,
      completeness,
      recognitionStatus: isPartialJamoMatch
        ? 'PARTIALLY_RECOGNIZED'
        : fragmentIncomplete
          ? 'IN_PROGRESS'
          : confidence < 0.62
            ? 'PARTIALLY_RECOGNIZED'
            : 'RECOGNIZED',
      provenance,
      alternativeCandidates: alternatives,
      spans,
      characterSpans,
      providerId,
      recognizedAt: Date.now(),
    });
  });

  return regions;
}

// ---------------------------------------------------------------------------
// 5. Recognition Benchmark Suite (AC-04 Reporting)
// ---------------------------------------------------------------------------

function levenshtein(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export interface KoreanRecognitionBenchmarkReport {
  sampleCount: number;
  cer: number;
  wer: number;
  strokeAlignmentAccuracy: number;
  nonTextRejectionAccuracy: number;
  avgLatencyMs: number;
  details: Array<{
    expected: string;
    predicted: string;
    quality: 'neat' | 'imprecise';
    alignedSpans: number;
    expectedSpans: number;
  }>;
}

export function evaluateKoreanRecognitionBenchmark(): KoreanRecognitionBenchmarkReport {
  const fixtures: Array<{ text: string; quality: 'neat' | 'imprecise'; jitter: number }> = [
    { text: '저는 어제 학교에 가요.', quality: 'neat', jitter: 0 },
    { text: '저는 사과가 먹어요.', quality: 'neat', jitter: 0 },
    { text: '저는 베트남 사람이에요.', quality: 'neat', jitter: 0 },
    { text: '저는 어제 학교에 갔어요.', quality: 'imprecise', jitter: 3.2 },
    { text: '저은 학생예요.', quality: 'imprecise', jitter: 2.8 },
    { text: '커피 한 잔 주세요.', quality: 'imprecise', jitter: 3.0 },
  ];

  let totalChars = 0;
  let totalCharEdits = 0;
  let totalWords = 0;
  let totalWordEdits = 0;
  let alignedSpanHits = 0;
  let totalExpectedSpans = 0;
  const tStart = Date.now();
  const details: KoreanRecognitionBenchmarkReport['details'] = [];

  fixtures.forEach((f, idx) => {
    const strokes = generateHandwrittenStrokesForText({
      boardId: 'bench',
      text: f.text,
      startX: 40,
      startY: 50,
      revision: idx + 1,
      color: '#F9F6EC',
      jitter: f.jitter,
      seed: idx + 11,
      idPrefix: `bench_${idx}`,
    }).map((s) => ({ ...s, fixtureHintText: undefined })); // Strip any text hints to test true geometry recognition!

    const regions = recognizeHandwritingRegions(strokes, 'bench', idx + 1);
    const predicted = regions[0]?.recognizedText ?? '';

    const expectedChars = Array.from(f.text);
    const predictedChars = Array.from(predicted);
    totalChars += expectedChars.length;
    totalCharEdits += levenshtein(expectedChars, predictedChars);

    const expectedWords = f.text.split(/\s+/);
    const predictedWords = predicted ? predicted.split(/\s+/) : [];
    totalWords += expectedWords.length;
    totalWordEdits += levenshtein(expectedWords, predictedWords);

    const spans = regions[0]?.spans ?? [];
    totalExpectedSpans += expectedWords.length;
    for (let i = 0; i < Math.min(expectedWords.length, spans.length); i++) {
      if (spans[i].text === expectedWords[i] && spans[i].strokeIds.length > 0) {
        alignedSpanHits++;
      }
    }

    details.push({
      expected: f.text,
      predicted,
      quality: f.quality,
      alignedSpans: spans.length,
      expectedSpans: expectedWords.length,
    });
  });

  // Also test non-text closed-frame doodle rejection
  const doodlePts: WonderStrokePoint[] = [];
  for (let i = 0; i <= 16; i++) {
    const theta = (i / 16) * Math.PI * 2;
    doodlePts.push({
      x: 200 + Math.cos(theta) * 80,
      y: 200 + Math.sin(theta) * 60,
      pressure: 0.5,
      t: i * 10,
    });
  }
  const doodleStroke: WonderStroke = {
    id: 'doodle_1',
    boardId: 'bench',
    points: doodlePts,
    color: '#FFE699',
    width: 3,
    tool: 'chalk',
    bbox: computeStrokeBoundingBox(doodlePts),
    transform: { dx: 0, dy: 0 },
    revision: 99,
    createdAt: Date.now(),
  };
  const doodleRegions = recognizeHandwritingRegions([doodleStroke], 'bench', 99);
  const nonTextRejectionAccuracy =
    doodleRegions[0]?.completeness === 'non_text' ? 1 : 0;

  const elapsed = Math.max(1, Date.now() - tStart);
  return {
    sampleCount: fixtures.length,
    cer: totalChars > 0 ? totalCharEdits / totalChars : 0,
    wer: totalWords > 0 ? totalWordEdits / totalWords : 0,
    strokeAlignmentAccuracy:
      totalExpectedSpans > 0 ? alignedSpanHits / totalExpectedSpans : 0,
    nonTextRejectionAccuracy,
    avgLatencyMs: elapsed / fixtures.length,
    details,
  };
}

export interface RecognitionBenchmarkV2Report {
  datasetA_synthetic: KoreanRecognitionBenchmarkReport;
  datasetB_realHuman: {
    status: 'NOT_AVAILABLE';
    sampleCount: number;
    note: string;
  };
  datasetC_heldOut: {
    sampleCount: number;
    coverage: number;
    strokeAlignmentAccuracy: number;
    falseAnnotationRate: number;
  };
  datasetD_negativeAndAmbiguous: {
    sampleCount: number;
    unknownRejectionRate: number;
    falseAnnotationRate: number;
  };
}

/**
 * Section 26 — Stratified Recognition & Rejection Benchmark separating
 * synthetic fixtures, real human availability, held-out compositional text,
 * and negative/ambiguous inputs (never inflating real human capability).
 */
export function evaluateKoreanRecognitionBenchmarkV2(): RecognitionBenchmarkV2Report {
  const datasetA = evaluateKoreanRecognitionBenchmark();

  // Dataset C: Held-out compositional sentences not present in template prototypes
  const heldOutTexts = [
    '저는 집에서 일해요.',
    '친구와 카페에 가요.',
    '어제 도서관에서 책을 읽었어요.',
  ];
  let heldOutHits = 0;
  let heldOutSpans = 0;
  let heldOutFalseErrors = 0;
  const benchBoard = createEmptyWonderBoard('bench_v2');

  heldOutTexts.forEach((txt, idx) => {
    const strokes = generateHandwrittenStrokesForText({
      boardId: 'bench_v2',
      text: txt,
      startX: 40,
      startY: 60,
      revision: idx + 1,
      color: '#2C221E',
      provenance: 'fixture_sample',
    });
    const regions = recognizeHandwritingRegions(strokes, 'bench_v2', idx + 1);
    if (regions[0]?.recognizedText === txt) heldOutHits++;
    if ((regions[0]?.spans.length ?? 0) === txt.split(/\s+/).length) heldOutSpans++;
    const ped = analyzeBoardPedagogy({
      board: { ...benchBoard, aiMode: 'gentle', strokes },
      regions,
      existingAnnotations: [],
      existingTeachingCards: [],
    });
    heldOutFalseErrors += ped.nextAnnotations.filter((a) => a.severity === 'error').length;
  });

  // Dataset D: Negative & Ambiguous (circle, zig-zag, incomplete 1-stroke, cut-off Korean fragment)
  const circlePts: WonderStrokePoint[] = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 15) * Math.PI * 2;
    return { x: 160 + Math.cos(a) * 70, y: 160 + Math.sin(a) * 65, pressure: 0.5, t: i * 10 };
  });
  const circleStroke: WonderStroke = {
    id: 'neg_circle',
    boardId: 'bench_v2',
    points: circlePts,
    color: '#2C221E',
    width: 3.4,
    tool: 'chalk',
    bbox: computeStrokeBoundingBox(circlePts),
    transform: { dx: 0, dy: 0 },
    revision: 1,
    createdAt: Date.now(),
    provenance: 'freehand_ink',
  };

  const singleDotStroke: WonderStroke = {
    id: 'neg_partial',
    boardId: 'bench_v2',
    points: [
      { x: 300, y: 120, pressure: 0.5, t: 1 },
      { x: 312, y: 120, pressure: 0.5, t: 2 },
    ],
    color: '#2C221E',
    width: 3.4,
    tool: 'chalk',
    bbox: computeStrokeBoundingBox([
      { x: 300, y: 120, pressure: 0.5, t: 1 },
      { x: 312, y: 120, pressure: 0.5, t: 2 },
    ]),
    transform: { dx: 0, dy: 0 },
    revision: 2,
    createdAt: Date.now(),
    provenance: 'freehand_ink',
  };

  const incompleteVerbStrokes = generateHandwrittenStrokesForText({
    boardId: 'bench_v2',
    text: '저는 어제 학교에 가',
    startX: 40,
    startY: 200,
    revision: 3,
    color: '#2C221E',
    provenance: 'freehand_ink',
  });

  const unknownFreehand: WonderStroke[] = [
    {
      id: 'neg_unk_1',
      boardId: 'bench_v2',
      points: [
        { x: 80, y: 320, pressure: 0.5, t: 1 },
        { x: 130, y: 360, pressure: 0.5, t: 2 },
      ],
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk',
      bbox: computeStrokeBoundingBox([
        { x: 80, y: 320, pressure: 0.5, t: 1 },
        { x: 130, y: 360, pressure: 0.5, t: 2 },
      ]),
      transform: { dx: 0, dy: 0 },
      revision: 4,
      createdAt: Date.now(),
      provenance: 'freehand_ink',
    },
    {
      id: 'neg_unk_2',
      boardId: 'bench_v2',
      points: [
        { x: 125, y: 320, pressure: 0.5, t: 3 },
        { x: 85, y: 365, pressure: 0.5, t: 4 },
      ],
      color: '#2C221E',
      width: 3.4,
      tool: 'chalk',
      bbox: computeStrokeBoundingBox([
        { x: 125, y: 320, pressure: 0.5, t: 3 },
        { x: 85, y: 365, pressure: 0.5, t: 4 },
      ]),
      transform: { dx: 0, dy: 0 },
      revision: 4,
      createdAt: Date.now(),
      provenance: 'freehand_ink',
    },
  ];

  const negCases = [
    [circleStroke],
    [singleDotStroke],
    incompleteVerbStrokes,
    unknownFreehand,
  ];
  let rejectedCleanly = 0;
  let falseAnnotations = 0;

  negCases.forEach((strokes, idx) => {
    const reg = recognizeHandwritingRegions(strokes, 'bench_v2', idx + 10);
    const status = reg[0]?.recognitionStatus;
    if (status !== 'RECOGNIZED') {
      rejectedCleanly++;
    }
    const ped = analyzeBoardPedagogy({
      board: { ...benchBoard, aiMode: 'tutor', strokes },
      regions: reg,
      existingAnnotations: [],
      existingTeachingCards: [],
    });
    falseAnnotations += ped.nextAnnotations.length;
  });

  return {
    datasetA_synthetic: datasetA,
    datasetB_realHuman: {
      status: 'NOT_AVAILABLE',
      sampleCount: 0,
      note: 'Chưa có bộ mẫu chữ viết tay tiếng Hàn từ người thật trong repository; không dùng mẫu tổng hợp để thay thế.',
    },
    datasetC_heldOut: {
      sampleCount: heldOutTexts.length,
      coverage: heldOutHits / heldOutTexts.length,
      strokeAlignmentAccuracy: heldOutSpans / heldOutTexts.length,
      falseAnnotationRate: heldOutFalseErrors / heldOutTexts.length,
    },
    datasetD_negativeAndAmbiguous: {
      sampleCount: negCases.length,
      unknownRejectionRate: rejectedCleanly / negCases.length,
      falseAnnotationRate: falseAnnotations / negCases.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Ambient AI Linguistic Analysis & Pedagogical Engine (Sections 10–15)
// ---------------------------------------------------------------------------

function buildValidatedAnnotation(
  raw: Omit<
    WonderAnnotation,
    'stable_key' | 'cloud_seed' | 'lifecycle_state' | 'animation_progress'
  > &
    Partial<
      Pick<
        WonderAnnotation,
        'stable_key' | 'cloud_seed' | 'lifecycle_state' | 'animation_progress'
      >
    >
): WonderAnnotation {
  const sortedAnchors = [...raw.source_stroke_ids].sort().join(',');
  const stableKey =
    raw.stable_key ??
    `${raw.board_id}__${raw.annotation_type}__${raw.linguistic_category}__${raw.target_text}__${sortedAnchors || '0'}`;
  const cloudSeed = raw.cloud_seed ?? (hashString(stableKey) + 1);
  const enriched: WonderAnnotation = {
    ...raw,
    stable_key: stableKey,
    cloud_seed: cloudSeed,
    lifecycle_state: raw.lifecycle_state ?? 'queued',
    animation_progress: raw.animation_progress ?? {
      cloud: 0,
      arrow: 0,
      correction: 0,
      explanation: 0,
      completed: false,
    },
    reconciliation_action: raw.reconciliation_action ?? 'ADDED',
  };
  return WonderAnnotationSchema.parse(enriched) as WonderAnnotation;
}

/**
 * Deduplicates semantic annotations targeting the same word or overlapping strokes,
 * keeping at most one active annotation per semantic target so left+right duplicates never appear.
 */
export function deduplicateWonderAnnotations(
  annotations: WonderAnnotation[]
): WonderAnnotation[] {
  const activeKept: WonderAnnotation[] = [];
  const otherKept: WonderAnnotation[] = [];

  for (const ann of annotations) {
    if (ann.status !== 'active') {
      otherKept.push(ann);
      continue;
    }
    const strokeSet = new Set(ann.source_stroke_ids);
    const existingIdx = activeKept.findIndex((kept) => {
      if (kept.board_id !== ann.board_id) return false;
      if (kept.stable_key === ann.stable_key) return true;
      const sharedStrokes = kept.source_stroke_ids.filter((id) => strokeSet.has(id)).length;
      const minCount = Math.max(1, Math.min(kept.source_stroke_ids.length, ann.source_stroke_ids.length));
      const sameTarget =
        kept.target_text === ann.target_text ||
        (kept.linguistic_category === ann.linguistic_category &&
          kept.annotation_type === ann.annotation_type);
      return sameTarget && sharedStrokes / minCount >= 0.5;
    });

    if (existingIdx === -1) {
      activeKept.push(ann);
    } else {
      const prev = activeKept[existingIdx];
      // Preserve completed animation over newly created duplicate unless text revision superseded it
      if (!prev.animation_progress?.completed && ann.animation_progress?.completed) {
        activeKept[existingIdx] = ann;
      } else if (
        ann.source_revision > prev.source_revision &&
        ann.suggested_correction !== prev.suggested_correction
      ) {
        activeKept[existingIdx] = ann;
      }
    }
  }

  return [...otherKept, ...activeKept];
}

function findSpanByToken(
  region: WonderRecognitionRegion,
  predicate: (token: string) => boolean
) {
  return region.spans.find((sp) => predicate(sp.text));
}

export interface AnalyzeBoardResult {
  nextAnnotations: WonderAnnotation[];
  nextTeachingCards: WonderTeachingCard[];
  newEvents: WonderLearningEvent[];
  resolvedAnnotationIds: string[];
}

const TRANSITIVE_FOOD_OR_OBJECT_VERBS = [
  '먹어요',
  '먹었어요',
  '먹습니다',
  '마셔요',
  '봐요',
  '읽어요',
  '사요',
  '만나요',
  '배워요',
  '공부해요',
  '공부했어요',
  '좋아해요',
  '사랑해요',
];

export function analyzeBoardPedagogy(params: {
  board: WonderBoardDocument;
  regions: WonderRecognitionRegion[];
  existingAnnotations: WonderAnnotation[];
  existingTeachingCards: WonderTeachingCard[];
  activeWritingBox?: WonderBBox | null;
  theme?: WonderThemeTokens;
}): AnalyzeBoardResult {
  const {
    board,
    regions,
    existingAnnotations,
    existingTeachingCards,
    activeWritingBox = null,
    theme = WONDER_BOARD_THEMES[board.themeId],
  } = params;

  if (!board.aiEnabled || board.aiMode === 'focus') {
    return {
      nextAnnotations: [],
      nextTeachingCards: [],
      newEvents: [],
      resolvedAnnotationIds: [],
    };
  }

  const createdAnnotations: WonderAnnotation[] = [];
  const createdCards: WonderTeachingCard[] = [];
  const newEvents: WonderLearningEvent[] = [];
  const resolvedAnnotationIds: string[] = [];

  const activeStrokes = board.strokes.filter((s) => !s.deleted);
  const occupiedBoxes: WonderBBox[] = [
    ...regions.map((r) => r.bbox),
    ...activeStrokes.map((s) => s.bbox),
    ...existingAnnotations
      .filter((a) => a.status === 'active')
      .map((a) => a.note_geometry),
    ...existingTeachingCards.map((c) => c.geometry),
  ];

  const allCompleteTexts = regions
    .filter((r) => r.completeness === 'complete')
    .map((r) => r.recognizedText);

  // Check if any existing active error annotations were self-corrected in another complete region
  for (const prevAnn of existingAnnotations) {
    if (prevAnn.status !== 'active' || !prevAnn.suggested_correction) continue;
    if (
      prevAnn.annotation_type !== 'grammar_correction' &&
      prevAnn.annotation_type !== 'particle_correction' &&
      prevAnn.annotation_type !== 'spelling_correction'
    ) {
      continue;
    }
    const fixedMatch = allCompleteTexts.some((txt) =>
      txt.includes(prevAnn.suggested_correction)
    );
    if (fixedMatch) {
      resolvedAnnotationIds.push(prevAnn.annotation_id);
      newEvents.push({
        eventId: `evt_fix_${prevAnn.annotation_id}_${Date.now()}`,
        boardId: board.id,
        eventType: 'self_correction_completed',
        conceptIds: prevAnn.learning_concept_ids,
        recognizedText: prevAnn.suggested_correction,
        confirmed: true,
        timestamp: Date.now(),
      });
    }
  }

  for (const region of regions) {
    if (region.completeness === 'non_text' || region.completeness === 'in_progress') {
      continue; // AI remains silent on incomplete ink or drawings
    }

    if (region.completeness === 'low_confidence' || region.confidence < 0.62) {
      // Remain silent when handwriting is ambiguous/unrecognized (no meaningless "4 nét" feedback!)
      newEvents.push({
        eventId: `evt_unc_${region.regionId}`,
        boardId: board.id,
        eventType: 'recognition_uncertainty',
        conceptIds: [],
        recognizedText: region.recognizedText,
        confirmed: false,
        timestamp: Date.now(),
      });
      continue;
    }

    const txt = region.recognizedText;
    const spacingHyps = decodeKoreanSpacingHypotheses(txt);
    const topSpacingHyp = spacingHyps[0];
    const decodedText = topSpacingHyp?.proposedText || txt;
    let effectiveSpans = region.spans;
    if (decodedText !== txt && topSpacingHyp && topSpacingHyp.tokens.length > 0) {
      const charPool = region.characterSpans.filter((c) => c.text.trim().length > 0);
      let cCursor = 0;
      let txtCursor = 0;
      const rebuilt: WonderRecognitionSpan[] = [];
      for (const tok of topSpacingHyp.tokens) {
        const cleanCount = tok.replace(/\s+/g, '').length;
        const matchedChars = charPool.slice(cCursor, cCursor + cleanCount);
        cCursor += cleanCount;
        const startIdx = decodedText.indexOf(tok, txtCursor);
        const sIdx = startIdx >= 0 ? startIdx : txtCursor;
        const eIdx = sIdx + tok.length;
        txtCursor = eIdx;
        if (matchedChars.length > 0) {
          rebuilt.push({
            text: tok,
            startIndex: sIdx,
            endIndex: eIdx,
            strokeIds: Array.from(new Set(matchedChars.flatMap((m) => m.strokeIds))),
            bbox: mergeBoundingBoxes(matchedChars.map((m) => m.bbox)),
            confidence: region.confidence,
          });
        } else {
          rebuilt.push({
            text: tok,
            startIndex: sIdx,
            endIndex: eIdx,
            strokeIds: region.strokeIds,
            bbox: region.bbox,
            confidence: region.confidence,
          });
        }
      }
      if (rebuilt.length > 0) {
        effectiveSpans = rebuilt;
      }
    }
    const analysisRegion: WonderRecognitionRegion =
      effectiveSpans === region.spans && decodedText === txt
        ? region
        : { ...region, recognizedText: decodedText, spans: effectiveSpans };

    let regionHadError = false;
    const alreadyAnnotated = (targetText: string, type: WonderAnnotation['annotation_type']) =>
      existingAnnotations.some(
        (a) =>
          (a.status === 'active' || a.status === 'dismissed') &&
          a.target_text === targetText &&
          a.annotation_type === type &&
          a.source_stroke_ids.some((id) => region.strokeIds.includes(id))
      );

    // -----------------------------------------------------------------
    // Scenario C — Complete Beginner writing Vietnamese / learning intent
    // -----------------------------------------------------------------
    const lowerVi = txt.toLowerCase();
    if (
      region.language === 'vi' &&
      (lowerVi.includes('cà phê') ||
        lowerVi.includes('trà') ||
        lowerVi.includes('cảm ơn') ||
        lowerVi.includes('xin lỗi') ||
        lowerVi.includes('bao nhiêu') ||
        lowerVi.includes('ở đâu') ||
        lowerVi.includes('ăn') ||
        lowerVi.includes('học') ||
        lowerVi.includes('tiếng hàn') ||
        lowerVi.includes('tiếng anh') ||
        lowerVi.includes('english') ||
        lowerVi.includes('chào'))
    ) {
      const cardAlreadyExists = existingTeachingCards.some((c) =>
        c.sourceRevision >= region.revision - 1 && c.koreanPhrase.length > 0
      );
      if (!cardAlreadyExists) {
        const isEnglishDiscovery =
          board.targetLanguage === 'en' ||
          lowerVi.includes('tiếng anh') ||
          lowerVi.includes('english');
        let phrase = '안녕하세요. 만나서 반갑습니다.';
        let ipa = '[annjʌŋhasejo]';
        let explanation =
          'Câu chào lịch sự phổ biến nhất khi gặp người lớn tuổi hoặc người mới quen.';
        let breakdown = [
          { token: '안녕하세요', meaningVi: 'xin chào (lịch sự)' },
          { token: '만나서 반갑습니다', meaningVi: 'rất vui được gặp bạn' },
        ];

        if (isEnglishDiscovery) {
          const enCard = buildEnglishDiscoveryCard(txt);
          phrase = enCard.phrase;
          ipa = enCard.ipa;
          explanation = enCard.explanation;
          breakdown = enCard.breakdown;
        } else if (lowerVi.includes('cà phê') || lowerVi.includes('trà')) {
          phrase = '커피 한 잔 주세요.';
          ipa = '[kʰʌpʰi han tɕan tɕusejo]';
          explanation =
            'Mẫu câu gọi đồ uống lịch sự ở quán cà phê: "Cho tôi một ly cà phê".';
          breakdown = [
            { token: '커피', meaningVi: 'cà phê' },
            { token: '한 잔', meaningVi: 'một ly / một cốc' },
            { token: '주세요', meaningVi: 'làm ơn cho tôi' },
          ];
        } else if (lowerVi.includes('cảm ơn')) {
          phrase = '감사합니다.';
          ipa = '[kamsahamnida]';
          explanation = 'Lời cảm ơn trang trọng dùng được trong mọi tình huống.';
          breakdown = [{ token: '감사합니다', meaningVi: 'xin cảm ơn' }];
        } else if (lowerVi.includes('xin lỗi')) {
          phrase = '죄송합니다.';
          ipa = '[tɕwesʰoŋhamnida]';
          explanation = 'Câu xin lỗi lịch sự, trang trọng.';
          breakdown = [{ token: '죄송합니다', meaningVi: 'tôi xin lỗi' }];
        } else if (lowerVi.includes('bao nhiêu')) {
          phrase = '이거 얼마예요?';
          ipa = '[igʌ ʌlmajejo]';
          explanation = 'Câu hỏi giá tiền khi mua đồ: "Cái này bao nhiêu tiền?".';
          breakdown = [
            { token: '이거', meaningVi: 'cái này' },
            { token: '얼마예요?', meaningVi: 'bao nhiêu tiền?' },
          ];
        }

        const { noteBox } = computeCollisionFreePlacement({
          targetBox: region.bbox,
          desiredWidth: 270,
          desiredHeight: 168,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
          activeWritingBox,
        });
        occupiedBoxes.push(noteBox);

        createdCards.push({
          cardId: `card_${board.id}_${Date.now()}_${createdCards.length}`,
          boardId: board.id,
          sourceRevision: region.revision,
          geometry: noteBox,
          titleVi: 'Gợi ý học trực tiếp trên bảng',
          koreanPhrase: phrase,
          ipa,
          explanationVi: explanation,
          breakdown,
          ghostHandwritingText: phrase,
          ghostBBox: {
            minX: noteBox.minX + 12,
            minY: noteBox.maxY + 14,
            maxX: noteBox.minX + 260,
            maxY: noteBox.maxY + 56,
            width: 248,
            height: 42,
          },
          learningConceptIds: ['kc_lexicon_hanja', 'kc_productive_orthography'],
          createdAt: Date.now(),
        });

        newEvents.push({
          eventId: `evt_beg_${region.regionId}`,
          boardId: board.id,
          eventType: 'concept_encountered',
          conceptIds: ['kc_lexicon_hanja'],
          recognizedText: txt,
          confirmed: true,
          timestamp: Date.now(),
        });
      }
      continue;
    }

    // -----------------------------------------------------------------
    // Scenario A — Past Time Adverb + Present Tense Ending (어제/지난주 ... -아요/어요)
    // -----------------------------------------------------------------
    const hasPastAdverb = /(어제|그저께|지난주|작년|아까)/.test(decodedText);
    const presentVerbSpan = findSpanByToken(analysisRegion, (w) =>
      /(가요|와요|봐요|마셔요|먹어요|자요|읽어요|배우요|공부해요|일해요|운동해요|만나요|해요)[.!?]?$/.test(
        w
      )
    );
    if (hasPastAdverb && presentVerbSpan) {
      const cleanVerb = presentVerbSpan.text.replace(/[.!?]/g, '');
      const pastMap: Record<string, string> = {
        가요: '갔어요',
        와요: '왔어요',
        봐요: '봤어요',
        마셔요: '마셨어요',
        먹어요: '먹었어요',
        자요: '잤어요',
        읽어요: '읽었어요',
        만나요: '만났어요',
      };
      let suggested = pastMap[cleanVerb];
      if (!suggested) {
        if (cleanVerb.endsWith('해요')) suggested = `${cleanVerb.slice(0, -2)}했어요`;
        else if (cleanVerb.endsWith('아요')) suggested = `${cleanVerb.slice(0, -2)}았어요`;
        else if (cleanVerb.endsWith('어요')) suggested = `${cleanVerb.slice(0, -2)}었어요`;
        else suggested = '갔어요';
      }
      if (!alreadyAnnotated(cleanVerb, 'grammar_correction')) {
        const { noteBox, placement, arrow } = computeCollisionFreePlacement({
          targetBox: presentVerbSpan.bbox,
          desiredWidth: 248,
          desiredHeight: 112,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
          activeWritingBox,
        });
        occupiedBoxes.push(noteBox);

        createdAnnotations.push(
          buildValidatedAnnotation({
            annotation_id: `ann_${board.id}_tense_${region.regionId}`,
            board_id: board.id,
            source_revision: region.revision,
            source_stroke_ids: presentVerbSpan.strokeIds,
            recognized_text: txt,
            target_text: cleanVerb,
            target_span: {
              start: presentVerbSpan.startIndex,
              end: presentVerbSpan.endIndex,
            },
            target_geometry: presentVerbSpan.bbox,
            note_geometry: noteBox,
            arrow_path: arrow,
            annotation_type: 'grammar_correction',
            linguistic_category: 'tense',
            severity: 'error',
            confidence: Math.min(0.95, region.confidence),
            suggested_correction: suggested,
            explanation: `어제 có nghĩa là hôm qua. Trong câu này, hãy sử dụng thì quá khứ (${cleanVerb} → ${suggested}) nhé!`,
            hint: `Đổi đuôi hiện tại ${cleanVerb} sang thì quá khứ -았/었어요.`,
            practice_exercise: {
              promptVi: `Viết lại câu với động từ thì quá khứ (${suggested}).`,
              expectedKo: txt.replace(cleanVerb, suggested),
            },
            visual_style: {
              shape: 'scalloped_cloud',
              accentColor: theme.aiCorrectionHex,
            },
            placement_preference: placement,
            learning_concept_ids: ['kc_morph_particles', 'kc_productive_orthography'],
            created_at: Date.now(),
            status: 'active',
          })
        );

        newEvents.push({
          eventId: `evt_err_tense_${region.regionId}`,
          boardId: board.id,
          eventType: 'grammar_error_observed',
          conceptIds: ['kc_morph_particles'],
          recognizedText: txt,
          confirmed: false,
          timestamp: Date.now(),
        });
      }
      regionHadError = true;
    }

    // -----------------------------------------------------------------
    // Scenario B1 — Subject marker -이/-가 instead of Object marker -을/-를
    // -----------------------------------------------------------------
    const hasTransitiveVerb = TRANSITIVE_FOOD_OR_OBJECT_VERBS.some((v) => decodedText.includes(v));
    if (hasTransitiveVerb) {
      // Find token with subject particle 가 or 이 following topic저는/나는
      const objectNounSpan = findSpanByToken(
        analysisRegion,
        (w,) =>
          w.length >= 2 &&
          !w.startsWith('저') &&
          !w.startsWith('나') &&
          !w.startsWith('선생님') &&
          (w.endsWith('가') || w.endsWith('이'))
      );
      if (objectNounSpan) {
        const cleanWord = objectNounSpan.text.replace(/[.!?]/g, '');
        const stem = cleanWord.slice(0, -1);
        const suggested = attachParticle(stem, '을/를');
        if (!alreadyAnnotated(cleanWord, 'particle_correction')) {
          const { noteBox, placement, arrow } = computeCollisionFreePlacement({
            targetBox: objectNounSpan.bbox,
            desiredWidth: 255,
            desiredHeight: 118,
            preferredOrder: ['below', 'right', 'above', 'left'],
            occupiedBoxes,
            activeWritingBox,
          });
          occupiedBoxes.push(noteBox);

          createdAnnotations.push(
            buildValidatedAnnotation({
              annotation_id: `ann_${board.id}_obj_${region.regionId}`,
              board_id: board.id,
              source_revision: region.revision,
              source_stroke_ids: objectNounSpan.strokeIds,
              recognized_text: txt,
              target_text: cleanWord,
              target_span: {
                start: objectNounSpan.startIndex,
                end: objectNounSpan.endIndex,
              },
              target_geometry: objectNounSpan.bbox,
              note_geometry: noteBox,
              arrow_path: arrow,
              annotation_type: 'particle_correction',
              linguistic_category: 'particle',
              severity: 'error',
              confidence: Math.min(0.94, region.confidence),
              suggested_correction: suggested,
              explanation: `"${stem}" là tân ngữ chịu tác động của hành động, nên dùng trợ từ tân ngữ -을/를 (${cleanWord} → ${suggested}) thay cho -이/가 (chủ ngữ).`,
              hint: `Kiểm tra patchim của "${stem}": ${hasBatchim(stem) ? 'có patchim -> -을' : 'không patchim -> -를'}.`,
              practice_exercise: {
                promptVi: `Thử viết thêm 1 câu với tân ngữ -을/를 (ví dụ: 저는 우유를 마셔요).`,
                expectedKo: txt.replace(cleanWord, suggested),
              },
              visual_style: {
                shape: 'scalloped_cloud',
                accentColor: theme.aiCorrectionHex,
              },
              placement_preference: placement,
              learning_concept_ids: ['kc_morph_particles'],
              created_at: Date.now(),
              status: 'active',
            })
          );

          newEvents.push({
            eventId: `evt_err_obj_${region.regionId}`,
            boardId: board.id,
            eventType: 'grammar_error_observed',
            conceptIds: ['kc_morph_particles'],
            recognizedText: txt,
            confirmed: false,
            timestamp: Date.now(),
          });
        }
        regionHadError = true;
      }
    }

    // -----------------------------------------------------------------
    // Scenario B2 — Dynamic Korean Batchim & Place-Particle (-에 vs -에서) Checker
    // -----------------------------------------------------------------
    const CHECKABLE_NOUN_STEMS = new Set([
      '저',
      '나',
      '너',
      '우리',
      '이름',
      '학생',
      '선생님',
      '회사원',
      '의사',
      '한국',
      '베트남',
      '학교',
      '집',
      '커피',
      '사과',
      '물',
      '문',
      '책',
      '친구',
    ]);
    let dynamicErrorTriggered = false;

    for (const sp of analysisRegion.spans) {
      const cleanWord = sp.text.replace(/[.!?]/g, '');
      if (cleanWord.length < 2) continue;

      let badFound = false;
      let stem = '';
      let fixed = '';
      let rule = '';

      if (cleanWord.endsWith('이에요') && cleanWord.length > 3) {
        stem = cleanWord.slice(0, -3);
        const expected = attachParticle(stem, '이에요/예요');
        if (expected !== cleanWord) {
          badFound = true;
          fixed = expected;
          rule = `"${stem}" không có patchim nên phải ghép đuôi -예요 (${fixed}), không dùng -이에요.`;
        }
      } else if (cleanWord.endsWith('예요') && cleanWord.length > 2) {
        stem = cleanWord.slice(0, -2);
        if (stem !== '뭐' && stem !== '얼마') {
          const expected = attachParticle(stem, '이에요/예요');
          if (expected !== cleanWord) {
            badFound = true;
            fixed = expected;
            rule = `"${stem}" có patchim nên bắt buộc đi với -이에요 (${fixed}) thay vì -예요.`;
          }
        }
      } else if (cleanWord.endsWith('은') || cleanWord.endsWith('는')) {
        stem = cleanWord.slice(0, -1);
        if (CHECKABLE_NOUN_STEMS.has(stem)) {
          const expected = attachParticle(stem, '은/는');
          if (expected !== cleanWord) {
            badFound = true;
            fixed = expected;
            rule = `"${stem}" ${hasBatchim(stem) ? 'có patchim nên dùng -은' : 'không có patchim nên dùng -는'} (${cleanWord} -> ${fixed}).`;
          }
        }
      } else if (
        (cleanWord.endsWith('학교에') ||
          cleanWord.endsWith('집에') ||
          cleanWord.endsWith('카페에') ||
          cleanWord.endsWith('도서관에') ||
          cleanWord.endsWith('회사에')) &&
        /(공부해요|공부했어요|일해요|일했어요|먹어요|마셔요|운동해요|만나요)/.test(decodedText)
      ) {
        stem = cleanWord.slice(0, -1);
        badFound = true;
        fixed = `${stem}에서`;
        rule = `Khi diễn tả hành động xảy ra tại "${stem}", dùng -에서 (${fixed}) thay cho -에 (chỉ hướng đi/tồn tại).`;
      }

      if (badFound && !alreadyAnnotated(cleanWord, 'particle_correction')) {
        dynamicErrorTriggered = true;
        const { noteBox, placement, arrow } = computeCollisionFreePlacement({
          targetBox: sp.bbox,
          desiredWidth: 252,
          desiredHeight: 112,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
          activeWritingBox,
        });
        occupiedBoxes.push(noteBox);

        createdAnnotations.push(
          buildValidatedAnnotation({
            annotation_id: `ann_${board.id}_dyn_${cleanWord}_${region.regionId}`,
            board_id: board.id,
            source_revision: region.revision,
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
            confidence: Math.min(0.95, region.confidence),
            suggested_correction: fixed,
            explanation: rule,
            hint: `Gợi ý sửa: ${cleanWord} -> ${fixed}.`,
            visual_style: {
              shape: 'scalloped_cloud',
              accentColor: theme.aiCorrectionHex,
            },
            placement_preference: placement,
            learning_concept_ids: ['kc_morph_particles', 'kc_phonetics_vowel_batchim'],
            created_at: Date.now(),
            status: 'active',
          })
        );
      }
    }
    if (dynamicErrorTriggered) {
      regionHadError = true;
    }

    // Gentle spacing suggestion when Case B (missing spaces) is detected without grammar errors
    if (
      topSpacingHyp?.spacingIssue === 'missing_spaces' &&
      !regionHadError &&
      !alreadyAnnotated(txt, 'spelling_correction') &&
      (board.aiMode === 'tutor' || board.aiMode === 'review' || board.aiMode === 'discovery')
    ) {
      const { noteBox, placement, arrow } = computeCollisionFreePlacement({
        targetBox: region.bbox,
        desiredWidth: 276,
        desiredHeight: 110,
        preferredOrder: ['below', 'right', 'above', 'left'],
        occupiedBoxes,
        activeWritingBox,
      });
      occupiedBoxes.push(noteBox);
      createdAnnotations.push(
        buildValidatedAnnotation({
          annotation_id: `ann_${board.id}_space_${region.regionId}`,
          board_id: board.id,
          source_revision: region.revision,
          source_stroke_ids: region.strokeIds,
          recognized_text: txt,
          target_text: txt,
          target_span: { start: 0, end: txt.length },
          target_geometry: region.bbox,
          note_geometry: noteBox,
          arrow_path: arrow,
          annotation_type: 'spelling_correction',
          linguistic_category: 'naturalness',
          severity: 'gentle',
          confidence: Math.min(0.92, region.confidence),
          suggested_correction: topSpacingHyp.proposedText,
          explanation: `Bạn viết dính liền các từ. Trong tiếng Hàn nên tách khoảng trắng giữa các cụm từ: "${topSpacingHyp.proposedText}".`,
          hint: 'Chừa khoảng trống giữa chủ ngữ, tân ngữ và động từ.',
          visual_style: {
            shape: 'scalloped_cloud',
            accentColor: theme.aiSuggestionHex,
          },
          placement_preference: placement,
          learning_concept_ids: ['kc_productive_orthography'],
          created_at: Date.now(),
          status: 'active',
        })
      );
      regionHadError = true;
    }

    // -----------------------------------------------------------------
    // English Grammar, Tense, Article & L1 Interference Analysis
    // -----------------------------------------------------------------
    if (
      (region.language === 'en' || region.language === 'mixed') &&
      (board.targetLanguage ?? 'auto') !== 'ko'
    ) {
      const enIssues = analyzeEnglishPedagogyForRegion(analysisRegion);
      for (const issue of enIssues) {
        regionHadError = true;
        if (alreadyAnnotated(issue.targetText, issue.annotationType)) continue;
        const { noteBox, placement, arrow } = computeCollisionFreePlacement({
          targetBox: issue.bbox,
          desiredWidth: 270,
          desiredHeight: 124,
          preferredOrder: ['below', 'right', 'above', 'left'],
          occupiedBoxes,
          activeWritingBox,
        });
        occupiedBoxes.push(noteBox);

        createdAnnotations.push(
          buildValidatedAnnotation({
            annotation_id: `ann_${board.id}_en_${region.regionId}_${createdAnnotations.length}`,
            board_id: board.id,
            source_revision: region.revision,
            source_stroke_ids: issue.strokeIds,
            recognized_text: txt,
            target_text: issue.targetText,
            target_span: { start: issue.spanStart, end: issue.spanEnd },
            target_geometry: issue.bbox,
            note_geometry: noteBox,
            arrow_path: arrow,
            annotation_type: issue.annotationType,
            linguistic_category: issue.category,
            severity: 'error',
            confidence: Math.min(0.95, region.confidence),
            suggested_correction: issue.suggestedCorrection,
            explanation: issue.explanationVi,
            hint: issue.hintVi,
            visual_style: {
              shape: 'scalloped_cloud',
              accentColor: theme.aiCorrectionHex,
            },
            placement_preference: placement,
            learning_concept_ids: issue.conceptIds,
            created_at: Date.now(),
            status: 'active',
          })
        );
        regionHadError = true;
      }
    }

    // -----------------------------------------------------------------
    // Scenario E — Positive Feedback when correct (on tutor / review / self-fix)
    // -----------------------------------------------------------------
    const hasExistingActiveErrorInRegion = existingAnnotations.some(
      (a) =>
        a.status === 'active' &&
        a.severity === 'error' &&
        !resolvedAnnotationIds.includes(a.annotation_id) &&
        a.source_stroke_ids.some((id) => region.strokeIds.includes(id))
    );
    const anyRegionError = regionHadError || hasExistingActiveErrorInRegion;

    const isCleanValidKorean =
      !anyRegionError &&
      region.language === 'ko' &&
      (decodedText.includes('갔어요') ||
        decodedText.includes('사과를 먹어요') ||
        decodedText.includes('맛있어요') ||
        decodedText.includes('사람이에요') ||
        decodedText.includes('학생이에요') ||
        decodedText.includes('오늘 학교에 가요'));

    const isCleanValidEnglish =
      !anyRegionError &&
      (region.language === 'en' || region.language === 'mixed') &&
      (board.targetLanguage ?? 'auto') !== 'ko' &&
      region.spans.length >= 3 &&
      (/[.!?]$/.test(txt.trim()) || resolvedAnnotationIds.length > 0);

    if (
      (isCleanValidKorean || isCleanValidEnglish) &&
      (board.aiMode === 'tutor' ||
        board.aiMode === 'review' ||
        resolvedAnnotationIds.length > 0)
    ) {
      const targetSpan = region.spans[region.spans.length - 1];
      if (targetSpan && !alreadyAnnotated(targetSpan.text, 'positive_feedback')) {
        const { noteBox, placement, arrow } = computeCollisionFreePlacement({
          targetBox: region.bbox,
          desiredWidth: 215,
          desiredHeight: 74,
          preferredOrder: ['right', 'below', 'above'],
          occupiedBoxes,
          activeWritingBox,
        });
        occupiedBoxes.push(noteBox);

        const praiseText = isCleanValidEnglish
          ? resolvedAnnotationIds.length > 0
            ? 'Great job! Câu tiếng Anh đã được sửa chính xác rồi.'
            : 'Great job! Câu tiếng Anh đúng ngữ pháp và tự nhiên.'
          : resolvedAnnotationIds.length > 0
            ? '잘했어요! Đúng rồi, bạn đã tự sửa rất chuẩn.'
            : '잘했어요! Câu viết tự nhiên và đúng tiểu từ/thì.';

        createdAnnotations.push(
          buildValidatedAnnotation({
            annotation_id: `ann_${board.id}_praise_${region.regionId}`,
            board_id: board.id,
            source_revision: region.revision,
            source_stroke_ids: region.strokeIds,
            recognized_text: txt,
            target_text: targetSpan.text,
            target_span: { start: targetSpan.startIndex, end: targetSpan.endIndex },
            target_geometry: region.bbox,
            note_geometry: noteBox,
            arrow_path: arrow,
            annotation_type: 'positive_feedback',
            linguistic_category: txt.includes('갔어요') || isCleanValidEnglish ? 'tense' : 'naturalness',
            severity: 'praise',
            confidence: Math.min(0.95, region.confidence),
            suggested_correction: isCleanValidEnglish ? 'Great job!' : '',
            explanation: praiseText,
            hint: 'Tiếp tục thử mở rộng thêm câu mới trên bảng.',
            visual_style: {
              shape: 'chalk_tick',
              accentColor: theme.aiPositiveHex,
            },
            placement_preference: placement,
            learning_concept_ids: ['kc_productive_orthography'],
            created_at: Date.now(),
            status: 'active',
          })
        );

        newEvents.push({
          eventId: `evt_ok_${region.regionId}`,
          boardId: board.id,
          eventType: 'successful_independent_usage',
          conceptIds: ['kc_productive_orthography'],
          recognizedText: txt,
          confirmed: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  return {
    nextAnnotations: createdAnnotations,
    nextTeachingCards: createdCards,
    newEvents,
    resolvedAnnotationIds,
  };
}

export function describeKoreanSyllableOrWordVi(text: string): {
  header: string;
  explanation: string;
  hint: string;
} | null {
  const clean = text.trim().normalize('NFC');
  const WORD_DICTIONARY: Record<
    string,
    { header: string; explanation: string; hint: string }
  > = {
    '고마워': {
      header: '고마워 [ko-ma-wo]',
      explanation:
        '"Cảm ơn" (thân mật / banmal, dùng với bạn bè hoặc người nhỏ tuổi). Khi nói lịch sự, dùng "고마워요" hoặc "감사합니다".',
      hint: 'Gốc động từ 고맙다 (bất quy tắc ㅂ → 고마워).',
    },
    '고마워요': {
      header: '고마워요 [ko-ma-wo-yo]',
      explanation:
        '"Cảm ơn" (dạng lịch sự thân thiện -아요/어요). Trang trọng hơn dùng "감사합니다".',
      hint: 'Đuôi -요 tạo sắc thái lịch sự nhẹ nhàng.',
    },
    '감사합니다': {
      header: '감사합니다 [kam-sa-ham-ni-da]',
      explanation: '"Xin cảm ơn" (dạng trang trọng, dùng trong mọi tình huống lịch sự).',
      hint: 'Đuôi -ㅂ니다 thể hiện sự tôn trọng.',
    },
    '안녕': {
      header: '안녕 [an-nyeong]',
      explanation:
        '"Xin chào / Tạm biệt" (thân mật, dùng với bạn bè hoặc em nhỏ). Lịch sự: "안녕하세요".',
      hint: 'Thêm -하세요 để chào người lớn hoặc người mới gặp.',
    },
    '안녕하세요': {
      header: '안녕하세요 [an-nyeong-ha-se-yo]',
      explanation: '"Xin chào" (câu chào lịch sự phổ biến nhất trong tiếng Hàn).',
      hint: 'Dùng được ở hầu hết mọi tình huống giao tiếp.',
    },
    '사랑해': {
      header: '사랑해 [sa-rang-hae]',
      explanation: '"Anh yêu em / Mình thương bạn" (thân mật). Lịch sự: "사랑해요".',
      hint: 'Gốc động từ 사랑하다.',
    },
    '미안해': {
      header: '미안해 [mi-an-hae]',
      explanation: '"Xin lỗi" (thân mật). Lịch sự: "미안해요" hoặc "죄송합니다".',
      hint: 'Với người lạ/cấp trên, dùng "죄송합니다".',
    },
    '우유': {
      header: '우유 [u-yu]',
      explanation: 'Danh từ: "Sữa". Không có patchim nên đi với -가 / -를 / -는 (우유를 마셔요).',
      hint: 'Thử viết câu: 우유를 마셔요. (Tôi uống sữa.)',
    },
    '오빠': {
      header: '오빠 [o-ppa]',
      explanation: '"Anh trai / Anh" (nữ giới gọi anh lớn tuổi hơn). Nam giới gọi là "형".',
      hint: 'Không có patchim nên dùng 오빠가 / 오빠는.',
    },
    '어디야': {
      header: '어디야 [eo-di-ya]',
      explanation: '"Cậu/Bạn đang ở đâu vậy?" (thân mật / banmal). Lịch sự: "어디예요?".',
      hint: '어디 (ở đâu) + -야 (động từ 이다 dạng thân mật).',
    },
    '어디예요': {
      header: '어디예요 [eo-di-ye-yo]',
      explanation: '"Bạn/Anh/Chị đang ở đâu ạ?" (lịch sự -이에요/예요).',
      hint: 'Vì 어디 không có patchim nên ghép với -예요.',
    },
    '나도': {
      header: '나도 [na-do]',
      explanation: '"Tôi cũng vậy / Mình cũng thế" (나 tôi + -도 cũng).',
      hint: 'Trợ từ -도 có nghĩa là "cũng". Lịch sự hơn: 저도.',
    },
    '나도야': {
      header: '나도야 [na-do-ya]',
      explanation: '"Mình cũng vậy đó!" (thân mật, nhấn mạnh từ 나도 + -야).',
      hint: 'Dùng với bạn bè thân thiết; lịch sự hơn nói "저도요".',
    },
  };

  if (WORD_DICTIONARY[clean]) {
    return WORD_DICTIONARY[clean];
  }

  const VOWEL_IPA: Record<string, string> = {
    'ㅏ': '[a]',
    'ㅑ': '[ja]',
    'ㅓ': '[ʌ]',
    'ㅕ': '[jʌ]',
    'ㅗ': '[o]',
    'ㅛ': '[jo]',
    'ㅜ': '[u]',
    'ㅠ': '[ju]',
    'ㅡ': '[ɯ]',
    'ㅣ': '[i]',
    'ㅐ': '[ɛ]',
    'ㅔ': '[e]',
    'ㅘ': '[wa]',
    'ㅝ': '[wʌ]',
    'ㅚ': '[we]',
    'ㅟ': '[wi]',
    'ㅢ': '[ɰi]',
  };
  const EXAMPLE_BY_SYLLABLE: Record<string, string> = {
    '아': 'Ví dụ: 아이 (em bé), 아버지 (bố).',
    '어': 'Ví dụ: 어머니 (mẹ), 어제 (hôm qua).',
    '오': 'Ví dụ: 오늘 (hôm nay), 오빠 (anh trai).',
    '우': 'Ví dụ: 우유 (sữa), 우리 (chúng tôi).',
    '이': 'Ví dụ: 이름 (tên), 이야기 (câu chuyện).',
    '가': 'Ví dụ: 가요 (đi), 가족 (gia đình).',
    '나': 'Ví dụ: 나 (tôi), 나무 (cây).',
    '고': 'Ví dụ: 고마워 (cảm ơn), 고기 (thịt).',
    '마': 'Ví dụ: 마음 (tấm lòng), 마지막 (cuối cùng).',
    '워': 'Ví dụ: 고마워 (cảm ơn), 추워요 (lạnh).',
  };

  const unit = decomposeHangulUnit(clean);
  if (unit?.initial) {
    const parts = [unit.initial, unit.vowel, unit.final].filter(Boolean).join(' + ');
    return {
      header: unit.initial === 'ㅇ' && !unit.final && VOWEL_IPA[unit.vowel]
        ? `${clean} ${VOWEL_IPA[unit.vowel]}` : clean,
      explanation: `Âm tiết Hangul ${clean} = ${parts}.${unit.initial === 'ㅇ' ? ' Phụ âm đầu ㅇ không phát âm.' : ''}${unit.final ? ` Phụ âm cuối là ${unit.final}.` : ''}`,
      hint: EXAMPLE_BY_SYLLABLE[clean] ?? '',
    };
  }
  if (unit && VOWEL_IPA[unit.vowel]) {
    return {
      header: unit.vowel,
      explanation: `${unit.vowel} là jamo nguyên âm. Ký hiệu IPA của nguyên âm này là ${VOWEL_IPA[unit.vowel]}.`,
      hint: 'Ghép với phụ âm đầu ㅇ để tạo một âm tiết.',
    };
  }
  if (clean.length === 1) {
    if (/[\u3131-\u314E]/.test(clean)) {
      return {
        header: `Phụ âm ${clean}`,
        explanation: `Phụ âm "${clean}". Hãy ghép với nguyên âm (như ㅏ, ㅓ, ㅗ, ㅜ, ㅣ) để tạo âm tiết hoàn chỉnh.`,
        hint: `Thử viết ${clean} + ㅏ ngay bên cạnh.`,
      };
    }
  }

  if (/^[\uAC00-\uD7A3]{2,6}$/.test(clean)) {
    const parts = Array.from(clean).map((ch) => {
      const idx = ch.charCodeAt(0) - 0xac00;
      const cho = JAMO_CHOSEONG[Math.floor(idx / 588)];
      const jJung = JAMO_JUNGSEONG[Math.floor((idx % 588) / 28)];
      return `${ch} (${cho === 'ㅇ' ? '' : cho}${jJung})`;
    });
    const lastCh = clean[clean.length - 1];
    const hasB = hasBatchim(lastCh);
    return {
      header: clean,
      explanation: `Chuỗi "${clean}" gồm ${clean.length} âm tiết: ${parts.join(' · ')}. Âm tiết cuối ${hasB ? 'có patchim (-은/-이/-이에요)' : 'không có patchim (-는/-가/-예요)'}.`,
      hint: `Thử đặt một câu ngắn với "${clean}".`,
    };
  }
  return null;
}

/**
 * Scenario D — Handles intentional gesture-based queries (Explain, Translate,
 * Grammar Check, Example, Trace Guide, Practice Exercise) on user-selected strokes.
 */
export function executeGestureQuery(params: {
  board: WonderBoardDocument;
  selectedStrokeIds: string[];
  intent: WonderGestureIntent;
}): {
  annotation?: WonderAnnotation;
  teachingCard?: WonderTeachingCard;
  event: WonderLearningEvent;
} {
  const { board, selectedStrokeIds, intent } = params;
  const theme = WONDER_BOARD_THEMES[board.themeId];
  const selectedSet = new Set(selectedStrokeIds);
  const selectedStrokes = board.strokes.filter(
    (s) => !s.deleted && selectedSet.has(s.id)
  );
  const existingRegionTexts = board.regions
    .filter(
      (r) =>
        r.recognizedText.trim().length > 0 &&
        r.strokeIds.some((id) => selectedSet.has(id))
    )
    .map((r) => r.recognizedText.trim());

  const regions =
    existingRegionTexts.length > 0
      ? board.regions.filter(
        (r) =>
          r.recognizedText.trim().length > 0 &&
          r.strokeIds.some((id) => selectedSet.has(id))
      )
      : recognizeHandwritingRegions(selectedStrokes, board.id, board.revision);
  const recognizedJoined = (
    existingRegionTexts.length > 0
      ? existingRegionTexts.join(' ')
      : regions
        .map((r) => r.recognizedText)
        .filter(Boolean)
        .join(' ')
  ).trim();
  const targetBox = mergeBoundingBoxes(selectedStrokes.map((s) => s.bbox));
  const occupiedBoxes = [
    ...board.strokes.filter((s) => !s.deleted).map((s) => s.bbox),
    ...board.annotations.filter((a) => a.status === 'active').map((a) => a.note_geometry),
    ...board.teachingCards.map((c) => c.geometry),
  ];

  const isTall = targetBox.height > 140 || targetBox.maxY > 420;
  const desiredWidth = Math.max(290, Math.min(460, Math.round(targetBox.height * 1.25)));
  const desiredHeight =
    intent === 'trace_guide' || intent === 'example'
      ? 168
      : Math.max(132, Math.min(220, Math.round(targetBox.height * 0.68)));

  const { noteBox, placement, arrow } = computeCollisionFreePlacement({
    targetBox,
    desiredWidth,
    desiredHeight,
    preferredOrder: isTall
      ? ['right', 'left', 'above', 'below']
      : ['right', 'below', 'above', 'left'],
    occupiedBoxes,
  });

  if (!recognizedJoined && intent !== 'trace_guide' && intent !== 'example') {
    // P0.3: Never spawn automatic "Xác nhận chữ viết" or "Cụm N nét" clouds on unrecognized ink!
    return {
      annotation: undefined,
      teachingCard: undefined,
      event: {
        eventId: `evt_unc_g_${Date.now()}`,
        boardId: board.id,
        eventType: 'recognition_uncertainty',
        conceptIds: [],
        recognizedText: '',
        confirmed: false,
        timestamp: Date.now(),
      },
    };
  }

  const text = recognizedJoined || '가';

  if (intent === 'practice_exercise' && decomposeHangulUnit(text)) {
    const createdAt = Date.now();
    return {
      teachingCard: {
        cardId: `card_practice_${createdAt}`, boardId: board.id, sourceRevision: board.revision,
        geometry: noteBox, titleVi: `Luyện viết ${text}`, koreanPhrase: text, practiceTarget: text,
        explanationVi: `Viết ${text} ngay dưới thẻ này.`, breakdown: [],
        learningConceptIds: [`handwriting:${text}`], createdAt,
      },
      event: {
        eventId: `evt_practice_${createdAt}`, boardId: board.id, eventType: 'hint_requested',
        conceptIds: [`handwriting:${text}`], recognizedText: text, confirmed: true, timestamp: createdAt,
      },
    };
  }

  if (intent === 'trace_guide' || intent === 'example') {
    const phrase = text.includes('커피') ? '커피 한 잔 주세요.' : text;
    const card: WonderTeachingCard = {
      cardId: `card_gesture_${Date.now()}`,
      boardId: board.id,
      sourceRevision: board.revision,
      geometry: noteBox,
      titleVi:
        intent === 'trace_guide'
          ? 'Mẫu chữ mờ để đồ theo nét'
          : 'Ví dụ mở rộng trên bảng',
      koreanPhrase: phrase,
      explanationVi:
        intent === 'trace_guide'
          ? 'Tô nhẹ theo nét phấn mờ bên dưới để nhớ thứ tự nét Hangul.'
          : `Câu mẫu sử dụng cấu trúc liên quan tới "${phrase}".`,
      breakdown: [{ token: phrase, meaningVi: 'Thực hành viết trực tiếp' }],
      ghostHandwritingText: phrase,
      ghostBBox: {
        minX: noteBox.minX + 12,
        minY: noteBox.maxY + 12,
        maxX: noteBox.minX + 240,
        maxY: noteBox.maxY + 52,
        width: 228,
        height: 40,
      },
      learningConceptIds: ['kc_productive_orthography'],
      createdAt: Date.now(),
    };

    return {
      teachingCard: card,
      event: {
        eventId: `evt_g_${Date.now()}`,
        boardId: board.id,
        eventType: 'hint_requested',
        conceptIds: ['kc_productive_orthography'],
        recognizedText: text,
        confirmed: true,
        timestamp: Date.now(),
      },
    };
  }

  const textLang = detectLanguageFromText(text);
  const singleDesc = textLang === 'en' ? null : describeKoreanSyllableOrWordVi(text);
  const enDesc = textLang === 'en' ? describeEnglishWordVi(text) : null;
  let headerCorr = '';
  let explanation = `Giải thích nhanh cho "${text}": `;
  let hint = 'Chạm lại vào vùng chữ để tiếp tục luyện.';

  if (intent === 'translate') {
    if (textLang === 'en') {
      headerCorr = enDesc ? enDesc.header : `${text} [EN]`;
      explanation = enDesc
        ? enDesc.explanation
        : `Dịch & phân tích câu tiếng Anh "${text}": chú ý chủ ngữ, thì động từ và mạo từ a/an/the.`;
    } else if (text.includes('학교')) explanation = `Dịch nghĩa: "Hôm qua tôi đi đến trường."`;
    else if (text.includes('사과')) explanation = `Dịch nghĩa: "Tôi ăn táo."`;
    else if (singleDesc) {
      headerCorr = singleDesc.header;
      explanation = singleDesc.explanation;
    } else explanation = `Dịch / Phân tích nghĩa của cụm "${text}".`;
  } else if (intent === 'grammar_check') {
    const check = analyzeBoardPedagogy({
      board: { ...board, aiEnabled: true, aiMode: 'tutor' },
      regions,
      existingAnnotations: [],
      existingTeachingCards: [],
      theme,
    });
    if (check.nextAnnotations.length > 0) {
      return {
        annotation: check.nextAnnotations[0],
        event: {
          eventId: `evt_g_${Date.now()}`,
          boardId: board.id,
          eventType: 'hint_requested',
          conceptIds: ['kc_morph_particles'],
          recognizedText: text,
          confirmed: true,
          timestamp: Date.now(),
        },
      };
    }
    explanation = enDesc
      ? enDesc.explanation
      : singleDesc
        ? singleDesc.explanation
        : `"${text}" hiện đang đúng ngữ pháp cơ bản.`;
  } else if (intent === 'practice_exercise') {
    explanation = textLang === 'en'
      ? `Bài tập tiếng Anh với "${text}": hãy thử đổi câu sang thì quá khứ hoặc phủ định ngay bên dưới.`
      : singleDesc
        ? `Thực hành ghép vần từ "${text}": hãy viết thêm từ "${text === '아' ? '아이' : `${text}요`}" bên dưới.`
        : `Bài tập nhỏ: Hãy viết lại "${text}" ở dạng phủ định (-지 않아요) ngay bên dưới.`;
  } else if (enDesc) {
    headerCorr = enDesc.header;
    explanation = enDesc.explanation;
    hint = enDesc.hint;
  } else if (singleDesc) {
    headerCorr = singleDesc.header;
    explanation = singleDesc.explanation;
    hint = singleDesc.hint;
  } else if (textLang === 'en') {
    explanation = `Cụm tiếng Anh "${text}": kiểm tra thì động từ, sự hòa hợp S-V và mạo từ (a/an/the).`;
  } else {
    explanation = `Phân tích cụm "${text}": kiểm tra tiểu từ cuối danh từ và đuôi câu lịch sự -아/어요.`;
  }

  const annotation = buildValidatedAnnotation({
    annotation_id: `ann_gesture_${Date.now()}`,
    board_id: board.id,
    source_revision: board.revision,
    source_stroke_ids: selectedStrokeIds,
    recognized_text: text,
    target_text: text.slice(0, 60),
    target_span: { start: 0, end: text.length },
    target_geometry: targetBox,
    note_geometry: noteBox,
    arrow_path: arrow,
    annotation_type: 'explanation',
    linguistic_category: 'vocabulary',
    severity: 'info',
    confidence: 0.9,
    suggested_correction: headerCorr,
    explanation,
    hint,
    visual_style: {
      shape: 'scalloped_cloud',
      accentColor: theme.aiSupportHex,
    },
    placement_preference: placement,
    learning_concept_ids: ['kc_lexicon_hanja'],
    created_at: Date.now(),
    status: 'active',
  });

  return {
    annotation,
    event: {
      eventId: `evt_g_${Date.now()}`,
      boardId: board.id,
      eventType: 'hint_requested',
      conceptIds: ['kc_lexicon_hanja'],
      recognizedText: text,
      confirmed: true,
      timestamp: Date.now(),
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Adaptive Learning Profile Bridge (Section 14)
// ---------------------------------------------------------------------------

export function applyWonderLearningEventsToProfile(
  profile: AdaptiveAiProfile,
  events: WonderLearningEvent[],
  recordedEventKeys?: Set<string>
): AdaptiveAiProfile {
  let current = profile;
  for (const evt of events) {
    // Never penalize BKT/Elo from unconfirmed errors, exposure-only prompts, or uncertainty!
    if (
      !evt.confirmed ||
      evt.eventType === 'recognition_uncertainty' ||
      evt.evidenceKind === 'exposure'
    ) {
      continue;
    }

    const dedupeKey = evt.idempotencyKey ?? evt.eventId;
    if (recordedEventKeys) {
      if (recordedEventKeys.has(dedupeKey)) {
        continue;
      }
      recordedEventKeys.add(dedupeKey);
    }

    const isPositive =
      evt.eventType === 'self_correction_completed' ||
      evt.eventType === 'successful_independent_usage' ||
      evt.eventType === 'exercise_completed';

    const grade: 1 | 2 | 3 | 4 =
      evt.evidenceKind === 'copied_answer' || evt.evidenceKind === 'guided_self_correction'
        ? 2
        : isPositive
          ? 3
          : 2;
    const wrongAttempts =
      evt.evidenceKind === 'copied_answer'
        ? 1
        : isPositive
          ? 0
          : 1;

    const syntheticExercise: Exercise = {
      id: evt.conceptIds.includes('kc_morph_particles')
        ? 'u1-l1-ex3'
        : 'u1-l1-ex1',
      stage: 3,
      type: evt.conceptIds.includes('kc_morph_particles')
        ? 'particle_contrast'
        : 'guided_personal_output',
      promptVi: 'Wonder Board',
      promptHint: '',
      explicitExplanation: '',
      templateHint: '',
      validationRules: {
        mustIncludeAny: [evt.recognizedText],
        mustIncludeTopicParticle: false,
      },
    } as Exercise;

    current = updateAdaptiveAiProfile(
      current,
      syntheticExercise,
      grade,
      wrongAttempts
    );
  }
  return current;
}

export function createEmptyWonderBoard(
  id = 'board_default',
  title = 'Bảng học tiếng Hàn #1',
  themeId: WonderBoardThemeId = 'soft-cream-whiteboard'
): WonderBoardDocument {
  const now = Date.now();
  return {
    id,
    title,
    themeId,
    aiEnabled: true,
    aiMode: 'tutor',
    teacherState: 'OBSERVING',
    animationSpeed: 'natural',
    chalkCursorEnabled: true,
    showAnnotations: true,
    chalkTextureEnabled: true,
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    revision: 0,
    strokes: [],
    redoStack: [],
    regions: [],
    annotations: [],
    teachingCards: [],
    events: [],
    telemetry: {
      lastRenderFrameMs: 0,
      lastRecognitionLatencyMs: 0,
      lastAiLatencyMs: 0,
      apiCallCount: 0,
      estimatedTokens: 0,
      errorCount: 0,
      timeoutCount: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function getWonderBoardAiModeLabel(mode: WonderAiMode): string {
  switch (mode) {
    case 'gentle':
      return 'Nhẹ nhàng (Gentle)';
    case 'tutor':
      return 'Gia sư (Tutor)';
    case 'discovery':
      return 'Khám phá (Discovery)';
    case 'focus':
      return 'Tập trung (Tắt AI)';
    case 'review':
      return 'Tổng hợp (Review)';
  }
}
