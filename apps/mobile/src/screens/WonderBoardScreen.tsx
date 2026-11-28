import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  AdaptiveAiProfile,
  WONDER_BOARD_THEMES,
  WonderAiMode,
  WonderAnimationSpeed,
  WonderAnnotation,
  WonderBBox,
  WonderBoardDocument,
  WonderBoardThemeId,
  WonderGestureIntent,
  WonderGuidanceLevel,
  WonderLearningEvent,
  WonderRecognitionDiagnosticEntry,
  WonderStroke,
  WonderTargetLanguage,
  WonderTeacherState,
  WonderThemeTokens,
  WonderToolType,
} from '@seed/schema';
import {
  appendConversationMemoryTurn,
  applyConfirmedUserTranscript,
  boxesIntersect,
  buildBoardContextModel,
  computeAdaptiveAnalysisDelayMs,
  computeAdaptiveAnnotationTypography,
  computeAnnotationPhaseTimings,
  computeCollisionFreePlacement,
  computeDirtyRegions,
  computeStrokeBoundingBox,
  createEmptyWonderBoard,
  deduplicateWonderAnnotations,
  decomposeHangulUnit,
  estimateFontRunWidthFallback,
  evaluateWonderBoardBenchmarkV3,
  executeGestureQuery,
  findStrokesInPolygon,
  generateHandwrittenStrokesForText,
  generateScallopedCloudGeometry,
  getWonderBoardAiModeLabel,
  hiddenAnnotationArrow,
  mergeBoundingBoxes,
  orchestrateWonderTutor,
  rasterizeTextToBinaryMask,
  recognizeHandwritingRegions,
  recognizeWithHybridPipeline,
  reconcileAnnotationsWithStrokes,
  routeAnnotationArrow,
  segmentMixedLanguageRuns,
  segmentUnicodeGraphemes,
  selectInterventionGranularity,
  sliceArrowPathAtProgress,
  sliceCloudPathAtProgress,
  sliceHangulDemoAtProgress,
  sliceMixedLanguageReveal,
  synthesizeHandwritingFromMask,
  translateStrokes,
  WonderAnimationPhaseTimings,
  WonderFontRun,
  WonderRecognitionCache,
  WonderWrappedTextMetrics,
  wrapMixedLanguageRuns,
} from '@seed/learning-engine';
import { loadAiApiConfig, resolveProvider } from '../lib/aiTutor';
import { speakKorean } from '../lib/speech';
import { FONT_CHALK, FONT_SANS, waitForWonderFontsReady } from '../lib/typography';
import {
  createBrowserVisionProvider,
  fetchWonderServerHealth,
  renderObservationWindowSnapshot,
  requestWonderServerTutor,
  WonderServerHealth,
  WonderServerTutorAction,
} from '../lib/wonderGateway';
import {
  WonderPrivacyConfig,
  deleteAllWonderBoardData,
  loadActiveBoardId,
  loadWonderBoards,
  loadWonderPrivacyConfig,
  saveActiveBoardId,
  saveWonderBoards,
  saveWonderPrivacyConfig,
} from '../lib/wonderBoardStore';

interface WonderBoardScreenProps {
  aiProfile: AdaptiveAiProfile;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onRecordLearningEvents: (events: WonderLearningEvent[]) => void;
}

interface WebCanvasContextLike {
  clearRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(sx: number, sy: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  lineCap: string;
  lineJoin: string;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
}

interface WebCanvasElementLike {
  width: number;
  height: number;
  getContext(type: '2d'): WebCanvasContextLike | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  toDataURL?(type?: string): string;
}

interface WebPointerEventLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  preventDefault(): void;
  nativeEvent?: WebPointerEventLike;
  getCoalescedEvents?: () => WebPointerEventLike[];
}

