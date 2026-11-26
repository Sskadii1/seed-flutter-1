import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  AdaptiveAiProfile,
  DialogueLine,
  Exercise,
  ExplicitRule,
  FsrsGrade,
  GradedMicroStory,
  GrammarPoint,
  VocabItem,
} from '@seed/schema';
import { selectRemedialExercise } from '@seed/learning-engine';
import { ExerciseView } from '../components/ExerciseView';
import { RuleCard } from '../components/RuleCard';
import { GeometricBadge, TactileButton } from '../components/SeedArt';
import { speakKorean } from '../lib/speech';

export interface ActiveLessonSession {
  id: string;
  title: string;
  subtitle: string;
  explicitRules: Array<{
    title: string;
    summaryVi: string;
    vietnameseTrap: string;
    examples?: Array<{ ko: string; vi: string }>;
  }>;
  vocabPreview: VocabItem[];
  dialogue?: DialogueLine[];
  microStory?: GradedMicroStory;
  exercises: Exercise[];
}

interface LessonPlayerModalProps {
  session: ActiveLessonSession | null;
  aiProfile: AdaptiveAiProfile;
  onClose: () => void;
  onRecordExercise: (params: {
    exercise: Exercise;
    grade: FsrsGrade;
    wrongAttempts: number;
  }) => number;
  onFinishLesson: (lessonId: string) => void;
}

