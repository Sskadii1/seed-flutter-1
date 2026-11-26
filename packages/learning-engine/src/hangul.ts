export const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

export const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const;

export const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const COMPOUND_VOWELS: Record<string, string> = {
  'ㅗㅏ': 'ㅘ',
  'ㅗㅐ': 'ㅙ',
  'ㅗㅣ': 'ㅚ',
  'ㅜㅓ': 'ㅝ',
  'ㅜㅔ': 'ㅞ',
  'ㅜㅣ': 'ㅟ',
  'ㅡㅣ': 'ㅢ',
};

const COMPOUND_JONGSEONG: Record<string, string> = {
  'ㄱㅅ': 'ㄳ',
  'ㄴㅈ': 'ㄵ',
  'ㄴㅎ': 'ㄶ',
  'ㄹㄱ': 'ㄺ',
  'ㄹㅁ': 'ㄻ',
  'ㄹㅂ': 'ㄼ',
  'ㄹㅅ': 'ㄽ',
  'ㄹㅌ': 'ㄾ',
  'ㄹㅍ': 'ㄿ',
  'ㄹㅎ': 'ㅀ',
  'ㅂㅅ': 'ㅄ',
};

const SPLIT_JONGSEONG: Record<string, [string, string]> = Object.fromEntries(
  Object.entries(COMPOUND_JONGSEONG).map(([pair, combined]) => [
    combined,
    [pair[0], pair[1]],
  ])
);

const CHOSEONG_INDEX = new Map<string, number>(CHOSEONG.map((c, i) => [c, i]));
const JUNGSEONG_INDEX = new Map<string, number>(JUNGSEONG.map((c, i) => [c, i]));
const JONGSEONG_INDEX = new Map<string, number>(JONGSEONG.map((c, i) => [c, i]));

export function getBatchimJamoIndex(koreanText: string): number {
  const trimmed = koreanText.trim();
  if (!trimmed) return 0;
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return 0;
  return (code - 0xac00) % 28;
}

export function hasBatchim(koreanText: string): boolean {
  return getBatchimJamoIndex(koreanText) !== 0;
}

export type ParticlePair = '은/는' | '이/가' | '을/를' | '이에요/예요' | '(으)로' | '과/와';

export function attachParticle(noun: string, pair: ParticlePair): string {
  const batchimIdx = getBatchimJamoIndex(noun);
  const hasB = batchimIdx !== 0;
  switch (pair) {
    case '은/는':
      return `${noun}${hasB ? '은' : '는'}`;
    case '이/가':
      return `${noun}${hasB ? '이' : '가'}`;
    case '을/를':
      return `${noun}${hasB ? '을' : '를'}`;
    case '이에요/예요':
      return `${noun}${hasB ? '이에요' : '예요'}`;
    case '과/와':
      return `${noun}${hasB ? '과' : '와'}`;
    case '(으)로':
      return `${noun}${batchimIdx === 0 || batchimIdx === 8 ? '로' : '으로'}`;
  }
}

function buildSyllable(cho: number, jung: number, jong = 0): string {
  return String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong);
}

/**
 * Composes a stream of Korean jamo (and spaces/punctuation) using standard
 * 2-beolsik Hangul automata rules, including compound vowels and batchim liaison.
 */
export function composeHangulFromJamo(tokens: string[]): string {
  const output: string[] = [];
  let cho: number | null = null;
  let jung: number | null = null;
  let jong = 0;

  const flush = () => {
    if (cho !== null && jung !== null) {
      output.push(buildSyllable(cho, jung, jong));
    } else if (cho !== null) {
      output.push(CHOSEONG[cho]);
    } else if (jung !== null) {
      output.push(JUNGSEONG[jung]);
    }
    cho = null;
    jung = null;
    jong = 0;
  };

  for (const ch of tokens) {
    const isConsonant = CHOSEONG_INDEX.has(ch) || JONGSEONG_INDEX.has(ch);
    const isVowel = JUNGSEONG_INDEX.has(ch);

    if (!isConsonant && !isVowel) {
      flush();
      output.push(ch);
      continue;
    }

    if (isConsonant) {
      if (cho !== null && jung !== null) {
        if (jong === 0) {
          const jIdx = JONGSEONG_INDEX.get(ch);
          if (jIdx !== undefined && jIdx > 0) {
            jong = jIdx;
            continue;
          }
        } else {
          const currentJongChar = JONGSEONG[jong];
          const combined = COMPOUND_JONGSEONG[`${currentJongChar}${ch}`];
          if (combined) {
            const combinedIdx = JONGSEONG_INDEX.get(combined);
            if (combinedIdx !== undefined) {
              jong = combinedIdx;
              continue;
            }
          }
        }
      }
      flush();
      const cIdx = CHOSEONG_INDEX.get(ch);
      if (cIdx !== undefined) {
        cho = cIdx;
      } else {
        output.push(ch);
      }
      continue;
    }

    // ch is a vowel
    if (cho !== null && jung === null) {
      jung = JUNGSEONG_INDEX.get(ch)!;
      continue;
    }

    if (cho !== null && jung !== null) {
      if (jong === 0) {
        const combinedVowel: string | undefined = COMPOUND_VOWELS[`${JUNGSEONG[jung]}${ch}`];
        if (combinedVowel) {
          jung = JUNGSEONG_INDEX.get(combinedVowel)!;
          continue;
        }
        flush();
        jung = JUNGSEONG_INDEX.get(ch)!;
        continue;
      }

      // Liaison: move last batchim consonant to next syllable's initial consonant
      const currentJongChar = JONGSEONG[jong];
      const split = SPLIT_JONGSEONG[currentJongChar];
      if (split) {
        const [stayChar, moveChar] = split;
        jong = JONGSEONG_INDEX.get(stayChar)!;
        flush();
        cho = CHOSEONG_INDEX.get(moveChar)!;
        jung = JUNGSEONG_INDEX.get(ch)!;
      } else {
        const moveIdx = CHOSEONG_INDEX.get(currentJongChar);
        if (moveIdx !== undefined) {
          jong = 0;
          flush();
          cho = moveIdx;
          jung = JUNGSEONG_INDEX.get(ch)!;
        } else {
          flush();
          jung = JUNGSEONG_INDEX.get(ch)!;
        }
      }
      continue;
    }

    // Standalone vowel (e.g., typing vowel before consonant)
    if (jung !== null) {
      const combinedVowel: string | undefined = COMPOUND_VOWELS[`${JUNGSEONG[jung]}${ch}`];
      if (combinedVowel) {
        jung = JUNGSEONG_INDEX.get(combinedVowel)!;
        continue;
      }
      flush();
    }
    jung = JUNGSEONG_INDEX.get(ch)!;
  }

  flush();
  return output.join('');
}

export function normalizeKoreanAnswer(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!,]+$/g, '')
    .trim();
}
