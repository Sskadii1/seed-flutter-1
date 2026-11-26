import type { SpeakerId, SpeakingRate } from '@seed/schema';

interface SpeechPreset {
  pitch: number;
  labelVi: string;
}

const SPEAKER_PRESETS: Record<SpeakerId, SpeechPreset> = {
  female_seoul_1: { pitch: 1.18, labelVi: 'Nữ Seoul 1' },
  male_seoul_1: { pitch: 0.85, labelVi: 'Nam Seoul 1' },
  female_seoul_2: { pitch: 1.28, labelVi: 'Nữ Seoul 2' },
  male_busan_1: { pitch: 0.78, labelVi: 'Nam Busan 1' },
};

const RATE_VALUES: Record<SpeakingRate, number> = {
  slow: 0.68,
  normal: 0.98,
  fast: 1.22,
};

export function describeSpeakerVariant(speakerId: SpeakerId, rate: SpeakingRate): string {
  const sp = SPEAKER_PRESETS[speakerId];
  const rateVi = rate === 'slow' ? 'Chậm' : rate === 'fast' ? 'Nhanh' : 'Vừa';
  return `${sp.labelVi} • ${rateVi}`;
}

/**
 * Plays Korean speech via Web Speech API on Web (ko-KR) with multi-speaker pitch
 * and rate modulation for HVPT drills. Safely degrades on headless/native shells
 * until expo-speech or pre-recorded CDN MP3s are attached.
 */
export function speakKorean(
  text: string,
  options?: { speakerId?: SpeakerId; rate?: SpeakingRate }
): { supported: boolean; description: string } {
  const speakerId = options?.speakerId ?? 'female_seoul_1';
  const rate = options?.rate ?? 'normal';
  const description = describeSpeakerVariant(speakerId, rate);

  if (typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis) {
    try {
      const synth = globalThis.speechSynthesis;
      synth.cancel();
      const UtteranceCtor = (globalThis as unknown as {
        SpeechSynthesisUtterance?: new (t: string) => SpeechSynthesisUtterance;
      }).SpeechSynthesisUtterance;

      if (UtteranceCtor) {
        const utterance = new UtteranceCtor(text);
        utterance.lang = 'ko-KR';
        utterance.pitch = SPEAKER_PRESETS[speakerId].pitch;
        utterance.rate = RATE_VALUES[rate];
        const voices = synth.getVoices();
        const krVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ko'));
        if (krVoice) {
          utterance.voice = krVoice;
        }
        synth.speak(utterance);
        return { supported: true, description };
      }
    } catch {
      // Fallback cleanly when speechSynthesis is blocked
    }
  }

  return { supported: false, description };
}
