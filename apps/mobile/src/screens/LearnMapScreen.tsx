import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { roadmapData, unit0Data, unit1Data } from '@seed/schema';
import { buildAdaptiveAiSession, computeRetentionTruth } from '@seed/learning-engine';
import { getEffectiveNow, type SeedLearningState } from '../store/learningStore';
import { GeometricBadge, TactileButton } from '../components/SeedArt';
import {
  buildRuleListFromGrammar,
  buildRuleListFromUnit0,
  type ActiveLessonSession,
} from './LessonPlayerModal';

interface LearnMapScreenProps {
  state: SeedLearningState;
  onStartSession: (session: ActiveLessonSession) => void;
}

const UNIT0_PREVIEWS: Record<number, string[]> = {
  1: ['아', '어', '오'],
  2: ['나무', '바다', '우유'],
  3: ['달', '딸', '탈'],
  4: ['의사', '과일', 'ㅐ/ㅔ'],
  5: ['문', '물', '꽃'],
  6: ['한국어', '[한구거]'],
};

const UNIT1_PREVIEWS: Record<number, string[]> = {
  1: ['안녕하세요', '학생'],
  2: ['베트남', '한국'],
  3: ['이름', '네 / 아니요'],
  4: ['Hội thoại', 'Truyện ngắn'],
};

