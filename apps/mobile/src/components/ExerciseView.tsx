import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Exercise, FsrsGrade } from '@seed/schema';
import {
  composeHangulFromJamo,
  evaluateExerciseSubmission,
  type ExerciseSubmission,
  type FeedbackEvaluation,
} from '@seed/learning-engine';
import { describeSpeakerVariant, speakKorean } from '../lib/speech';
import { HangulKeyboard } from './HangulKeyboard';
import { GeometricBadge, TactileButton } from './SeedArt';

interface ExerciseViewProps {
  exercise: Exercise;
  onComplete: (result: {
    grade: FsrsGrade;
    wrongAttempts: number;
    requeueAtEnd: boolean;
  }) => void;
}

const STAGE_LABELS: Record<number, string> = {
  1: 'Nấc 1 • Nhận diện',
  2: 'Nấc 2 • Tự nhớ',
  3: 'Nấc 3 • Ghép câu',
  4: 'Nấc 4 • Tự gõ',
};

export function ExerciseView({ exercise, onComplete }: ExerciseViewProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [jamoTokens, setJamoTokens] = useState<string[]>([]);
  const [textValue, setTextValue] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(
    exercise.type === 'ime_typing_recall' ||
      exercise.type === 'audio_dictation' ||
      exercise.type === 'guided_personal_output'
  );
  const [attemptNumber, setAttemptNumber] = useState<1 | 2>(1);
  const [feedback, setFeedback] = useState<FeedbackEvaluation | null>(null);
  const [activeAudioInfo, setActiveAudioInfo] = useState<string | null>(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    setSelectedOptionId(null);
    setSelectedTokens([]);
    setJamoTokens([]);
    setTextValue('');
    setAttemptNumber(1);
    setFeedback(null);
    setActiveAudioInfo(null);
    setVariantIdx(0);
    setShowKeyboard(
      exercise.type === 'ime_typing_recall' ||
        exercise.type === 'audio_dictation' ||
        exercise.type === 'guided_personal_output'
    );
    startTimeRef.current = Date.now();
  }, [exercise.id, exercise.type]);

  const isResolved = feedback !== null && feedback.status !== 'prompt_retry';

  const playExerciseAudio = () => {
    if (exercise.type === 'hvpt_minimal_pair') {
      const target = exercise.options.find((o) => o.id === exercise.targetOptionId);
      const variant = exercise.audioVariants[variantIdx % exercise.audioVariants.length];
      setVariantIdx((v) => v + 1);
      if (target && variant) {
        const res = speakKorean(target.hangul.replace(/[\[\]]/g, ''), {
          speakerId: variant.speakerId,
          rate: variant.rate,
        });
        setActiveAudioInfo(
          res.supported
            ? res.description
            : `${describeSpeakerVariant(variant.speakerId, variant.rate)} • /${target.ipa}/`
        );
      }
      return;
    }

    let textToSpeak = '';
    if (exercise.type === 'vocab_mcq') {
      const match = exercise.promptVi.match(/'([^']+)'/);
      textToSpeak = match?.[1] ?? '';
    } else if (exercise.type === 'audio_dictation') {
      textToSpeak = exercise.expectedAnswers[0] ?? '';
    } else if (exercise.type === 'shadowing_speak') {
      textToSpeak = exercise.targetText;
    }
    if (textToSpeak) {
      const res = speakKorean(textToSpeak, { rate: 'normal' });
      setActiveAudioInfo(res.supported ? res.description : textToSpeak);
    }
  };

  const buildSubmission = (): ExerciseSubmission | null => {
    switch (exercise.type) {
      case 'hvpt_minimal_pair':
      case 'vocab_mcq':
      case 'context_cloze':
      case 'particle_contrast':
        return selectedOptionId ? { kind: 'option', optionId: selectedOptionId } : null;
      case 'syllable_builder':
        return jamoTokens.length > 0
          ? { kind: 'text', text: composeHangulFromJamo(jamoTokens) }
          : null;
      case 'sentence_scramble':
        return selectedTokens.length > 0 ? { kind: 'tokens', tokens: selectedTokens } : null;
      case 'ime_typing_recall':
      case 'audio_dictation':
      case 'guided_personal_output':
        return textValue.trim().length > 0 ? { kind: 'text', text: textValue } : null;
      case 'shadowing_speak':
        return { kind: 'shadowing_done' };
    }
  };

  const handleSubmit = (forceReveal = false) => {
    const submission = buildSubmission() ?? { kind: 'text', text: '' };
    const result = evaluateExerciseSubmission({
      exercise,
      submission,
      attemptNumber,
      forceReveal,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
    setFeedback(result);
    if (result.status === 'prompt_retry') {
      setAttemptNumber(2);
    }
  };

  const handleContinue = () => {
    if (!feedback || feedback.status === 'prompt_retry') return;
    const wrongAttempts =
      feedback.status === 'passed_first_try'
        ? 0
        : feedback.status === 'passed_self_repair'
          ? 1
          : 2;
    onComplete({
      grade: feedback.fsrsGrade,
      wrongAttempts,
      requeueAtEnd: feedback.requeueAtEnd,
    });
  };

  const hasInput = buildSubmission() !== null;

  return (
    <View style={styles.container}>
      <View style={styles.stageBadge}>
        <Text style={styles.stageBadgeText}>{STAGE_LABELS[exercise.stage]}</Text>
      </View>

      <Text style={styles.prompt}>{exercise.promptVi}</Text>

      {(exercise.type === 'hvpt_minimal_pair' ||
        exercise.type === 'audio_dictation' ||
        exercise.type === 'shadowing_speak' ||
        (exercise.type === 'vocab_mcq' && exercise.audioKey)) && (
        <View style={styles.audioBox}>
          <Pressable
            style={({ pressed }) => [styles.audioBtn, pressed && styles.audioBtnPressed]}
            onPress={playExerciseAudio}
          >
            <GeometricBadge name="audio" size={28} />
            <Text style={styles.audioBtnText}>
              {exercise.type === 'hvpt_minimal_pair' ? 'Nghe giọng mới' : 'Nghe phát âm'}
            </Text>
          </Pressable>
          {activeAudioInfo && <Text style={styles.audioMeta}>{activeAudioInfo}</Text>}
        </View>
      )}

      {(exercise.type === 'hvpt_minimal_pair' ||
        exercise.type === 'vocab_mcq' ||
        exercise.type === 'context_cloze' ||
        exercise.type === 'particle_contrast') && (
        <View style={styles.optionsList}>
          {exercise.options.map((opt, index) => {
            const isSelected = selectedOptionId === opt.id;
            const title =
              'hangul' in opt
                ? opt.hangul
                : 'label' in opt
                  ? opt.label
                  : opt.text;
            const sub = 'ipa' in opt ? `/${opt.ipa}/ • ${opt.meaningVi}` : undefined;
            return (
              <Pressable
                key={opt.id}
                disabled={isResolved}
                style={({ pressed }) => [
                  styles.optionCard,
                  isSelected && styles.optionSelected,
                  pressed && !isResolved && styles.optionPressed,
                ]}
                onPress={() => setSelectedOptionId(opt.id)}
              >
                <View style={styles.optionRow}>
                  <View style={[styles.optionIndexBox, isSelected && styles.optionIndexBoxSelected]}>
                    <Text style={[styles.optionIndex, isSelected && styles.optionIndexSelected]}>
                      {String.fromCharCode(65 + index)}
                    </Text>
                  </View>
                  <View style={styles.optionBody}>
                    <Text style={[styles.optionTitle, isSelected && styles.optionTitleSelected]}>
                      {title}
                    </Text>
                    {sub && <Text style={styles.optionSub}>{sub}</Text>}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {exercise.type === 'syllable_builder' && (
        <View>
          <View style={styles.answerDisplay}>
            <Text style={styles.answerDisplayText}>
              {jamoTokens.length > 0 ? composeHangulFromJamo(jamoTokens) : 'Chạm Jamo bên dưới'}
            </Text>
          </View>
          <View style={styles.tokenWrap}>
            {exercise.availableJamo.map((j, idx) => (
              <Pressable
                key={`${j}-${idx}`}
                disabled={isResolved}
                style={({ pressed }) => [styles.jamoTile, pressed && styles.tilePressed]}
                onPress={() => setJamoTokens((prev) => [...prev, j])}
              >
                <Text style={styles.jamoTileText}>{j}</Text>
              </Pressable>
            ))}
            <Pressable
              disabled={isResolved}
              style={[styles.jamoTile, styles.clearTile]}
              onPress={() => setJamoTokens([])}
            >
              <Text style={styles.clearTileText}>Xóa</Text>
            </Pressable>
          </View>
        </View>
      )}

      {exercise.type === 'sentence_scramble' && (
        <View>
          <View style={styles.answerDisplay}>
            <Text style={styles.answerDisplayText}>
              {selectedTokens.length > 0 ? selectedTokens.join(' ') : 'Chạm từ theo thứ tự'}
            </Text>
          </View>
          <View style={styles.tokenWrap}>
            {exercise.tokens.map((tok, idx) => {
              const usedCount = selectedTokens.filter((t) => t === tok).length;
              const availCount = exercise.tokens.filter((t) => t === tok).length;
              const disabled = isResolved || usedCount >= availCount;
              return (
                <Pressable
                  key={`${tok}-${idx}`}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.wordChip,
                    disabled && styles.wordChipUsed,
                    pressed && !disabled && styles.tilePressed,
                  ]}
                  onPress={() => setSelectedTokens((prev) => [...prev, tok])}
                >
                  <Text style={styles.wordChipText}>{tok}</Text>
                </Pressable>
              );
            })}
            <Pressable
              disabled={isResolved || selectedTokens.length === 0}
              style={[styles.wordChip, styles.clearTile]}
              onPress={() => setSelectedTokens((prev) => prev.slice(0, -1))}
            >
              <Text style={styles.clearTileText}>Lùi</Text>
            </Pressable>
          </View>
        </View>
      )}

      {(exercise.type === 'ime_typing_recall' ||
        exercise.type === 'audio_dictation' ||
        exercise.type === 'guided_personal_output') && (
        <View>
          {exercise.type === 'guided_personal_output' && (
            <View style={styles.templateBanner}>
              <Text style={styles.templateValue}>{exercise.templateHint}</Text>
            </View>
          )}
          <TextInput
            style={styles.textInput}
            editable={!isResolved}
            value={textValue}
            onChangeText={(txt) => {
              setTextValue(txt);
              setJamoTokens([]);
            }}
            placeholder="Gõ tiếng Hàn..."
            placeholderTextColor="#8C7A6B"
          />
          <Pressable
            style={styles.toggleKbBtn}
            onPress={() => setShowKeyboard((s) => !s)}
          >
            <Text style={styles.toggleKbText}>
              {showKeyboard ? 'Ẩn bàn phím Hàn' : 'Bàn phím Hàn'}
            </Text>
          </Pressable>
          {showKeyboard && !isResolved && (
            <HangulKeyboard
              tokens={jamoTokens}
              onChangeTokens={(nextTokens, composed) => {
                setJamoTokens(nextTokens);
                setTextValue(composed);
              }}
            />
          )}
        </View>
      )}

      {exercise.type === 'shadowing_speak' && (
        <View style={styles.shadowBox}>
          <Text style={styles.shadowKo}>{exercise.targetText}</Text>
          <Text style={styles.shadowHint}>Nghe mẫu và đọc theo 2 lần.</Text>
        </View>
      )}

      {feedback && (
        <View
          style={[
            styles.feedbackBox,
            feedback.status === 'prompt_retry'
              ? styles.feedbackPrompt
              : feedback.status === 'failed_reveal'
                ? styles.feedbackError
                : styles.feedbackSuccess,
          ]}
        >
          <View style={styles.feedbackHead}>
            <GeometricBadge
              name={
                feedback.status === 'prompt_retry'
                  ? 'hint'
                  : feedback.status === 'failed_reveal'
                    ? 'book'
                    : 'check'
              }
              size={24}
            />
            <Text style={styles.feedbackTitle}>
              {feedback.status === 'prompt_retry' && 'Gợi ý tự sửa'}
              {feedback.status === 'passed_first_try' && 'Chính xác'}
              {feedback.status === 'passed_self_repair' && 'Tự sửa đúng'}
              {feedback.status === 'failed_reveal' && 'Giải thích'}
            </Text>
          </View>
          <Text style={styles.feedbackBody}>
            {feedback.status === 'prompt_retry' ? feedback.hint : feedback.explanation}
          </Text>
          {feedback.status === 'failed_reveal' && (
            <Text style={styles.correctLine}>Đáp án: {feedback.correctSummary}</Text>
          )}
        </View>
      )}

      <View style={styles.actionRow}>
        {!isResolved ? (
          <>
            <TactileButton
              label="Kiểm tra"
              variant="caramel"
              disabled={!hasInput && exercise.type !== 'shadowing_speak'}
              onPress={() => handleSubmit(false)}
              style={{ flex: 1 }}
            />
            {attemptNumber === 2 && (
              <TactileButton
                label="Xem đáp án"
                variant="outline"
                onPress={() => handleSubmit(true)}
              />
            )}
          </>
        ) : (
          <TactileButton
            label="Tiếp tục"
            variant={feedback?.status === 'failed_reveal' ? 'sand' : 'caramel'}
            onPress={handleContinue}
            style={{ flex: 1 }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
  },
  stageBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F2F7F3',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 10,
  },
  stageBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D5D3D',
  },
  prompt: {
    fontSize: 17.5,
    fontWeight: '600',
    color: '#2C221E',
    lineHeight: 26,
    marginBottom: 16,
  },
  audioBox: {
    marginBottom: 16,
    gap: 6,
  },
  audioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#DFD2C0',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  audioBtnPressed: {
    borderBottomWidth: 1.5,
    transform: [{ translateY: 1.5 }],
  },
  audioBtnText: {
    color: '#5C4D42',
    fontWeight: '600',
    fontSize: 14,
  },
  audioMeta: {
    fontSize: 12.5,
    color: '#8C7A6B',
    textAlign: 'center',
  },
  optionsList: {
    gap: 10,
  },
  optionCard: {
    borderWidth: 1.5,
    borderBottomWidth: 3,
    borderColor: '#EAE2D6',
    borderRadius: 14,
    padding: 13,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: {
    borderColor: '#3E7B52',
    backgroundColor: '#F2F7F3',
  },
  optionPressed: {
    borderBottomWidth: 1.5,
    transform: [{ translateY: 1.5 }],
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionIndexBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIndexBoxSelected: {
    backgroundColor: '#3E7B52',
    borderColor: '#2D5D3D',
  },
  optionIndex: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B584B',
  },
  optionIndexSelected: {
    color: '#FFFFFF',
  },
  optionBody: { flex: 1 },
  optionTitle: {
    fontSize: 16.5,
    fontWeight: '600',
    color: '#2C221E',
  },
  optionTitleSelected: {
    color: '#244A32',
  },
  optionSub: {
    fontSize: 13,
    color: '#8C7A6B',
    marginTop: 2,
  },
  answerDisplay: {
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: '#EAE0D2',
    borderRadius: 14,
    padding: 14,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  answerDisplayText: {
    fontSize: 19,
    fontWeight: '600',
    color: '#2C221E',
    textAlign: 'center',
  },
  tokenWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  jamoTile: {
    minWidth: 46,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderBottomWidth: 3,
    borderColor: '#DFD2C0',
    alignItems: 'center',
  },
  tilePressed: {
    borderBottomWidth: 1.5,
    transform: [{ translateY: 1.5 }],
  },
  jamoTileText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2C221E',
  },
  wordChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderBottomWidth: 3,
    borderColor: '#DFD2C0',
  },
  wordChipUsed: {
    opacity: 0.3,
  },
  wordChipText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C221E',
  },
  clearTile: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DFD2C0',
  },
  clearTileText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#5C4D42',
  },
  templateBanner: {
    backgroundColor: '#FFFFFF',
    padding: 11,
    borderRadius: 12,
    marginBottom: 10,
  },
  templateValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A3B32',
  },
  textInput: {
    borderWidth: 1.5,
    borderColor: '#DFD2C0',
    borderRadius: 14,
    padding: 13,
    fontSize: 18,
    fontWeight: '500',
    color: '#2C221E',
    backgroundColor: '#FFFFFF',
  },
  toggleKbBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  toggleKbText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8D6B4C',
  },
  shadowBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  shadowKo: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C221E',
  },
  shadowHint: {
    fontSize: 13.5,
    color: '#5C4D42',
  },
  feedbackBox: {
    marginTop: 16,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    gap: 6,
  },
  feedbackPrompt: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
  },
  feedbackSuccess: {
    backgroundColor: '#F2F7F3',
    borderColor: '#B6D7C0',
  },
  feedbackError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  feedbackHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackTitle: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '700',
    color: '#2C221E',
  },
  feedbackBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#4A3B32',
  },
  correctLine: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '700',
    color: '#991B1B',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
});
