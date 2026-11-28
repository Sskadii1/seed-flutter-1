import type { WonderStroke } from '@seed/schema';

const VOWELS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const INITIALS = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

export function decomposeHangulUnit(text: string) {
  const unit = text.trim().normalize('NFC');
  if ([...unit].length !== 1) return null;
  if (VOWELS.includes(unit)) return { unit, initial: '', vowel: unit, final: '' };
  const [initial, vowel, final] = [...unit.normalize('NFD')].map((jamo) => jamo.charCodeAt(0));
  const leading = INITIALS[initial - 0x1100];
  const medial = VOWELS[vowel - 0x1161];
  if (initial >= 0x1161 && initial <= 0x1175 && vowel === undefined) {
    return { unit, initial: '', vowel: VOWELS[initial - 0x1161], final: '' };
  }
  if (!leading || !medial || (final !== undefined && !FINALS[final - 0x11a7])) return null;
  return { unit, initial: leading, vowel: medial, final: FINALS[final - 0x11a7] ?? '' };
}

const BRANCH_VOWELS = {
  right: ['ㅏ', 'ㅑ'],
  left: ['ㅓ', 'ㅕ'],
  above: ['ㅗ', 'ㅛ'],
  below: ['ㅜ', 'ㅠ'],
} as const;

export interface HangulBranchEvidence {
  vowel: string;
  stemStrokeId: string;
  branchStrokeIds: string[];
  side: keyof typeof BRANCH_VOWELS;
  virtualJunction: boolean;
  componentLayout: 'standalone' | 'initial_left' | 'initial_above';
  possibleFinal: boolean;
}

// Orient the line from its lower world coordinate, independent of pen travel.
function toSpatialLine(stroke: WonderStroke, axis: 'x' | 'y') {
  if (stroke.points.length < 2) return null;
  const cross = axis === 'x' ? 'y' : 'x';
  const points = stroke.points.map((p) => ({
    x: p.x + stroke.transform.dx,
    y: p.y + stroke.transform.dy,
  }));
  let start = points[0];
  let end = points[0];
  for (const p of points) {
    if (p[axis] < start[axis]) start = p;
    if (p[axis] > end[axis]) end = p;
  }
  const span = end[axis] - start[axis];
  if (span < 4 || Math.abs(end[cross] - start[cross]) > span * 0.42) return null;
  const at = (position: number) =>
    start[cross] + ((position - start[axis]) / span) * (end[cross] - start[cross]);
  if (points.some((p) => Math.abs(p[cross] - at(p[axis])) > Math.max(2.5, span * 0.115))) {
    return null;
  }
  return { stroke, start: start[axis], end: end[axis], span, at };
}

export function inspectStandaloneHangulAxis(strokes: WonderStroke[]) {
  if (strokes.length !== 1) return undefined;
  const [stroke] = strokes;
  const horizontal = toSpatialLine(stroke, 'x');
  const vertical = toSpatialLine(stroke, 'y');
  if (horizontal && horizontal.span >= 10) {
    return { vowel: 'ㅡ', dominantAxis: 'horizontal' as const, stemStrokeId: stroke.id };
  }
  if (vertical && vertical.span >= 10) {
    return { vowel: 'ㅣ', dominantAxis: 'vertical' as const, stemStrokeId: stroke.id };
  }
  return undefined;
}

// Verifies separated-stroke vowel structure. A result requires a unique stem and
// spatially consistent branches. Vision remains responsible for the transcript.
export function inspectHangulBranch(strokes: WonderStroke[]): HangulBranchEvidence | undefined {
  const hypotheses: HangulBranchEvidence[] = [];
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x';
    const lines = strokes.map((s) => toSpatialLine(s, axis)).filter((s) => s !== null);
    const perpendicular = strokes.map((s) => toSpatialLine(s, cross)).filter((s) => s !== null);
    for (const stem of lines) {
      const branches = perpendicular.flatMap((branch) => {
        if (branch.span < stem.span * 0.12 || branch.span > stem.span * 0.56) return [];
        const center = (branch.start + branch.end) / 2;
        const along = branch.at(center);
        if (along < stem.start + stem.span * 0.12 || along > stem.end - stem.span * 0.12) return [];
        const junction = stem.at(along);
        const positive = branch.end - junction;
        const negative = junction - branch.start;
        const extent = Math.max(positive, negative);
        const inner = Math.min(positive, negative);
        if (extent < stem.span * 0.10 || inner > branch.span * 0.24) return [];
        const gap = Math.max(0, -inner);
        if (gap > Math.min(stem.span * 0.18, branch.span * 0.8)) return [];
        const side = axis === 'y'
          ? (positive > negative ? 'right' : 'left')
          : (positive > negative ? 'below' : 'above');
        return [{ branch, along, gap, side } as const];
      });
      if (branches.length < 1 || branches.length > 2) continue;
      const { side } = branches[0];
      if (branches.some((b) => b.side !== side)) continue;
      if (branches.length === 2 && Math.abs(branches[0].along - branches[1].along) < stem.span * 0.14) continue;

      const remaining = strokes.filter((s) =>
        s !== stem.stroke && !branches.some((b) => b.branch.stroke === s));
      const final = remaining.filter((s) =>
        s.bbox.minY > (axis === 'y' ? stem.end : Math.max(
          stem.at(stem.start), stem.at(stem.end),
          ...branches.map((b) => b.branch.end)
        )) + stem.span * 0.04);
      const leading = remaining.filter((s) => !final.includes(s));
      const stemMid = stem.at((stem.start + stem.end) / 2);
      const leadingFits = leading.every(({ bbox: box }) => axis === 'y'
        ? box.maxX <= stemMid + stem.span * 0.08 &&
          box.maxY >= stem.start + stem.span * 0.18 && box.minY <= stem.end - stem.span * 0.18
        : box.maxY <= stemMid + stem.span * 0.08 &&
          box.maxX >= stem.start && box.minX <= stem.end);
      if (!leadingFits || (final.length > 0 && leading.length === 0)) continue;
      hypotheses.push({
        vowel: BRANCH_VOWELS[side][branches.length - 1],
        stemStrokeId: stem.stroke.id,
        branchStrokeIds: branches.map((b) => b.branch.stroke.id),
        side,
        virtualJunction: branches.some((b) => b.gap > Math.max(1, stem.span * 0.025)),
        componentLayout: leading.length === 0 ? 'standalone' : axis === 'y' ? 'initial_left' : 'initial_above',
        possibleFinal: final.length > 0,
      });
    }
  }
  return hypotheses.length === 1 ? hypotheses[0] : undefined;
}

export function contrastiveVowelAlternative(text: string, vowel: string): string | undefined {
  const unit = decomposeHangulUnit(text);
  if (!unit || unit.vowel === vowel) return undefined;
  const opposite = [['ㅏ', 'ㅓ'], ['ㅑ', 'ㅕ'], ['ㅗ', 'ㅜ'], ['ㅛ', 'ㅠ'], ['ㅡ', 'ㅣ']];
  if (!opposite.some((pair) => pair.includes(unit.vowel) && pair.includes(vowel))) return undefined;
  if (!unit.initial) return vowel;
  return String.fromCharCode(
    0xac00 + (INITIALS.indexOf(unit.initial) * 21 + VOWELS.indexOf(vowel)) * 28 + FINALS.indexOf(unit.final)
  );
}
