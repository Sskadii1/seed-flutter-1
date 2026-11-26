import { WonderBBox, WonderHangulDemoSpec, WonderHangulDemoStroke } from '@seed/schema';

const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];
const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const COMPOUND_JONG_SPLIT: Record<string, [string, string]> = {
  'ㄳ': ['ㄱ', 'ㅅ'],
  'ㄵ': ['ㄴ', 'ㅈ'],
  'ㄶ': ['ㄴ', 'ㅎ'],
  'ㄺ': ['ㄹ', 'ㄱ'],
  'ㄻ': ['ㄹ', 'ㅁ'],
  'ㄼ': ['ㄹ', 'ㅂ'],
  'ㄽ': ['ㄹ', 'ㅅ'],
  'ㄾ': ['ㄹ', 'ㅌ'],
  'ㄿ': ['ㄹ', 'ㅍ'],
  'ㅀ': ['ㄹ', 'ㅎ'],
  'ㅄ': ['ㅂ', 'ㅅ'],
};

interface StrokeDef {
  pts: Array<[number, number]>;
  dir: string;
}

/**
 * Canonical NIKL (National Institute of Korean Language) stroke order definitions
 * for single Jamo inside normalized [0..1] x [0..1] sub-boxes.
 */
function canonicalJamoStrokes(jamo: string): StrokeDef[] {
  const doublePair = (inner: StrokeDef[]): StrokeDef[] => {
    const left = inner.map((s) => ({
      pts: s.pts.map(([x, y]): [number, number] => [x * 0.46, y]),
      dir: s.dir,
    }));
    const right = inner.map((s) => ({
      pts: s.pts.map(([x, y]): [number, number] => [0.5 + x * 0.46, y]),
      dir: s.dir,
    }));
    return [...left, ...right];
  };

  switch (jamo) {
    case 'ㄱ':
      return [{ pts: [[0.18, 0.2], [0.82, 0.2], [0.76, 0.85]], dir: 'Trái→phải rồi xuống' }];
    case 'ㄲ':
      return doublePair(canonicalJamoStrokes('ㄱ'));
    case 'ㄴ':
      return [{ pts: [[0.2, 0.2], [0.2, 0.82], [0.85, 0.82]], dir: 'Xuống rồi ngang phải' }];
    case 'ㄷ':
      return [
        { pts: [[0.2, 0.2], [0.84, 0.2]], dir: 'Nét ngang trên' },
        { pts: [[0.2, 0.2], [0.2, 0.82], [0.85, 0.82]], dir: 'Xuống rồi ngang đáy' },
      ];
    case 'ㄸ':
      return doublePair(canonicalJamoStrokes('ㄷ'));
    case 'ㄹ':
      return [
        { pts: [[0.18, 0.18], [0.82, 0.18], [0.82, 0.48]], dir: 'Ngang trên rồi xuống' },
        { pts: [[0.18, 0.48], [0.82, 0.48]], dir: 'Nét ngang giữa' },
        { pts: [[0.2, 0.48], [0.2, 0.82], [0.84, 0.82]], dir: 'Xuống rồi ngang đáy' },
      ];
    case 'ㅁ':
      return [
        { pts: [[0.2, 0.2], [0.2, 0.84]], dir: 'Nét sổ trái' },
        { pts: [[0.2, 0.2], [0.82, 0.2], [0.82, 0.84]], dir: 'Ngang trên rồi sổ phải' },
        { pts: [[0.2, 0.84], [0.82, 0.84]], dir: 'Nét ngang đáy' },
      ];
    case 'ㅂ':
      return [
        { pts: [[0.22, 0.14], [0.22, 0.84]], dir: 'Nét sổ trái' },
        { pts: [[0.8, 0.14], [0.8, 0.84]], dir: 'Nét sổ phải' },
        { pts: [[0.22, 0.48], [0.8, 0.48]], dir: 'Nét ngang giữa' },
        { pts: [[0.22, 0.84], [0.8, 0.84]], dir: 'Nét ngang đáy' },
      ];
    case 'ㅃ':
      return doublePair(canonicalJamoStrokes('ㅂ'));
    case 'ㅅ':
      return [
        { pts: [[0.52, 0.18], [0.18, 0.85]], dir: 'Phẩy xuống trái' },
        { pts: [[0.46, 0.45], [0.84, 0.85]], dir: 'Xiên xuống phải' },
      ];
    case 'ㅆ':
      return doublePair(canonicalJamoStrokes('ㅅ'));
    case 'ㅇ':
      return [
        {
          pts: Array.from({ length: 13 }, (_, k) => {
            const angle = -Math.PI / 2 - (k / 12) * Math.PI * 2;
            return [0.5 + Math.cos(angle) * 0.34, 0.5 + Math.sin(angle) * 0.34] as [
              number,
              number,
            ];
          }),
          dir: 'Vòng ngược chiều kim đồng hồ từ đỉnh',
        },
      ];
    case 'ㅈ':
      return [
        { pts: [[0.18, 0.22], [0.82, 0.22], [0.2, 0.84]], dir: 'Ngang trên rồi phẩy xuống trái' },
        { pts: [[0.5, 0.48], [0.84, 0.84]], dir: 'Xiên xuống phải' },
      ];
    case 'ㅉ':
      return doublePair(canonicalJamoStrokes('ㅈ'));
    case 'ㅊ':
      return [
        { pts: [[0.5, 0.08], [0.5, 0.24]], dir: 'Nét chấm/sổ đỉnh' },
        { pts: [[0.18, 0.32], [0.82, 0.32], [0.2, 0.86]], dir: 'Ngang rồi phẩy xuống trái' },
        { pts: [[0.5, 0.54], [0.84, 0.86]], dir: 'Xiên xuống phải' },
      ];
    case 'ㅋ':
      return [
        { pts: [[0.18, 0.2], [0.82, 0.2], [0.76, 0.85]], dir: 'Ngang trên rồi xuống' },
        { pts: [[0.2, 0.5], [0.78, 0.5]], dir: 'Nét ngang giữa' },
      ];
    case 'ㅌ':
      return [
        { pts: [[0.2, 0.2], [0.82, 0.2]], dir: 'Nét ngang trên' },
        { pts: [[0.2, 0.5], [0.78, 0.5]], dir: 'Nét ngang giữa' },
        { pts: [[0.2, 0.2], [0.2, 0.84], [0.84, 0.84]], dir: 'Sổ trái rồi ngang đáy' },
      ];
    case 'ㅍ':
      return [
        { pts: [[0.16, 0.2], [0.84, 0.2]], dir: 'Nét ngang trên' },
        { pts: [[0.34, 0.2], [0.34, 0.82]], dir: 'Sổ trái' },
        { pts: [[0.66, 0.2], [0.66, 0.82]], dir: 'Sổ phải' },
        { pts: [[0.16, 0.82], [0.84, 0.82]], dir: 'Nét ngang đáy' },
      ];
    case 'ㅎ':
      return [
        { pts: [[0.5, 0.06], [0.5, 0.2]], dir: 'Nét đỉnh' },
        { pts: [[0.14, 0.28], [0.86, 0.28]], dir: 'Nét ngang trên' },
        {
          pts: Array.from({ length: 13 }, (_, k) => {
            const angle = -Math.PI / 2 - (k / 12) * Math.PI * 2;
            return [0.5 + Math.cos(angle) * 0.28, 0.64 + Math.sin(angle) * 0.26] as [
              number,
              number,
            ];
          }),
          dir: 'Vòng tròn dưới ngược chiều kim đồng hồ',
        },
      ];
    case 'ㅏ':
      return [
        { pts: [[0.4, 0.08], [0.4, 0.92]], dir: 'Sổ dọc trên→dưới' },
        { pts: [[0.4, 0.48], [0.88, 0.48]], dir: 'Nhánh ngang sang phải' },
      ];
    case 'ㅐ':
      return [
        ...canonicalJamoStrokes('ㅏ').map((s) => ({
          pts: s.pts.map(([x, y]): [number, number] => [x * 0.78, y]),
          dir: s.dir,
        })),
        { pts: [[0.82, 0.08], [0.82, 0.92]], dir: 'Sổ dọc phải' },
      ];
    case 'ㅑ':
      return [
        { pts: [[0.4, 0.08], [0.4, 0.92]], dir: 'Sổ dọc' },
        { pts: [[0.4, 0.36], [0.88, 0.36]], dir: 'Nhánh ngang trên' },
        { pts: [[0.4, 0.6], [0.88, 0.6]], dir: 'Nhánh ngang dưới' },
      ];
    case 'ㅒ':
      return [
        ...canonicalJamoStrokes('ㅑ').map((s) => ({
          pts: s.pts.map(([x, y]): [number, number] => [x * 0.78, y]),
          dir: s.dir,
        })),
        { pts: [[0.82, 0.08], [0.82, 0.92]], dir: 'Sổ dọc phải' },
      ];
    case 'ㅓ':
      return [
        { pts: [[0.14, 0.48], [0.62, 0.48]], dir: 'Nhánh ngang trái' },
        { pts: [[0.62, 0.08], [0.62, 0.92]], dir: 'Sổ dọc trên→dưới' },
      ];
    case 'ㅔ':
      return [
        { pts: [[0.1, 0.48], [0.5, 0.48]], dir: 'Nhánh ngang trái' },
        { pts: [[0.5, 0.08], [0.5, 0.92]], dir: 'Sổ dọc giữa' },
        { pts: [[0.82, 0.08], [0.82, 0.92]], dir: 'Sổ dọc phải' },
      ];
    case 'ㅕ':
      return [
        { pts: [[0.14, 0.36], [0.62, 0.36]], dir: 'Nhánh ngang trên' },
        { pts: [[0.14, 0.6], [0.62, 0.6]], dir: 'Nhánh ngang dưới' },
        { pts: [[0.62, 0.08], [0.62, 0.92]], dir: 'Sổ dọc' },
      ];
    case 'ㅖ':
      return [
        { pts: [[0.1, 0.36], [0.5, 0.36]], dir: 'Nhánh ngang trên' },
        { pts: [[0.1, 0.6], [0.5, 0.6]], dir: 'Nhánh ngang dưới' },
        { pts: [[0.5, 0.08], [0.5, 0.92]], dir: 'Sổ dọc giữa' },
        { pts: [[0.82, 0.08], [0.82, 0.92]], dir: 'Sổ dọc phải' },
      ];
    case 'ㅗ':
      return [
        { pts: [[0.5, 0.14], [0.5, 0.64]], dir: 'Sổ ngắn trên→dưới' },
        { pts: [[0.1, 0.64], [0.9, 0.64]], dir: 'Nét ngang trái→phải' },
      ];
    case 'ㅛ':
      return [
        { pts: [[0.35, 0.14], [0.35, 0.64]], dir: 'Sổ ngắn trái' },
        { pts: [[0.65, 0.14], [0.65, 0.64]], dir: 'Sổ ngắn phải' },
        { pts: [[0.1, 0.64], [0.9, 0.64]], dir: 'Nét ngang' },
      ];
    case 'ㅜ':
      return [
        { pts: [[0.1, 0.36], [0.9, 0.36]], dir: 'Nét ngang trên' },
        { pts: [[0.5, 0.36], [0.5, 0.88]], dir: 'Sổ ngắn xuống dưới' },
      ];
    case 'ㅠ':
      return [
        { pts: [[0.1, 0.36], [0.9, 0.36]], dir: 'Nét ngang trên' },
        { pts: [[0.35, 0.36], [0.35, 0.88]], dir: 'Sổ ngắn trái' },
        { pts: [[0.65, 0.36], [0.65, 0.88]], dir: 'Sổ ngắn phải' },
      ];
    case 'ㅡ':
      return [{ pts: [[0.1, 0.5], [0.9, 0.5]], dir: 'Nét ngang trái→phải' }];
    case 'ㅣ':
      return [{ pts: [[0.5, 0.08], [0.5, 0.92]], dir: 'Sổ dọc trên→dưới' }];
    case 'ㅢ':
      return [
        { pts: [[0.08, 0.62], [0.56, 0.62]], dir: 'Nét ngang ㅡ' },
        { pts: [[0.68, 0.08], [0.68, 0.92]], dir: 'Sổ dọc ㅣ' },
      ];
    case 'ㅘ':
    case 'ㅙ':
    case 'ㅚ':
    case 'ㅝ':
    case 'ㅞ':
    case 'ㅟ': {
      const horizMap: Record<string, [string, string]> = {
        'ㅘ': ['ㅗ', 'ㅏ'],
        'ㅙ': ['ㅗ', 'ㅐ'],
        'ㅚ': ['ㅗ', 'ㅣ'],
        'ㅝ': ['ㅜ', 'ㅓ'],
        'ㅞ': ['ㅜ', 'ㅔ'],
        'ㅟ': ['ㅜ', 'ㅣ'],
      };
      const [first, second] = horizMap[jamo];
      const s1 = canonicalJamoStrokes(first).map((s) => ({
        pts: s.pts.map(([x, y]): [number, number] => [x * 0.52, 0.45 + y * 0.45]),
        dir: s.dir,
      }));
      const s2 = canonicalJamoStrokes(second).map((s) => ({
        pts: s.pts.map(([x, y]): [number, number] => [0.54 + x * 0.46, y]),
        dir: s.dir,
      }));
      return [...s1, ...s2];
    }
    default:
      return [];
  }
}

