import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { HangulKeyboard } from '../components/HangulKeyboard';
import { GeometricBadge, TactileButton } from '../components/SeedArt';
import {
  AiApiConfig,
  AiProvider,
  ChatMessage,
  askAiTutor,
  buildMangaCoachingBubble,
  loadAiApiConfig,
  resolveProvider,
  saveAiApiConfig,
} from '../lib/aiTutor';
import { speakKorean } from '../lib/speech';
import { SeedLearningState } from '../store/learningStore';

interface AiTutorScreenProps {
  state: SeedLearningState;
  focusCoachingSeq?: number;
}

const QUICK_PROMPTS = [
  'Phân tích điểm yếu của tôi',
  'Sửa câu: 저은 학생예요',
  'Phân biệt 은/는 và 이/가',
  'Quy tắc 3 bậc phụ âm tắc',
  'Kiểm tra patchim của 한국',
  'Luyện tự giới thiệu bản thân',
];

function createWelcomeMessage(state: SeedLearningState): ChatMessage {
  const skills = Object.values(state.aiProfile.skills).sort((a, b) => a.pKnown - b.pKnown);
  const focus = skills[0];
  return {
    id: `welcome_${Date.now()}`,
    role: 'assistant',
    source: 'local',
    timestamp: Date.now(),
    text: [
      `Xin chào. Mình là gia sư SEED AI, đồng bộ trực tiếp với hồ sơ học tập của bạn (Elo ${Math.round(state.aiProfile.eloRating)}, trọng tâm hiện tại: ${focus ? focus.labelVi : 'Hangul'}).`,
      'Bạn có thể hỏi ngữ pháp, sửa câu tiếng Hàn, kiểm tra patchim, tra cứu Hán-Việt hoặc xin đánh giá năng lực BKT.',
    ].join('\n'),
    koreanSample: '안녕하세요. 무엇을 도와드릴까요?',
  };
}

function getSourceLabel(source?: 'deepseek' | 'openai' | 'gemini' | 'local'): string {
  if (source === 'deepseek') return 'SEED AI · DeepSeek';
  if (source === 'openai') return 'SEED AI · OpenAI';
  if (source === 'gemini') return 'SEED AI · Gemini';
  return 'SEED AI · Nội bộ';
}

