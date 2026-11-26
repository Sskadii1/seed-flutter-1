import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Exercise, FsrsGrade } from '@seed/schema';
import { inferExerciseErrorCategory } from '@seed/learning-engine';
import { injectWebTypography } from './lib/typography';
import {
  applyExerciseOutcome,
  createInitialState,
  loadLearningState,
  markLessonCompleted,
  runDemo30DaySimulation,
  saveLearningState,
  type SeedLearningState,
} from './store/learningStore';
import { GeometricBadge, type BadgeName } from './components/SeedArt';
import { LearnMapScreen } from './screens/LearnMapScreen';
import { ReviewQueueScreen } from './screens/ReviewQueueScreen';
import { DictionaryScreen } from './screens/DictionaryScreen';
import { RetentionDashboardScreen } from './screens/RetentionDashboardScreen';
import { AiTutorScreen } from './screens/AiTutorScreen';
import { LessonPlayerModal, type ActiveLessonSession } from './screens/LessonPlayerModal';
import { buildMangaCoachingBubble } from './lib/aiTutor';

type TabKey = 'learn' | 'review' | 'dict' | 'stats' | 'chat';

const TABS: Array<{ key: TabKey; label: string; badge: BadgeName }> = [
  { key: 'learn', label: 'Lộ trình', badge: 'sprout' },
  { key: 'review', label: 'Ôn tập', badge: 'brain' },
  { key: 'dict', label: 'Từ điển', badge: 'book' },
  { key: 'stats', label: 'Thống kê', badge: 'chart' },
  { key: 'chat', label: 'Hỏi đáp AI', badge: 'chat' },
];