function projectBox(
  defs: StrokeDef[],
  jamo: string,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  startIdx: number
): WonderHangulDemoStroke[] {
  return defs.map((def, i) => ({
    index: startIdx + i + 1,
    jamo,
    points: def.pts.map(([rx, ry]) => ({
      x: Math.round((bx + rx * bw) * 10) / 10,
      y: Math.round((by + ry * bh) * 10) / 10,
    })),
    directionLabel: def.dir,
  }));
}

/**
 * Builds canonical NIKL-aligned Hangul stroke-order demonstration data for any modern Hangul
 * syllable (\uAC00-\uD7A3) or compatibility Jamo (\u3131-\u3163). Non-Hangul characters are skipped.
 */
export function buildHangulStrokeOrderDemo(params: {
  demoId?: string;
  text: string;
  startX: number;
  startY: number;
  cellSize?: number;
}): WonderHangulDemoSpec {
  const { demoId = `demo_${Date.now()}`, text, startX, startY, cellSize = 54 } = params;
  const strokes: WonderHangulDemoStroke[] = [];
  let cursorX = startX;
  const chars = Array.from(text);

  for (const ch of chars) {
    if (ch === ' ') {
      cursorX += cellSize * 0.42;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00;
      const cho = CHOSEONG[Math.floor(idx / 588)];
      const jung = JUNGSEONG[Math.floor((idx % 588) / 28)];
      const jong = JONGSEONG[idx % 28];
      const hasJong = jong.length > 0;
      const isBottomVowel =
        jung === 'ㅗ' || jung === 'ㅛ' || jung === 'ㅜ' || jung === 'ㅠ' || jung === 'ㅡ';

      const choRect = isBottomVowel
        ? { x: cursorX + cellSize * 0.1, y: startY, w: cellSize * 0.8, h: cellSize * (hasJong ? 0.34 : 0.46) }
        : { x: cursorX, y: startY + cellSize * 0.04, w: cellSize * 0.5, h: cellSize * (hasJong ? 0.56 : 0.86) };

      const jungRect = isBottomVowel
        ? {
            x: cursorX,
            y: startY + cellSize * (hasJong ? 0.34 : 0.46),
            w: cellSize,
            h: cellSize * (hasJong ? 0.3 : 0.42),
          }
        : {
            x: cursorX + cellSize * 0.52,
            y: startY,
            w: cellSize * 0.46,
            h: cellSize * (hasJong ? 0.6 : 0.94),
          };

      strokes.push(
        ...projectBox(canonicalJamoStrokes(cho), cho, choRect.x, choRect.y, choRect.w, choRect.h, strokes.length)
      );
      strokes.push(
        ...projectBox(canonicalJamoStrokes(jung), jung, jungRect.x, jungRect.y, jungRect.w, jungRect.h, strokes.length)
      );

      if (hasJong) {
        const split = COMPOUND_JONG_SPLIT[jong];
        if (split) {
          strokes.push(
            ...projectBox(
              canonicalJamoStrokes(split[0]),
              split[0],
              cursorX + cellSize * 0.06,
              startY + cellSize * 0.64,
              cellSize * 0.42,
              cellSize * 0.34,
              strokes.length
            )
          );
          strokes.push(
            ...projectBox(
              canonicalJamoStrokes(split[1]),
              split[1],
              cursorX + cellSize * 0.52,
              startY + cellSize * 0.64,
              cellSize * 0.42,
              cellSize * 0.34,
              strokes.length
            )
          );
        } else {
          strokes.push(
            ...projectBox(
              canonicalJamoStrokes(jong),
              jong,
              cursorX + cellSize * 0.14,
              startY + cellSize * 0.64,
              cellSize * 0.72,
              cellSize * 0.34,
              strokes.length
            )
          );
        }
      }
      cursorX += cellSize + 10;
    } else {
      const defs = canonicalJamoStrokes(ch);
      if (defs.length > 0) {
        strokes.push(
          ...projectBox(defs, ch, cursorX, startY, cellSize * 0.85, cellSize * 0.9, strokes.length)
        );
        cursorX += cellSize * 0.95 + 8;
      }
    }
  }

  const width = Math.max(cellSize, cursorX - startX);
  const geometry: WonderBBox = {
    minX: startX,
    minY: startY,
    maxX: startX + width,
    maxY: startY + cellSize + 8,
    width,
    height: cellSize + 8,
  };

  return {
    demoId,
    text,
    geometry,
    strokes,
    scopeNote:
      'NIKL standard compositional Jamo stroke order (40 Jamo -> 11,172 Hangul syllables; non-Hangul omitted)',
  };
}