interface WebWheelEventLike {
  deltaY: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

interface LiveAnimProgress {
  cloud: number;
  arrow: number;
  correction: number;
  explanation: number;
  phase: 'cloud' | 'pause1' | 'arrow' | 'pause2' | 'correction' | 'explanation' | 'done';
  completed: boolean;
}

const TOOL_ITEMS: Array<{ key: WonderToolType; label: string }> = [
  { key: 'chalk', label: 'Phấn' },
  { key: 'pencil', label: 'Bút chì' },
  { key: 'highlighter', label: 'Highlight' },
  { key: 'eraser_stroke', label: 'Tẩy nét' },
  { key: 'eraser_pixel', label: 'Tẩy vùng' },
  { key: 'lasso', label: 'Chọn' },
  { key: 'ai_lasso', label: 'Khoanh hỏi AI' },
  { key: 'pan', label: 'Kéo bảng' },
];

const AI_MODE_OPTIONS: WonderAiMode[] = ['gentle', 'tutor', 'discovery', 'focus', 'review'];

const GUIDANCE_OPTIONS: Array<{ key: WonderGuidanceLevel; label: string }> = [
  { key: 'minimal', label: 'Tối giản' },
  { key: 'guided', label: 'Có gợi ý' },
  { key: 'detailed', label: 'Chi tiết' },
  { key: 'beginner_friendly', label: 'Người mới' },
];

const SPEED_OPTIONS: Array<{ key: WonderAnimationSpeed; label: string; factor: number }> = [
  { key: 'slow', label: 'Chậm', factor: 1.5 },
  { key: 'natural', label: 'Tự nhiên', factor: 1.0 },
  { key: 'fast', label: 'Nhanh', factor: 0.55 },
  { key: 'instant', label: 'Tức thì', factor: 0 },
];

const TARGET_LANG_OPTIONS: Array<{
  key: WonderTargetLanguage;
  shortLabel: string;
  label: string;
}> = [
  { key: 'auto', shortLabel: 'Hàn + Anh', label: 'Tự động (Hàn + Anh)' },
  { key: 'ko', shortLabel: 'Tiếng Hàn', label: 'Tiếng Hàn (KO)' },
  { key: 'en', shortLabel: 'Tiếng Anh', label: 'Tiếng Anh (EN)' },
];

function getNextTargetLanguage(cur?: WonderTargetLanguage): WonderTargetLanguage {
  if (cur === 'ko') return 'en';
  if (cur === 'en') return 'auto';
  return 'ko';
}

function getTargetLangShortLabel(cur?: WonderTargetLanguage): string {
  return TARGET_LANG_OPTIONS.find((o) => o.key === (cur ?? 'auto'))?.shortLabel ?? 'Hàn + Anh';
}

let sharedMeasureCtx: {
  font: string;
  measureText(text: string): { width: number };
} | null | undefined;

function getMeasureCtx() {
  if (sharedMeasureCtx !== undefined) return sharedMeasureCtx;
  if (Platform.OS !== 'web') {
    sharedMeasureCtx = null;
    return null;
  }
  const doc = (globalThis as unknown as {
    document?: {
      createElement(tag: string): {
        getContext(t: '2d'): { font: string; measureText(text: string): { width: number } } | null;
      };
    };
  }).document;
  if (!doc) {
    sharedMeasureCtx = null;
    return null;
  }
  const c = doc.createElement('canvas');
  sharedMeasureCtx = c.getContext('2d');
  return sharedMeasureCtx;
}

/**
 * Measures an explicit font run using Canvas 2D measureText on web (after or during font load),
 * falling back cleanly to heuristic script widths in Node.
 */
function measureFontRunOnWeb(run: WonderFontRun): number {
  const ctx = getMeasureCtx();
  if (!ctx) return estimateFontRunWidthFallback(run);
  ctx.font = `${run.fontWeight} ${run.fontSize}px ${run.fontFamily}`;
  const rawW = ctx.measureText(run.text).width;
  const gCount = segmentUnicodeGraphemes(run.text).length;
  const trackingPx = Math.max(0, gCount - 1) * run.fontSize * run.letterSpacingEm;
  return rawW + trackingPx;
}

interface ResolvedAnnotationVisualLayout {
  noteBox: WonderBBox;
  placement: WonderAnnotation['placement_preference'];
  arrow: WonderAnnotation['arrow_path'];
  cloud: ReturnType<typeof generateScallopedCloudGeometry>;
  cloudVisible: boolean;
  noteVisible: boolean;
  headerFontSize: number;
  explFontSize: number;
  explLineHeight: number;
  explGapTop: number;
  headerMetrics: WonderWrappedTextMetrics;
  explMetrics: WonderWrappedTextMetrics;
  textBaseX: number;
  textBaseY: number;
}

function sliceWrappedLinesByVisibleText(
  fullLines: string[],
  visibleText: string
): string[] {
  const visibleCount = segmentUnicodeGraphemes(visibleText).length;
  if (visibleCount <= 0) return [];
  const out: string[] = [];
  let remaining = visibleCount;
  for (const line of fullLines) {
    if (remaining <= 0) break;
    const gs = segmentUnicodeGraphemes(line);
    if (gs.length <= remaining) {
      out.push(line);
      remaining -= gs.length + 1; // account for space separator between wrapped lines
    } else {
      out.push(gs.slice(0, remaining).join(''));
      remaining = 0;
    }
  }
  return out;
}

function renderRunTspans(
  lineText: string,
  role: 'correction' | 'explanation',
  baseFontSize: number
): React.ReactNode[] {
  const runs = segmentMixedLanguageRuns(lineText, role, baseFontSize);
  let prevShiftEm = 0;
  return runs.map((run, idx) => {
    const deltaShiftPx = Number(((run.baselineShiftEm - prevShiftEm) * baseFontSize).toFixed(2));
    prevShiftEm = run.baselineShiftEm;
    return React.createElement(
      'tspan',
      {
        key: `${idx}_${run.script}`,
        fontFamily: run.fontFamily,
        fontSize: run.fontSize,
        fontWeight: run.fontWeight,
        letterSpacing: `${(run.letterSpacingEm * run.fontSize).toFixed(2)}px`,
        dy: idx === 0 && run.baselineShiftEm === 0 ? undefined : deltaShiftPx !== 0 ? deltaShiftPx : undefined,
      },
      run.text
    );
  });
}

function getTeacherStateLabel(st: WonderTeacherState): string {
  switch (st) {
    case 'RECOGNIZING':
      return 'Đang đọc chữ...';
    case 'WAITING_FOR_CONTEXT':
      return 'Đang đợi viết hết câu';
    case 'ANALYZING':
    case 'PLANNING_FEEDBACK':
      return 'Đang suy nghĩ...';
    case 'DRAWING_CLOUD':
      return 'Đang khoanh mây';
    case 'DRAWING_ARROW':
      return 'Đang vẽ mũi tên';
    case 'WRITING_CORRECTION':
      return 'Đang viết gợi ý sửa';
    case 'WRITING_EXPLANATION':
      return 'Đang viết giải thích';
    case 'REASSESSING':
      return 'Đang cập nhật nhận xét';
    case 'WAITING_FOR_LEARNER':
      return 'Đợi bạn viết tiếp';
    case 'IDLE':
      return 'Tạm nghỉ';
    default:
      return 'Đang quan sát';
  }
}

function wrapChalkText(text: string, maxChars = 28): string[] {
  const normalized = text.normalize('NFC').trim();
  if (!normalized) return [];
  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let curr = '';
  for (const w of words) {
    if (!curr) {
      curr = w;
    } else if (segmentUnicodeGraphemes(curr).length + 1 + segmentUnicodeGraphemes(w).length <= maxChars) {
      curr += ` ${w}`;
    } else {
      lines.push(curr);
      curr = w;
    }
  }
  if (curr) lines.push(curr);
  return lines.slice(0, 6);
}

/**
 * Connected midpoint quadratic Bezier renderer guaranteeing continuous,
 * smooth, legible chalk strokes without disconnected dashed segments.
 */
function drawStrokeOnCtx(
  ctx: WebCanvasContextLike,
  stroke: WonderStroke,
  chalkTextureEnabled: boolean,
  themeBg: string
): void {
  if (stroke.deleted || stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = stroke.points;
  const dx = stroke.transform.dx;
  const dy = stroke.transform.dy;

  if (stroke.tool === 'eraser_pixel') {
    ctx.strokeStyle = themeBg;
    ctx.globalAlpha = 1;
    ctx.lineWidth = stroke.width * 3.4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y + dy);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x + dx, pts[i].y + dy);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.strokeStyle = stroke.color;
  const isHighlight = stroke.tool === 'highlighter';
  const baseAlpha = isHighlight ? 0.28 : stroke.tool === 'chalk' ? 0.94 : 0.98;

  if (pts.length === 1) {
    const p = pts[0];
    ctx.globalAlpha = baseAlpha;
    ctx.lineWidth = Math.max(1.8, stroke.width * (0.65 + p.pressure * 0.7));
    ctx.beginPath();
    ctx.moveTo(p.x + dx, p.y + dy);
    ctx.lineTo(p.x + dx + 0.5, p.y + dy + 0.5);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (pts.length === 2) {
    ctx.globalAlpha = baseAlpha;
    const avgP = (pts[0].pressure + pts[1].pressure) / 2;
    ctx.lineWidth = isHighlight
      ? stroke.width * 3.8
      : Math.max(1.6, stroke.width * (0.65 + avgP * 0.72));
    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y + dy);
    ctx.lineTo(pts[1].x + dx, pts[1].y + dy);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Connected quadratic midpoint curve per sub-segment (mid(i-1,i) -> pt(i) -> mid(i,i+1))
  let prevMidX = pts[0].x + dx;
  let prevMidY = pts[0].y + dy;

  for (let i = 1; i < pts.length; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    const endX = next ? (curr.x + next.x) / 2 + dx : curr.x + dx;
    const endY = next ? (curr.y + next.y) / 2 + dy : curr.y + dy;

    ctx.lineWidth = isHighlight
      ? stroke.width * 3.8
      : Math.max(1.6, stroke.width * (0.68 + curr.pressure * 0.72));
    ctx.globalAlpha =
      stroke.tool === 'chalk' && chalkTextureEnabled
        ? baseAlpha * (0.9 + ((i % 4) * 0.02))
        : baseAlpha;

    ctx.beginPath();
    ctx.moveTo(prevMidX, prevMidY);
    ctx.quadraticCurveTo(curr.x + dx, curr.y + dy, endX, endY);
    ctx.stroke();

    // Very subtle edge grain speckling beside stroke without punching holes inside it
    if (stroke.tool === 'chalk' && chalkTextureEnabled && i % 4 === 0) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = stroke.color;
      ctx.fillRect(endX + ((i % 2) * 2 - 1), endY + 1.4, 1.1, 1.1);
    }

    prevMidX = endX;
    prevMidY = endY;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Isolated Layer 4 & Layer 6 World-Space Chalk Animator & Overlay
// (Prevents full-screen React re-renders during 60fps animation)
// ---------------------------------------------------------------------------

interface ChalkOverlayProps {
  board: WonderBoardDocument;
  theme: WonderThemeTokens;
  lassoPoly: Array<{ x: number; y: number }>;
  tool: WonderToolType;
  selectedStrokeIds: string[];
  animOverrideMap: Record<string, LiveAnimProgress>;
  selectedNoteId: string | null;
  activeWritingBox: WonderBBox | null;
  fontEpoch: number;
  resolvedLayoutByAnnId: Record<string, ResolvedAnnotationVisualLayout>;
  onSelectNote: (id: string | null) => void;
  onAnnotationPhaseCompleted: (annId: string) => void;
  onTeacherStateHint: (state: WonderTeacherState) => void;
  onAnimationTimingsObserved?: (
    annId: string,
    timings: WonderAnimationPhaseTimings,
    actualCloudMs?: number,
    actualTextMs?: number
  ) => void;
  onExposeOverlayHelpers?: (helpers: {
    getAnimationTimings: () => Record<
      string,
      WonderAnimationPhaseTimings & { actualCloudMs?: number; actualTextMs?: number }
    >;
    skipAnnotationAnim: (annId: string) => void;
  }) => void;
}

function buildResolvedAnnotationLayouts(
  board: WonderBoardDocument,
  activeAnnotations: WonderAnnotation[],
  activeWritingBox: WonderBBox | null,
  viewportWidth = 1200,
  viewportHeight?: number,
  sidebarWidthPx = 0,
  toolbarCollapsed = false
): Record<string, ResolvedAnnotationVisualLayout> {
  const layoutMap: Record<string, ResolvedAnnotationVisualLayout> = {};
  const wordBoxes = board.regions.filter((r) => r.completeness !== 'non_text')
    .flatMap((r) => r.spans.length ? r.spans.map((sp) => sp.bbox) : [r.bbox]);
  const strokes = board.strokes.filter((s) => !s.deleted && s.tool !== 'eraser_pixel');
  const strokeBoxes = strokes.map((s) => s.bbox);
  const teachingBoxes = [
    ...board.teachingCards.map((c) => c.geometry),
    ...(board.hangulDemos ?? []).map((demo) => demo.geometry),
  ];
  const cloudById = new Map<string, {
    geometry: ReturnType<typeof generateScallopedCloudGeometry>;
    visible: boolean;
  }>();
  const placedNotes: WonderBBox[] = [];
  const exactScale = Math.max(0.25, board.viewport.scale || 1);
  const vScale = Math.max(0.35, exactScale);
  const isNarrowPhone = viewportWidth < 680;

  let worldSafeBounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  const uiOverlayBlockers: WonderBBox[] = [];
  if (typeof viewportHeight === 'number' && viewportHeight > 0) {
    const topChromeH = isNarrowPhone ? 98 : 58;
    const stageW = Math.max(300, viewportWidth - sidebarWidthPx);
    const stageH = Math.max(220, viewportHeight - topChromeH);
    const bottomDockReservePx = toolbarCollapsed ? 64 : isNarrowPhone ? 136 : 122;
    const offX = board.viewport.offsetX || 0;
    const offY = board.viewport.offsetY || 0;
    const toWorldX = (sx: number) => (sx - offX) / exactScale;
    const toWorldY = (sy: number) => (sy - offY) / exactScale;

    worldSafeBounds = {
      minX: toWorldX(12),
      minY: toWorldY(12),
      maxX: toWorldX(stageW - 12),
      maxY: toWorldY(Math.max(100, stageH - bottomDockReservePx)),
    };

    const tbLeft = toWorldX(Math.max(0, stageW * 0.06));
    const tbTop = toWorldY(Math.max(96, stageH - bottomDockReservePx));
    const tbRight = toWorldX(Math.min(stageW, stageW * 0.94));
    const tbBottom = toWorldY(stageH + 24);
    uiOverlayBlockers.push({
      minX: tbLeft,
      minY: tbTop,
      maxX: tbRight,
      maxY: tbBottom,
      width: Math.max(40, tbRight - tbLeft),
      height: Math.max(30, tbBottom - tbTop),
    });
  }

  const ordered = [...activeAnnotations].sort((a, b) =>
    Number(b.severity === 'error') - Number(a.severity === 'error') ||
    a.created_at - b.created_at || a.annotation_id.localeCompare(b.annotation_id));
  for (const ann of ordered) {
    const targetIds = new Set(ann.source_stroke_ids);
    const neighbors = strokes.filter((s) => !targetIds.has(s.id)).map((s) => s.bbox);
    const occupiedClouds = [...cloudById.values()].filter((p) => p.visible).map((p) => p.geometry.outerBounds);
    const cloudObstacles = [...neighbors, ...occupiedClouds, ...teachingBoxes, ...uiOverlayBlockers];
    if (activeWritingBox) cloudObstacles.push(activeWritingBox);
    const fits = (geometry: ReturnType<typeof generateScallopedCloudGeometry>) =>
      !cloudObstacles.some((b) => boxesIntersect(b, geometry.outerBounds, 2));
    const compact = Boolean(ann.teaching_activity_id || decomposeHangulUnit(ann.target_text) ||
      ann.granularity === 'CHARACTER');
    let geometry = generateScallopedCloudGeometry(ann.target_geometry, ann.cloud_seed, neighbors, compact);
    if (!compact && !fits(geometry)) {
      geometry = generateScallopedCloudGeometry(ann.target_geometry, ann.cloud_seed, neighbors, true);
    }
    cloudById.set(ann.annotation_id, { geometry, visible: ann.visual_style.shape !== 'chalk_tick' && fits(geometry) });
  }
  const visibleClouds = [...cloudById.entries()].filter(([, cloud]) => cloud.visible);
  const fitsViewport = (box: WonderBBox) => !worldSafeBounds || (
    box.minX >= worldSafeBounds.minX - 1 && box.maxX <= worldSafeBounds.maxX + 1 &&
    box.minY >= worldSafeBounds.minY - 1 && box.maxY <= worldSafeBounds.maxY + 1);

  for (const ann of ordered) {
    const resolvedCloud = cloudById.get(ann.annotation_id)!;
    const cloud = resolvedCloud.geometry;
    const otherClouds = visibleClouds.filter(([id]) => id !== ann.annotation_id)
      .map(([, item]) => item.geometry.outerBounds);
    const occupied = [
      ...strokeBoxes, ...wordBoxes, ...otherClouds, ...placedNotes, ...teachingBoxes,
      ...uiOverlayBlockers, ...(activeWritingBox ? [activeWritingBox] : []),
    ];

    if (ann.visual_style.shape === 'chalk_tick') {
      const tickLabel = ann.suggested_correction || '잘했어요!';
      const noteVisible = fitsViewport(ann.note_geometry) &&
        !occupied.some((box) => boxesIntersect(ann.note_geometry, box, 2));
      layoutMap[ann.annotation_id] = {
        noteBox: ann.note_geometry,
        placement: ann.placement_preference,
        arrow: hiddenAnnotationArrow(ann.note_geometry),
        cloud,
        cloudVisible: false,
        noteVisible,
        headerFontSize: 20,
        explFontSize: 16,
        explLineHeight: 24,
        explGapTop: 24,
        headerMetrics: wrapMixedLanguageRuns(tickLabel, 'correction', 20, 200, 1.35, measureFontRunOnWeb, 1),
        explMetrics: { lines: [], maxWidth: 0, totalHeight: 0, lineHeight: 24 },
        textBaseX: ann.note_geometry.minX + 6,
        textBaseY: ann.note_geometry.minY + 22,
      };
      if (noteVisible) placedNotes.push(ann.note_geometry);
      continue;
    }

    const typo = computeAdaptiveAnnotationTypography(ann.target_geometry.height, vScale);
    const corrLabel =
      ann.severity === 'error' && ann.suggested_correction
        ? `${ann.target_text} → ${ann.suggested_correction}`
        : ann.suggested_correction || ann.target_text;

    const headerFontSize = typo.correctionWorldPx;
    const isHighZoomConstrained = Boolean(worldSafeBounds && exactScale >= 1.45);
    const explFontSize = isHighZoomConstrained
      ? Math.min(typo.explanationWorldPx, Math.max(13, Math.round(25 / exactScale)))
      : typo.explanationWorldPx;
    const explLineRatio = isHighZoomConstrained ? 1.3 : typo.lineHeightRatio;
    const explLineHeight = isHighZoomConstrained
      ? Math.max(17, Math.round(explFontSize * explLineRatio))
      : typo.explLineHeightWorldPx;
    const explGapTop = isHighZoomConstrained
      ? Math.min(typo.explGapTopWorldPx, 12)
      : typo.explGapTopWorldPx;

    const availSafeW = worldSafeBounds
      ? Math.max(220, worldSafeBounds.maxX - worldSafeBounds.minX - 20)
      : 0;
    const headerWrapWidth = isNarrowPhone
      ? Math.max(200, (viewportWidth - 36) / vScale)
      : Math.max(typo.maxLineWidthWorldPx + 40, 320);
    const explWrapWidth = isNarrowPhone
      ? Math.min(typo.maxLineWidthWorldPx, Math.max(200, (viewportWidth - 40) / vScale))
      : isHighZoomConstrained
        ? Math.min(Math.max(typo.maxLineWidthWorldPx, 460), availSafeW)
        : typo.maxLineWidthWorldPx;

    const headerMetrics = wrapMixedLanguageRuns(
      corrLabel,
      'correction',
      headerFontSize,
      headerWrapWidth,
      1.32,
      measureFontRunOnWeb,
      2
    );
    const measureAndPlaceForWrapWidth = (candWrapWidth: number) => {
      const candExplMetrics = wrapMixedLanguageRuns(
        ann.explanation,
        'explanation',
        explFontSize,
        candWrapWidth,
        explLineRatio,
        measureFontRunOnWeb,
        8
      );
      const rawW = Math.max(
        200,
        Math.ceil(Math.max(headerMetrics.maxWidth, candExplMetrics.maxWidth) + 20)
      );
      const mWidth = Math.max(isNarrowPhone ? 200 : 210, rawW);
      // Use the same baselines as the overlay and PNG exporter, including the
      // final descenders so the routing registry covers the rendered text.
      const headerLineStep = Math.round(headerFontSize * 1.32);
      const headerLineCount = Math.max(1, headerMetrics.lines.length);
      const firstBaseline = Math.round(headerFontSize * 1.08);
      const headerBottom = firstBaseline + (headerLineCount - 1) * headerLineStep + headerFontSize * 0.32;
      const explBottom = candExplMetrics.lines.length > 0
        ? firstBaseline + headerLineCount * headerLineStep - Math.round(headerFontSize * 0.45) +
          explGapTop + (candExplMetrics.lines.length - 1) * explLineHeight + explFontSize * 0.36
        : 0;
      const mHeight = Math.max(64, Math.ceil(Math.max(headerBottom, explBottom) + 8));
      const candPlaced = computeCollisionFreePlacement({
        targetBox: ann.target_geometry,
        desiredWidth: mWidth,
        desiredHeight: mHeight,
        preferredOrder: isNarrowPhone
          ? ['below', 'above', 'right', 'left']
          : [ann.placement_preference, 'below', 'right', 'above', 'left'],
        occupiedBoxes: occupied,
        activeWritingBox,
        safeGap: typo.safeGapWorldPx,
        maxWorldRight: isNarrowPhone
          ? Math.max((viewportWidth - 12) / vScale, ann.target_geometry.maxX + 40)
          : Math.max(1080, ann.target_geometry.maxX + mWidth + 140),
        worldSafeBounds,
        uiOverlayBlockers,
        cloudSeed: ann.cloud_seed ?? 1,
        resolvedCloud: cloud,
      });
      let inkOverlapScore = 0;
      for (const sb of occupied) {
        const ox = Math.max(
          0,
          Math.min(candPlaced.noteBox.maxX, sb.maxX) - Math.max(candPlaced.noteBox.minX, sb.minX)
        );
        const oy = Math.max(
          0,
          Math.min(candPlaced.noteBox.maxY, sb.maxY) - Math.max(candPlaced.noteBox.minY, sb.minY)
        );
        inkOverlapScore += ox * oy;
      }
      return {
        explMetrics: candExplMetrics,
        placed: candPlaced,
        inkOverlapScore,
      };
    };

    let chosen = measureAndPlaceForWrapWidth(explWrapWidth);
    const widerFallbackWidth = Math.min(580, availSafeW > 0 ? availSafeW : 560);
    if (chosen.inkOverlapScore > 0 && !isNarrowPhone && widerFallbackWidth > explWrapWidth + 40) {
      const widerCandidate = measureAndPlaceForWrapWidth(widerFallbackWidth);
      if (widerCandidate.inkOverlapScore < chosen.inkOverlapScore) {
        chosen = widerCandidate;
      }
    }

    const { explMetrics, placed } = chosen;

    const noteVisible = fitsViewport(placed.noteBox) &&
      !occupied.some((box) => boxesIntersect(placed.noteBox, box, 2)) &&
      (!resolvedCloud.visible || !boxesIntersect(placed.noteBox, cloud.outerBounds, 2));
    if (noteVisible) placedNotes.push(placed.noteBox);
    const textBaseX = placed.noteBox.minX + 8;
    const textBaseY = placed.noteBox.minY + Math.round(headerFontSize * 1.08);

    layoutMap[ann.annotation_id] = {
      noteBox: placed.noteBox,
      placement: placed.placement,
      arrow: hiddenAnnotationArrow(placed.noteBox),
      cloud,
      cloudVisible: resolvedCloud.visible,
      noteVisible,
      headerFontSize,
      explFontSize,
      explLineHeight,
      explGapTop,
      headerMetrics,
      explMetrics,
      textBaseX,
      textBaseY,
    };
  }

  const existingRoutes: WonderAnnotation['arrow_path'][] = [];
  for (const ann of ordered) {
    const layout = layoutMap[ann.annotation_id];
    if (!layout.cloudVisible || !layout.noteVisible) continue;
    const obstacles = [
      ...strokeBoxes, ...wordBoxes, ...teachingBoxes, ...uiOverlayBlockers, ...placedNotes,
      ...visibleClouds.filter(([id]) => id !== ann.annotation_id).map(([, item]) => item.geometry.outerBounds),
      ...(activeWritingBox ? [activeWritingBox] : []),
    ];
    const arrow = routeAnnotationArrow({
      targetBox: ann.target_geometry, cloud: layout.cloud, noteBox: layout.noteBox,
      placement: layout.placement, safeBounds: worldSafeBounds, existingRoutes, obstacles,
      maxLength: Math.min(150, 160 / exactScale),
    });
    if (!arrow) continue;
    layout.arrow = arrow;
    existingRoutes.push(arrow);
  }
  return layoutMap;
}

function buildAnnotationFromServerAction(params: {
  action: WonderServerTutorAction;
  boardId: string;
  revision: number;
  targetBox: WonderBBox;
  targetStrokeIds: string[];
  recognizedText: string;
  startIndex: number;
  endIndex: number;
  occupiedBoxes: WonderBBox[];
  theme: WonderThemeTokens;
  idPrefix: string;
  seedIndex: number;
}): WonderAnnotation {
  const {
    action,
    boardId,
    revision,
    targetBox,
    targetStrokeIds,
    recognizedText,
    startIndex,
    endIndex,
    occupiedBoxes,
    theme,
    idPrefix,
    seedIndex,
  } = params;
  const isPraise = action.type === 'DRAW_CHECKMARK' || action.type === 'PRAISE';
  const isExample = action.type === 'WRITE_EXAMPLE' || action.type === 'CREATE_EXAMPLE';
  const isCorrection =
    !isPraise &&
    !isExample &&
    (action.type === 'MARK_GRAMMAR_ERROR' ||
      action.type === 'WRITE_CORRECTION' ||
      (Boolean(action.suggestedCorrection) && action.suggestedCorrection !== action.targetText));
  const placement = computeCollisionFreePlacement({
    targetBox,
    desiredWidth: 320,
    desiredHeight: 112,
    preferredOrder: ['below', 'right', 'above', 'left'],
    occupiedBoxes,
  });
  occupiedBoxes.push(placement.noteBox);
  const accentColor = isPraise
    ? theme.aiPositiveHex
    : isCorrection
      ? theme.aiCorrectionHex
      : isExample
        ? theme.aiSuggestionHex
        : theme.aiSupportHex;

  return {
    annotation_id: `${idPrefix}_${revision}_${seedIndex}`,
    stable_key: `${boardId}_srv_${action.type}_${targetStrokeIds.slice().sort().join('_')}`,
    cloud_seed: seedIndex + 1,
    board_id: boardId,
    source_revision: revision,
    source_stroke_ids: targetStrokeIds,
    recognized_text: recognizedText,
    target_text: action.targetText,
    target_span: { start: startIndex, end: endIndex },
    target_geometry: targetBox,
    note_geometry: placement.noteBox,
    arrow_path: placement.arrow,
    annotation_type: isPraise
      ? 'positive_feedback'
      : isCorrection
        ? 'grammar_correction'
        : isExample
          ? 'hint'
          : 'explanation',
    linguistic_category: isCorrection || isPraise ? 'naturalness' : 'vocabulary',
    severity: isPraise ? 'praise' : isCorrection ? 'error' : 'info',
    confidence: 0.9,
    suggested_correction:
      action.suggestedCorrection ||
      (isPraise
        ? /[\uAC00-\uD7A3]/.test(recognizedText)
          ? '잘했어요!'
          : 'Great job!'
        : action.targetText),
    explanation: action.explanation,
    hint: action.hint,
    visual_style: {
      shape: isPraise ? 'chalk_tick' : 'scalloped_cloud',
      accentColor,
    },
    placement_preference: placement.placement,
    learning_concept_ids: [],
    created_at: Date.now() + seedIndex,
    status: 'active',
    lifecycle_state: 'queued',
    animation_progress: {
      cloud: 0,
      arrow: 0,
      correction: 0,
      explanation: 0,
      completed: false,
    },
  };
}

const WonderAiChalkOverlay = React.memo(function WonderAiChalkOverlay({
  board,
  theme,
  lassoPoly,
  tool,
  selectedStrokeIds,
  animOverrideMap,
  selectedNoteId,
  activeWritingBox,
  fontEpoch,
  resolvedLayoutByAnnId,
  onSelectNote,
  onAnnotationPhaseCompleted,
  onTeacherStateHint,
  onAnimationTimingsObserved,
  onExposeOverlayHelpers,
}: ChalkOverlayProps) {
  const [liveMap, setLiveMap] = useState<Record<string, LiveAnimProgress>>({});
  const animRef = useRef<Record<string, LiveAnimProgress>>({});
  const timingsRef = useRef<
    Record<
      string,
      WonderAnimationPhaseTimings & {
        startedAtMs: number;
        cloudDoneAtMs?: number;
        actualCloudMs?: number;
        actualTextMs?: number;
      }
    >
  >({});
  const lastFrameMsRef = useRef<number>(Date.now());
  const pauseAccRef = useRef<Record<string, number>>({});
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    const g = globalThis as unknown as {
      matchMedia?: (q: string) => { matches: boolean };
    };
    return typeof g.matchMedia === 'function'
      ? g.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  });

  useEffect(() => {
    const g = globalThis as unknown as {
      matchMedia?: (q: string) => {
        matches: boolean;
        addEventListener?: (ev: string, fn: (e: { matches: boolean }) => void) => void;
        removeEventListener?: (ev: string, fn: (e: { matches: boolean }) => void) => void;
      };
    };
    if (typeof g.matchMedia !== 'function') return;
    const mq = g.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const onChange = (e: { matches: boolean }) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const activeAnnotations = useMemo(
    () => board.annotations.filter((a) => a.status === 'active'),
    [board.annotations]
  );

  const selUnionBox = useMemo(() => {
    if (selectedStrokeIds.length === 0) return null;
    const selSet = new Set(selectedStrokeIds);
    const boxes = board.strokes
      .filter((s) => !s.deleted && selSet.has(s.id))
      .map((s) => s.bbox);
    return boxes.length > 0 ? mergeBoundingBoxes(boxes) : null;
  }, [board.strokes, selectedStrokeIds]);

  const skipAnnotationAnim = (annId: string) => {
    const cur = animRef.current[annId];
    if (cur && !cur.completed) {
      animRef.current = {
        ...animRef.current,
        [annId]: {
          cloud: 1,
          arrow: 1,
          correction: 1,
          explanation: 1,
          phase: 'done',
          completed: true,
        },
      };
      setLiveMap(animRef.current);
      onAnnotationPhaseCompleted(annId);
    }
  };

  useEffect(() => {
    onExposeOverlayHelpers?.({
      getAnimationTimings: () => ({ ...timingsRef.current }),
      skipAnnotationAnim,
    });
  });

  // Initialize entries for queued/completed annotations (never reset completed/active progress on font load or new strokes)
  useEffect(() => {
    const nextMap = { ...animRef.current };
    let changed = false;
    const activeIds = new Set(activeAnnotations.map((a) => a.annotation_id));

    for (const id of Object.keys(nextMap)) {
      if (!activeIds.has(id)) {
        delete nextMap[id];
        delete timingsRef.current[id];
        delete pauseAccRef.current[id];
        changed = true;
      }
    }

    const g = globalThis as unknown as {
      matchMedia?: (q: string) => { matches: boolean };
    };
    const reducedNow =
      prefersReducedMotion ||
      (typeof g.matchMedia === 'function'
        ? g.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false);

    const newlyInstantCompletedIds: string[] = [];
    for (const ann of activeAnnotations) {
      const existing = nextMap[ann.annotation_id];
      const forceInstantNow = board.animationSpeed === 'instant' || reducedNow;
      if (!existing || (forceInstantNow && !existing.completed)) {
        const alreadyDone =
          ann.animation_progress?.completed ||
          ann.lifecycle_state === 'completed' ||
          forceInstantNow;
        nextMap[ann.annotation_id] = alreadyDone
          ? {
            cloud: 1,
            arrow: 1,
            correction: 1,
            explanation: 1,
            phase: 'done',
            completed: true,
          }
          : {
            cloud: ann.animation_progress?.cloud ?? 0,
            arrow: ann.animation_progress?.arrow ?? 0,
            correction: ann.animation_progress?.correction ?? 0,
            explanation: ann.animation_progress?.explanation ?? 0,
            phase: 'cloud',
            completed: false,
          };
        if (alreadyDone && !ann.animation_progress?.completed) {
          newlyInstantCompletedIds.push(ann.annotation_id);
        }
        changed = true;
      }
    }

    if (changed) {
      animRef.current = nextMap;
      setLiveMap(nextMap);
    }

    if (newlyInstantCompletedIds.length > 0) {
      const timer = setTimeout(() => {
        for (const id of newlyInstantCompletedIds) {
          onAnnotationPhaseCompleted(id);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeAnnotations, board.animationSpeed, prefersReducedMotion, onAnnotationPhaseCompleted]);

  // Single-teacher sequential animation loop (priority-aware adaptive queue, latched durations)
  useEffect(() => {
    if (Platform.OS !== 'web' || !board.showAnnotations || !board.aiEnabled) return;

    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: (t: number) => void) => number;
      cancelAnimationFrame?: (id: number) => void;
      matchMedia?: (q: string) => { matches: boolean };
    };
    if (typeof g.requestAnimationFrame !== 'function') return;

    const incompleteList = activeAnnotations.filter(
      (a) => !animRef.current[a.annotation_id]?.completed && !animOverrideMap[a.annotation_id]
    );
    if (incompleteList.length === 0) return;

    let rafId = 0;
    lastFrameMsRef.current = Date.now();

    const step = () => {
      const now = Date.now();
      const dt = Math.min(80, Math.max(6, now - lastFrameMsRef.current));
      lastFrameMsRef.current = now;

      const reducedNow =
        prefersReducedMotion ||
        (typeof g.matchMedia === 'function'
          ? g.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false);

      const pending = activeAnnotations.filter(
        (a) => !animRef.current[a.annotation_id]?.completed && !animOverrideMap[a.annotation_id]
      );
      if (pending.length === 0) {
        onTeacherStateHint('WAITING_FOR_LEARNER');
        return;
      }

      const orderedPending =
        pending.length > 6
          ? [...pending].sort((a, b) => {
              const pa = a.severity === 'error' ? 0 : 1;
              const pb = b.severity === 'error' ? 0 : 1;
              return pa - pb || a.created_at - b.created_at;
            })
          : pending;

      const inProgress = pending.find((a) => {
        const st = animRef.current[a.annotation_id];
        return st && !st.completed && (st.cloud > 0 || st.arrow > 0 || st.correction > 0 || st.explanation > 0);
      });
      const currentAnn = inProgress ?? orderedPending[0];
      const id = currentAnn.annotation_id;
      const cur = {
        ...(animRef.current[id] ?? {
          cloud: 0,
          arrow: 0,
          correction: 0,
          explanation: 0,
          phase: 'cloud' as const,
          completed: false,
        }),
      };

      if (board.animationSpeed === 'instant' || reducedNow) {
        animRef.current = {
          ...animRef.current,
          [id]: {
            cloud: 1,
            arrow: 1,
            correction: 1,
            explanation: 1,
            phase: 'done',
            completed: true,
          },
        };
        setLiveMap(animRef.current);
        onAnnotationPhaseCompleted(id);
        rafId = g.requestAnimationFrame!(step);
        return;
      }

      if (!timingsRef.current[id]) {
        const layout = resolvedLayoutByAnnId[id];
        const arrowPath = layout?.arrow ?? currentAnn.arrow_path;
        const arrowLen = Math.hypot(arrowPath.toX - arrowPath.fromX, arrowPath.toY - arrowPath.fromY);
        const corrText =
          currentAnn.severity === 'error' && currentAnn.suggested_correction
            ? `${currentAnn.target_text} → ${currentAnn.suggested_correction}`
            : currentAnn.suggested_correction || currentAnn.target_text;
        const computed = computeAnnotationPhaseTimings({
          cloudPathLengthWorld: layout?.cloud.totalLength ?? 480,
          viewportScale: board.viewport.scale || 1,
          arrowLengthWorld: arrowLen,
          correctionText: corrText,
          explanationText: currentAnn.explanation,
          speed: board.animationSpeed,
          pendingCount: pending.length,
        });
        timingsRef.current[id] = {
          ...computed,
          startedAtMs: now,
        };
      }

      const sched = timingsRef.current[id];
      const cloudDurationMs = Math.max(120, sched.cloudMs);
      const pause1DurationMs = Math.max(20, sched.pauseAfterCloudMs);
      const arrowDurationMs = Math.max(100, sched.arrowMs);
      const pause2DurationMs = Math.max(20, sched.pauseBeforeExplMs);
      const corrDurationMs = Math.max(100, sched.corrMs);
      const explDurationMs = Math.max(160, sched.explMs);

      if (cur.phase === 'cloud') {
        onTeacherStateHint('DRAWING_CLOUD');
        cur.cloud = Math.min(1, cur.cloud + dt / cloudDurationMs);
        if (cur.cloud >= 1) {
          sched.cloudDoneAtMs = now;
          sched.actualCloudMs = now - sched.startedAtMs;
          cur.phase = 'pause1';
          pauseAccRef.current[id] = 0;
        }
      } else if (cur.phase === 'pause1') {
        pauseAccRef.current[id] = (pauseAccRef.current[id] ?? 0) + dt;
        if (pauseAccRef.current[id] >= pause1DurationMs) {
          cur.phase = 'arrow';
        }
      } else if (cur.phase === 'arrow') {
        onTeacherStateHint('DRAWING_ARROW');
        cur.arrow = Math.min(1, cur.arrow + dt / arrowDurationMs);
        if (cur.arrow >= 1) {
          cur.phase = 'pause2';
          pauseAccRef.current[id] = 0;
        }
      } else if (cur.phase === 'pause2') {
        pauseAccRef.current[id] = (pauseAccRef.current[id] ?? 0) + dt;
        if (pauseAccRef.current[id] >= pause2DurationMs) {
          cur.phase = 'correction';
        }
      } else if (cur.phase === 'correction') {
        onTeacherStateHint('WRITING_CORRECTION');
        cur.correction = Math.min(1, cur.correction + dt / corrDurationMs);
        if (cur.correction >= 1) {
          cur.phase = 'explanation';
        }
      } else if (cur.phase === 'explanation') {
        onTeacherStateHint('WRITING_EXPLANATION');
        cur.explanation = Math.min(1, cur.explanation + dt / explDurationMs);
        if (cur.explanation >= 1) {
          cur.phase = 'done';
          cur.completed = true;
          const totalActual = now - sched.startedAtMs;
          const actualText = Math.max(0, totalActual - (sched.actualCloudMs ?? sched.cloudMs));
          sched.actualTextMs = actualText;
          animRef.current = { ...animRef.current, [id]: cur };
          setLiveMap(animRef.current);
          onAnimationTimingsObserved?.(id, sched, sched.actualCloudMs, actualText);
          onAnnotationPhaseCompleted(id);
          rafId = g.requestAnimationFrame!(step);
          return;
        }
      }

      animRef.current = { ...animRef.current, [id]: cur };
      setLiveMap(animRef.current);
      rafId = g.requestAnimationFrame!(step);
    };

    rafId = g.requestAnimationFrame(step);
    return () => {
      g.cancelAnimationFrame?.(rafId);
    };
  }, [
    activeAnnotations,
    animOverrideMap,
    board.aiEnabled,
    board.animationSpeed,
    board.showAnnotations,
    board.viewport.scale,
    fontEpoch,
    onAnimationTimingsObserved,
    onAnnotationPhaseCompleted,
    onTeacherStateHint,
    prefersReducedMotion,
    resolvedLayoutByAnnId,
  ]);

  if (Platform.OS !== 'web') return null;

  return (
    <>
      {React.createElement(
        'svg',
        {
          'data-testid': 'wonder-svg-overlay',
          style: {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          },
        },
        React.createElement(
          'g',
          {
            'data-testid': 'wonder-world-group',
            transform: `translate(${board.viewport.offsetX}, ${board.viewport.offsetY}) scale(${board.viewport.scale})`,
          },
          board.showAnnotations &&
          activeAnnotations.map((ann) => {
            const override = animOverrideMap[ann.annotation_id];
            const anim = override ??
              liveMap[ann.annotation_id] ?? {
              cloud: ann.animation_progress?.cloud ?? 1,
              arrow: ann.animation_progress?.arrow ?? 1,
              correction: ann.animation_progress?.correction ?? 1,
              explanation: ann.animation_progress?.explanation ?? 1,
              phase: ann.animation_progress?.completed ? 'done' : 'cloud',
              completed: Boolean(ann.animation_progress?.completed),
            };

            const layout = resolvedLayoutByAnnId[ann.annotation_id];
            const cloudGeo = layout?.cloudVisible ? layout.cloud : undefined;
            const noteVisible = Boolean(layout?.noteVisible);
            const cloudSlice = cloudGeo
              ? sliceCloudPathAtProgress(cloudGeo, anim.cloud)
              : { pathData: '', headX: 0, headY: 0, headAngle: 0, isClosed: false };
            const resolvedArrow = layout?.arrow ?? hiddenAnnotationArrow(ann.note_geometry);
            const arrowSlice = sliceArrowPathAtProgress(resolvedArrow, anim.arrow);
            const accent = ann.visual_style.accentColor;

            const corrLabel =
              ann.severity === 'error' && ann.suggested_correction
                ? `${ann.target_text} → ${ann.suggested_correction}`
                : ann.suggested_correction || ann.target_text;
            const visibleCorr = sliceMixedLanguageReveal(corrLabel, anim.correction, false);

            const vScale = Math.max(0.35, board.viewport.scale || 1);
            const zoomStrokeComp =
              vScale < 1
                ? Math.min(1.85, 1 / Math.pow(vScale, 0.65))
                : Math.max(0.85, 1 / Math.pow(vScale, 0.25));
            const targetH = Math.max(28, ann.target_geometry.height);
            const sizeStrokeComp = Math.max(1.0, Math.min(1.38, targetH / 115));
            const cloudStrokeW = Number((3.4 * zoomStrokeComp * sizeStrokeComp).toFixed(2));
            const arrowStrokeW = Number((2.6 * zoomStrokeComp * sizeStrokeComp).toFixed(2));

            const headerFontSize = layout?.headerFontSize ?? 26;
            const explFontSize = layout?.explFontSize ?? 18;
            const explLineHeight = layout?.explLineHeight ?? 27;
            const explGapTop = layout?.explGapTop ?? 32;

            const fullHeaderLines = layout?.headerMetrics.lines.map((l) => l.text) ?? [corrLabel];
            const visibleHeaderLines = noteVisible && visibleCorr
              ? sliceWrappedLinesByVisibleText(fullHeaderLines, visibleCorr)
              : [];

            const visibleExpl = noteVisible ? sliceMixedLanguageReveal(ann.explanation, anim.explanation, true) : '';
            const fullExplLines =
              layout?.explMetrics.lines.map((l) => l.text) ?? wrapChalkText(ann.explanation, 28);
            const explLines = visibleExpl
              ? sliceWrappedLinesByVisibleText(fullExplLines, visibleExpl)
              : [];

            const showCursor =
              board.chalkCursorEnabled &&
              ((cloudSlice.pathData.length > 0 && anim.cloud > 0.01 && anim.cloud < 0.999) ||
                (arrowSlice.shaftPath.length > 0 && anim.arrow > 0.01 && anim.arrow < 0.999));
            const cursorX = anim.cloud < 0.999 ? cloudSlice.headX : arrowSlice.headX;
            const cursorY = anim.cloud < 0.999 ? cloudSlice.headY : arrowSlice.headY;
            const cursorDeg =
              ((anim.cloud < 0.999 ? cloudSlice.headAngle : arrowSlice.headAngle) * 180) /
              Math.PI;

            const textBaseX = layout?.textBaseX ?? ann.note_geometry.minX + 8;
            const textBaseY =
              layout?.textBaseY ?? ann.note_geometry.minY + Math.round(headerFontSize * 1.08);

            // Optional Riddle-inspired Zhang-Suen skeleton handwriting synthesis for short chalk headers
            // Automatically falls back to grapheme reveal whenever disabled, too dense, or fragmented
            let synthStrokesToDraw: Array<Array<{ x: number; y: number }>> | null = null;
            if (
              noteVisible && board.handwritingSynthesisEnabled &&
              anim.correction > 0 &&
              anim.correction < 0.999 &&
              corrLabel.length <= 24
            ) {
              const mask = rasterizeTextToBinaryMask(corrLabel, Math.max(20, Math.round(headerFontSize)));
              if (mask) {
                const synth = synthesizeHandwritingFromMask(
                  mask,
                  {
                    minX: textBaseX,
                    minY: textBaseY - headerFontSize,
                    maxX: textBaseX + Math.min(260, mask.width * 0.9),
                    maxY: textBaseY + Math.round(headerFontSize * 0.35),
                    width: Math.min(260, mask.width * 0.9),
                    height: Math.round(headerFontSize * 1.35),
                  },
                  corrLabel
                );
                if (!synth.fallbackToGraphemeReveal && synth.strokes.length > 0) {
                  const totalPts = synth.strokes.reduce((acc, s) => acc + s.points.length, 0);
                  let budget = Math.max(1, Math.round(totalPts * anim.correction));
                  const partial: Array<Array<{ x: number; y: number }>> = [];
                  for (const st of synth.strokes) {
                    if (budget <= 0) break;
                    const take = Math.min(st.points.length, budget);
                    if (take >= 2) partial.push(st.points.slice(0, take));
                    budget -= take;
                  }
                  if (partial.length > 0) synthStrokesToDraw = partial;
                }
              }
            }

            const handleAnnClick = () => {
              if (!anim.completed && !override) {
                skipAnnotationAnim(ann.annotation_id);
                return;
              }
              onSelectNote(selectedNoteId === ann.annotation_id ? null : ann.annotation_id);
            };

            if (ann.visual_style.shape === 'chalk_tick') {
              if (!noteVisible) return null;
              const tickLabel = ann.suggested_correction || '잘했어요!';
              return React.createElement(
                'g',
                {
                  key: ann.annotation_id,
                  'data-testid': `ann-${ann.annotation_id}`,
                  'data-anim-cloud': anim.cloud.toFixed(2),
                },
                anim.cloud > 0.05 &&
                React.createElement('path', {
                  d: `M ${ann.target_geometry.maxX + 12} ${ann.target_geometry.minY + 14} L ${ann.target_geometry.maxX + 20} ${ann.target_geometry.minY + 22} L ${ann.target_geometry.maxX + 36} ${ann.target_geometry.minY + 4}`,
                  fill: 'none',
                  stroke: accent,
                  strokeWidth: 3.2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
                visibleCorr.length > 0 &&
                React.createElement(
                  'text',
                  {
                    'data-testid': `chalk-corr-${ann.annotation_id}`,
                    x: textBaseX,
                    y: textBaseY,
                    fill: accent,
                    fontSize: 20,
                    fontWeight: '700',
                    fontFamily: FONT_CHALK,
                  },
                  renderRunTspans(tickLabel, 'correction', 20)
                )
              );
            }

            const headerBlockHeight =
              Math.max(1, visibleHeaderLines.length) * Math.round(headerFontSize * 1.32);

            return React.createElement(
              'g',
              {
                key: ann.annotation_id,
                'data-testid': `ann-${ann.annotation_id}`,
                'data-stable-key': ann.stable_key,
                'data-anim-cloud': anim.cloud.toFixed(2),
                'data-anim-arrow': anim.arrow.toFixed(2),
              },
              // Continuous non-filled organic chalk cloud outline (pastel chalk stroke + subtle under-glow texture)
              board.chalkTextureEnabled &&
              cloudSlice.pathData.length > 0 &&
              React.createElement('path', {
                d: cloudSlice.pathData,
                fill: 'none',
                stroke: accent,
                strokeOpacity: 0.2,
                strokeWidth: Number((cloudStrokeW * 1.55).toFixed(2)),
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
              cloudSlice.pathData.length > 0 &&
              React.createElement('path', {
                'data-testid': `cloud-path-${ann.annotation_id}`,
                d: cloudSlice.pathData,
                fill: 'none',
                stroke: accent,
                strokeOpacity: 0.95,
                strokeWidth: cloudStrokeW,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                style: { pointerEvents: 'stroke', cursor: 'pointer' },
                onClick: handleAnnClick,
              }),
              // Curved continuous chalk arrow (guaranteed outside note box)
              arrowSlice.shaftPath.length > 0 &&
              React.createElement('path', {
                'data-testid': `arrow-path-${ann.annotation_id}`,
                d: arrowSlice.shaftPath,
                fill: 'none',
                stroke: accent,
                strokeOpacity: 0.92,
                strokeWidth: arrowStrokeW,
                strokeLinecap: 'round',
              }),
              arrowSlice.headPath.length > 0 &&
              React.createElement('path', {
                'data-testid': `arrow-head-${ann.annotation_id}`,
                d: arrowSlice.headPath,
                fill: 'none',
                stroke: accent,
                strokeOpacity: 0.92,
                strokeWidth: arrowStrokeW,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
              // Direct-on-canvas language-aware correction lines with normalized <tspan> font runs
              // When optional Riddle skeleton synthesis is active mid-reveal, draw progressive skeleton strokes
              synthStrokesToDraw
                ? synthStrokesToDraw.map((pts, sIdx) =>
                    React.createElement('path', {
                      key: `synth_${sIdx}`,
                      'data-testid': sIdx === 0 ? `chalk-synth-${ann.annotation_id}` : undefined,
                      d: pts
                        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                        .join(' '),
                      fill: 'none',
                      stroke: accent,
                      strokeWidth: 2.1,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    })
                  )
                : visibleHeaderLines.map((hLine, hIdx) =>
                React.createElement(
                  'text',
                  {
                    key: `h_${hIdx}`,
                    'data-testid': hIdx === 0 ? `chalk-corr-${ann.annotation_id}` : undefined,
                    x: textBaseX,
                    y: textBaseY + hIdx * Math.round(headerFontSize * 1.32),
                    fill: accent,
                    fontSize: headerFontSize,
                    fontWeight: '700',
                    fontFamily: FONT_CHALK,
                    style: { pointerEvents: 'auto', cursor: 'pointer' },
                    onClick: handleAnnClick,
                  },
                  renderRunTspans(hLine, 'correction', headerFontSize)
                )
              ),
              // Direct-on-canvas readable mixed-language explanation lines with explicit <tspan> runs
              explLines.map((line, lineIdx) =>
                React.createElement(
                  'text',
                  {
                    key: `e_${lineIdx}`,
                    'data-testid':
                      lineIdx === 0 ? `chalk-expl-${ann.annotation_id}` : undefined,
                    x: textBaseX,
                    y:
                      textBaseY +
                      headerBlockHeight -
                      Math.round(headerFontSize * 0.45) +
                      explGapTop +
                      lineIdx * explLineHeight,
                    fill: theme.primaryInkHex,
                    fontSize: explFontSize,
                    fontWeight: '500',
                    fontFamily: FONT_CHALK,
                    style: { pointerEvents: 'auto', cursor: 'pointer' },
                    onClick: handleAnnClick,
                  },
                  renderRunTspans(line, 'explanation', explFontSize)
                )
              ),
              // Small oriented chalk nib while teacher is actively drawing
              showCursor &&
              React.createElement(
                'g',
                {
                  'data-testid': `chalk-cursor-${ann.annotation_id}`,
                  transform: `translate(${cursorX.toFixed(1)}, ${cursorY.toFixed(1)}) rotate(${cursorDeg.toFixed(1)})`,
                },
                React.createElement('circle', {
                  cx: 0,
                  cy: 0,
                  r: 4.5,
                  fill: accent,
                  stroke: theme.backgroundHex,
                  strokeWidth: 1.5,
                }),
                React.createElement('rect', {
                  x: -11,
                  y: -2.4,
                  width: 11,
                  height: 4.8,
                  rx: 2,
                  fill: theme.primaryInkHex,
                  opacity: 0.72,
                })
              )
            );
          }),
          // Layer 5: Beginner Teaching Phrases written directly in world space
          board.showAnnotations &&
          board.teachingCards.map((card) =>
            React.createElement(
              'g',
              { key: card.cardId, 'data-testid': `teaching-${card.cardId}` },
              React.createElement(
                'text',
                {
                  x: card.geometry.minX + 6,
                  y: card.geometry.minY + 26,
                  fill: theme.aiSuggestionHex,
                  fontSize: 22,
                  fontWeight: '700',
                  fontFamily: FONT_CHALK,
                },
                card.koreanPhrase
              ),
              wrapChalkText(card.explanationVi, 36).map((line, i) =>
                React.createElement(
                  'text',
                  {
                    key: i,
                    x: card.geometry.minX + 6,
                    y: card.geometry.minY + 50 + i * 19,
                    fill: theme.secondaryInkHex,
                    fontSize: 14.5,
                    fontWeight: '600',
                    fontFamily: FONT_SANS,
                  },
                  line
                )
              )
            )
          ),
          // Layer 5B: NIKL Hangul Stroke-Order Demonstrations (numbered strokes + chalk nib)
          board.showAnnotations &&
          (board.hangulDemos ?? []).map((demo) => {
            const slice = sliceHangulDemoAtProgress(demo, 1);
            return React.createElement(
              'g',
              { key: demo.demoId, 'data-testid': `hangul-demo-${demo.demoId}` },
              React.createElement(
                'text',
                {
                  x: demo.geometry.minX,
                  y: demo.geometry.minY - 10,
                  fill: theme.aiSuggestionHex,
                  fontSize: 13.5,
                  fontWeight: '700',
                  fontFamily: FONT_SANS,
                },
                `Thứ tự nét Hangul: ${demo.text} (${demo.strokes.length} nét)`
              ),
              slice.completedPaths.map((sp) =>
                React.createElement(
                  'g',
                  { key: `d_${sp.index}` },
                  React.createElement('path', {
                    d: sp.d,
                    fill: 'none',
                    stroke: theme.aiSuggestionHex,
                    strokeWidth: 3.1,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    opacity: 0.85,
                  }),
                  React.createElement('circle', {
                    cx: sp.startPt.x,
                    cy: sp.startPt.y,
                    r: 6.5,
                    fill: theme.aiSuggestionHex,
                  }),
                  React.createElement(
                    'text',
                    {
                      x: sp.startPt.x,
                      y: sp.startPt.y + 3,
                      textAnchor: 'middle',
                      fill: '#FFFFFF',
                      fontSize: 9,
                      fontWeight: '700',
                      fontFamily: FONT_SANS,
                    },
                    String(sp.index)
                  )
                )
              )
            );
          }),
          // Active lasso polygon
          lassoPoly.length >= 2 &&
          React.createElement('path', {
            d:
              lassoPoly
                .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
                .join(' ') + ' Z',
            fill:
              tool === 'ai_lasso'
                ? 'rgba(181, 116, 22, 0.12)'
                : 'rgba(46, 102, 153, 0.12)',
            stroke: tool === 'ai_lasso' ? theme.aiSuggestionHex : theme.aiSupportHex,
            strokeWidth: 2,
            strokeDasharray: '6 4',
          }),
          // Selected strokes frame
          selUnionBox &&
          React.createElement('rect', {
            x: selUnionBox.minX - 8,
            y: selUnionBox.minY - 8,
            width: selUnionBox.width + 16,
            height: selUnionBox.height + 16,
            rx: 10,
            fill: 'rgba(46, 102, 153, 0.08)',
            stroke: theme.aiSupportHex,
            strokeWidth: 2,
            strokeDasharray: '6 4',
          })
        )
      )}

      {/* Optional compact action pill ONLY when learner taps directly on a chalk explanation */}
      {selectedNoteId &&
        (() => {
          const ann = activeAnnotations.find((a) => a.annotation_id === selectedNoteId);
          if (!ann) return null;
          const noteGeo = resolvedLayoutByAnnId[ann.annotation_id]?.noteBox ?? ann.note_geometry;
          const left = noteGeo.minX * board.viewport.scale + board.viewport.offsetX;
          const top = (noteGeo.minY - 38) * board.viewport.scale + board.viewport.offsetY;
          return (
            <View
              style={[
                styles.tapActionBar,
                { left: Math.max(12, left), top: Math.max(8, top), backgroundColor: theme.uiSurfaceHex },
              ]}
            >
              <Pressable
                style={styles.tapActionBtn}
                onPress={() => speakKorean(ann.suggested_correction || ann.target_text)}
              >
                <Text style={[styles.tapActionText, { color: theme.uiTextHex }]}>Nghe mẫu</Text>
              </Pressable>
              <Pressable
                style={styles.tapActionBtn}
                onPress={() => {
                  onSelectNote(null);
                  onAnnotationPhaseCompleted(`__dismiss__${ann.annotation_id}`);
                }}
              >
                <Text style={[styles.tapActionText, { color: '#991B1B' }]}>Ẩn ghi chú</Text>
              </Pressable>
            </View>
          );
        })()}
    </>
  );
});

export function WonderBoardScreen({
  aiProfile,
  sidebarCollapsed,
  onToggleSidebar,
  onRecordLearningEvents,
}: WonderBoardScreenProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();

  const [boards, setBoards] = useState<WonderBoardDocument[]>(() => loadWonderBoards());
  const [activeBoardId, setActiveBoardId] = useState<string>(() =>
    loadActiveBoardId(loadWonderBoards())
  );
  const [privacy, setPrivacy] = useState<WonderPrivacyConfig>(() =>
    loadWonderPrivacyConfig()
  );

  const board = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? boards[0],
    [boards, activeBoardId]
  );
  const theme = WONDER_BOARD_THEMES[board.themeId];

  const [tool, setTool] = useState<WonderToolType>('chalk');
  const [inkColor, setInkColor] = useState<string>(theme.primaryInkHex);
  const [strokeWidth, setStrokeWidth] = useState<number>(3.6);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);

  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showDeferredNotes, setShowDeferredNotes] = useState(false);
  const [showSpecimensDrawer, setShowSpecimensDrawer] = useState(false);
  const [showTypedComposer, setShowTypedComposer] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [showBoardList, setShowBoardList] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [boardDraftText, setBoardDraftText] = useState('');
  const [confirmTextDraft, setConfirmTextDraft] = useState('');
  const [showConfirmInput, setShowConfirmInput] = useState(false);
  const [showDevCropPreview, setShowDevCropPreview] = useState(false);
  const [serverHealth, setServerHealth] = useState<WonderServerHealth | null>(null);
  const serverHealthRef = useRef<WonderServerHealth | null>(null);
  serverHealthRef.current = serverHealth;

  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [lassoPoly, setLassoPoly] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [stylusStatus, setStylusStatus] = useState<string>('Chuột / Bút');
  const [palmGuardEnabled, setPalmGuardEnabled] = useState<boolean>(true);
  const [lastPenTime, setLastPenTime] = useState<number>(0);
  const [animOverrideMap, setAnimOverrideMap] = useState<Record<string, LiveAnimProgress>>({});
  const [fontEpoch, setFontEpoch] = useState<number>(0);
  const [activeWritingBox, setActiveWritingBox] = useState<WonderBBox | null>(null);
  const lastFeedbackStartMsRef = useRef<number>(Date.now());
  const overlayHelpersRef = useRef<{
    getAnimationTimings: () => Record<
      string,
      WonderAnimationPhaseTimings & { actualCloudMs?: number; actualTextMs?: number }
    >;
    skipAnnotationAnim: (annId: string) => void;
  } | null>(null);
  const [recognitionDiagnostics, setRecognitionDiagnostics] = useState<
    WonderRecognitionDiagnosticEntry[]
  >([]);
  const recognitionDiagnosticsRef = useRef<WonderRecognitionDiagnosticEntry[]>([]);
  recognitionDiagnosticsRef.current = recognitionDiagnostics;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let mounted = true;
    const gDoc = (globalThis as unknown as {
      document?: {
        fonts?: {
          addEventListener?: (ev: string, fn: () => void) => void;
          removeEventListener?: (ev: string, fn: () => void) => void;
        };
      };
    }).document;
    const onLoadingDone = () => {
      if (mounted) setFontEpoch((e) => e + 1);
    };
    gDoc?.fonts?.addEventListener?.('loadingdone', onLoadingDone);
    waitForWonderFontsReady(1800).then(() => {
      if (mounted) setFontEpoch((e) => e + 1);
    });
    return () => {
      mounted = false;
      gDoc?.fonts?.removeEventListener?.('loadingdone', onLoadingDone);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let active = true;
    fetchWonderServerHealth(privacy.gatewayUrl, privacy.gatewayToken).then((health) => {
      if (active) setServerHealth(health);
    });
    return () => {
      active = false;
    };
  }, [privacy.gatewayUrl, privacy.gatewayToken]);

  const aiBackendLabel = useMemo(() => {
    if (!serverHealth?.tutorReady) return '';
    if (serverHealth.providers.deepseek) return 'DeepSeek';
    if (serverHealth.providers.gemini) return 'Gemini';
    if (serverHealth.providers.openai) return 'OpenAI';
    return 'Cloud AI';
  }, [serverHealth]);

  const activeAnnotationsForLayout = useMemo(
    () => board.annotations.filter((a) => a.status === 'active'),
    [board.annotations]
  );

  const isPhoneLayout = winWidth < 680;
  const activeSidebarWidth = !isPhoneLayout && !sidebarCollapsed ? 220 : 0;

  const resolvedLayoutByAnnId = useMemo(
    () =>
      buildResolvedAnnotationLayouts(
        board,
        activeAnnotationsForLayout,
        activeWritingBox,
        winWidth,
        winHeight,
        activeSidebarWidth,
        toolbarCollapsed
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeAnnotationsForLayout,
      activeWritingBox,
      activeSidebarWidth,
      board.regions,
      board.hangulDemos,
      board.strokes,
      board.teachingCards,
      board.viewport.offsetX,
      board.viewport.offsetY,
      board.viewport.scale,
      fontEpoch,
      toolbarCollapsed,
      winHeight,
      winWidth,
    ]
  );

  const canvasRef = useRef<WebCanvasElementLike | null>(null);
  const activeStrokeRef = useRef<WonderStroke | null>(null);
  const activeTouchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const panAnchorRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(
    null
  );
  const dragMoveAnchorRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(
    null
  );
  const rafHandleRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentStrokeTimesRef = useRef<number[]>([]);
  const writingCadenceMsRef = useRef<number>(650);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const visionCacheRef = useRef<WonderRecognitionCache>(new WonderRecognitionCache(64));
  const privacyRef = useRef<WonderPrivacyConfig>(privacy);
  privacyRef.current = privacy;
  const latestBoardRef = useRef<WonderBoardDocument>(board);
  latestBoardRef.current = board;

  const updateActiveBoard = (updater: (prev: WonderBoardDocument) => WonderBoardDocument) => {
    setBoards((prevList) => {
      const next = prevList.map((item) =>
        item.id === activeBoardId ? { ...updater(item), updatedAt: Date.now() } : item
      );
      saveWonderBoards(next);
      return next;
    });
  };

  const setTeacherState = (st: WonderTeacherState) => {
    if (latestBoardRef.current.teacherState === st) return;
    updateActiveBoard((b) => ({ ...b, teacherState: st }));
  };

  const handleSelectTheme = (nextThemeId: WonderBoardThemeId) => {
    const nextTheme = WONDER_BOARD_THEMES[nextThemeId];
    setInkColor(nextTheme.primaryInkHex);
    updateActiveBoard((b) => ({ ...b, themeId: nextThemeId }));
  };

  // High-DPI Canvas Render Loop (Decoupled from AI network work)
  const renderCanvasNow = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t0 = Date.now();
    const rect = canvas.getBoundingClientRect();
    const g = globalThis as unknown as { devicePixelRatio?: number };
    const dpr = Math.max(1, Math.min(2.5, g.devicePixelRatio ?? 1));
    const targetW = Math.max(300, Math.round(rect.width * dpr));
    const targetH = Math.max(240, Math.round(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentBoard = latestBoardRef.current;
    const currentTheme = WONDER_BOARD_THEMES[currentBoard.themeId];
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = currentTheme.backgroundHex;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (currentBoard.chalkTextureEnabled && currentTheme.isDark) {
      ctx.fillStyle = currentTheme.chalkDustHex;
      for (let i = 0; i < 80; i++) {
        const dx = (i * 197) % Math.max(200, Math.floor(rect.width));
        const dy = (i * 131) % Math.max(200, Math.floor(rect.height));
        ctx.fillRect(dx, dy, 2, 2);
      }
    }

    ctx.translate(currentBoard.viewport.offsetX, currentBoard.viewport.offsetY);
    ctx.scale(currentBoard.viewport.scale, currentBoard.viewport.scale);

    // Layer 5 Traceable Ghost Handwriting
    for (const card of currentBoard.teachingCards) {
      if (card.ghostHandwritingText && card.ghostBBox) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = currentTheme.aiSuggestionHex;
        ctx.font = `700 28px ${FONT_CHALK}`;
        ctx.fillText(card.ghostHandwritingText, card.ghostBBox.minX, card.ghostBBox.minY + 30);
        ctx.restore();
      }
    }

    // Layer 2 Original User Ink (connected smooth strokes)
    for (const st of currentBoard.strokes) {
      drawStrokeOnCtx(ctx, st, currentBoard.chalkTextureEnabled, currentTheme.backgroundHex);
    }

    if (activeStrokeRef.current) {
      drawStrokeOnCtx(
        ctx,
        activeStrokeRef.current,
        currentBoard.chalkTextureEnabled,
        currentTheme.backgroundHex
      );
    }

    ctx.restore();

    const frameMs = Math.max(1, Date.now() - t0);
    if (Math.abs(frameMs - currentBoard.telemetry.lastRenderFrameMs) > 6) {
      latestBoardRef.current.telemetry.lastRenderFrameMs = frameMs;
    }
  };

  const scheduleRender = () => {
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: () => void) => number;
    };
    if (typeof g.requestAnimationFrame === 'function') {
      if (rafHandleRef.current !== null) return;
      rafHandleRef.current = g.requestAnimationFrame(() => {
        rafHandleRef.current = null;
        renderCanvasNow();
      });
    } else {
      renderCanvasNow();
    }
  };

  useEffect(() => {
    if (Platform.OS === 'web') {
      renderCanvasNow();
    }
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = canvasRef.current as unknown as Element | null;
    const RO = (globalThis as unknown as {
      ResizeObserver?: new (cb: () => void) => {
        observe(target: Element): void;
        disconnect(): void;
      };
    }).ResizeObserver;
    if (!el || typeof RO !== 'function') return;
    const obs = new RO(() => scheduleRender());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Strip any legacy persisted unknown-ink/placeholder annotations on mount (never display "Xác nhận chữ viết" clouds)
  useEffect(() => {
    const cur = latestBoardRef.current;
    const stalePlaceholder = cur.annotations.filter(
      (a) =>
        a.status === 'active' &&
        (a.target_text === '내용' ||
          a.target_text === 'Chưa nhận dạng rõ' ||
          a.suggested_correction === 'Xác nhận chữ viết' ||
          a.annotation_type === 'ambiguity_check')
    );
    if (stalePlaceholder.length === 0) return;
    const staleIds = new Set(stalePlaceholder.map((a) => a.annotation_id));
    const updatedAnns = cur.annotations.filter((a) => !staleIds.has(a.annotation_id));
    const upgraded: WonderAnnotation[] = [];
    for (const old of stalePlaceholder) {
      const res = executeGestureQuery({
        board: { ...cur, annotations: updatedAnns },
        selectedStrokeIds: old.source_stroke_ids,
        intent: 'explain',
      });
      if (res.annotation) {
        upgraded.push(res.annotation);
      }
    }
    updateActiveBoard((b) => ({
      ...b,
      annotations: deduplicateWonderAnnotations([...updatedAnns, ...upgraded]),
    }));
  }, [activeBoardId]);

  // Living AI Continuous Recognition, Context Modeling, Reconciliation & Tutor Orchestrator V3
  const runAmbientAnalysis = async (targetRevision: number, forceReview = false) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const snapBoard = latestBoardRef.current;
    if (!snapBoard.aiEnabled || (snapBoard.aiMode === 'focus' && !forceReview)) {
      setTeacherState('IDLE');
      return;
    }
    if (snapBoard.revision !== targetRevision) return;

    if (analysisAbortRef.current) {
      analysisAbortRef.current.abort();
    }
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    analysisAbortRef.current = ac;

    setTeacherState('RECOGNIZING');
    const tRecStart = Date.now();

    try {
      const priv = privacyRef.current;
      const apiCfg = loadAiApiConfig();
      const resolvedProv = resolveProvider(apiCfg);
      const serverVisionReady = Boolean(serverHealthRef.current?.visionReady);
      const hasGateway = Boolean(priv.gatewayUrl.trim());
      const devDirectProv = resolvedProv ?? 'auto';
      const visionProvider = createBrowserVisionProvider({
        allowCloudAi: priv.allowCloudAi,
        gatewayUrl: priv.gatewayUrl,
        gatewayToken: priv.gatewayToken,
        sameOriginVisionReady: serverVisionReady,
        devDirectApiKey: apiCfg.apiKey,
        devDirectProvider: devDirectProv,
      });

      const noProviderReason =
        !serverVisionReady && !hasGateway
          ? !apiCfg.apiKey.trim()
            ? 'NO_VISION_CREDENTIALS'
            : !priv.allowCloudAi
              ? 'CLOUD_CONSENT_DISABLED'
              : undefined
          : undefined;

      const perception = await recognizeWithHybridPipeline({
        strokes: snapBoard.strokes,
        boardId: snapBoard.id,
        revision: snapBoard.revision,
        visionProvider,
        cropRenderer: renderObservationWindowSnapshot,
        cache: visionCacheRef.current,
        existingRegions: snapBoard.regions,
        visionFirst: true,
        signal: ac?.signal,
        forceRecognition: forceReview,
        bypassCache: forceReview,
        maxSubRegionBudget: 2,
        cloudConsentGranted: priv.allowCloudAi || serverVisionReady || hasGateway,
        noProviderReason,
        targetLanguage: snapBoard.targetLanguage ?? 'auto',
      });

      const regions = perception.regions;
      setRecognitionDiagnostics(perception.diagnostics);
      const recLatency = Math.max(1, Date.now() - tRecStart);

      if (ac?.signal.aborted || latestBoardRef.current.revision !== targetRevision) {
        return;
      }

      const dirty = computeDirtyRegions(snapBoard.regions, regions);
      const hasInProgress = regions.some((r) => r.completeness === 'in_progress');
      if (
        !forceReview &&
        hasInProgress &&
        regions.every((r) => r.completeness === 'in_progress')
      ) {
        updateActiveBoard((b) => ({
          ...b,
          regions,
          teacherState: 'WAITING_FOR_CONTEXT',
          telemetry: {
            ...b.telemetry,
            lastRecognitionLatencyMs: recLatency,
            lastSegmentationMs: perception.segmentationMs,
            lastLocalRecognitionMs: perception.localRecognitionMs,
            lastCloudRecognitionMs: perception.cloudRecognitionMs,
            apiCallCount: b.telemetry.apiCallCount + perception.apiCallsMade,
          },
        }));
        return;
      }

      // If user only moved strokes via lasso (geometryOnly), update geometry without replaying animations!
      if (
        dirty.dirtyRegionIds.length === 0 &&
        dirty.geometryOnlyRegionIds.length > 0 &&
        !forceReview
      ) {
        updateActiveBoard((b) => ({
          ...b,
          regions,
          annotations: reconcileAnnotationsWithStrokes(b.annotations, b.strokes, regions),
          teacherState: 'WAITING_FOR_LEARNER',
        }));
        return;
      }

      setTeacherState('ANALYZING');
      const tAiStart = Date.now();
      const effectiveBoard: WonderBoardDocument = forceReview
        ? { ...snapBoard, aiMode: 'review' }
        : snapBoard;

      const reconciled = reconcileAnnotationsWithStrokes(
        snapBoard.annotations,
        snapBoard.strokes,
        regions
      );

      const boardContext = buildBoardContextModel({
        boardId: effectiveBoard.id,
        revision: targetRevision,
        regions,
        strokes: effectiveBoard.strokes,
        existingAnnotations: reconciled,
        existingTeachingCards: effectiveBoard.teachingCards,
      });

      const tutorRes = orchestrateWonderTutor({
        board: effectiveBoard,
        regions,
        context: boardContext,
        existingAnnotations: reconciled,
        existingTeachingCards: effectiveBoard.teachingCards,
        learnerProfile: aiProfile,
        recordedEventKeys: new Set(effectiveBoard.recordedEventKeys ?? []),
        previousTree: effectiveBoard.semanticTree,
        writingCadenceMs: writingCadenceMsRef.current,
      });

      const aiLatency = Math.max(1, Date.now() - tAiStart);

      if (ac?.signal.aborted || latestBoardRef.current.revision !== targetRevision) {
        return;
      }

      // Consult /api/wonder/tutor (server-side DeepSeek / Gemini / OpenAI) on recognized regions
      // unless deterministic SLA engine already raised a concrete error, teaching card, or demo.
      let serverAnnotationsToAdd: WonderAnnotation[] = [];
      let serverTutorCalled = false;
      const recognizedRegionsForServer = regions.filter((r) => {
        if (tutorRes.practiceByRegionId[r.regionId]) return false;
        if (
          !(r.recognitionStatus === 'RECOGNIZED' || r.recognitionStatus === 'PARTIALLY_RECOGNIZED') ||
          r.recognizedText.trim().length === 0 ||
          r.completeness !== 'complete'
        ) {
          return false;
        }
        const sentNode = tutorRes.semanticTree.nodes.find((n) => n.id === `sent_${r.regionId}`);
        if (sentNode && selectInterventionGranularity(sentNode, effectiveBoard) === 'SILENT_OBSERVE') {
          return false;
        }
        return true;
      });
      const localHandledStrokeIds = new Set(
        [...reconciled.filter((a) => a.status === 'active'), ...tutorRes.annotationsToAdd]
          .filter(
            (a) =>
              a.severity === 'error' ||
              a.severity === 'praise' ||
              a.annotation_id.startsWith('srv_')
          )
          .flatMap((a) => a.source_stroke_ids)
      );
      const regionsNeedingServerTutor = recognizedRegionsForServer.filter((r) => {
        const alreadyCovered = r.strokeIds.some((id) => localHandledStrokeIds.has(id));
        if (alreadyCovered) return false;
        const coveredByTeachingCard =
          !forceReview &&
          tutorRes.teachingCardsToAdd.some((c) => c.sourceRevision === r.revision) &&
          recognizedRegionsForServer.length === 1;
        return !coveredByTeachingCard;
      });
      const canCallServerTutor =
        Boolean(serverHealthRef.current?.tutorReady) || Boolean(priv.gatewayUrl.trim());
      if (canCallServerTutor && regionsNeedingServerTutor.length > 0) {
        serverTutorCalled = true;
        const serverTutor = await requestWonderServerTutor({
          regions: regionsNeedingServerTutor.map((r) => ({
            regionId: r.regionId,
            recognizedText: r.recognizedText,
            language: r.language,
          })),
          guidanceLevel: effectiveBoard.guidanceLevel ?? 'guided',
          targetLanguage: effectiveBoard.targetLanguage ?? 'auto',
          intent: forceReview ? 'grammar_check' : 'ambient',
          revision: targetRevision,
          conversationMemory: effectiveBoard.conversationMemory ?? [],
          stream: true,
          gatewayUrl: priv.gatewayUrl,
          gatewayToken: priv.gatewayToken,
          signal: ac?.signal,
        });
        if (ac?.signal.aborted || latestBoardRef.current.revision !== targetRevision) {
          return;
        }
        const alreadyOccupied = [
          ...reconciled.filter((a) => a.status === 'active').map((a) => a.note_geometry),
          ...effectiveBoard.teachingCards.map((c) => c.geometry),
        ];
        serverAnnotationsToAdd = serverTutor.actions
          .filter(
            (act) =>
              act.type !== 'WAIT' &&
              act.type !== 'RETRACT_ANNOTATION' &&
              act.targetText.length > 0 &&
              (act.explanation.length > 0 || act.hint.length > 0 || act.suggestedCorrection.length > 0)
          )
          .slice(0, 6)
          .flatMap((act, idx) => {
            const matchedRegion = regionsNeedingServerTutor.find(
              (r) => r.regionId === act.regionId && r.recognizedText.includes(act.targetText));
            if (!matchedRegion) return [];
            const matchingSpans = matchedRegion.spans.filter((sp) => sp.text.includes(act.targetText));
            if (matchingSpans.length !== 1 && matchedRegion.recognizedText !== act.targetText) return [];
            const matchedSpan = matchingSpans.length === 1 ? matchingSpans[0] : undefined;
            const targetBox = matchedSpan?.bbox ?? matchedRegion.bbox;
            const targetStrokeIds =
              matchedSpan?.strokeIds && matchedSpan.strokeIds.length > 0
                ? matchedSpan.strokeIds
                : matchedRegion.strokeIds;
            return [
              buildAnnotationFromServerAction({
                action: act,
                boardId: effectiveBoard.id,
                revision: targetRevision,
                targetBox,
                targetStrokeIds,
                recognizedText: matchedRegion.recognizedText,
                startIndex: matchedSpan?.startIndex ?? 0,
                endIndex: matchedSpan?.endIndex ?? act.targetText.length,
                occupiedBoxes: alreadyOccupied,
                theme,
                idPrefix: 'srv_ann',
                seedIndex: idx,
              }),
            ];
          });
      }

      if (tutorRes.newEvents.length > 0) {
        onRecordLearningEvents(tutorRes.newEvents);
      }

      setRecognitionDiagnostics(
        perception.diagnostics.map((d) => {
          const activity = tutorRes.practiceByRegionId[d.regionId];
          const matchingAnns = [...reconciled, ...tutorRes.annotationsToAdd, ...serverAnnotationsToAdd].filter((a) =>
            a.status === 'active' && !tutorRes.retractedAnnotationIds.includes(a.annotation_id) &&
            !tutorRes.resolvedAnnotationIds.includes(a.annotation_id) &&
            (d.sourceStrokeIds?.some((sid) => a.source_stroke_ids.includes(sid)) ||
              (activity && a.teaching_activity_id === activity.activityId &&
                a.severity === 'info' && a.learning_concept_ids.includes(activity.conceptId ?? '')))
          );
          const decision =
            matchingAnns.length > 0
              ? matchingAnns.map((a) => `${a.granularity ?? 'AUTO'}:${a.target_text}`).join(', ')
              : d.recognitionStatus === 'RECOGNIZED'
                ? 'OBSERVE_OR_VALID'
                : 'DEFERRED_AMBIGUOUS';
          return {
            ...d,
            annotationDecision: activity?.suppressedReason ?? decision,
            learningIntent: tutorRes.intentsByRegionId[d.regionId]?.[0]?.intent,
            teachingActivityId: activity?.activityId,
            conceptIds: [...new Set([...(activity?.conceptId ? [activity.conceptId] : []),
              ...matchingAnns.flatMap((a) => a.learning_concept_ids)])],
            annotationIds: [...new Set(matchingAnns.map((a) => a.annotation_id))],
            suppressedFeedbackReason: activity?.suppressedReason ??
              (d.recognitionStatus !== 'RECOGNIZED' ? 'DEFERRED_AMBIGUOUS' : undefined),
          };
        })
      );

      updateActiveBoard((b) => {
        const resolvedSet = new Set(tutorRes.resolvedAnnotationIds);
        const retractedSet = new Set(tutorRes.retractedAnnotationIds);
        const mergedAnnotations = reconcileAnnotationsWithStrokes(
          b.annotations,
          b.strokes,
          regions
        ).map((a) => {
          if (resolvedSet.has(a.annotation_id)) {
            return { ...a, status: 'resolved' as const, reconciliation_action: 'RESOLVED' as const };
          }
          if (retractedSet.has(a.annotation_id) && a.status === 'active') {
            return {
              ...a,
              status: 'stale' as const,
              lifecycle_state: 'cancelled' as const,
              reconciliation_action: 'SUPERSEDED' as const,
              retracted_reason: 'Superseded by higher-level semantic node',
            };
          }
          return a;
        });
        const existingKeys = new Set(
          mergedAnnotations
            .filter((a) => a.status === 'active' || a.status === 'dismissed')
            .map((a) => a.stable_key)
        );
        const serverStrokeIds = new Set(serverAnnotationsToAdd.flatMap((a) => a.source_stroke_ids));
        const filteredLocalAdds =
          serverAnnotationsToAdd.length > 0
            ? tutorRes.annotationsToAdd.filter(
                (a) =>
                  a.severity === 'error' ||
                  !a.source_stroke_ids.some((id) => serverStrokeIds.has(id))
              )
            : tutorRes.annotationsToAdd;
        const uniqueNew = [...filteredLocalAdds, ...serverAnnotationsToAdd].filter(
          (a) => !existingKeys.has(a.stable_key)
        );
        let nextMemory = b.conversationMemory ?? [];
        for (const newAnn of uniqueNew.slice(0, 4)) {
          const regLang =
            regions.find((r) => r.strokeIds.some((sid) => newAnn.source_stroke_ids.includes(sid)))
              ?.language ?? 'unknown';
          nextMemory = appendConversationMemoryTurn(nextMemory, {
            turnId: newAnn.annotation_id,
            revision: targetRevision,
            timestamp: Date.now(),
            regionId: newAnn.parent_node_id ?? '',
            userText: newAnn.recognized_text.slice(0, 240),
            aiSummary: (newAnn.suggested_correction || newAnn.explanation).slice(0, 240),
            actionType: newAnn.annotation_type,
            language: regLang,
          });
        }
        const recordedKeys = Array.from(
          new Set([
            ...(b.recordedEventKeys ?? []),
            ...tutorRes.newEvents.map((e) => e.idempotencyKey ?? e.eventId),
          ])
        ).slice(-250);

        return {
          ...b,
          regions,
          boardContext,
          semanticTree: tutorRes.semanticTree,
          beginnerLoop: tutorRes.nextBeginnerLoop,
          conversationMemory: nextMemory,
          teacherState:
            uniqueNew.length > 0 ? 'PLANNING_FEEDBACK' : tutorRes.recommendedTeacherState,
          annotations: deduplicateWonderAnnotations([...mergedAnnotations, ...uniqueNew]),
          teachingCards: [...b.teachingCards, ...tutorRes.teachingCardsToAdd],
          hangulDemos: [...(b.hangulDemos ?? []), ...tutorRes.hangulDemosToAdd],
          deferredActions: tutorRes.deferredActions,
          recordedEventKeys: recordedKeys,
          events: [...b.events, ...tutorRes.newEvents].slice(-120),
          telemetry: {
            ...b.telemetry,
            lastRecognitionLatencyMs: recLatency,
            lastAiLatencyMs: aiLatency,
            lastSegmentationMs: perception.segmentationMs,
            lastLocalRecognitionMs: perception.localRecognitionMs,
            lastCloudRecognitionMs: perception.cloudRecognitionMs,
            lastLinguisticAnalysisMs: aiLatency,
            apiCallCount: b.telemetry.apiCallCount + perception.apiCallsMade + (serverTutorCalled ? 1 : 0),
          },
        };
      });
    } catch {
      updateActiveBoard((b) => ({
        ...b,
        teacherState: 'OBSERVING',
        telemetry: { ...b.telemetry, errorCount: b.telemetry.errorCount + 1 },
      }));
    }
  };

  const scheduleAmbientAi = (revisionAfterCommit: number, adaptiveDelayMs = 1100) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      runAmbientAnalysis(revisionAfterCommit);
    }, adaptiveDelayMs);
  };

  const screenToWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const { offsetX, offsetY, scale } = latestBoardRef.current.viewport;
    return {
      x: (sx - offsetX) / scale,
      y: (sy - offsetY) / scale,
    };
  };

  const handlePointerDown = (rawEvent: WebPointerEventLike) => {
    const ev = rawEvent.nativeEvent ?? rawEvent;
    ev.preventDefault?.();

    const pType = ev.pointerType || 'mouse';
    const isPen = pType === 'pen';
    if (isPen) {
      setLastPenTime(Date.now());
      setStylusStatus(
        `Apple Pencil / Bút (Lực ${Math.round((ev.pressure ?? 0.5) * 100)}%)`
      );
    } else if (pType === 'touch') {
      activeTouchPointsRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (activeTouchPointsRef.current.size === 2) {
        activeStrokeRef.current = null;
        const pts = Array.from(activeTouchPointsRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        pinchStateRef.current = {
          dist,
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
        };
        return;
      }
      if (palmGuardEnabled && Date.now() - lastPenTime < 1400 && tool !== 'pan') {
        return;
      }
      setStylusStatus('Cảm ứng chạm');
    } else {
      setStylusStatus('Chuột');
    }

    canvasRef.current?.setPointerCapture?.(ev.pointerId);

    if (tool === 'pan') {
      panAnchorRef.current = {
        x: ev.clientX,
        y: ev.clientY,
        origX: latestBoardRef.current.viewport.offsetX,
        origY: latestBoardRef.current.viewport.offsetY,
      };
      return;
    }

    const worldPt = screenToWorld(ev.clientX, ev.clientY);

    if (tool === 'lasso' && selectedStrokeIds.length > 0) {
      const selSet = new Set(selectedStrokeIds);
      const selBoxes = latestBoardRef.current.strokes
        .filter((s) => !s.deleted && selSet.has(s.id))
        .map((s) => s.bbox);
      const selUnion = mergeBoundingBoxes(selBoxes);
      if (
        worldPt.x >= selUnion.minX - 10 &&
        worldPt.x <= selUnion.maxX + 10 &&
        worldPt.y >= selUnion.minY - 10 &&
        worldPt.y <= selUnion.maxY + 10
      ) {
        dragMoveAnchorRef.current = { x: worldPt.x, y: worldPt.y, dx: 0, dy: 0 };
        return;
      }
      setSelectedStrokeIds([]);
    }

    if (tool === 'lasso' || tool === 'ai_lasso') {
      setLassoPoly([worldPt]);
      return;
    }

    if (tool === 'eraser_stroke') {
      const hitStroke = [...latestBoardRef.current.strokes]
        .reverse()
        .find(
          (s) =>
            !s.deleted &&
            worldPt.x >= s.bbox.minX - 12 &&
            worldPt.x <= s.bbox.maxX + 12 &&
            worldPt.y >= s.bbox.minY - 12 &&
            worldPt.y <= s.bbox.maxY + 12
        );
      if (hitStroke) {
        const nextRev = latestBoardRef.current.revision + 1;
        updateActiveBoard((b) => {
          const nextStrokes = b.strokes.map((s) =>
            s.id === hitStroke.id ? { ...s, deleted: true, revision: nextRev } : s
          );
          return {
            ...b,
            revision: nextRev,
            strokes: nextStrokes,
            annotations: reconcileAnnotationsWithStrokes(b.annotations, nextStrokes),
          };
        });
        scheduleAmbientAi(nextRev, 900);
      }
      return;
    }

    const strokeTool =
      tool === 'pencil'
        ? 'pencil'
        : tool === 'highlighter'
          ? 'highlighter'
          : tool === 'eraser_pixel'
            ? 'eraser_pixel'
            : 'chalk';

    const initPts = [
      {
        x: worldPt.x,
        y: worldPt.y,
        pressure: ev.pressure && ev.pressure > 0 ? ev.pressure : 0.55,
        tiltX: ev.tiltX,
        tiltY: ev.tiltY,
        t: Date.now(),
      },
    ];
    activeStrokeRef.current = {
      id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boardId: latestBoardRef.current.id,
      points: initPts,
      color: inkColor,
      width: strokeWidth,
      tool: strokeTool,
      bbox: computeStrokeBoundingBox(initPts, 0, 0, strokeWidth, strokeTool),
      transform: { dx: 0, dy: 0 },
      revision: latestBoardRef.current.revision + 1,
      createdAt: Date.now(),
      provenance: 'freehand_ink',
    };
    if (strokeTool !== 'eraser_pixel') setActiveWritingBox(activeStrokeRef.current.bbox);
    scheduleRender();
  };

  const handlePointerMove = (rawEvent: WebPointerEventLike) => {
    const ev = rawEvent.nativeEvent ?? rawEvent;
    ev.preventDefault?.();

    if (ev.pointerType === 'touch' && activeTouchPointsRef.current.has(ev.pointerId)) {
      activeTouchPointsRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (activeTouchPointsRef.current.size === 2 && pinchStateRef.current) {
        const pts = Array.from(activeTouchPointsRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const factor = dist / Math.max(10, pinchStateRef.current.dist);
        const panDx = cx - pinchStateRef.current.cx;
        const panDy = cy - pinchStateRef.current.cy;
        pinchStateRef.current = { dist, cx, cy };
        updateActiveBoard((b) => ({
          ...b,
          viewport: {
            scale: Math.max(0.25, Math.min(2.6, b.viewport.scale * factor)),
            offsetX: b.viewport.offsetX + panDx,
            offsetY: b.viewport.offsetY + panDy,
          },
        }));
        return;
      }
    }

    if (panAnchorRef.current) {
      const dx = ev.clientX - panAnchorRef.current.x;
      const dy = ev.clientY - panAnchorRef.current.y;
      const origX = panAnchorRef.current.origX;
      const origY = panAnchorRef.current.origY;
      updateActiveBoard((b) => ({
        ...b,
        viewport: { ...b.viewport, offsetX: origX + dx, offsetY: origY + dy },
      }));
      return;
    }

    if (dragMoveAnchorRef.current && selectedStrokeIds.length > 0) {
      const worldPt = screenToWorld(ev.clientX, ev.clientY);
      const stepDx = worldPt.x - dragMoveAnchorRef.current.x;
      const stepDy = worldPt.y - dragMoveAnchorRef.current.y;
      dragMoveAnchorRef.current.x = worldPt.x;
      dragMoveAnchorRef.current.y = worldPt.y;
      const selSet = new Set(selectedStrokeIds);
      updateActiveBoard((b) => {
        const nextRev = b.revision + 1;
        const moved = translateStrokes(b.strokes, selSet, stepDx, stepDy, nextRev);
        return {
          ...b,
          revision: nextRev,
          strokes: moved,
          annotations: reconcileAnnotationsWithStrokes(b.annotations, moved),
        };
      });
      return;
    }

    if (tool === 'lasso' || tool === 'ai_lasso') {
      if (lassoPoly.length > 0) {
        const worldPt = screenToWorld(ev.clientX, ev.clientY);
        setLassoPoly((prev) => [...prev, worldPt]);
      }
      return;
    }

    const active = activeStrokeRef.current;
    if (!active) return;

    const coalesced =
      typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
    const samples = coalesced.length > 0 ? coalesced : [ev];

    for (const s of samples) {
      const pt = screenToWorld(s.clientX, s.clientY);
      active.points.push({
        x: pt.x,
        y: pt.y,
        pressure: s.pressure && s.pressure > 0 ? s.pressure : 0.55,
        tiltX: s.tiltX,
        tiltY: s.tiltY,
        t: Date.now(),
      });
    }
    active.bbox = computeStrokeBoundingBox(
      active.points,
      0,
      0,
      active.width,
      active.tool
    );
    if (active.tool !== 'eraser_pixel') setActiveWritingBox(active.bbox);
    scheduleRender();
  };

  const handlePointerUp = (rawEvent: WebPointerEventLike) => {
    setActiveWritingBox(null);
    const ev = rawEvent.nativeEvent ?? rawEvent;
    activeTouchPointsRef.current.delete(ev.pointerId);
    if (activeTouchPointsRef.current.size < 2) {
      pinchStateRef.current = null;
    }
    panAnchorRef.current = null;
    dragMoveAnchorRef.current = null;
    canvasRef.current?.releasePointerCapture?.(ev.pointerId);

    if ((tool === 'lasso' || tool === 'ai_lasso') && lassoPoly.length >= 3) {
      const hitIds = findStrokesInPolygon(latestBoardRef.current.strokes, lassoPoly);
      setSelectedStrokeIds(hitIds);
      setLassoPoly([]);
      return;
    } else if (lassoPoly.length > 0) {
      setLassoPoly([]);
    }

    const active = activeStrokeRef.current;
    if (!active) return;
    activeStrokeRef.current = null;

    const nextRevision = latestBoardRef.current.revision + 1;
    const finalized: WonderStroke = {
      ...active,
      revision: nextRevision,
      bbox: computeStrokeBoundingBox(active.points, 0, 0, active.width, active.tool),
    };

    const strokeEndNow = Date.now();
    recentStrokeTimesRef.current = [...recentStrokeTimesRef.current.slice(-14), strokeEndNow];
    const strokesAfterCommit = [...latestBoardRef.current.strokes, finalized];
    const adaptiveTiming = computeAdaptiveAnalysisDelayMs(
      recentStrokeTimesRef.current,
      strokesAfterCommit,
      latestBoardRef.current.regions[latestBoardRef.current.regions.length - 1]
    );
    writingCadenceMsRef.current = adaptiveTiming.writingCadenceMs;

    updateActiveBoard((b) => {
      const nextStrokes = [...b.strokes, finalized];
      return {
        ...b,
        revision: nextRevision,
        strokes: nextStrokes,
        redoStack: [],
        annotations: reconcileAnnotationsWithStrokes(b.annotations, nextStrokes),
      };
    });
    scheduleAmbientAi(nextRevision, adaptiveTiming.semanticDelayMs);
  };

  const handleWheelZoom = (ev: WebWheelEventLike) => {
    ev.preventDefault?.();
    const factor = ev.deltaY < 0 ? 1.09 : 0.92;
    updateActiveBoard((b) => ({
      ...b,
      viewport: {
        ...b.viewport,
        scale: Math.max(0.25, Math.min(2.6, b.viewport.scale * factor)),
      },
    }));
  };

  const handleUndo = () => {
    updateActiveBoard((b) => {
      const visible = b.strokes.filter((s) => !s.deleted);
      if (visible.length === 0) return b;
      const last = visible[visible.length - 1];
      const nextRev = b.revision + 1;
      const nextStrokes = b.strokes.filter((s) => s.id !== last.id);
      return {
        ...b,
        revision: nextRev,
        strokes: nextStrokes,
        redoStack: [...b.redoStack, last],
        annotations: reconcileAnnotationsWithStrokes(b.annotations, nextStrokes),
      };
    });
  };

  const handleRedo = () => {
    updateActiveBoard((b) => {
      if (b.redoStack.length === 0) return b;
      const restored = b.redoStack[b.redoStack.length - 1];
      const nextRev = b.revision + 1;
      const nextStrokes = [...b.strokes, { ...restored, deleted: false, revision: nextRev }];
      return {
        ...b,
        revision: nextRev,
        strokes: nextStrokes,
        redoStack: b.redoStack.slice(0, -1),
      };
    });
  };

  const handleClearBoard = () => {
    setConfirmClearOpen(false);
    setSelectedStrokeIds([]);
    setSelectedNoteId(null);
    setAnimOverrideMap({});
    setShowConfirmInput(false);
    setConfirmTextDraft('');
    updateActiveBoard((b) => ({
      ...b,
      revision: b.revision + 1,
      teacherState: 'OBSERVING',
      strokes: [],
      redoStack: [],
      regions: [],
      annotations: [],
      teachingCards: [],
      boardContext: undefined,
      beginnerLoop: undefined,
      hangulDemos: [],
      deferredActions: [],
    }));
  };

  const renderExportPngDataUrl = (): string => {
    if (Platform.OS !== 'web') return '';
    const srcCanvas = canvasRef.current;
    const doc = (globalThis as unknown as {
      document?: {
        createElement(t: string): {
          width: number;
          height: number;
          getContext(t: '2d'): {
            fillStyle: string;
            strokeStyle: string;
            lineWidth: number;
            lineCap: string;
            lineJoin: string;
            globalAlpha: number;
            font: string;
            save(): void;
            restore(): void;
            scale(sx: number, sy: number): void;
            translate(tx: number, ty: number): void;
            fillRect(x: number, y: number, w: number, h: number): void;
            fillText(text: string, x: number, y: number): void;
            measureText(text: string): { width: number };
            stroke(path?: unknown): void;
          } | null;
          toDataURL(t?: string): string;
        };
      };
    }).document;
    if (!srcCanvas || !doc) return '';

    const rect = srcCanvas.getBoundingClientRect();
    const g = globalThis as unknown as {
      devicePixelRatio?: number;
      Path2D?: new (d: string) => unknown;
    };
    const dpr = Math.max(1, Math.min(2, g.devicePixelRatio ?? 1));
    const cssW = Math.max(400, Math.round(rect.width || 1100));
    const cssH = Math.max(300, Math.round(rect.height || 720));

    const out = doc.createElement('canvas');
    out.width = Math.round(cssW * dpr);
    out.height = Math.round(cssH * dpr);
    const ctx = out.getContext('2d');
    if (!ctx) return srcCanvas.toDataURL?.('image/png') ?? '';

    const curBoard = latestBoardRef.current;
    const curTheme = WONDER_BOARD_THEMES[curBoard.themeId];
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = curTheme.backgroundHex;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.translate(curBoard.viewport.offsetX, curBoard.viewport.offsetY);
    ctx.scale(curBoard.viewport.scale, curBoard.viewport.scale);

    // Layer 2 Original Ink
    for (const st of curBoard.strokes) {
      drawStrokeOnCtx(
        ctx as unknown as WebCanvasContextLike,
        st,
        curBoard.chalkTextureEnabled,
        curTheme.backgroundHex
      );
    }

    // Layer 4 Organic Clouds, Arrows & Mixed-Language Runs
    if (curBoard.showAnnotations) {
      const Path2DCtor = g.Path2D;
      const activeAnns = curBoard.annotations.filter((a) => a.status === 'active');
      const layouts = buildResolvedAnnotationLayouts(curBoard, activeAnns, null);
      const vScale = Math.max(0.35, curBoard.viewport.scale || 1);
      const zoomStrokeComp =
        vScale < 1
          ? Math.min(1.85, 1 / Math.pow(vScale, 0.65))
          : Math.max(0.85, 1 / Math.pow(vScale, 0.25));

      const drawMixedLine = (
        lineText: string,
        role: 'correction' | 'explanation',
        baseSize: number,
        startX: number,
        baseY: number,
        color: string
      ) => {
        const runs = segmentMixedLanguageRuns(lineText, role, baseSize);
        let cursorX = startX;
        ctx.fillStyle = color;
        for (const r of runs) {
          ctx.font = `${r.fontWeight} ${r.fontSize}px ${r.fontFamily}`;
          const yAdj = baseY + r.baselineShiftEm * baseSize;
          ctx.fillText(r.text, cursorX, yAdj);
          cursorX += ctx.measureText(r.text).width;
        }
      };

      for (const ann of activeAnns) {
        const l = layouts[ann.annotation_id];
        if (!l) continue;
        const accent = ann.visual_style.accentColor;
        const targetH = Math.max(28, ann.target_geometry.height);
        const sizeStrokeComp = Math.max(1.0, Math.min(1.38, targetH / 115));
        const cloudStrokeW = Number((3.4 * zoomStrokeComp * sizeStrokeComp).toFixed(2));
        const arrowStrokeW = Number((2.6 * zoomStrokeComp * sizeStrokeComp).toFixed(2));

        if (Path2DCtor) {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = cloudStrokeW;
          if (l.cloudVisible) ctx.stroke(new Path2DCtor(l.cloud.pathData));

          const arrowPaths = sliceArrowPathAtProgress(l.arrow, 1);
          ctx.lineWidth = arrowStrokeW;
          if (arrowPaths.shaftPath) ctx.stroke(new Path2DCtor(arrowPaths.shaftPath));
          if (arrowPaths.headPath) ctx.stroke(new Path2DCtor(arrowPaths.headPath));
        }

        if (!l.noteVisible) continue;
        ctx.globalAlpha = 1;
        l.headerMetrics.lines.forEach((hl, idx) => {
          drawMixedLine(
            hl.text,
            'correction',
            l.headerFontSize,
            l.textBaseX,
            l.textBaseY + idx * Math.round(l.headerFontSize * 1.32),
            accent
          );
        });
        const hdrH =
          Math.max(1, l.headerMetrics.lines.length) * Math.round(l.headerFontSize * 1.32);
        l.explMetrics.lines.forEach((el, idx) => {
          drawMixedLine(
            el.text,
            'explanation',
            l.explFontSize,
            l.textBaseX,
            l.textBaseY +
              hdrH -
              Math.round(l.headerFontSize * 0.45) +
              l.explGapTop +
              idx * l.explLineHeight,
            curTheme.primaryInkHex
          );
        });
      }
    }

    ctx.restore();
    return out.toDataURL('image/png');
  };

  const handleExportPng = () => {
    const url = renderExportPngDataUrl();
    if (!url) return;
    const doc = (globalThis as unknown as {
      document?: {
        createElement(t: string): { href: string; download: string; click(): void };
      };
    }).document;
    if (!doc) return;
    const link = doc.createElement('a');
    link.href = url;
    link.download = `${board.title.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.click();
  };

  const handleGestureAction = async (intent: WonderGestureIntent) => {
    if (selectedStrokeIds.length === 0) return;
    const snapBoard = latestBoardRef.current;
    const selSet = new Set(selectedStrokeIds);
    const filteredExisting = snapBoard.annotations.filter(
      (a) =>
        !(
          a.status === 'active' &&
          (a.annotation_type === 'explanation' || a.annotation_type === 'ambiguity_check') &&
          a.source_stroke_ids.some((id) => selSet.has(id))
        )
    );

    const matchedRegions = snapBoard.regions.filter(
      (r) => r.recognizedText.trim().length > 0 && r.strokeIds.some((id) => selSet.has(id))
    );
    const selStrokes = snapBoard.strokes.filter((s) => !s.deleted && selSet.has(s.id));
    const fallbackRegs =
      matchedRegions.length > 0 || selStrokes.length === 0
        ? matchedRegions
        : recognizeHandwritingRegions(selStrokes, snapBoard.id, snapBoard.revision).filter(
            (r) => r.recognizedText.trim().length > 0
          );

    const canCallServerTutor =
      Boolean(serverHealthRef.current?.tutorReady) || Boolean(privacyRef.current.gatewayUrl.trim());
    const serverIntent =
      intent === 'explain' ||
      intent === 'translate' ||
      intent === 'grammar_check' ||
      intent === 'practice_exercise'
        ? intent
        : null;

    const localHangulExercise = intent === 'practice_exercise' && fallbackRegs.length === 1 &&
      decomposeHangulUnit(fallbackRegs[0].recognizedText);
    if (canCallServerTutor && serverIntent && !localHangulExercise && fallbackRegs.length > 0 && selStrokes.length > 0) {
      setTeacherState('ANALYZING');
      const serverTutor = await requestWonderServerTutor({
        regions: fallbackRegs.map((r) => ({
          regionId: r.regionId,
          recognizedText: r.recognizedText,
          language: r.language,
        })),
        guidanceLevel: snapBoard.guidanceLevel ?? 'guided',
        intent: serverIntent,
        gatewayUrl: privacyRef.current.gatewayUrl,
        gatewayToken: privacyRef.current.gatewayToken,
      });
      const anchoredActions = serverTutor.actions.flatMap((act) => {
        if (act.type === 'WAIT' || !act.targetText || !act.explanation) return [];
        const matched = fallbackRegs.find((r) => r.regionId === act.regionId);
        if (!matched || !matched.recognizedText.includes(act.targetText)) return [];
        const spans = matched.spans.filter((item) => item.text.includes(act.targetText));
        if (spans.length !== 1 && matched.recognizedText !== act.targetText) return [];
        const targetIds = spans.length === 1 && spans[0].strokeIds.length ? spans[0].strokeIds : matched.strokeIds;
        return targetIds.length && targetIds.every((id) => selSet.has(id)) ? [{ act, matched, targetIds }] : [];
      });
      const anchored = anchoredActions[0];
      if (anchored) {
        const { act, matched, targetIds } = anchored;
        const targetBox = mergeBoundingBoxes(selStrokes.filter((stroke) => targetIds.includes(stroke.id)).map((s) => s.bbox));
        const occupiedBoxes = [
          ...snapBoard.strokes.filter((s) => !s.deleted).map((s) => s.bbox),
          ...filteredExisting.filter((a) => a.status === 'active').map((a) => a.note_geometry),
          ...snapBoard.teachingCards.map((c) => c.geometry),
        ];
        const ann = buildAnnotationFromServerAction({
          action: act,
          boardId: snapBoard.id,
          revision: snapBoard.revision,
          targetBox,
          targetStrokeIds: targetIds,
          recognizedText: matched.recognizedText,
          startIndex: matched.recognizedText.indexOf(act.targetText),
          endIndex: matched.recognizedText.indexOf(act.targetText) + act.targetText.length,
          occupiedBoxes,
          theme,
          idPrefix: `srv_gest_${intent}`,
          seedIndex: Math.floor(Date.now() % 100),
        });
        updateActiveBoard((b) => {
          const baseAnns = b.annotations.filter(
            (a) =>
              !(
                a.status === 'active' &&
                (a.annotation_type === 'explanation' || a.annotation_type === 'ambiguity_check') &&
                a.source_stroke_ids.some((id) => selSet.has(id))
              )
          );
          return {
            ...b,
            teacherState: 'PLANNING_FEEDBACK',
            annotations: deduplicateWonderAnnotations([...baseAnns, ann]),
            telemetry: {
              ...b.telemetry,
              apiCallCount: b.telemetry.apiCallCount + 1,
            },
          };
        });
        setSelectedStrokeIds([]);
        return;
      }
      setTeacherState('OBSERVING');
    }

    const res = executeGestureQuery({
      board: { ...snapBoard, annotations: filteredExisting },
      selectedStrokeIds,
      intent,
    });
    if (!res.annotation && !res.teachingCard) {
      onRecordLearningEvents([res.event]);
      // Open quiet inline confirmation input on floating toolbar instead of spawning an ugly cloud
      setShowConfirmInput(true);
      return;
    }
    onRecordLearningEvents([res.event]);
    updateActiveBoard((b) => {
      const baseAnns = b.annotations.filter(
        (a) =>
          !(
            a.status === 'active' &&
            (a.annotation_type === 'explanation' || a.annotation_type === 'ambiguity_check') &&
            a.source_stroke_ids.some((id) => selSet.has(id))
          )
      );
      return {
        ...b,
        annotations: res.annotation
          ? deduplicateWonderAnnotations([...baseAnns, res.annotation])
          : baseAnns,
        teachingCards: res.teachingCard
          ? [...b.teachingCards, res.teachingCard]
          : b.teachingCards,
        events: [...b.events, res.event].slice(-120),
      };
    });
    setSelectedStrokeIds([]);
  };

  const handleInsertSampleFixture = (
    sampleText: string,
    modeOverride?: WonderAiMode,
    startX = 70,
    explicitY?: number,
    provenance: 'fixture_sample' | 'typed_vector' = 'fixture_sample',
    analyzeImmediately = false
  ) => {
    setShowSpecimensDrawer(false);
    const curBoard = latestBoardRef.current;
    const activeVisible = curBoard.strokes.filter((s) => !s.deleted);
    const maxY = activeVisible.reduce((m, s) => Math.max(m, s.bbox.maxY), 70);
    const startY = explicitY ?? (activeVisible.length === 0 ? 85 : maxY + 95);
    const nextRev = curBoard.revision + 1;
    const generated = generateHandwrittenStrokesForText({
      boardId: curBoard.id,
      text: sampleText,
      startX,
      startY,
      revision: nextRev,
      color: theme.primaryInkHex,
      tool: 'chalk',
      seed: nextRev,
      provenance,
    });

    updateActiveBoard((b) => ({
      ...b,
      aiMode: modeOverride ?? b.aiMode,
      aiEnabled: true,
      revision: nextRev,
      strokes: [...b.strokes, ...generated],
    }));
    if (analyzeImmediately) {
      setTimeout(() => runAmbientAnalysis(nextRev), 25);
    } else {
      scheduleAmbientAi(nextRev, 450);
    }
  };

  const handleAnnotationPhaseCompleted = (rawId: string) => {
    if (rawId.startsWith('__dismiss__')) {
      const targetId = rawId.replace('__dismiss__', '');
      updateActiveBoard((b) => ({
        ...b,
        annotations: b.annotations.map((a) =>
          a.annotation_id === targetId
            ? { ...a, status: 'dismissed', reconciliation_action: 'DISMISSED' }
            : a
        ),
      }));
      return;
    }

    updateActiveBoard((b) => ({
      ...b,
      annotations: b.annotations.map((a) =>
        a.annotation_id === rawId
          ? {
            ...a,
            lifecycle_state: 'completed',
            animation_progress: {
              cloud: 1,
              arrow: 1,
              correction: 1,
              explanation: 1,
              completed: true,
            },
          }
          : a
      ),
    }));
  };

  const handleCreateBoard = () => {
    const title = newBoardName.trim() || `Bảng học #${boards.length + 1}`;
    const created = createEmptyWonderBoard(
      `board_${Date.now()}`,
      title,
      board.themeId
    );
    const nextList = [...boards, created];
    setBoards(nextList);
    saveWonderBoards(nextList);
    setActiveBoardId(created.id);
    saveActiveBoardId(created.id);
    setNewBoardName('');
    setShowBoardList(false);
  };

  const handleSwitchBoard = (id: string) => {
    setActiveBoardId(id);
    saveActiveBoardId(id);
    setSelectedStrokeIds([]);
    setSelectedNoteId(null);
    setShowBoardList(false);
  };

  const handleWipeBoardData = () => {
    const fresh = deleteAllWonderBoardData();
    setBoards(fresh);
    setActiveBoardId(fresh[0].id);
    setShowSettingsDrawer(false);
  };

  // Expose deterministic inspection & animation scrubbing API for Playwright/CDP browser validation
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const g = globalThis as unknown as {
      __WONDER_BOARD_TEST__?: unknown;
    };
    g.__WONDER_BOARD_TEST__ = {
      getState: () => ({
        board: latestBoardRef.current,
        animOverrideMap,
        viewport: latestBoardRef.current.viewport,
        diagnostics: recognitionDiagnosticsRef.current,
      }),
      getDiagnostics: () => recognitionDiagnosticsRef.current,
      setZoomScale: (scale: number) => {
        updateActiveBoard((b) => ({
          ...b,
          viewport: { ...b.viewport, scale: Math.max(0.25, Math.min(2.6, scale)) },
        }));
      },
      setTargetLanguage: (targetLanguage: WonderTargetLanguage) => {
        updateActiveBoard((b) => ({
          ...b,
          targetLanguage,
        }));
      },
      clearBoard: handleClearBoard,
      insertSample: (text: string, mode?: WonderAiMode, startX = 70, startY?: number) => {
        handleInsertSampleFixture(text, mode, startX, startY, 'fixture_sample', true);
      },
      appendStrokeIncremental: (text: string, startX: number, startY: number) => {
        handleInsertSampleFixture(text, 'tutor', startX, startY, 'fixture_sample', true);
      },
      editFirstRegionStrokes: (replacementText: string) => {
        const cur = latestBoardRef.current;
        const firstReg = cur.regions[0];
        if (!firstReg) return;
        const removeSet = new Set(firstReg.strokeIds);
        const nextRev = cur.revision + 1;
        const replacement = generateHandwrittenStrokesForText({
          boardId: cur.id,
          text: replacementText,
          startX: 70,
          startY: 85,
          revision: nextRev,
          color: theme.primaryInkHex,
          tool: 'chalk',
          seed: nextRev,
          provenance: 'fixture_sample',
        });
        updateActiveBoard((b) => {
          const filtered = b.strokes.filter((s) => !removeSet.has(s.id));
          const merged = [...filtered, ...replacement];
          return {
            ...b,
            revision: nextRev,
            strokes: merged,
            annotations: reconcileAnnotationsWithStrokes(b.annotations, merged),
          };
        });
        setTimeout(() => runAmbientAnalysis(nextRev), 25);
      },
      setAnimationSpeed: (speed: WonderAnimationSpeed) => {
        updateActiveBoard((b) => ({ ...b, animationSpeed: speed }));
      },
      scrubAllAnnotations: (progress: {
        cloud: number;
        arrow: number;
        correction: number;
        explanation: number;
        completed?: boolean;
      }) => {
        const next: Record<string, LiveAnimProgress> = {};
        for (const a of latestBoardRef.current.annotations) {
          if (a.status !== 'active') continue;
          next[a.annotation_id] = {
            cloud: progress.cloud,
            arrow: progress.arrow,
            correction: progress.correction,
            explanation: progress.explanation,
            phase: progress.completed ? 'done' : 'cloud',
            completed: Boolean(progress.completed),
          };
        }
        setAnimOverrideMap(next);
        if (progress.completed) {
          updateActiveBoard((b) => ({
            ...b,
            annotations: b.annotations.map((a) =>
              a.status === 'active'
                ? {
                  ...a,
                  lifecycle_state: 'completed',
                  animation_progress: {
                    cloud: progress.cloud,
                    arrow: progress.arrow,
                    correction: progress.correction,
                    explanation: progress.explanation,
                    completed: true,
                  },
                }
                : a
            ),
          }));
        }
      },
      clearAnimOverride: () => setAnimOverrideMap({}),
      setViewport: (scale: number, offsetX = 0, offsetY = 0) => {
        updateActiveBoard((b) => ({ ...b, viewport: { scale, offsetX, offsetY } }));
      },
      runAnalysisNow: () => runAmbientAnalysis(latestBoardRef.current.revision, false),
      getBenchmarkV3: () => evaluateWonderBoardBenchmarkV3(),
      getFontEpoch: () => fontEpoch,
      exportPngDataUrl: () => renderExportPngDataUrl(),
      getAnimationTimings: () => overlayHelpersRef.current?.getAnimationTimings() ?? {},
      skipAnnotationAnim: (annId: string) => overlayHelpersRef.current?.skipAnnotationAnim(annId),
      getMeasuredLayouts: () => {
        const res: Record<string, { noteBox: WonderBBox; arrow: WonderAnnotation['arrow_path']; headerFontSize: number; explFontSize: number; lines: string[]; cloudBounds: WonderBBox; noteVisible: boolean; cloudVisible: boolean }> = {};
        for (const [id, l] of Object.entries(resolvedLayoutByAnnId)) {
          res[id] = {
            noteBox: l.noteBox,
            arrow: l.arrow,
            headerFontSize: l.headerFontSize,
            explFontSize: l.explFontSize,
            lines: [
              ...l.headerMetrics.lines.map((x) => x.text),
              ...l.explMetrics.lines.map((x) => x.text),
            ],
            cloudBounds: l.cloud.outerBounds,
            noteVisible: l.noteVisible,
            cloudVisible: l.cloudVisible,
          };
        }
        return res;
      },
      injectMixedLanguageAnnotations: (
        cases: Array<{
          targetText: string;
          suggestedCorrection: string;
          explanation: string;
          severity?: WonderAnnotation['severity'];
          box?: WonderBBox;
        }>
      ) => {
        const cur = latestBoardRef.current;
        const rev = cur.revision + 1;
        const syntheticStrokes: WonderStroke[] = [];
        const anns: WonderAnnotation[] = cases.map((c, idx) => {
          const box = c.box ?? {
            minX: 80 + (idx % 2) * 430,
            minY: 70 + Math.floor(idx / 2) * 240,
            maxX: 250 + (idx % 2) * 430,
            maxY: 145 + Math.floor(idx / 2) * 240,
            width: 170,
            height: 75,
          };
          const strokeId = `mix_st_${rev}_${idx}`;
          const pts = [
            { x: box.minX + 8, y: box.minY + Math.round(box.height * 0.25), pressure: 0.6, t: 1 },
            { x: (box.minX + box.maxX) / 2, y: box.maxY - Math.round(box.height * 0.2), pressure: 0.6, t: 2 },
            { x: box.maxX - 8, y: box.minY + Math.round(box.height * 0.35), pressure: 0.6, t: 3 },
          ];
          syntheticStrokes.push({
            id: strokeId,
            boardId: cur.id,
            points: pts,
            color: theme.primaryInkHex,
            width: 3.4,
            tool: 'chalk',
            bbox: box,
            transform: { dx: 0, dy: 0 },
            revision: rev,
            createdAt: Date.now() + idx,
            provenance: 'freehand_ink',
          });
          const accent =
            c.severity === 'error'
              ? theme.aiCorrectionHex
              : c.severity === 'praise'
              ? theme.aiPositiveHex
              : theme.aiSupportHex;
          return {
            annotation_id: `mix_ann_${rev}_${idx}`,
            stable_key: `${cur.id}_mix_${idx}_${c.targetText}`,
            cloud_seed: idx + 1,
            board_id: cur.id,
            source_revision: rev,
            source_stroke_ids: [strokeId],
            recognized_text: c.targetText,
            target_text: c.targetText,
            target_span: { start: 0, end: c.targetText.length },
            target_geometry: box,
            note_geometry: {
              minX: box.minX,
              minY: box.maxY + 34,
              maxX: box.minX + 320,
              maxY: box.maxY + 130,
              width: 320,
              height: 96,
            },
            arrow_path: {
              fromX: box.minX + box.width / 2,
              fromY: box.maxY + 16,
              ctrlX: box.minX + box.width / 2 + 12,
              ctrlY: box.maxY + 25,
              toX: box.minX + box.width / 2,
              toY: box.maxY + 30,
            },
            annotation_type: c.severity === 'error' ? 'grammar_correction' : 'explanation',
            linguistic_category: 'hangul_shape',
            severity: c.severity ?? 'info',
            confidence: 0.96,
            suggested_correction: c.suggestedCorrection,
            explanation: c.explanation,
            hint: '',
            visual_style: {
              shape: 'scalloped_cloud',
              accentColor: accent,
            },
            placement_preference: 'below',
            learning_concept_ids: [],
            created_at: Date.now() + idx,
            status: 'active',
            lifecycle_state: 'queued',
            animation_progress: {
              cloud: 0,
              arrow: 0,
              correction: 0,
              explanation: 0,
              completed: false,
            },
          };
        });
        updateActiveBoard((b) => ({
          ...b,
          revision: rev,
          strokes: syntheticStrokes,
          annotations: anns,
        }));
      },
      setGuidanceLevel: (level: WonderGuidanceLevel) => {
        updateActiveBoard((b) => ({ ...b, guidanceLevel: level }));
      },
      setGatewayConfig: (gatewayUrl: string, gatewayToken = '') => {
        const next: WonderPrivacyConfig = {
          ...privacyRef.current,
          allowCloudAi: true,
          gatewayUrl,
          gatewayToken,
        };
        privacyRef.current = next;
        visionCacheRef.current = new WonderRecognitionCache();
        setPrivacy(next);
        saveWonderPrivacyConfig(next);
      },
      confirmRegionText: (regionId: string, confirmedText: string) => {
        const cur = latestBoardRef.current;
        const idx = cur.regions.findIndex((r) => r.regionId === regionId);
        if (idx < 0) return false;
        const confirmed = applyConfirmedUserTranscript(cur.regions[idx], confirmedText);
        const nextRegs = [...cur.regions];
        nextRegs[idx] = confirmed;
        updateActiveBoard((b) => ({ ...b, regions: nextRegs }));
        return true;
      },
      getSemanticTree: () => latestBoardRef.current.semanticTree,
      renderCropPreview: () => {
        const active = latestBoardRef.current.strokes.filter(
          (s) => !s.deleted && s.provenance !== 'ai_teaching' && s.tool !== 'eraser_pixel'
        );
        if (active.length === 0) return null;
        const box = mergeBoundingBoxes(active.map((s) => s.bbox));
        return renderObservationWindowSnapshot(active, box);
      },
    };
  });

  const isPhone = winWidth < 680;
  const compactHeader = winWidth < 860;
  const activeCount = board.annotations.filter((a) => a.status === 'active').length;
  const deferredNotes = board.showAnnotations
    ? activeAnnotationsForLayout.filter((a) => !resolvedLayoutByAnnId[a.annotation_id]?.noteVisible)
    : [];
  const deferredNotesButton = deferredNotes.length > 0 && (
    <Pressable
      testID="wonder-deferred-notes"
      style={[styles.pillBtn, isPhone && styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
      onPress={() => setShowDeferredNotes((value) => !value)}
    >
      <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>Ghi chú ({deferredNotes.length})</Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundHex }]}>
      {/* Minimal Low-Distraction Top Chrome */}
      {isPhone ? (
        <View style={[styles.topBarPhone, { borderBottomColor: theme.noteBorderHex }]}>
          <View style={styles.mobileTopRow}>
            <View style={styles.mobileTopLeft}>
              <Pressable
                style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex, flexShrink: 0 }]}
                onPress={onToggleSidebar}
              >
                <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                  {sidebarCollapsed ? 'Menu' : 'Toàn màn'}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.pillBtn,
                  styles.pillBtnPhone,
                  { backgroundColor: theme.uiSurfaceHex, flexShrink: 1, minWidth: 60 },
                ]}
                onPress={() => setShowBoardList((v) => !v)}
              >
                <Text
                  style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}
                  numberOfLines={1}
                >
                  {board.title}
                </Text>
              </Pressable>
            </View>

            <View style={styles.mobileTopRight}>
              <Pressable
                style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
                onPress={() => runAmbientAnalysis(latestBoardRef.current.revision, true)}
              >
                <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.aiPositiveHex }]}>
                  Chấm
                </Text>
              </Pressable>

              <Pressable
                style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
                onPress={() => setShowSettingsDrawer((v) => !v)}
              >
                <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                  Cài đặt
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mobileActionScroll}
          >
            <View style={[styles.statusBadge, styles.pillBtnPhone, { borderColor: theme.noteBorderHex }]}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: board.aiEnabled ? theme.aiPositiveHex : '#9CA3AF' },
                ]}
              />
              <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.primaryInkHex }]}>
                {aiBackendLabel || 'AI'}
                {activeCount > 0 ? ` (${activeCount})` : ''}
              </Text>
            </View>

            {deferredNotesButton}
            <Pressable
              testID="wonder-lang-toggle"
              style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() =>
                updateActiveBoard((b) => ({
                  ...b,
                  targetLanguage: getNextTargetLanguage(b.targetLanguage),
                }))
              }
            >
              <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                {getTargetLangShortLabel(board.targetLanguage)}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setShowTypedComposer((v) => !v)}
            >
              <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                {showTypedComposer ? 'Ẩn ô gõ' : 'Gõ chữ'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setShowSpecimensDrawer((v) => !v)}
            >
              <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                Mẫu thử
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => {
                updateActiveBoard((b) => ({
                  ...b,
                  aiEnabled: !b.aiEnabled,
                  teacherState: !b.aiEnabled ? 'OBSERVING' : 'IDLE',
                }));
              }}
            >
              <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                {board.aiEnabled ? 'AI: Bật' : 'AI: Tắt'}
              </Text>
            </Pressable>

            {Platform.OS === 'web' && (
              <Pressable
                style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
                onPress={handleExportPng}
              >
                <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                  Lưu ảnh
                </Text>
              </Pressable>
            )}

            <Pressable
              style={[styles.pillBtn, styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setConfirmClearOpen(true)}
            >
              <Text style={[styles.pillBtnText, styles.pillBtnTextPhone, { color: '#B42318' }]}>
                Xóa bảng
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : (
        <View style={[styles.topBar, { borderBottomColor: theme.noteBorderHex }]}>
          <View style={styles.topLeft}>
            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={onToggleSidebar}
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>
                {sidebarCollapsed ? 'Menu' : 'Toàn màn hình'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setShowBoardList((v) => !v)}
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]} numberOfLines={1}>
                {board.title}
              </Text>
            </Pressable>

            {!compactHeader && (
              <View style={[styles.statusBadge, { borderColor: theme.noteBorderHex }]}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: board.aiEnabled ? theme.aiPositiveHex : '#9CA3AF' },
                  ]}
                />
                <Text style={[styles.statusText, { color: theme.primaryInkHex }]}>
                  Giáo viên AI{aiBackendLabel ? ` (${aiBackendLabel})` : ''}:{' '}
                  {getTeacherStateLabel(board.teacherState)}
                  {activeCount > 0 ? ` (${activeCount})` : ''}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.topRight}>
            {deferredNotesButton}
            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => runAmbientAnalysis(latestBoardRef.current.revision, true)}
            >
              <Text style={[styles.pillBtnText, { color: theme.aiPositiveHex }]}>Chấm ngay</Text>
            </Pressable>

            <Pressable
              testID="wonder-lang-toggle"
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() =>
                updateActiveBoard((b) => ({
                  ...b,
                  targetLanguage: getNextTargetLanguage(b.targetLanguage),
                }))
              }
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>
                {getTargetLangShortLabel(board.targetLanguage)}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setShowSpecimensDrawer((v) => !v)}
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>Mẫu thử</Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setShowTypedComposer((v) => !v)}
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>
                {showTypedComposer ? 'Ẩn ô gõ' : 'Gõ chữ'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => {
                updateActiveBoard((b) => ({
                  ...b,
                  aiEnabled: !b.aiEnabled,
                  teacherState: !b.aiEnabled ? 'OBSERVING' : 'IDLE',
                }));
              }}
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>
                {board.aiEnabled ? 'AI: Bật' : 'AI: Tắt'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setShowSettingsDrawer((v) => !v)}
            >
              <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>Cài đặt</Text>
            </Pressable>

            {Platform.OS === 'web' && (
              <Pressable
                style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
                onPress={handleExportPng}
              >
                <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>Lưu ảnh</Text>
              </Pressable>
            )}

            <Pressable
              style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setConfirmClearOpen(true)}
            >
              <Text style={[styles.pillBtnText, { color: '#B42318' }]}>Xóa bảng</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Main Freeform Canvas Stage */}
      <View style={styles.canvasStage}>
        {Platform.OS === 'web' ? (
          <>
            {React.createElement('canvas', {
              ref: canvasRef,
              'data-testid': 'wonder-canvas',
              style: {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                touchAction: 'none',
                cursor: tool === 'pan' ? 'grab' : 'crosshair',
                display: 'block',
              },
              onPointerDown: handlePointerDown,
              onPointerMove: handlePointerMove,
              onPointerUp: handlePointerUp,
              onPointerCancel: handlePointerUp,
              onWheel: handleWheelZoom,
            })}

            <WonderAiChalkOverlay
              board={board}
              theme={theme}
              lassoPoly={lassoPoly}
              tool={tool}
              selectedStrokeIds={selectedStrokeIds}
              animOverrideMap={animOverrideMap}
              selectedNoteId={selectedNoteId}
              activeWritingBox={activeWritingBox}
              fontEpoch={fontEpoch}
              resolvedLayoutByAnnId={resolvedLayoutByAnnId}
              onSelectNote={setSelectedNoteId}
              onAnnotationPhaseCompleted={handleAnnotationPhaseCompleted}
              onTeacherStateHint={setTeacherState}
              onAnimationTimingsObserved={(_annId, _sched, actualCloudMs, actualTextMs) => {
                updateActiveBoard((b) => ({
                  ...b,
                  telemetry: {
                    ...b.telemetry,
                    lastCloudAnimDurationMs: actualCloudMs ?? b.telemetry.lastCloudAnimDurationMs,
                    lastTextRevealDurationMs: actualTextMs ?? b.telemetry.lastTextRevealDurationMs,
                    lastTotalTimeToFeedbackMs:
                      (b.telemetry.lastRecognitionLatencyMs || 0) +
                      (b.telemetry.lastAiLatencyMs || 0) +
                      (actualCloudMs ?? 0) +
                      (actualTextMs ?? 0),
                  },
                }));
              }}
              onExposeOverlayHelpers={(helpers) => {
                overlayHelpersRef.current = helpers;
              }}
            />
          </>
        ) : (
          <View style={styles.nativeFallback}>
            <Text style={[styles.nativeFallbackText, { color: theme.primaryInkHex }]}>
              Wonder Board hỗ trợ vẽ tự do đầy đủ trên trình duyệt Web & iPad Safari.
            </Text>
          </View>
        )}

        {/* Layer 6 Contextual AI Gesture Menu */}
        {(() => {
          if (selectedStrokeIds.length === 0) return null;
          const selSet = new Set(selectedStrokeIds);
          const boxes = board.strokes
            .filter((s) => !s.deleted && selSet.has(s.id))
            .map((s) => s.bbox);
          if (boxes.length === 0) return null;
          const selUnionBox = mergeBoundingBoxes(boxes);
          return (
            <View
              style={[
                styles.gestureMenu,
                {
                  left: isPhone
                    ? Math.min(
                        Math.max(8, selUnionBox.minX * board.viewport.scale + board.viewport.offsetX),
                        Math.max(8, winWidth - 260)
                      )
                    : Math.max(
                        16,
                        selUnionBox.minX * board.viewport.scale + board.viewport.offsetX
                      ),
                  top: Math.max(
                    12,
                    selUnionBox.minY * board.viewport.scale + board.viewport.offsetY - 50
                  ),
                  maxWidth: isPhone ? Math.max(240, winWidth - 16) : undefined,
                  backgroundColor: theme.uiSurfaceHex,
                },
              ]}
            >
              {(
                [
                  { intent: 'explain', label: 'Giải thích' },
                  { intent: 'translate', label: 'Dịch' },
                  { intent: 'grammar_check', label: 'Sửa ngữ pháp' },
                  { intent: 'trace_guide', label: 'Đồ theo nét' },
                  { intent: 'practice_exercise', label: 'Bài tập nhỏ' },
                ] as Array<{ intent: WonderGestureIntent; label: string }>
              ).map((item) => (
                <Pressable
                  key={item.intent}
                  style={styles.gestureMenuBtn}
                  onPress={() => handleGestureAction(item.intent)}
                >
                  <Text style={[styles.gestureMenuText, { color: theme.uiTextHex }]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                style={styles.gestureMenuBtn}
                onPress={() => setShowConfirmInput((v) => !v)}
              >
                <Text style={[styles.gestureMenuText, { color: theme.aiSupportHex }]}>
                  Xác nhận chữ viết
                </Text>
              </Pressable>
              <Pressable
                style={styles.gestureMenuBtn}
                onPress={() => {
                  setSelectedStrokeIds([]);
                  setShowConfirmInput(false);
                }}
              >
                <Text style={[styles.gestureMenuText, { color: '#9CA3AF' }]}>{'\u00D7'}</Text>
              </Pressable>
              {showConfirmInput && (
                <View style={{ flexDirection: 'row', gap: 6, width: '100%', marginTop: 4 }}>
                  <TextInput
                    style={[styles.newBoardInput, { minWidth: 160 }]}
                    value={confirmTextDraft}
                    onChangeText={setConfirmTextDraft}
                    placeholder="Nhập chữ bạn vừa viết tay..."
                    placeholderTextColor="#8C7A6B"
                  />
                  <Pressable
                    style={styles.actionChipBtn}
                    onPress={() => {
                      const clean = confirmTextDraft.trim();
                      if (!clean) return;
                      const selSet = new Set(selectedStrokeIds);
                      const targetIdx = board.regions.findIndex((r) =>
                        r.strokeIds.some((id) => selSet.has(id))
                      );
                      if (targetIdx >= 0) {
                        const updatedReg = applyConfirmedUserTranscript(
                          board.regions[targetIdx],
                          clean
                        );
                        const nextRegs = [...board.regions];
                        nextRegs[targetIdx] = updatedReg;
                        updateActiveBoard((b) => ({ ...b, regions: nextRegs }));
                        setTimeout(() => runAmbientAnalysis(latestBoardRef.current.revision), 30);
                      }
                      setConfirmTextDraft('');
                      setShowConfirmInput(false);
                      setSelectedStrokeIds([]);
                    }}
                  >
                    <Text style={styles.actionChipBtnText}>Lưu & Phân tích</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })()}

        {/* Empty Onboarding Hint */}
        {board.strokes.filter((s) => !s.deleted).length === 0 && (
          <View
            style={[styles.emptyOverlay, isPhone && styles.emptyOverlayPhone]}
            pointerEvents="none"
          >
            <Text style={[styles.emptyTitle, isPhone && styles.emptyTitlePhone, { color: theme.primaryInkHex }]}>
              Bảng học tự do SEED Wonder Board
            </Text>
            <Text style={[styles.emptySub, isPhone && styles.emptySubPhone, { color: theme.secondaryInkHex }]}>
              Cầm Apple Pencil hoặc chuột viết tự do ở bất kỳ đâu. Giáo viên AI sẽ lặng lẽ quan sát và từ từ khoanh đám mây phấn cùng lời giải thích trực tiếp ngay trên bảng be.
            </Text>
          </View>
        )}

        {/* Board Switcher Dropdown */}
        {showBoardList && (
          <View
            style={[
              styles.floatingPopover,
              isPhone
                ? styles.floatingPopoverPhone
                : { left: 16, top: 12 },
              { backgroundColor: theme.uiSurfaceHex },
            ]}
          >
            <Text style={[styles.popoverTitle, { color: theme.uiTextHex }]}>
              Các bảng của bạn ({boards.length})
            </Text>
            {boards.map((bItem) => (
              <Pressable
                key={bItem.id}
                style={[styles.boardRow, bItem.id === board.id && styles.boardRowActive]}
                onPress={() => handleSwitchBoard(bItem.id)}
              >
                <Text style={[styles.boardRowText, { color: theme.uiTextHex }]}>
                  {bItem.title}
                </Text>
                <Text style={styles.boardMetaText}>
                  {bItem.strokes.filter((s) => !s.deleted).length} nét
                </Text>
              </Pressable>
            ))}
            <View style={styles.newBoardRow}>
              <TextInput
                style={styles.newBoardInput}
                value={newBoardName}
                onChangeText={setNewBoardName}
                placeholder="Tên bảng mới..."
                placeholderTextColor="#8C7A6B"
              />
              <Pressable style={styles.actionChipBtn} onPress={handleCreateBoard}>
                <Text style={styles.actionChipBtnText}>Tạo bảng</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Explicit Test / Specimen Fixtures Drawer */}
        {showSpecimensDrawer && (
          <View
            style={[
              styles.floatingPopover,
              isPhone
                ? styles.floatingPopoverPhone
                : { right: 16, top: 12, width: 320 },
              { backgroundColor: theme.uiSurfaceHex },
            ]}
          >
            <View style={styles.popoverHeaderRow}>
              <Text style={[styles.popoverTitle, { color: theme.uiTextHex }]}>
                Mẫu chữ viết thử nghiệm (Fixtures)
              </Text>
              <Pressable onPress={() => setShowSpecimensDrawer(false)}>
                <Text style={{ fontWeight: '700', color: theme.uiTextHex }}>{'\u00D7'}</Text>
              </Pressable>
            </View>
            <Text style={styles.popoverNote}>
              Tạo nét vector Hàn / Anh / Việt chuẩn hóa trên Layer 2 để quan sát giáo viên AI khoanh đám mây từng nét:
            </Text>
            {(() => {
              const koSpecs: Array<{ label: string; text: string; mode: WonderAiMode }> = [
                {
                  label: 'Hàn A: Thì quá khứ (저는 어제 학교에 가요.)',
                  text: '저는 어제 학교에 가요.',
                  mode: 'tutor',
                },
                {
                  label: 'Hàn B: Trợ từ tân ngữ (저는 사과가 먹어요.)',
                  text: '저는 사과가 먹어요.',
                  mode: 'tutor',
                },
                {
                  label: 'Hàn C: Người mới viết tiếng Việt',
                  text: 'Tôi muốn học cách gọi cà phê.',
                  mode: 'discovery',
                },
                {
                  label: 'Hàn D: Tự sửa đúng (갔어요)',
                  text: '저는 어제 학교에 갔어요.',
                  mode: 'tutor',
                },
              ];
              const enSpecs: Array<{ label: string; text: string; mode: WonderAiMode }> = [
                {
                  label: 'Anh A: Thì quá khứ (I go to school yesterday.)',
                  text: 'I go to school yesterday.',
                  mode: 'tutor',
                },
                {
                  label: 'Anh B: Mạo từ & S-V (She eat a apple every day.)',
                  text: 'She eat a apple every day.',
                  mode: 'tutor',
                },
                {
                  label: 'Anh C: Lỗi Việt-Anh (I am agree and go to home.)',
                  text: 'I am agree and go to home.',
                  mode: 'tutor',
                },
                {
                  label: 'Anh D: Câu tiếng Anh chuẩn (went yesterday)',
                  text: 'I went to school yesterday.',
                  mode: 'tutor',
                },
              ];
              const orderedSpecs =
                board.targetLanguage === 'en' ? [...enSpecs, ...koSpecs] : [...koSpecs, ...enSpecs];
              return orderedSpecs;
            })().map((spec) => (
              <Pressable
                key={spec.label}
                style={styles.specimenBtn}
                onPress={() => handleInsertSampleFixture(spec.text, spec.mode)}
              >
                <Text style={[styles.specimenBtnText, { color: theme.uiTextHex }]}>
                  {spec.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {showDeferredNotes && deferredNotes.length > 0 && (
          <ScrollView
            style={[styles.settingsDrawer, isPhone && styles.settingsDrawerPhone, { backgroundColor: theme.uiSurfaceHex }]}
            contentContainerStyle={{ gap: 10 }}
          >
            <View style={styles.popoverHeaderRow}>
              <Text style={[styles.popoverTitle, { color: theme.uiTextHex }]}>Ghi chú trên bảng</Text>
              <Pressable accessibilityLabel="Đóng ghi chú" onPress={() => setShowDeferredNotes(false)}>
                <Text style={{ color: theme.uiTextHex, fontSize: 18 }}>×</Text>
              </Pressable>
            </View>
            {deferredNotes.map((ann) => (
              <View key={ann.annotation_id}>
                <Text style={[styles.popoverTitle, { color: theme.uiTextHex }]}>{ann.target_text}</Text>
                {ann.severity === 'error' && ann.suggested_correction && (
                  <Text style={{ color: theme.uiTextHex }}>{ann.target_text} → {ann.suggested_correction}</Text>
                )}
                <Text style={{ color: theme.uiTextHex }}>{ann.explanation || ann.hint || ann.suggested_correction}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Settings Drawer: Theme, AI Mode, Chalk Speed, Cursor & Privacy */}
        {showSettingsDrawer && (
          <ScrollView
            style={[
              styles.settingsDrawer,
              isPhone && styles.settingsDrawerPhone,
              { backgroundColor: theme.uiSurfaceHex },
            ]}
            contentContainerStyle={{ gap: 12 }}
          >
            <View style={styles.popoverHeaderRow}>
              <Text style={[styles.popoverTitle, { color: theme.uiTextHex }]}>
                Cài đặt bảng & Giáo viên AI
              </Text>
              <Pressable onPress={() => setShowSettingsDrawer(false)}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: theme.uiTextHex }}>
                  {'\u00D7'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLbl}>Theme bảng</Text>
            <View style={styles.wrapRow}>
              {(Object.keys(WONDER_BOARD_THEMES) as WonderBoardThemeId[]).map((tid) => {
                const t = WONDER_BOARD_THEMES[tid];
                const active = board.themeId === tid;
                return (
                  <Pressable
                    key={tid}
                    style={[styles.themeChip, active && styles.themeChipActive]}
                    onPress={() => handleSelectTheme(tid)}
                  >
                    <View style={[styles.themeSwatch, { backgroundColor: t.backgroundHex }]} />
                    <Text style={styles.themeChipText}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.sectionLbl}>Tốc độ vẽ phấn của AI</Text>
            <View style={styles.wrapRow}>
              {SPEED_OPTIONS.map((sp) => (
                <Pressable
                  key={sp.key}
                  style={[styles.modeChip, board.animationSpeed === sp.key && styles.modeChipActive]}
                  onPress={() => updateActiveBoard((b) => ({ ...b, animationSpeed: sp.key }))}
                >
                  <Text style={styles.modeChipText}>{sp.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLbl}>Chế độ phản hồi AI</Text>
            <View style={styles.wrapRow}>
              {AI_MODE_OPTIONS.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.modeChip, board.aiMode === m && styles.modeChipActive]}
                  onPress={() => updateActiveBoard((b) => ({ ...b, aiMode: m }))}
                >
                  <Text style={styles.modeChipText}>{getWonderBoardAiModeLabel(m)}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLbl}>Ngôn ngữ học trên bảng</Text>
            <View style={styles.wrapRow}>
              {TARGET_LANG_OPTIONS.map((langOpt) => (
                <Pressable
                  key={langOpt.key}
                  style={[
                    styles.modeChip,
                    (board.targetLanguage ?? 'auto') === langOpt.key && styles.modeChipActive,
                  ]}
                  onPress={() =>
                    updateActiveBoard((b) => ({ ...b, targetLanguage: langOpt.key }))
                  }
                >
                  <Text style={styles.modeChipText}>{langOpt.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLbl}>Mức độ hướng dẫn (Guidance Level)</Text>
            <View style={styles.wrapRow}>
              {GUIDANCE_OPTIONS.map((gOpt) => (
                <Pressable
                  key={gOpt.key}
                  style={[
                    styles.modeChip,
                    (board.guidanceLevel ?? 'guided') === gOpt.key && styles.modeChipActive,
                  ]}
                  onPress={() => updateActiveBoard((b) => ({ ...b, guidanceLevel: gOpt.key }))}
                >
                  <Text style={styles.modeChipText}>{gOpt.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.toggleList}>
              <Pressable
                style={styles.toggleRow}
                onPress={() =>
                  updateActiveBoard((b) => ({
                    ...b,
                    chalkCursorEnabled: !b.chalkCursorEnabled,
                  }))
                }
              >
                <Text style={styles.toggleText}>
                  Hiển thị đầu phấn di chuyển khi vẽ: {board.chalkCursorEnabled ? 'Bật' : 'Tắt'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() =>
                  updateActiveBoard((b) => ({ ...b, showAnnotations: !b.showAnnotations }))
                }
              >
                <Text style={styles.toggleText}>
                  Hiển thị lớp nhận xét phấn AI: {board.showAnnotations ? 'Hiện' : 'Ẩn'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() =>
                  updateActiveBoard((b) => ({
                    ...b,
                    chalkTextureEnabled: !b.chalkTextureEnabled,
                  }))
                }
              >
                <Text style={styles.toggleText}>
                  Hiệu ứng hạt phấn: {board.chalkTextureEnabled ? 'Bật' : 'Tắt (nhẹ máy)'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() => setPalmGuardEnabled((v) => !v)}
              >
                <Text style={styles.toggleText}>
                  Giảm nét chạm tay sau khi dùng bút: {palmGuardEnabled ? 'Bật' : 'Tắt'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() =>
                  updateActiveBoard((b) => ({
                    ...b,
                    handwritingSynthesisEnabled: !b.handwritingSynthesisEnabled,
                  }))
                }
              >
                <Text style={styles.toggleText}>
                  Mô phỏng nét viết skeleton (Riddle):{' '}
                  {board.handwritingSynthesisEnabled ? 'Bật' : 'Tắt (mặc định ổn định)'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLbl}>Hiệu năng & Hồ sơ SEED</Text>
            <Text style={styles.popoverNote}>
              Elo: {Math.round(aiProfile.eloRating)} | Phân đoạn:{' '}
              {board.telemetry.lastSegmentationMs ?? 0}ms | Cục bộ:{' '}
              {board.telemetry.lastLocalRecognitionMs ?? 0}ms | Cloud OCR:{' '}
              {board.telemetry.lastCloudRecognitionMs ?? 0}ms | Sư phạm:{' '}
              {board.telemetry.lastAiLatencyMs}ms | Mây:{' '}
              {board.telemetry.lastCloudAnimDurationMs ?? 0}ms | Chữ:{' '}
              {board.telemetry.lastTextRevealDurationMs ?? 0}ms
            </Text>

            <Text style={styles.sectionLbl}>Chẩn đoán Nhận dạng (Developer Diagnostics)</Text>
            <Text style={styles.popoverNote}>
              Vision Cloud:{' '}
              {serverHealth?.visionReady
                ? `Sẵn sàng (${
                    [
                      serverHealth.providers?.deepseek ? 'DeepSeek deepseek-flash' : '',
                      serverHealth.providers?.gemini ? 'Gemini' : '',
                      serverHealth.providers?.openai ? 'OpenAI' : '',
                    ]
                      .filter(Boolean)
                      .join(' / ') || 'Gateway'
                  })`
                : privacy.gatewayUrl.trim()
                  ? `Gateway: ${privacy.gatewayUrl.trim()}`
                  : 'Chưa cấu hình khóa server (.env.local)'}
              {'\n'}
              {recognitionDiagnostics.length === 0
                ? 'Chưa có vùng chữ nào được phân tích.'
                : recognitionDiagnostics
                    .map(
                      (d) =>
                        `[${d.regionId}] ${d.providerId} (${d.recognitionStatus}) | ${d.providerLatencyMs}ms | hash=${d.inputImageHash ?? '-'} | strokes=${d.sourceStrokeIds?.join(',') || '-'} | raw="${d.rawTranscription ?? ''}" | text="${d.recognizedText}" | candidates=${d.candidateAlternatives.join(',') || '-'} | confidence=${d.confidence.toFixed(2)} | structure=${d.structuralVerification?.verdict ?? '-'}:${d.structuralVerification?.side ?? '-'} | intent=${d.learningIntent ?? '-'} | concept=${d.conceptIds?.join(',') || '-'} | action=${d.annotationDecision ?? '-'} | notes=${d.annotationIds?.join(',') || '-'} | ${d.providerFailureReason ?? d.fallbackReason}`
                    )
                    .join('\n')}
            </Text>
            {Platform.OS === 'web' &&
              recognitionDiagnostics.some((d) => Boolean(d.cropDataUrl)) && (
                <View style={{ marginBottom: 8 }}>
                  <Pressable
                    style={[styles.modeChip, { alignSelf: 'flex-start', marginBottom: 6 }]}
                    onPress={() => setShowDevCropPreview((v) => !v)}
                  >
                    <Text style={styles.modeChipText}>
                      {showDevCropPreview ? 'Ẩn ảnh crop gửi Vision' : 'Xem ảnh crop gửi Vision'}
                    </Text>
                  </Pressable>
                  {showDevCropPreview && recognitionDiagnostics.filter((d) => d.cropDataUrl).map((d) => (
                    <View key={d.regionId}>
                      <Text style={styles.popoverNote}>{d.regionId} · {d.inputImageHash}</Text>
                      {React.createElement('img', {
                        src: d.cropDataUrl,
                        alt: `Vùng chữ ${d.regionId}`,
                        style: {
                          width: '100%',
                          maxHeight: 140,
                          objectFit: 'contain',
                          borderRadius: 8,
                          border: '1px solid #D6CCC2',
                          backgroundColor: '#FFFFFF',
                        },
                      })}
                    </View>
                  ))}
                </View>
              )}

            <Text style={styles.sectionLbl}>AI Gateway (Production) & Quyền riêng tư</Text>
            <TextInput
              style={styles.newBoardInput}
              value={privacy.gatewayUrl}
              onChangeText={(val) => {
                const next = { ...privacy, gatewayUrl: val };
                setPrivacy(next);
                saveWonderPrivacyConfig(next);
              }}
              placeholder="URL AI Gateway (vd: http://127.0.0.1:8787)"
              placeholderTextColor="#8C7A6B"
            />
            <Pressable
              style={styles.toggleRow}
              onPress={() => {
                const next = { ...privacy, allowCloudAi: !privacy.allowCloudAi };
                setPrivacy(next);
                saveWonderPrivacyConfig(next);
              }}
            >
              <Text style={styles.toggleText}>
                Cho phép gửi vùng chữ ra Cloud Vision (DEV-ONLY nếu không dùng Gateway):{' '}
                {privacy.allowCloudAi ? 'Bật' : 'Tắt (chỉ cục bộ)'}
              </Text>
            </Pressable>

            <Pressable style={styles.dangerBtn} onPress={handleWipeBoardData}>
              <Text style={styles.dangerBtnText}>Xóa toàn bộ dữ liệu Wonder Board</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* Clear Confirmation */}
        {confirmClearOpen && (
          <View
            style={[
              styles.floatingPopover,
              isPhone
                ? styles.floatingPopoverPhone
                : { right: 20, top: 16, width: 280 },
              { backgroundColor: theme.uiSurfaceHex },
            ]}
          >
            <Text style={[styles.popoverTitle, { color: theme.uiTextHex }]}>
              Xóa toàn bộ nét viết trên bảng?
            </Text>
            <Text style={styles.popoverNote}>
              Thao tác này sẽ dọn sạch nét viết và nhận xét trên "{board.title}".
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable style={styles.dangerBtn} onPress={handleClearBoard}>
                <Text style={styles.dangerBtnText}>Xác nhận xóa</Text>
              </Pressable>
              <Pressable
                style={styles.actionChipBtn}
                onPress={() => setConfirmClearOpen(false)}
              >
                <Text style={styles.actionChipBtnText}>Hủy</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Bottom Floating Collapsible Toolbar */}
        <View style={[styles.bottomDock, isPhone && styles.bottomDockPhone]}>
          {showTypedComposer && !toolbarCollapsed && (
            <View style={[styles.quickWriteBar, { backgroundColor: theme.uiSurfaceHex }]}>
              <TextInput
                style={styles.quickWriteInput}
                value={boardDraftText}
                onChangeText={setBoardDraftText}
                placeholder="Gõ chữ Hàn / Anh / Việt đưa lên bảng..."
                placeholderTextColor="#8C7A6B"
              />
              <Pressable
                style={[
                  styles.quickWriteBtn,
                  boardDraftText.trim().length === 0 && { opacity: 0.45 },
                ]}
                disabled={boardDraftText.trim().length === 0}
                onPress={() => {
                  const txt = boardDraftText.trim();
                  if (!txt) return;
                  handleInsertSampleFixture(txt, undefined, 70, undefined, 'typed_vector');
                  setBoardDraftText('');
                }}
              >
                <Text style={styles.quickWriteBtnText}>Đưa lên bảng</Text>
              </Pressable>
            </View>
          )}

          {!toolbarCollapsed && (
            <View style={[styles.toolbarCard, { backgroundColor: theme.uiSurfaceHex }]}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.toolbarRow}
              >
                {TOOL_ITEMS.map((t) => {
                  const selected = tool === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      style={[styles.toolBtn, selected && styles.toolBtnActive]}
                      onPress={() => setTool(t.key)}
                    >
                      <Text
                        style={[
                          styles.toolBtnText,
                          selected && styles.toolBtnTextActive,
                        ]}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}

                <View style={styles.toolDivider} />

                {theme.palette.map((c) => {
                  const active = inkColor === c;
                  return (
                    <Pressable
                      key={c}
                      style={[
                        styles.colorDot,
                        { backgroundColor: c },
                        active && styles.colorDotActive,
                      ]}
                      onPress={() => {
                        setInkColor(c);
                        if (tool === 'eraser_pixel' || tool === 'eraser_stroke' || tool === 'pan') {
                          setTool('chalk');
                        }
                      }}
                    />
                  );
                })}

                <View style={styles.toolDivider} />

                {[
                  { label: 'Mảnh', w: 2.2 },
                  { label: 'Vừa', w: 3.6 },
                  { label: 'Đậm', w: 6.2 },
                ].map((sz) => (
                  <Pressable
                    key={sz.label}
                    style={[styles.toolBtn, strokeWidth === sz.w && styles.toolBtnActive]}
                    onPress={() => setStrokeWidth(sz.w)}
                  >
                    <Text style={styles.toolBtnText}>{sz.label}</Text>
                  </Pressable>
                ))}

                <View style={styles.toolDivider} />

                <Pressable style={styles.toolBtn} onPress={handleUndo}>
                  <Text style={styles.toolBtnText}>Hoàn tác</Text>
                </Pressable>
                <Pressable style={styles.toolBtn} onPress={handleRedo}>
                  <Text style={styles.toolBtnText}>Làm lại</Text>
                </Pressable>
                <Pressable
                  style={styles.toolBtn}
                  onPress={() =>
                    updateActiveBoard((b) => ({
                      ...b,
                      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
                    }))
                  }
                >
                  <Text style={styles.toolBtnText}>
                    {Math.round(board.viewport.scale * 100)}%
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          )}

          <View
            style={[
              styles.dockMetaRow,
              isPhone && toolbarCollapsed && { alignSelf: 'flex-end' },
            ]}
          >
            <Pressable
              style={[styles.pillBtn, isPhone && styles.pillBtnPhone, { backgroundColor: theme.uiSurfaceHex }]}
              onPress={() => setToolbarCollapsed((v) => !v)}
            >
              <Text style={[styles.pillBtnText, isPhone && styles.pillBtnTextPhone, { color: theme.uiTextHex }]}>
                {toolbarCollapsed ? 'Mở thanh bút' : 'Thu gọn'}
              </Text>
            </Pressable>
            {!isPhone && (
              <View style={[styles.pillBtn, { backgroundColor: theme.uiSurfaceHex }]}>
                <Text style={[styles.pillBtnText, { color: theme.uiTextHex }]}>
                  {stylusStatus}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: 'hidden' },
  topBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    gap: 8,
    zIndex: 30,
  },
  topBarPhone: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 7,
    borderBottomWidth: 1,
    gap: 6,
    zIndex: 30,
  },
  mobileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  mobileTopLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mobileTopRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mobileActionScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 12,
  },
  topLeft: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  topRight: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  pillBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  pillBtnPhone: {
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pillBtnText: { fontSize: 12, fontWeight: '600' },
  pillBtnTextPhone: { fontSize: 11.5 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 99 },
  statusText: { fontSize: 12, fontWeight: '600' },
  canvasStage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
  },
  nativeFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  nativeFallbackText: { fontSize: 15, textAlign: 'center', fontWeight: '600' },
  emptyOverlay: {
    position: 'absolute',
    top: '28%',
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyOverlayPhone: {
    top: '20%',
    left: 16,
    right: 16,
    gap: 6,
  },
  emptyTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyTitlePhone: { fontSize: 18 },
  emptySub: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 520,
    lineHeight: 21,
  },
  emptySubPhone: {
    fontSize: 13,
    lineHeight: 19,
  },
  tapActionBar: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    zIndex: 28,
  },
  tapActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tapActionText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  gestureMenu: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D6CCBE',
    zIndex: 25,
  },
  gestureMenuBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(47,115,75,0.1)',
  },
  gestureMenuText: { fontSize: 12, fontWeight: '600' },
  floatingPopover: {
    position: 'absolute',
    width: 290,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCD2C4',
    gap: 8,
    zIndex: 40,
  },
  floatingPopoverPhone: {
    left: 10,
    right: 10,
    top: 8,
    width: undefined,
    maxHeight: '76%',
  },
  settingsDrawer: {
    position: 'absolute',
    right: 16,
    top: 12,
    width: 340,
    maxHeight: '78%',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DCD2C4',
    zIndex: 45,
  },
  settingsDrawerPhone: {
    left: 10,
    right: 10,
    top: 8,
    width: undefined,
    maxHeight: '76%',
  },
  popoverHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  popoverTitle: { fontSize: 14.5, fontWeight: '700' },
  popoverNote: { fontSize: 12, color: '#57463D', lineHeight: 17 },
  sectionLbl: { fontSize: 12, fontWeight: '700', color: '#2C221E', marginTop: 4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  themeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
  },
  themeChipActive: { borderColor: '#2F734B', backgroundColor: '#F2F7F3' },
  themeSwatch: { width: 12, height: 12, borderRadius: 99 },
  themeChipText: { fontSize: 11.5, fontWeight: '600', color: '#2C221E' },
  modeChip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
  },
  modeChipActive: { borderColor: '#2F734B', backgroundColor: '#F2F7F3' },
  modeChipText: { fontSize: 11.5, fontWeight: '600', color: '#2C221E' },
  toggleList: { gap: 6 },
  toggleRow: {
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
  },
  toggleText: { fontSize: 12, fontWeight: '600', color: '#2C221E' },
  specimenBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
  },
  specimenBtnText: { fontSize: 12, fontWeight: '600' },
  boardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAE2D6',
  },
  boardRowActive: { backgroundColor: '#F2F7F3', borderColor: '#2F734B' },
  boardRowText: { fontSize: 13, fontWeight: '600' },
  boardMetaText: { fontSize: 11.5, color: '#6E5A4F' },
  newBoardRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  newBoardInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12.5,
    backgroundColor: '#FFFFFF',
    color: '#2C221E',
  },
  actionChipBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#2F734B',
    justifyContent: 'center',
  },
  actionChipBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  dangerBtn: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    alignItems: 'center',
  },
  dangerBtnText: { fontSize: 12, fontWeight: '700', color: '#991B1B' },
  bottomDock: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    alignItems: 'center',
    gap: 8,
    zIndex: 35,
  },
  bottomDockPhone: {
    bottom: 8,
    left: 8,
    right: 8,
    gap: 6,
  },
  quickWriteBar: {
    width: '100%',
    maxWidth: 620,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DFD2C0',
  },
  quickWriteInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#2C221E',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  quickWriteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#2F734B',
  },
  quickWriteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  toolbarCard: {
    maxWidth: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#E5DDD0',
    backgroundColor: '#FFFFFF',
  },
  toolBtnActive: {
    backgroundColor: '#2F734B',
    borderColor: '#1E352B',
  },
  toolBtnText: { fontSize: 12, fontWeight: '600', color: '#2C221E' },
  toolBtnTextActive: { color: '#FFFFFF' },
  toolDivider: { width: 1, height: 22, backgroundColor: '#DFD2C0', marginHorizontal: 4 },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  colorDotActive: {
    borderWidth: 3,
    borderColor: '#2F734B',
  },
  dockMetaRow: { flexDirection: 'row', gap: 8 },
});
