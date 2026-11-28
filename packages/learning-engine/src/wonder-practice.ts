import type {
  WonderBoardDocument, WonderLearningIntentType, WonderRecognitionRegion, WonderRecognitionSpan,
} from '@seed/schema';
import { contrastiveVowelAlternative, decomposeHangulUnit } from './wonder-hangul';

type Occurrence = WonderRecognitionSpan & { region: WonderRecognitionRegion; text: string; time: number };

export interface WonderPracticeActivity {
  id: string;
  intent: WonderLearningIntentType;
  conceptId?: string;
  explanation?: string;
  occurrences: Occurrence[];
}

export function findWonderPracticeActivities(
  board: WonderBoardDocument,
  regions: WonderRecognitionRegion[]
): WonderPracticeActivity[] {
  const strokeTimes = new Map(board.strokes.map((s) => [s.id, s.createdAt]));
  const occurrences = regions.flatMap((region): Occurrence[] => {
    if (region.recognitionStatus !== 'RECOGNIZED' || region.completeness !== 'complete' ||
        region.confidence < 0.78 || !['ko', 'en'].includes(region.language)) return [];
    const text = region.recognizedText.trim();
    const single = {
      text, bbox: region.bbox, strokeIds: region.strokeIds, startIndex: 0,
      endIndex: text.length, confidence: region.confidence,
    };
    const spans = region.spans.length > 1 && region.spans.map((s) => s.text).join(' ') === text
      ? region.spans : [single];
    if (spans.some((s) => !s.strokeIds.length || s.confidence < 0.78 ||
      !(decomposeHangulUnit(s.text) || /^[가-힣]{1,16}$|^[A-Za-z][A-Za-z'-]{1,20}$/.test(s.text)))) {
      return [];
    }
    const keys = spans.map((s) => JSON.stringify([...s.strokeIds].sort()));
    if (new Set(keys).size !== keys.length) return [];
    return spans.map((s) => ({
      ...s,
      region,
      time: Math.min(...s.strokeIds.map((id) => strokeTimes.get(id) ?? region.recognizedAt)),
    }));
  }).sort((a, b) => a.time - b.time || a.bbox.minY - b.bbox.minY || a.bbox.minX - b.bbox.minX);

  const groups: Occurrence[][] = [];
  for (const occurrence of occurrences) {
    const group = groups.find((prior) => occurrence.time - prior[0].time <= 180_000 &&
      prior.some((item) => {
        if (item.region.language !== occurrence.region.language) return false;
        const a = item.bbox;
        const b = occurrence.bbox;
        const gapX = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
        const gapY = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
        return Math.hypot(gapX, gapY) <= Math.max(130, Math.max(a.height, b.height) * 2.3);
      }));
    if (group) group.push(occurrence);
    else groups.push([occurrence]);
  }

  return groups.flatMap((group): WonderPracticeActivity[] => {
    const labels = [...new Set(group.map((item) => item.text.normalize('NFC')))];
    const byRegion = new Map<WonderRecognitionRegion, number>();
    for (const item of group) byRegion.set(item.region, (byRegion.get(item.region) ?? 0) + 1);
    if ([...byRegion].some(([region, count]) => count < region.recognizedText.trim().split(/\s+/).length)) return [];
    const [a, b] = labels.map(decomposeHangulUnit);
    const id = JSON.stringify([board.id, [...group[0].strokeIds].sort()[0]]);
    if (labels.length === 1 && group.length >= 2) return [{
      id, intent: a ? 'REPEATED_CHARACTER_PRACTICE' : 'REPEATED_WORD_PRACTICE',
      conceptId: `practice:${labels[0]}`, occurrences: group,
    }];

    if (labels.length === 2 && a && b) {
      const compose = ({ unit, initial, vowel, final }: NonNullable<typeof a>) =>
        initial ? `${unit} = ${[initial, vowel, final].filter(Boolean).join(' + ')}` : unit;
      const composition = `${compose(a)}. ${compose(b)}.`;
      if (a.initial === b.initial && a.final === b.final && contrastiveVowelAlternative(a.unit, b.vowel)) {
        const right = ['ㅏ', 'ㅑ'].includes(a.vowel) ? a.vowel : b.vowel;
        const left = right === a.vowel ? b.vowel : a.vowel;
        const above = ['ㅗ', 'ㅛ'].includes(a.vowel) ? a.vowel : b.vowel;
        const below = above === a.vowel ? b.vowel : a.vowel;
        const rule = ['ㅏ', 'ㅓ', 'ㅑ', 'ㅕ'].includes(a.vowel)
          ? `Nhánh ngang của ${right} nằm bên phải nét dọc. Với ${left}, nhánh nằm bên trái.`
          : ['ㅗ', 'ㅜ', 'ㅛ', 'ㅠ'].includes(a.vowel)
            ? `Nhánh dọc của ${above} nằm phía trên nét ngang. Với ${below}, nhánh nằm phía dưới.`
            : 'Nét của ㅡ nằm ngang. Nét của ㅣ thẳng đứng.';
        return [{
          id, intent: 'VOWEL_ORIENTATION_PRACTICE',
          conceptId: `vowel_orientation:${[a.vowel, b.vowel].sort().join('/')}`,
          explanation: `${composition} ${rule}`, occurrences: group,
        }];
      }
      if (a.initial && b.initial && a.initial !== b.initial && a.vowel === b.vowel && a.final === b.final && group.length >= 3) {
        return [{
          id, intent: 'CONSONANT_DISTINCTION_PRACTICE',
          conceptId: `initial_consonant:${[a.initial, b.initial].sort().join('/')}`,
          explanation: `${composition} Hai âm tiết dùng cùng nguyên âm ${a.vowel} và khác phụ âm đầu.`,
          occurrences: group,
        }];
      }
      if (group.length >= 3 && a.initial === b.initial &&
          (a.final === b.final || a.vowel === b.vowel)) return [{
        id, intent: 'CONTRASTIVE_CHARACTER_PRACTICE',
        conceptId: `contrastive:${[...labels].sort().join('/')}`, explanation: composition, occurrences: group,
      }];
    }
    if (group.length >= 3 && labels.every((label) => decomposeHangulUnit(label))) {
      return [{ id, intent: 'UNKNOWN_PRACTICE_INTENT', occurrences: group }];
    }
    return [];
  });
}