export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 820;
  const [activeTab, setActiveTab] = useState<TabKey>('learn');
  const [state, setState] = useState<SeedLearningState>(() => loadLearningState());
  const [activeSession, setActiveSession] = useState<ActiveLessonSession | null>(null);
  const [bubbleDismissed, setBubbleDismissed] = useState(false);
  const [focusCoachingSeq, setFocusCoachingSeq] = useState(0);

  const coaching = buildMangaCoachingBubble(state);

  useEffect(() => {
    injectWebTypography();
  }, []);

  const handleRecordExercise = (params: {
    exercise: Exercise;
    grade: FsrsGrade;
    wrongAttempts: number;
  }): number => {
    let earned = 0;
    setState((prev) => {
      const res = applyExerciseOutcome(prev, {
        exercise: params.exercise,
        grade: params.grade,
        wrongAttempts: params.wrongAttempts,
        category: inferExerciseErrorCategory(params.exercise),
      });
      earned = res.xpEarned;
      return res.nextState;
    });
    return earned;
  };

  const handleFinishLesson = (lessonId: string) => {
    setState((prev) => markLessonCompleted(prev, lessonId));
    setBubbleDismissed(false);
  };

  const handleRunDemo = () => {
    setState(runDemo30DaySimulation());
    setBubbleDismissed(false);
  };

  const handleReset = () => {
    const fresh = createInitialState();
    saveLearningState(fresh);
    setState(fresh);
    setBubbleDismissed(false);
  };

  const handleSelectTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === 'chat') {
      setBubbleDismissed(true);
    }
  };

  const openAiWithCoaching = () => {
    setBubbleDismissed(true);
    setActiveTab('chat');
    setFocusCoachingSeq((n) => n + 1);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <View style={[styles.shell, isWide && styles.shellWide]}>
          {isWide && (
            <View style={styles.sidebar}>
              <View style={styles.brandBlock}>
                <View style={styles.brandMark}>
                  <Text style={styles.brandMarkText}>S</Text>
                </View>
                <Text style={styles.brand}>SEED</Text>
              </View>

              <View style={styles.sideNav}>
                {TABS.map((t) => {
                  const active = activeTab === t.key;
                  return (
                    <View
                      key={t.key}
                      style={[
                        styles.sideItemGroup,
                        t.key === 'chat' && styles.sideItemGroupChat,
                      ]}
                    >
                      <Pressable
                        style={[styles.sideItem, active && styles.sideItemActive]}
                        onPress={() => handleSelectTab(t.key)}
                      >
                        <GeometricBadge name={t.badge} size={30} />
                        <Text style={[styles.sideText, active && styles.sideTextActive]}>
                          {t.label}
                        </Text>
                      </Pressable>

                      {t.key === 'chat' && activeTab !== 'chat' && !bubbleDismissed && (
                        <View nativeID="seed-manga-popup" style={styles.mangaBubbleWrap}>
                          <View style={styles.mangaBubbleTailTop} />
                          <View style={styles.mangaBubbleTopRow}>
                            <View style={styles.mangaBadge}>
                              <Text style={styles.mangaBadgeText}>NHẬN XÉT AI</Text>
                            </View>
                            <Pressable
                              style={styles.mangaDismissBtn}
                              onPress={() => setBubbleDismissed(true)}
                            >
                              <Text style={styles.mangaDismissText}>{'\u00D7'}</Text>
                            </Pressable>
                          </View>

                          <Pressable
                            nativeID="seed-manga-body"
                            style={styles.mangaBubbleBody}
                            onPress={openAiWithCoaching}
                          >
                            <Text style={styles.mangaHeadline}>{coaching.headlineVi}</Text>
                            <Text style={styles.mangaAdvice}>
                              Cần cải thiện: {coaching.actionSummaryVi}
                            </Text>
                            <Text style={styles.mangaCta}>Xem cách khắc phục -&gt;</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              <View style={styles.sideFooter}>
                <View style={styles.statChip}>
                  <GeometricBadge name="streak" size={22} />
                  <Text style={styles.statChipText}>{state.streakDays} ngày</Text>
                </View>
                <View style={styles.statChip}>
                  <GeometricBadge name="xp" size={22} />
                  <Text style={styles.statChipText}>{state.totalXp} XP</Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.content}>
            {!isWide && (
              <View style={styles.mobileHeader}>
                <View style={styles.mobileBrandRow}>
                  <View style={styles.brandMarkSmall}>
                    <Text style={styles.brandMarkTextSmall}>S</Text>
                  </View>
                  <Text style={styles.brandMobile}>SEED</Text>
                </View>
                <View style={styles.mobileStats}>
                  <View style={styles.mobilePill}>
                    <GeometricBadge name="streak" size={18} />
                    <Text style={styles.mobilePillText}>{state.streakDays}</Text>
                  </View>
                  <View style={styles.mobilePill}>
                    <GeometricBadge name="xp" size={18} />
                    <Text style={styles.mobilePillText}>{state.totalXp}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.screenArea}>
              {activeTab === 'learn' && (
                <LearnMapScreen state={state} onStartSession={setActiveSession} />
              )}
              {activeTab === 'review' && (
                <ReviewQueueScreen state={state} onStartSession={setActiveSession} />
              )}
              {activeTab === 'dict' && <DictionaryScreen />}
              {activeTab === 'stats' && (
                <RetentionDashboardScreen
                  state={state}
                  onRunDemo30Days={handleRunDemo}
                  onResetState={handleReset}
                />
              )}
              {activeTab === 'chat' && (
                <AiTutorScreen state={state} focusCoachingSeq={focusCoachingSeq} />
              )}
            </View>

            {!isWide && activeTab !== 'chat' && !bubbleDismissed && (
              <View style={styles.mobileMangaWrap}>
                <View nativeID="seed-manga-mobile" style={styles.mobileMangaBubble}>
                  <View style={styles.mangaBubbleTopRow}>
                    <View style={styles.mangaBadge}>
                      <Text style={styles.mangaBadgeText}>NHẬN XÉT AI</Text>
                    </View>
                    <Pressable
                      style={styles.mangaDismissBtn}
                      onPress={() => setBubbleDismissed(true)}
                    >
                      <Text style={styles.mangaDismissText}>{'\u00D7'}</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    nativeID="seed-manga-body"
                    style={styles.mangaBubbleBody}
                    onPress={openAiWithCoaching}
                  >
                    <Text style={styles.mangaHeadline} numberOfLines={2}>
                      {coaching.headlineVi}
                    </Text>
                    <Text style={styles.mangaAdvice} numberOfLines={2}>
                      Cần cải thiện: {coaching.actionSummaryVi}
                    </Text>
                    <Text style={styles.mangaCta}>Mở Hỏi đáp AI -&gt;</Text>
                  </Pressable>
                  <View style={styles.mangaBubbleTailBottom} />
                </View>
              </View>
            )}

            {!isWide && (
              <View style={styles.bottomBar}>
                {TABS.map((t) => {
                  const active = activeTab === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      style={styles.bottomTab}
                      onPress={() => handleSelectTab(t.key)}
                    >
                      <GeometricBadge name={t.badge} size={24} />
                      <Text
                        style={[styles.bottomText, active && styles.bottomTextActive]}
                        numberOfLines={1}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        <LessonPlayerModal
          session={activeSession}
          aiProfile={state.aiProfile}
          onClose={() => setActiveSession(null)}
          onRecordExercise={handleRecordExercise}
          onFinishLesson={handleFinishLesson}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  shell: { flex: 1 },
  shellWide: { flexDirection: 'row' },
  sidebar: {
    width: 236,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#EAE4DC',
    padding: 20,
    justifyContent: 'space-between',
    zIndex: 50,
    overflow: 'visible',
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 20,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3EEE6',
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#3E7B52',
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: '#2D5D3D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  brandMarkSmall: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#3E7B52',
    borderWidth: 1,
    borderBottomWidth: 2.5,
    borderColor: '#2D5D3D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkTextSmall: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  brand: { fontSize: 20, fontWeight: '700', color: '#2C221E', letterSpacing: 0.4 },
  sideNav: { gap: 6, flex: 1, overflow: 'visible', zIndex: 60 },
  sideItemGroup: {
    position: 'relative',
    overflow: 'visible',
  },
  sideItemGroupChat: {
    zIndex: 80,
  },
  sideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  sideItemActive: {
    backgroundColor: '#F2F7F3',
    borderColor: '#C5DFCD',
  },
  sideText: { fontSize: 14.5, fontWeight: '600', color: '#6B584B' },
  sideTextActive: { color: '#244A32', fontWeight: '700' },
  sideFooter: {
    flexDirection: 'row',
    gap: 8,
  },
  statChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE2D6',
    borderRadius: 12,
    padding: 8,
  },
  statChipText: { fontSize: 12.5, fontWeight: '600', color: '#2C221E' },
  content: { flex: 1, backgroundColor: '#FFFFFF', zIndex: 1 },
  mobileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EAE4DC',
  },
  mobileBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMobile: { fontSize: 17, fontWeight: '700', color: '#2C221E' },
  mobileStats: { flexDirection: 'row', gap: 8 },
  mobilePill: {
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
  mobilePillText: { fontSize: 12.5, fontWeight: '600', color: '#2C221E' },
  screenArea: { flex: 1, backgroundColor: '#FFFFFF' },
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EAE4DC',
    paddingVertical: 8,
  },
  bottomTab: { flex: 1, alignItems: 'center', gap: 3 },
  bottomText: { fontSize: 10.5, fontWeight: '600', color: '#8C7A6B' },
  bottomTextActive: { color: '#2D5D3D', fontWeight: '700' },
  mangaBubbleWrap: {
    position: 'absolute',
    top: 46,
    left: 0,
    width: 340,
    zIndex: 100,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    borderBottomWidth: 4.5,
    borderRightWidth: 3.5,
    borderColor: '#2C221E',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    shadowColor: '#2C221E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  mangaBubbleTailTop: {
    position: 'absolute',
    top: -7,
    left: 21,
    width: 12,
    height: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: '#2C221E',
    transform: [{ rotate: '45deg' }],
  },
  mangaBubbleTailBottom: {
    position: 'absolute',
    bottom: -7,
    right: 22,
    width: 12,
    height: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderColor: '#2C221E',
    transform: [{ rotate: '45deg' }],
  },
  mangaBubbleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  mangaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
    backgroundColor: '#F2F7F3',
    borderWidth: 1,
    borderColor: '#3E7B52',
  },
  mangaBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2D5D3D',
  },
  mangaDismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mangaDismissText: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '700',
    color: '#57463D',
  },
  mangaBubbleBody: {
    gap: 5,
    flexShrink: 1,
  },
  mangaHeadline: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#2C221E',
    lineHeight: 19,
    flexShrink: 1,
  },
  mangaAdvice: {
    fontSize: 12.5,
    color: '#57463D',
    lineHeight: 18,
    flexShrink: 1,
  },
  mangaCta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3E7B52',
    marginTop: 2,
  },
  mobileMangaWrap: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 4,
    backgroundColor: '#FFFFFF',
  },
  mobileMangaBubble: {
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderRightWidth: 3,
    borderColor: '#2C221E',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
});