export function LessonPlayerModal({
  session,
  aiProfile,
  onClose,
  onRecordExercise,
  onFinishLesson,
}: LessonPlayerModalProps) {
  const [phase, setPhase] = useState<'intro' | 'exercises' | 'story' | 'done'>('intro');
  const [queue, setQueue] = useState<Exercise[]>([]);
  const [idx, setIdx] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [firstTryPasses, setFirstTryPasses] = useState(0);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [remedialCount, setRemedialCount] = useState(0);

  React.useEffect(() => {
    if (session) {
      const hasIntro = session.explicitRules.length > 0 || session.vocabPreview.length > 0;
      setPhase(hasIntro ? 'intro' : 'exercises');
      setQueue([...session.exercises]);
      setIdx(0);
      setSessionXp(0);
      setFirstTryPasses(0);
      setTotalCompleted(0);
      setRemedialCount(0);
    }
  }, [session]);

  if (!session) return null;

  const currentExercise = queue[idx];
  const progressPct = Math.round(((idx + 1) / Math.max(1, queue.length)) * 100);

  const handleExerciseComplete = (res: {
    grade: FsrsGrade;
    wrongAttempts: number;
    requeueAtEnd: boolean;
  }) => {
    if (!currentExercise) return;
    const earned = onRecordExercise({
      exercise: currentExercise,
      grade: res.grade,
      wrongAttempts: res.wrongAttempts,
    });
    setSessionXp((x) => x + earned);
    setTotalCompleted((c) => c + 1);
    if (res.wrongAttempts === 0) {
      setFirstTryPasses((p) => p + 1);
    }

    let nextQueue = queue;
    if (res.requeueAtEnd && queue.length < session.exercises.length + 4) {
      // ZPDES Remedial Scaffolding: insert a lower-stage scaffold before re-testing
      if (remedialCount < 2) {
        const scaffold = selectRemedialExercise(currentExercise, aiProfile);
        if (scaffold && !queue.some((q) => q.id === scaffold.id)) {
          nextQueue = [...queue, scaffold, currentExercise];
          setRemedialCount((r) => r + 1);
        } else {
          nextQueue = [...queue, currentExercise];
        }
      } else {
        nextQueue = [...queue, currentExercise];
      }
      setQueue(nextQueue);
    }

    if (idx + 1 < nextQueue.length) {
      setIdx(idx + 1);
    } else if (session.dialogue || session.microStory) {
      setPhase('story');
    } else {
      onFinishLesson(session.id);
      setPhase('done');
    }
  };

  return (
    <Modal visible={Boolean(session)} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>Đóng</Text>
          </Pressable>
          <View style={styles.progressWrap}>
            <Text style={styles.topTitle} numberOfLines={1}>
              {session.title}
            </Text>
            {phase === 'exercises' && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
            )}
          </View>
          <View style={styles.xpBadge}>
            <GeometricBadge name="xp" size={20} />
            <Text style={styles.xpPill}>+{sessionXp}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {phase === 'intro' && (
            <View>
              {session.explicitRules.map((r, i) => (
                <RuleCard
                  key={i}
                  title={r.title}
                  summaryVi={r.summaryVi}
                  vietnameseTrap={r.vietnameseTrap}
                  examples={r.examples}
                />
              ))}

              {session.vocabPreview.length > 0 && (
                <View style={styles.vocabBox}>
                  <Text style={styles.vocabHeader}>Từ vựng mới (chạm để nghe)</Text>
                  {session.vocabPreview.map((v, vIdx) => (
                    <Pressable
                      key={v.id}
                      style={[styles.vocabRow, vIdx === 0 && styles.vocabRowFirst]}
                      onPress={() => speakKorean(v.hangul)}
                    >
                      <View style={styles.vocabTop}>
                        <Text style={styles.vocabKo}>{v.hangul}</Text>
                        <Text style={styles.badgeBatchim}>
                          {v.hasBatchim ? 'Có patchim' : 'Không patchim'}
                        </Text>
                      </View>
                      <Text style={styles.vocabVi}>{v.meaningVi}</Text>
                      {v.hanja && (
                        <Text style={styles.hanjaNote}>Hán–Việt: {v.hanja.hanViet}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              <TactileButton
                label="Bắt đầu luyện tập"
                variant="caramel"
                onPress={() => setPhase('exercises')}
              />
            </View>
          )}

          {phase === 'exercises' && currentExercise && (
            <View>
              <Text style={styles.stepLabel}>
                Câu {idx + 1} / {queue.length}
              </Text>
              <ExerciseView exercise={currentExercise} onComplete={handleExerciseComplete} />
            </View>
          )}

          {phase === 'story' && (
            <View style={styles.storyContainer}>
              {session.dialogue && (
                <View style={styles.storyCard}>
                  <Text style={styles.storyTitle}>Hội thoại</Text>
                  {session.dialogue.map((line, i) => (
                    <Pressable
                      key={i}
                      style={styles.storyLine}
                      onPress={() => speakKorean(line.ko)}
                    >
                      <Text style={styles.speakerTag}>{line.speaker}</Text>
                      <Text style={styles.storyKo}>{line.ko}</Text>
                      <Text style={styles.storyVi}>{line.vi}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {session.microStory && (
                <View style={styles.storyCard}>
                  <Text style={styles.storyTitle}>{session.microStory.titleVi}</Text>
                  {session.microStory.lines.map((line, i) => (
                    <Pressable
                      key={i}
                      style={styles.storyLine}
                      onPress={() => speakKorean(line.ko)}
                    >
                      <Text style={styles.storyKo}>{line.ko}</Text>
                      <Text style={styles.storyVi}>{line.vi}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <TactileButton
                label="Hoàn thành"
                variant="caramel"
                onPress={() => {
                  onFinishLesson(session.id);
                  setPhase('done');
                }}
              />
            </View>
          )}

          {phase === 'done' && (
            <View style={styles.doneCard}>
              <GeometricBadge name="star" size={44} />
              <Text style={styles.doneTitle}>Hoàn thành bài học</Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryVal}>+{sessionXp} XP</Text>
                  <Text style={styles.summaryLbl}>Điểm nhớ</Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryVal}>
                    {firstTryPasses}/{totalCompleted}
                  </Text>
                  <Text style={styles.summaryLbl}>Đúng lần đầu</Text>
                </View>
              </View>
              <TactileButton
                label="Về lộ trình"
                variant="caramel"
                onPress={onClose}
                style={{ width: '100%' }}
              />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function buildRuleListFromUnit0(rule: ExplicitRule) {
  return [rule];
}

export function buildRuleListFromGrammar(points: GrammarPoint[]) {
  return points.map((g) => ({
    title: `${g.pattern} — ${g.meaningVi}`,
    summaryVi: g.explicitRuleVi,
    vietnameseTrap: g.vietnameseL1Trap,
    examples: g.examples,
  }));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EAE2D6',
    gap: 12,
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  closeText: { fontSize: 13, fontWeight: '600', color: '#5C4D42' },
  progressWrap: { flex: 1, gap: 6 },
  topTitle: { fontSize: 14.5, fontWeight: '600', color: '#2C221E' },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#EEF6F0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3E7B52',
    borderRadius: 999,
  },
  xpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE2D6',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  xpPill: { color: '#8D6B4C', fontWeight: '700', fontSize: 13 },
  body: { padding: 20, maxWidth: 680, width: '100%', alignSelf: 'center' },
  vocabBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    marginBottom: 16,
    gap: 10,
  },
  vocabHeader: { fontSize: 14, fontWeight: '700', color: '#5C4D42' },
  vocabRow: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3EEE6',
    gap: 2,
  },
  vocabRowFirst: { borderTopWidth: 0, paddingTop: 2 },
  vocabTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vocabKo: { fontSize: 18, fontWeight: '700', color: '#2C221E' },
  badgeBatchim: { fontSize: 12, fontWeight: '500', color: '#8C7A6B' },
  vocabVi: { fontSize: 14, color: '#4A3B32' },
  hanjaNote: { fontSize: 12.5, color: '#3E7B52', fontWeight: '600' },
  stepLabel: { fontSize: 13, fontWeight: '600', color: '#8C7A6B', marginBottom: 10 },
  storyContainer: { gap: 14 },
  storyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 10,
  },
  storyTitle: { fontSize: 17, fontWeight: '700', color: '#2C221E' },
  storyLine: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3EEE6',
    gap: 2,
  },
  speakerTag: { fontSize: 12, fontWeight: '700', color: '#3E7B52' },
  storyKo: { fontSize: 16.5, fontWeight: '600', color: '#2C221E' },
  storyVi: { fontSize: 14, color: '#5C4D42' },
  doneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 26,
    alignItems: 'center',
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 16,
  },
  doneTitle: { fontSize: 22, fontWeight: '700', color: '#2C221E' },
  summaryRow: { flexDirection: 'row', gap: 12, width: '100%' },
  summaryBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#EAE2D6',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  summaryVal: { fontSize: 20, fontWeight: '700', color: '#2C221E' },
  summaryLbl: { fontSize: 13, color: '#6B584B' },
});