export function sliceHangulDemoAtProgress(
  demo: WonderHangulDemoSpec,
  progress01: number
): {
  completedPaths: Array<{ index: number; jamo: string; d: string; startPt: { x: number; y: number } }>;
  activePath: { index: number; d: string; startPt: { x: number; y: number }; headX: number; headY: number } | null;
} {
  const total = demo.strokes.length;
  if (total === 0 || progress01 <= 0) {
    return { completedPaths: [], activePath: null };
  }
  const p = Math.max(0, Math.min(1, progress01));
  const scaled = p * total;
  const fullCount = Math.floor(scaled);
  const frac = scaled - fullCount;

  const toPath = (pts: Array<{ x: number; y: number }>) =>
    pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

  const completedPaths: Array<{
    index: number;
    jamo: string;
    d: string;
    startPt: { x: number; y: number };
  }> = [];

  for (let i = 0; i < Math.min(fullCount, total); i++) {
    const st = demo.strokes[i];
    if (st.points.length >= 2) {
      completedPaths.push({
        index: st.index,
        jamo: st.jamo,
        d: toPath(st.points),
        startPt: st.points[0],
      });
    }
  }

  let activePath: {
    index: number;
    d: string;
    startPt: { x: number; y: number };
    headX: number;
    headY: number;
  } | null = null;

  if (fullCount < total && frac > 0.01) {
    const st = demo.strokes[fullCount];
    if (st.points.length >= 2) {
      let totalLen = 0;
      const segLens: number[] = [];
      for (let i = 1; i < st.points.length; i++) {
        const len = Math.hypot(
          st.points[i].x - st.points[i - 1].x,
          st.points[i].y - st.points[i - 1].y
        );
        segLens.push(len);
        totalLen += len;
      }
      const targetLen = totalLen * frac;
      const subPts = [st.points[0]];
      let acc = 0;
      let headX = st.points[0].x;
      let headY = st.points[0].y;
      for (let i = 0; i < segLens.length; i++) {
        const segLen = segLens[i];
        const a = st.points[i];
        const b = st.points[i + 1];
        if (acc + segLen <= targetLen) {
          subPts.push(b);
          headX = b.x;
          headY = b.y;
          acc += segLen;
        } else {
          const r = segLen > 0 ? (targetLen - acc) / segLen : 0;
          headX = a.x + (b.x - a.x) * r;
          headY = a.y + (b.y - a.y) * r;
          subPts.push({ x: Math.round(headX * 10) / 10, y: Math.round(headY * 10) / 10 });
          break;
        }
      }
      activePath = {
        index: st.index,
        d: toPath(subPts),
        startPt: st.points[0],
        headX,
        headY,
      };
    }
  }

  return { completedPaths, activePath };
}