export function AiTutorScreen({ state, focusCoachingSeq = 0 }: AiTutorScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage(state)]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [apiConfig, setApiConfig] = useState<AiApiConfig>(() => loadAiApiConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [draftProvider, setDraftProvider] = useState<AiProvider>(() => apiConfig.provider);
  const [draftKey, setDraftKey] = useState(() => apiConfig.apiKey);
  const [draftModel, setDraftModel] = useState(() => apiConfig.model ?? '');
  const [settingsSavedNote, setSettingsSavedNote] = useState<string | null>(null);

  const [showKeyboard, setShowKeyboard] = useState(false);
  const [jamoTokens, setJamoTokens] = useState<string[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [serverProvider, setServerProvider] = useState<string | null>(null);
  const keyboardPrefixRef = useRef('');
  const scrollRef = useRef<ScrollView | null>(null);
  const lastCompletionSeqRef = useRef<number>(state.lessonCompletionSeq ?? 0);

  const coaching = buildMangaCoachingBubble(state);

  useEffect(() => {
    const gFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    if (typeof gFetch !== 'function') return;
    gFetch('/api/wonder/health')
      .then(async (r) => {
        const ct = r.headers?.get?.('content-type') || '';
        if (!r.ok || !ct.includes('application/json')) return;
        const d = (await r.json()) as {
          tutorReady?: boolean;
          providers?: { deepseek?: boolean; gemini?: boolean; openai?: boolean };
        };
        if (d?.tutorReady) {
          if (d.providers?.deepseek) setServerProvider('DeepSeek Server');
          else if (d.providers?.gemini) setServerProvider('Gemini Server');
          else if (d.providers?.openai) setServerProvider('OpenAI Server');
        }
      })
      .catch(() => {
        // Offline / static host without backend
      });
  }, []);

  const activeProvider = resolveProvider(apiConfig);
  const modePillLabel =
    activeProvider === 'deepseek'
      ? 'DeepSeek đang bật'
      : activeProvider === 'openai'
      ? 'OpenAI đang bật'
      : activeProvider === 'gemini'
      ? 'Gemini đang bật'
      : serverProvider ?? 'Chế độ nội bộ';

  const scrollToEndSoon = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
  };

  useEffect(() => {
    const seq = state.lessonCompletionSeq ?? 0;
    if (seq > lastCompletionSeqRef.current) {
      lastCompletionSeqRef.current = seq;
      setBannerDismissed(false);
      const latest = buildMangaCoachingBubble(state);
      const summaryMsg: ChatMessage = {
        id: `coach_${seq}_${Date.now()}`,
        role: 'assistant',
        source: 'local',
        timestamp: Date.now(),
        koreanSample: latest.koreanSample,
        text: [
          `Nhận xét sau bài học vừa hoàn thành: ${latest.headlineVi}`,
          `Điểm bạn cần cải thiện: ${latest.actionSummaryVi}`,
          ...latest.bulletPointsVi.map((b) => `- ${b}`),
        ].join('\n'),
      };
      setMessages((prev) => [...prev, summaryMsg]);
      scrollToEndSoon();
    }
  }, [state.lessonCompletionSeq, state]);

  useEffect(() => {
    if (focusCoachingSeq > 0) {
      setBannerDismissed(false);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [focusCoachingSeq]);

  const handleSend = async (overrideText?: string) => {
    const query = (overrideText ?? input).trim();
    if (!query || sending) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: Date.now(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!overrideText) {
      setInput('');
      setJamoTokens([]);
      keyboardPrefixRef.current = '';
    }
    setSending(true);
    scrollToEndSoon();

    try {
      const reply = await askAiTutor({
        query,
        history: messages,
        state,
        apiConfig,
      });

      const assistantMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        text: reply.text,
        koreanSample: reply.koreanSample,
        source: reply.source,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setSending(false);
      scrollToEndSoon();
    }
  };

  const handleResetChat = () => {
    setMessages([createWelcomeMessage(state)]);
    setJamoTokens([]);
    keyboardPrefixRef.current = '';
  };

  const handleSaveApiSettings = () => {
    const next: AiApiConfig = {
      provider: draftProvider,
      apiKey: draftKey.trim(),
      model: draftModel.trim(),
    };
    saveAiApiConfig(next);
    setApiConfig(next);
    const resolved = resolveProvider(next);
    setSettingsSavedNote(
      resolved
        ? `Đã lưu khóa ${resolved.toUpperCase()} tại trình duyệt.`
        : 'Đã chuyển về chế độ Gia sư nội bộ.'
    );
  };

  const handleClearApiKey = () => {
    const next: AiApiConfig = { provider: 'auto', apiKey: '', model: '' };
    saveAiApiConfig(next);
    setApiConfig(next);
    setDraftProvider('auto');
    setDraftKey('');
    setDraftModel('');
    setSettingsSavedNote('Đã xóa API key, dùng chế độ nội bộ.');
  };

  const handleManualTextChange = (text: string) => {
    setInput(text);
    setJamoTokens([]);
    keyboardPrefixRef.current = text;
  };

  const handleHangulChange = (nextTokens: string[], composedText: string) => {
    if (jamoTokens.length === 0 && nextTokens.length > 0) {
      const trimmedEnd = input.endsWith(' ') || input.length === 0 ? input : `${input} `;
      keyboardPrefixRef.current = trimmedEnd;
    }
    setJamoTokens(nextTokens);
    setInput(`${keyboardPrefixRef.current}${composedText}`);
  };

  return (
    <View style={styles.root}>
      {/* Minimalist Top Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <GeometricBadge name="chat" size={34} />
          <View style={styles.headerTitles}>
            <Text style={styles.title}>Hỏi đáp AI</Text>
            <Text style={styles.subtitle}>
              Gia sư tiếng Hàn cá nhân hóa theo BKT & Elo
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <View
            style={[
              styles.statusPill,
              activeProvider || serverProvider ? styles.statusPillLive : styles.statusPillLocal,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                activeProvider || serverProvider ? styles.statusDotLive : styles.statusDotLocal,
              ]}
            />
            <Text style={styles.statusPillText}>{modePillLabel}</Text>
          </View>

          <View style={styles.eloPill}>
            <Text style={styles.eloPillText}>Elo {Math.round(state.aiProfile.eloRating)}</Text>
          </View>

          <Pressable
            style={[styles.ghostBtn, showSettings && styles.ghostBtnActive]}
            onPress={() => {
              setShowSettings((v) => !v);
              setSettingsSavedNote(null);
            }}
          >
            <Text style={styles.ghostBtnText}>Cài đặt API</Text>
          </Pressable>

          <Pressable style={styles.ghostBtn} onPress={handleResetChat}>
            <Text style={styles.ghostBtnText}>Làm mới</Text>
          </Pressable>
        </View>
      </View>

      {/* Collapsible API Configuration Panel */}
      {showSettings && (
        <View style={styles.settingsCard}>
          <View style={styles.settingsHeaderRow}>
            <Text style={styles.settingsTitle}>Kết nối AI trực tuyến (tùy chọn)</Text>
            <Text style={styles.settingsHint}>
              Key chỉ lưu cục bộ trên trình duyệt của bạn, không gửi về máy chủ khác.
            </Text>
          </View>

          <View style={styles.providerRow}>
            {(
              [
                { key: 'auto', label: 'Tự động' },
                { key: 'deepseek', label: 'DeepSeek' },
                { key: 'openai', label: 'OpenAI' },
                { key: 'gemini', label: 'Gemini' },
              ] as Array<{ key: AiProvider; label: string }>
            ).map((opt) => {
              const selected = draftProvider === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[styles.providerChip, selected && styles.providerChipActive]}
                  onPress={() => setDraftProvider(opt.key)}
                >
                  <Text
                    style={[
                      styles.providerChipText,
                      selected && styles.providerChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.settingsInputsRow}>
            <TextInput
              style={[styles.settingsInput, { flex: 2 }]}
              value={draftKey}
              onChangeText={setDraftKey}
              placeholder="Dán OpenAI key (sk-...) hoặc Gemini key (AIza...)"
              placeholderTextColor="#9A897E"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={[styles.settingsInput, { flex: 1 }]}
              value={draftModel}
              onChangeText={setDraftModel}
              placeholder="Model (mặc định: deepseek-chat / gpt-4o-mini / gemini-2.5-flash)"
              placeholderTextColor="#9A897E"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.settingsFooterRow}>
            <View style={styles.settingsButtons}>
              <TactileButton
                label="Lưu cài đặt"
                variant="caramel"
                onPress={handleSaveApiSettings}
              />
              <Pressable style={styles.ghostBtn} onPress={handleClearApiKey}>
                <Text style={styles.ghostBtnText}>Xóa key</Text>
              </Pressable>
            </View>
            {settingsSavedNote && (
              <Text style={styles.savedNoteText}>{settingsSavedNote}</Text>
            )}
          </View>
        </View>
      )}

      {/* Quick Prompts */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickStrip}
        contentContainerStyle={styles.quickStripContent}
      >
        {QUICK_PROMPTS.map((prompt) => (
          <Pressable
            key={prompt}
            style={({ pressed }) => [styles.quickChip, pressed && styles.quickChipPressed]}
            onPress={() => handleSend(prompt)}
          >
            <Text style={styles.quickChipText}>{prompt}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Conversation Feed */}
      <ScrollView
        ref={scrollRef}
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        onContentSizeChange={scrollToEndSoon}
      >
        {/* Manga Speech Bubble Hero Callout */}
        {!bannerDismissed && (
        <View style={styles.mangaRow}>
          <View style={styles.mangaAvatarCol}>
            <View style={styles.mangaAvatar}>
              <Text style={styles.mangaAvatarText}>AI</Text>
            </View>
          </View>
          <View nativeID="seed-manga-hero" style={styles.mangaBubble}>
            <View style={styles.mangaTailLeft} />
            <View style={styles.mangaHeaderRow}>
              <View style={styles.mangaHeaderLeft}>
                <View style={styles.mangaTag}>
                  <Text style={styles.mangaTagText}>NHẬN XÉT SAU BÀI HỌC</Text>
                </View>
                <Text style={styles.mangaPctPill}>{coaching.weakestSkillPct}%</Text>
              </View>
              <Pressable
                style={styles.mangaCloseBtn}
                onPress={() => setBannerDismissed(true)}
              >
                <Text style={styles.mangaCloseText}>{'\u00D7'}</Text>
              </Pressable>
            </View>

            <Pressable
              nativeID="seed-manga-body"
              style={{ gap: 8 }}
              onPress={() => setBannerDismissed(true)}
            >
              <Text style={styles.mangaHeadline}>{coaching.headlineVi}</Text>
              <Text style={styles.mangaSectionTitle}>Bạn cần cải thiện:</Text>
              <Text style={styles.mangaSummary}>{coaching.actionSummaryVi}</Text>

              <View style={styles.mangaBullets}>
                {coaching.bulletPointsVi.map((point, idx) => (
                  <View key={idx} style={styles.mangaBulletRow}>
                    <View style={styles.mangaBulletDot} />
                    <Text style={styles.mangaBulletText}>{point}</Text>
                  </View>
                ))}
              </View>
            </Pressable>

            <View style={styles.mangaActionsRow}>
              <TactileButton
                label="Luyện khắc phục ngay"
                variant="caramel"
                onPress={() => {
                  setBannerDismissed(true);
                  handleSend(coaching.drillPromptVi);
                }}
              />
              <Pressable
                style={styles.audioBtn}
                onPress={() => speakKorean(coaching.koreanSample)}
              >
                <GeometricBadge name="audio" size={18} />
                <Text style={styles.audioBtnText}>
                  Nghe mẫu: {coaching.koreanSample}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <View
              key={msg.id}
              style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAi]}
            >
              <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
                {!isUser && (
                  <View style={styles.aiMetaRow}>
                    <Text style={styles.aiMetaText}>{getSourceLabel(msg.source)}</Text>
                  </View>
                )}

                <Text
                  selectable
                  style={[styles.messageText, isUser ? styles.messageTextUser : styles.messageTextAi]}
                >
                  {msg.text}
                </Text>

                {!isUser && msg.koreanSample && (
                  <View style={styles.sampleFooter}>
                    <Pressable
                      style={styles.audioBtn}
                      onPress={() => speakKorean(msg.koreanSample!)}
                    >
                      <GeometricBadge name="audio" size={18} />
                      <Text style={styles.audioBtnText}>
                        Nghe: {msg.koreanSample}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {sending && (
          <View style={[styles.messageRow, styles.messageRowAi]}>
            <View style={[styles.bubble, styles.bubbleAi]}>
              <Text style={styles.thinkingText}>Đang phân tích câu trả lời...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Composer */}
      <View style={styles.composerWrap}>
        {showKeyboard && (
          <View style={styles.keyboardBox}>
            <HangulKeyboard tokens={jamoTokens} onChangeTokens={handleHangulChange} />
          </View>
        )}

        <View style={styles.composerRow}>
          <Pressable
            style={[styles.kbToggleBtn, showKeyboard && styles.kbToggleBtnActive]}
            onPress={() => setShowKeyboard((v) => !v)}
          >
            <Text style={[styles.kbToggleText, showKeyboard && styles.kbToggleTextActive]}>
              {showKeyboard ? 'Ẩn phím Hàn' : 'Phím Hàn'}
            </Text>
          </Pressable>

          <TextInput
            style={styles.input}
            value={input}
            onChangeText={handleManualTextChange}
            placeholder="Hỏi ngữ pháp, dán câu tiếng Hàn để sửa, hoặc hỏi điểm yếu của bạn..."
            placeholderTextColor="#9A897E"
            multiline
          />

          <TactileButton
            label={sending ? 'Đang gửi' : 'Gửi'}
            variant="caramel"
            disabled={sending || input.trim().length === 0}
            onPress={() => handleSend()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitles: {
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C221E',
  },
  subtitle: {
    fontSize: 12,
    color: '#6E5A4F',
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
  },
  statusPillLive: {
    backgroundColor: '#F2F7F3',
    borderColor: '#CFE3D5',
  },
  statusPillLocal: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EAE2D6',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  statusDotLive: {
    backgroundColor: '#3E7B52',
  },
  statusDotLocal: {
    backgroundColor: '#B08968',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2C221E',
  },
  eloPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE2D6',
  },
  eloPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6E5A4F',
  },
  ghostBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
  },
  ghostBtnActive: {
    borderColor: '#3E7B52',
    backgroundColor: '#F2F7F3',
  },
  ghostBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2C221E',
  },
  settingsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  settingsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2C221E',
  },
  settingsHint: {
    fontSize: 12,
    color: '#6E5A4F',
  },
  providerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  providerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
  },
  providerChipActive: {
    borderColor: '#3E7B52',
    backgroundColor: '#F2F7F3',
  },
  providerChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6E5A4F',
  },
  providerChipTextActive: {
    color: '#2D5D3D',
  },
  settingsInputsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  settingsInput: {
    minWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
    fontSize: 13,
    color: '#2C221E',
  },
  settingsFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  settingsButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savedNoteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3E7B52',
  },
  quickStrip: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#F2ECE4',
    backgroundColor: '#FFFFFF',
  },
  quickStripContent: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
  },
  quickChipPressed: {
    backgroundColor: '#F2F7F3',
    borderColor: '#3E7B52',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2C221E',
  },
  feed: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  feedContent: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 14,
    maxWidth: 920,
    width: '100%',
  },
  mangaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  mangaAvatarCol: {
    paddingTop: 6,
  },
  mangaAvatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#3E7B52',
    borderWidth: 2,
    borderColor: '#2C221E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mangaAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mangaBubble: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderRightWidth: 3,
    borderColor: '#2C221E',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  mangaTailLeft: {
    position: 'absolute',
    left: -8,
    top: 16,
    width: 13,
    height: 13,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#2C221E',
    transform: [{ rotate: '45deg' }],
  },
  mangaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mangaHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mangaCloseBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mangaCloseText: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '700',
    color: '#57463D',
  },
  mangaTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F2F7F3',
    borderWidth: 1,
    borderColor: '#3E7B52',
  },
  mangaTagText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#2D5D3D',
  },
  mangaPctPill: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B08968',
  },
  mangaHeadline: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#2C221E',
    lineHeight: 20,
  },
  mangaSectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#3E7B52',
    marginTop: 2,
  },
  mangaSummary: {
    fontSize: 13.5,
    color: '#2C221E',
    lineHeight: 20,
  },
  mangaBullets: {
    gap: 6,
    paddingTop: 2,
  },
  mangaBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  mangaBulletDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: '#3E7B52',
    marginTop: 7,
  },
  mangaBulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#57463D',
  },
  mangaActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingTop: 6,
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAi: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
  },
  bubbleUser: {
    backgroundColor: '#F2F7F3',
    borderColor: '#CFE3D5',
  },
  bubbleAi: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EAE2D6',
  },
  aiMetaRow: {
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiMetaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3E7B52',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 22,
  },
  messageTextUser: {
    color: '#1F3A28',
    fontWeight: '500',
  },
  messageTextAi: {
    color: '#2C221E',
  },
  sampleFooter: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F2ECE4',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  audioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
  },
  audioBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2C221E',
  },
  thinkingText: {
    fontSize: 13,
    color: '#6E5A4F',
    fontWeight: '500',
  },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  keyboardBox: {
    marginBottom: 10,
    maxWidth: 920,
    width: '100%',
  },
  composerRow: {
    maxWidth: 920,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  kbToggleBtn: {
    paddingHorizontal: 11,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    backgroundColor: '#FFFFFF',
  },
  kbToggleBtnActive: {
    borderColor: '#3E7B52',
    backgroundColor: '#F2F7F3',
  },
  kbToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6E5A4F',
  },
  kbToggleTextActive: {
    color: '#2D5D3D',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
    fontSize: 14,
    color: '#2C221E',
  },
});