export function LearnMapScreen({ state, onStartSession }: LearnMapScreenProps) {
  const { width } = useWindowDimensions();
  const isPhone = width < 640;
  const isTwoColLessons = width >= 640;
  const showCompanionRail = width >= 1080;

  const now = getEffectiveNow(state);
  const cards = Object.values(state.cards);
  const metrics = computeRetentionTruth(cards, [], now);

  const startSmartSession = () => {
    const queue = buildAdaptiveAiSession(cards, state.aiProfile, now, 8);
    onStartSession({
      id: 'smart-daily',
      title: 'Phiên học thích ứng AI',
      subtitle: 'Tối ưu theo BKT + Elo-IRT (vùng 85%) + FSRS-4.5',
      explicitRules: [],
      vocabPreview: [],
      exercises: queue,
    });
  };

  const openUnit0Lesson = (lessonOrder: number) => {
    const lesson = unit0Data.lessons.find((l) => l.order === lessonOrder);
    if (!lesson) return;
    onStartSession({
      id: lesson.lessonId,
      title: `Unit 0 • ${lesson.title}`,
      subtitle: lesson.description,
      explicitRules: buildRuleListFromUnit0(lesson.explicitRule),
      vocabPreview: [],
      exercises: lesson.exercises,
    });
  };

  const openUnit1Lesson = (lessonOrder: number) => {
    const lesson = unit1Data.lessons.find((l) => l.order === lessonOrder);
    if (!lesson) return;
    const vocabPreview = unit1Data.vocabulary.filter((v) =>
      lesson.targetVocabIds.includes(v.id)
    );
    const grammarPoints = unit1Data.grammarPoints.filter((g) =>
      lesson.targetGrammarIds.includes(g.id)
    );
    onStartSession({
      id: lesson.lessonId,
      title: `Unit 1 • ${lesson.title}`,
      subtitle: unit1Data.communicativeGoal,
      explicitRules: buildRuleListFromGrammar(grammarPoints),
      vocabPreview,
      dialogue: lesson.dialogue,
      microStory: lesson.gradedMicroStory,
      exercises: lesson.exercises,
    });
  };

  const retentionPct =
    metrics.totalTrackedCards > 0
      ? Math.round(metrics.averageRetrievability * 100)
      : 0;

  const stage3PlusCount = metrics.stageDistribution[3] + metrics.stageDistribution[4];

  const quests = [
    {
      title: '1 bài học',
      current: Math.min(1, state.completedLessonIds.length),
      target: 1,
    },
    {
      title: '50 XP',
      current: Math.min(50, state.totalXp),
      target: 50,
    },
    {
      title: '3 từ chủ động',
      current: Math.min(3, stage3PlusCount),
      target: 3,
    },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FFFFFF' }}
      contentContainerStyle={[styles.outer, isPhone && styles.outerPhone]}
    >
      <View style={[styles.workspace, showCompanionRail && styles.workspaceWide]}>
        <View style={styles.mainCol}>
          {/* Minimalist Hero Card */}
          <View style={[styles.heroCard, isPhone && styles.heroCardPhone]}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.heroTitle, isPhone && styles.heroTitlePhone]}>
                  Tiếng Hàn Sơ Cấp 1
                </Text>
                <Text style={styles.heroSub}>
                  Ôn tập thông minh và luyện gõ chủ động.
                </Text>
              </View>
              <TactileButton
                label="Bắt đầu học"
                variant="caramel"
                onPress={startSmartSession}
              />
            </View>

            <View style={styles.metricStrip}>
              <View style={styles.metricItem}>
                <Text style={styles.metricVal}>
                  {metrics.totalTrackedCards > 0 ? `${retentionPct}%` : '—'}
                </Text>
                <Text style={styles.metricLbl}>Độ nhớ</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricVal}>{Math.round(state.aiProfile.eloRating)}</Text>
                <Text style={styles.metricLbl}>Elo năng lực</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricVal}>{metrics.dueCount}</Text>
                <Text style={styles.metricLbl}>Cần ôn</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricVal}>{metrics.masteredCount}</Text>
                <Text style={styles.metricLbl}>Đã thuộc</Text>
              </View>
            </View>
          </View>

          {/* Unit 0 */}
          <View style={styles.unitSection}>
            <View style={[styles.unitBanner, styles.bannerCaramel]}>
              <View style={styles.bannerLeft}>
                <Text style={styles.bannerTag}>Unit 0</Text>
                <Text style={styles.bannerTitle}>Hangul & Phát âm</Text>
              </View>
              <Text style={styles.bannerCount}>6 bài</Text>
            </View>

            <View style={styles.lessonGrid}>
              {unit0Data.lessons.map((lesson) => {
                const done = state.completedLessonIds.includes(lesson.lessonId);
                const chips = UNIT0_PREVIEWS[lesson.order] ?? [];
                return (
                  <Pressable
                    key={lesson.lessonId}
                    style={({ pressed }) => [
                      styles.lessonCard,
                      isTwoColLessons && styles.lessonCardHalf,
                      done && styles.lessonCardDone,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => openUnit0Lesson(lesson.order)}
                  >
                    <View style={styles.lessonTop}>
                      <View style={[styles.numSquircle, done ? styles.squircleEspresso : styles.squircleCaramel]}>
                        <Text style={styles.numText}>0{lesson.order}</Text>
                      </View>
                      {done && <GeometricBadge name="check" size={22} />}
                    </View>
                    <Text style={styles.lessonTitle}>{lesson.title}</Text>
                    <View style={styles.previewRow}>
                      {chips.map((c) => (
                        <View key={c} style={styles.koChip}>
                          <Text style={styles.koChipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Unit 1 */}
          <View style={styles.unitSection}>
            <View style={[styles.unitBanner, styles.bannerLatte]}>
              <View style={styles.bannerLeft}>
                <Text style={styles.bannerTag}>Unit 1</Text>
                <Text style={styles.bannerTitle}>{unit1Data.title}</Text>
              </View>
              <Text style={styles.bannerCount}>4 bài</Text>
            </View>

            <View style={styles.lessonGrid}>
              {unit1Data.lessons.map((lesson) => {
                const done = state.completedLessonIds.includes(lesson.lessonId);
                const chips = UNIT1_PREVIEWS[lesson.order] ?? [];
                return (
                  <Pressable
                    key={lesson.lessonId}
                    style={({ pressed }) => [
                      styles.lessonCard,
                      isTwoColLessons && styles.lessonCardHalf,
                      done && styles.lessonCardDone,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => openUnit1Lesson(lesson.order)}
                  >
                    <View style={styles.lessonTop}>
                      <View style={[styles.numSquircle, done ? styles.squircleEspresso : styles.squircleSand]}>
                        <Text style={styles.numText}>0{lesson.order}</Text>
                      </View>
                      {done && <GeometricBadge name="check" size={22} />}
                    </View>
                    <Text style={styles.lessonTitle}>{lesson.title}</Text>
                    <View style={styles.previewRow}>
                      {chips.map((c) => (
                        <View key={c} style={styles.koChip}>
                          <Text style={styles.koChipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Upcoming Units 2..12 */}
          <View style={styles.unitSection}>
            <Text style={styles.roadmapHeading}>Các học phần tiếp theo</Text>
            <View style={styles.lessonGrid}>
              {roadmapData.units
                .filter((u) => u.unitNumber >= 2)
                .map((u) => (
                  <View
                    key={u.id}
                    style={[
                      styles.futureCard,
                      isTwoColLessons && styles.lessonCardHalf,
                    ]}
                  >
                    <View style={styles.futureTop}>
                      <Text style={styles.futureBadge}>Unit {u.unitNumber}</Text>
                      <Text style={styles.futureCount}>
                        {u.lessonsCount} bài • {u.vocabTarget} từ
                      </Text>
                    </View>
                    <Text style={styles.futureTitle}>{u.title}</Text>
                  </View>
                ))}
            </View>
          </View>
        </View>

        {/* Airy Right Companion Rail */}
        {showCompanionRail && (
          <View style={styles.railCol}>
            <View style={styles.railCard}>
              <View style={styles.railHeader}>
                <GeometricBadge name="brain" size={28} />
                <Text style={styles.railTitle}>Trí nhớ</Text>
              </View>
              <Text style={styles.gaugeVal}>
                {metrics.totalTrackedCards > 0 ? `${retentionPct}%` : '—'}
              </Text>
              <View style={styles.chunkyTrack}>
                <View
                  style={[
                    styles.chunkyFill,
                    { width: `${Math.max(8, retentionPct)}%` },
                  ]}
                />
              </View>
              <Text style={styles.gaugeSub}>
                {metrics.totalTrackedCards > 0
                  ? `${metrics.totalTrackedCards} từ đang theo dõi`
                  : 'Chưa có từ nào'}
              </Text>
            </View>

            <View style={styles.railCard}>
              <View style={styles.railHeader}>
                <GeometricBadge name="star" size={28} />
                <Text style={styles.railTitle}>Hôm nay</Text>
              </View>
              <View style={{ gap: 12 }}>
                {quests.map((q) => {
                  const pct = Math.round((q.current / q.target) * 100);
                  return (
                    <View key={q.title} style={{ gap: 5 }}>
                      <View style={styles.questTop}>
                        <Text style={styles.questTitle}>{q.title}</Text>
                        <Text style={styles.questPct}>
                          {q.current}/{q.target}
                        </Text>
                      </View>
                      <View style={styles.questTrack}>
                        <View style={[styles.questFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={[styles.railCard, styles.hanjaRailCard]}>
              <Text style={styles.hanjaMain}>학 • Học</Text>
              <View style={styles.hanjaFamily}>
                <Text style={styles.hanjaPill}>학생 · học sinh</Text>
                <Text style={styles.hanjaPill}>학교 · trường</Text>
                <Text style={styles.hanjaPill}>대학 · đại học</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: { padding: 24, alignItems: 'center' },
  outerPhone: { padding: 14, paddingBottom: 24 },
  workspace: { width: '100%', maxWidth: 1120, gap: 24 },
  workspaceWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mainCol: { flex: 1, gap: 28, minWidth: 0 },
  railCol: { width: 280, gap: 16 },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 18,
  },
  heroCardPhone: {
    padding: 16,
    gap: 14,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 14,
  },
  heroTitle: { fontSize: 24, fontWeight: '700', color: '#2C221E' },
  heroTitlePhone: { fontSize: 20 },
  heroSub: { fontSize: 14.5, color: '#6B584B' },
  metricStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#EAE2D6',
  },
  metricItem: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: { width: 1, height: 26, backgroundColor: '#DFD2C0' },
  metricVal: { fontSize: 18, fontWeight: '700', color: '#2C221E' },
  metricLbl: { fontSize: 12.5, color: '#8C7A6B', fontWeight: '500' },
  unitSection: { gap: 14 },
  unitBanner: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  bannerCaramel: { backgroundColor: '#3E7B52', borderColor: '#2D5D3D' },
  bannerLatte: { backgroundColor: '#B08968', borderColor: '#8D6B4C' },
  bannerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  bannerTag: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bannerTitle: { fontSize: 18.5, fontWeight: '700', color: '#FFFFFF' },
  bannerCount: { fontSize: 13.5, fontWeight: '600', color: '#F7F3ED' },
  lessonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  lessonCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 10,
  },
  lessonCardHalf: { width: '48.8%' },
  lessonCardDone: {
    borderColor: '#C5DFCD',
    backgroundColor: '#F2F7F3',
  },
  cardPressed: {
    borderBottomWidth: 1.5,
    transform: [{ translateY: 1.5 }],
  },
  lessonTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  numSquircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderBottomWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squircleCaramel: { backgroundColor: '#3E7B52', borderColor: '#2D5D3D' },
  squircleSand: { backgroundColor: '#B08968', borderColor: '#8D6B4C' },
  squircleEspresso: { backgroundColor: '#2D5D3D', borderColor: '#1E422A' },
  numText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },
  lessonTitle: { fontSize: 16, fontWeight: '600', color: '#2C221E', lineHeight: 22 },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  koChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE2D6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  koChipText: { fontSize: 13, fontWeight: '600', color: '#5C4D42' },
  roadmapHeading: { fontSize: 17, fontWeight: '700', color: '#2C221E' },
  futureCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    gap: 6,
  },
  futureTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  futureBadge: { fontSize: 12.5, fontWeight: '700', color: '#3E7B52' },
  futureCount: { fontSize: 12.5, color: '#8C7A6B' },
  futureTitle: { fontSize: 15, fontWeight: '600', color: '#2C221E' },
  railCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 12,
  },
  railHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  railTitle: { fontSize: 15.5, fontWeight: '700', color: '#2C221E' },
  gaugeVal: { fontSize: 26, fontWeight: '700', color: '#3E7B52' },
  gaugeSub: { fontSize: 13, color: '#8C7A6B' },
  chunkyTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#EEF6F0',
    overflow: 'hidden',
  },
  chunkyFill: {
    height: '100%',
    backgroundColor: '#3E7B52',
    borderRadius: 999,
  },
  questTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  questTitle: { flex: 1, fontSize: 13.5, fontWeight: '500', color: '#4A3B32' },
  questPct: { fontSize: 13, fontWeight: '600', color: '#8D6B4C' },
  questTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  questFill: {
    height: '100%',
    backgroundColor: '#D97706',
    borderRadius: 999,
  },
  hanjaRailCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EAE2D6',
  },
  hanjaMain: { fontSize: 17, fontWeight: '700', color: '#4A3B32' },
  hanjaFamily: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hanjaPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DFD2C0',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: '500',
    color: '#5C4D42',
  },
});
