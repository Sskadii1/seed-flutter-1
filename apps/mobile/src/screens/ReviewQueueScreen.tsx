import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  buildAdaptiveAiSession,
  getAllExercises,
  MS_PER_DAY,
  nextInterval,
  retrievability,
} from '@seed/learning-engine';
import { getEffectiveNow, type SeedLearningState } from '../store/learningStore';
import { GeometricBadge, TactileButton } from '../components/SeedArt';
import type { ActiveLessonSession } from './LessonPlayerModal';

interface ReviewQueueScreenProps {
  state: SeedLearningState;
  onStartSession: (session: ActiveLessonSession) => void;
}

export function ReviewQueueScreen({ state, onStartSession }: ReviewQueueScreenProps) {
  const now = getEffectiveNow(state);
  const cards = Object.values(state.cards)
    .map((card) => {
      const elapsedDays = Math.max(0, (now - card.lastReviewAt) / MS_PER_DAY);
      const r = retrievability(elapsedDays, card.stability);
      return { card, elapsedDays, r, nextDays: nextInterval(card.stability, 0.9) };
    })
    .sort((a, b) => a.r - b.r);

  const dueCards = cards.filter((c) => c.r < 0.9 || c.card.dueAt <= now);

  const startHvptContrastDrill = () => {
    const all = getAllExercises();
    const drills = all.filter(
      (ex) =>
        ex.type === 'hvpt_minimal_pair' ||
        ex.type === 'particle_contrast' ||
        ex.type === 'context_cloze'
    );
    onStartSession({
      id: 'interleaved-drill',
      title: 'Luyện đối chiếu',
      subtitle: 'Phân biệt âm và trợ từ dễ nhầm',
      explicitRules: [],
      vocabPreview: [],
      exercises: drills,
    });
  };

  const startDueReview = () => {
    const all = getAllExercises();
    const dueIds = new Set(dueCards.map((d) => d.card.itemId));
    const matched = all.filter((ex) =>
      ex.targetVocabIds?.some((id) => dueIds.has(id))
    );
    const exercises =
      matched.length > 0
        ? matched
        : buildAdaptiveAiSession(Object.values(state.cards), state.aiProfile, now, 5);
    onStartSession({
      id: 'fsrs-due-review',
      title: 'Ôn tập đến hạn',
      subtitle: 'Các từ sắp đến lúc quên',
      explicitRules: [],
      vocabPreview: [],
      exercises,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.banner}>
        <View style={styles.bannerTop}>
          <GeometricBadge name="brain" size={34} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>Ôn tập</Text>
            <Text style={styles.subtitle}>
              {dueCards.length > 0
                ? `${dueCards.length} từ đến hạn ôn hôm nay`
                : 'Chọn một chế độ luyện tập bên dưới'}
            </Text>
          </View>
        </View>
        <View style={styles.btnRow}>
          <TactileButton
            label={dueCards.length > 0 ? `Ôn ${dueCards.length} từ` : 'Ôn nhanh (5 câu)'}
            variant="caramel"
            onPress={startDueReview}
          />
          <TactileButton
            label="Luyện nghe & Trợ từ"
            variant="sand"
            onPress={startHvptContrastDrill}
          />
        </View>
      </View>

      {cards.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Chưa có từ nào được lưu</Text>
          <Text style={styles.emptyBody}>
            Hoàn thành bài đầu tiên để hệ thống bắt đầu lên lịch ôn.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {cards.map(({ card, r, nextDays }) => {
            const pct = Math.round(r * 100);
            const isDue = r < 0.9 || card.dueAt <= now;
            return (
              <View key={card.itemId} style={styles.cardRow}>
                <View style={styles.stagePill}>
                  <Text style={styles.stagePillText}>Nấc {card.stage}</Text>
                </View>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardWord}>{card.label}</Text>
                  <Text style={styles.cardMeaning}>{card.meaningVi}</Text>
                </View>
                <Text style={styles.nextText}>+{nextDays}d</Text>
                <View style={[styles.rBadge, isDue ? styles.rDue : styles.rSafe]}>
                  <Text style={[styles.rText, isDue ? styles.rTextDue : styles.rTextSafe]}>
                    {pct}%
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, maxWidth: 960, width: '100%', alignSelf: 'center' },
  banner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 16,
  },
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 21, fontWeight: '700', color: '#2C221E' },
  subtitle: { fontSize: 14, color: '#6B584B' },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#2C221E' },
  emptyBody: { fontSize: 14, color: '#6B584B', textAlign: 'center' },
  list: { gap: 10 },
  cardRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stagePill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stagePillText: { fontSize: 12.5, fontWeight: '600', color: '#6A4E35' },
  cardLeft: { flex: 1, gap: 2 },
  cardWord: { fontSize: 16.5, fontWeight: '700', color: '#2C221E' },
  cardMeaning: { fontSize: 13.5, color: '#5C4D42' },
  nextText: { fontSize: 13, color: '#8C7A6B', fontWeight: '500' },
  rBadge: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  rDue: { backgroundColor: '#FEF2F2' },
  rSafe: { backgroundColor: '#EEF6F0' },
  rText: { fontSize: 13, fontWeight: '700' },
  rTextDue: { color: '#B91C1C' },
  rTextSafe: { color: '#2D5D3D' },
});
