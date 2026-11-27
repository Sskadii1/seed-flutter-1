import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { computeRetentionTruth } from '@seed/learning-engine';
import { SUPABASE_MIGRATION_SQL } from '../lib/supabase';
import { getEffectiveNow, type SeedLearningState } from '../store/learningStore';
import { GeometricBadge, TactileButton } from '../components/SeedArt';

interface RetentionDashboardScreenProps {
  state: SeedLearningState;
  onRunDemo30Days: () => void;
  onResetState: () => void;
}

export function RetentionDashboardScreen({
  state,
  onRunDemo30Days,
  onResetState,
}: RetentionDashboardScreenProps) {
  const { width } = useWindowDimensions();
  const isPhone = width < 640;
  const [showSql, setShowSql] = useState(false);
  const now = getEffectiveNow(state);
  const cards = Object.values(state.cards);
  const firstTryFlags = state.attempts.map((a) => (a.wrongAttempts === 0 ? 1 : 0));
  const metrics = computeRetentionTruth(cards, firstTryFlags, now);

  const retentionPct = Math.round(metrics.averageRetrievability * 100);
  const accuracyPct = Math.round(metrics.firstTryAccuracy * 100);

  return (
    <ScrollView contentContainerStyle={[styles.container, isPhone && styles.containerPhone]}>
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <GeometricBadge name="chart" size={34} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Thống kê trí nhớ</Text>
            <Text style={styles.subtitle}>Theo dõi mức nhớ thực tế theo thời gian.</Text>
          </View>
        </View>
        <View style={styles.demoRow}>
          <TactileButton
            label="Mô phỏng 30 ngày"
            variant="caramel"
            onPress={onRunDemo30Days}
          />
          <TactileButton
            label="Đặt lại"
            variant="outline"
            onPress={onResetState}
          />
        </View>
      </View>

      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>
            {metrics.totalTrackedCards > 0 ? `${retentionPct}%` : '—'}
          </Text>
          <Text style={styles.kpiLabel}>Độ nhớ hiện tại</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{metrics.masteredCount}</Text>
          <Text style={styles.kpiLabel}>Thuộc thật</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{state.totalXp}</Text>
          <Text style={styles.kpiLabel}>Điểm nhớ (XP)</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>
            {state.attempts.length > 0 ? `${accuracyPct}%` : '—'}
          </Text>
          <Text style={styles.kpiLabel}>Đúng lần đầu</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.sqlHeader}>
          <Text style={styles.panelTitle}>Chẩn đoán AI (BKT & Elo-IRT)</Text>
          <Text style={styles.eloBadge}>Elo {Math.round(state.aiProfile.eloRating)}</Text>
        </View>
        <Text style={styles.aiNote}>{state.aiProfile.lastRecommendationVi}</Text>
        {Object.values(state.aiProfile.skills).map((sk) => {
          const pct = Math.round(sk.pKnown * 100);
          return (
            <View key={sk.kcId} style={styles.stageRow}>
              <View style={styles.stageTop}>
                <Text style={styles.stageLabel}>{sk.labelVi}</Text>
                <Text style={styles.stageCount}>{pct}%</Text>
              </View>
              <View style={[styles.barTrack, { backgroundColor: '#EEF6F0' }]}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${pct}%`, backgroundColor: pct >= 70 ? '#3E7B52' : '#B08968' },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Mức độ thành thạo</Text>
        {([1, 2, 3, 4] as const).map((stage) => {
          const count = metrics.stageDistribution[stage];
          const pct =
            metrics.totalTrackedCards > 0
              ? Math.round((count / metrics.totalTrackedCards) * 100)
              : 0;
          const meta: Record<number, { label: string; color: string; track: string }> = {
            1: { label: 'Nấc 1 · Nhận diện', color: '#D4A373', track: '#F7F3ED' },
            2: { label: 'Nấc 2 · Tự nhớ', color: '#B08968', track: '#F7F3ED' },
            3: { label: 'Nấc 3 · Ghép câu', color: '#6E9B7D', track: '#EEF6F0' },
            4: { label: 'Nấc 4 · Tự gõ', color: '#3E7B52', track: '#EEF6F0' },
          };
          return (
            <View key={stage} style={styles.stageRow}>
              <View style={styles.stageTop}>
                <Text style={styles.stageLabel}>{meta[stage].label}</Text>
                <Text style={styles.stageCount}>{count}</Text>
              </View>
              <View style={[styles.barTrack, { backgroundColor: meta[stage].track }]}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${pct}%`, backgroundColor: meta[stage].color },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.panel}>
        <View style={styles.sqlHeader}>
          <Text style={styles.panelTitle}>Đồng bộ Supabase</Text>
          <Pressable onPress={() => setShowSql((s) => !s)}>
            <Text style={styles.toggleLink}>{showSql ? 'Ẩn SQL' : 'Xem SQL'}</Text>
          </Pressable>
        </View>
        {showSql && (
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{SUPABASE_MIGRATION_SQL}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, maxWidth: 960, width: '100%', alignSelf: 'center' },
  containerPhone: { padding: 14, paddingBottom: 24, gap: 12 },
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 14,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 21, fontWeight: '700', color: '#2C221E' },
  subtitle: { fontSize: 14, color: '#6B584B' },
  demoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpiCard: {
    flexGrow: 1,
    flexBasis: 160,
    backgroundColor: '#FFFFFF',
    borderColor: '#EAE2D6',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 4,
  },
  kpiValue: { fontSize: 24, fontWeight: '700', color: '#2C221E' },
  kpiLabel: { fontSize: 13, color: '#5C4D42', fontWeight: '500' },
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 12,
  },
  panelTitle: { fontSize: 16, fontWeight: '700', color: '#2C221E' },
  stageRow: { gap: 5 },
  stageTop: { flexDirection: 'row', justifyContent: 'space-between' },
  stageLabel: { fontSize: 14, color: '#4A3B32', fontWeight: '500' },
  stageCount: { fontSize: 13.5, color: '#6B584B', fontWeight: '700' },
  barTrack: { height: 10, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  sqlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eloBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D5D3D',
    backgroundColor: '#EEF6F0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  aiNote: { fontSize: 13.5, color: '#5C4D42' },
  toggleLink: { fontSize: 13.5, fontWeight: '600', color: '#8D6B4C' },
  codeBox: { backgroundColor: '#2C221E', borderRadius: 12, padding: 14 },
  codeText: { color: '#FAF6F0', fontSize: 11.5, fontFamily: 'monospace' },
});
