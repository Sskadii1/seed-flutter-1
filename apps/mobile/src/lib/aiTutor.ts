import {
  AdaptiveAiProfile,
  KnowledgeComponentId,
  unit0Data,
  unit1Data,
} from '@seed/schema';
import {
  attachParticle,
  computeRetentionTruth,
  hasBatchim,
} from '@seed/learning-engine';
import { SeedLearningState, getEffectiveNow } from '../store/learningStore';

export type AiProvider = 'auto' | 'deepseek' | 'openai' | 'gemini';

export interface AiApiConfig {
  provider: AiProvider;
  apiKey: string;
  model?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  koreanSample?: string;
  source?: 'deepseek' | 'openai' | 'gemini' | 'local';
  timestamp: number;
}

export interface MangaCoachingBubbleData {
  headlineVi: string;
  weakestSkillLabel: string;
  weakestSkillPct: number;
  actionSummaryVi: string;
  bulletPointsVi: string[];
  drillPromptVi: string;
  koreanSample: string;
}

const API_CONFIG_STORAGE_KEY = 'seed_korean_ai_config_v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type FetchFn = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function getStorage(): StorageLike | null {
  try {
    const g = globalThis as unknown as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

function getFetch(): FetchFn | null {
  try {
    const g = globalThis as unknown as { fetch?: FetchFn };
    return typeof g.fetch === 'function' ? g.fetch : null;
  } catch {
    return null;
  }
}

export function loadAiApiConfig(): AiApiConfig {
  const storage = getStorage();
  if (!storage) return { provider: 'auto', apiKey: '', model: '' };
  try {
    const raw = storage.getItem(API_CONFIG_STORAGE_KEY);
    if (!raw) return { provider: 'auto', apiKey: '', model: '' };
    const parsed = JSON.parse(raw) as Partial<AiApiConfig>;
    return {
      provider:
        parsed.provider === 'deepseek' ||
        parsed.provider === 'openai' ||
        parsed.provider === 'gemini'
          ? parsed.provider
          : 'auto',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
    };
  } catch {
    return { provider: 'auto', apiKey: '', model: '' };
  }
}

export function saveAiApiConfig(config: AiApiConfig): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      API_CONFIG_STORAGE_KEY,
      JSON.stringify({
        provider: config.provider,
        apiKey: config.apiKey.trim(),
        model: (config.model ?? '').trim(),
      })
    );
  } catch {
    // Ignore storage quota or sandbox errors
  }
}

export function resolveProvider(
  config: AiApiConfig
): 'deepseek' | 'openai' | 'gemini' | null {
  const key = config.apiKey.trim();
  if (!key) return null;
  if (config.provider === 'deepseek') return 'deepseek';
  if (config.provider === 'openai') return 'openai';
  if (config.provider === 'gemini') return 'gemini';
  if (key.startsWith('AIza')) return 'gemini';
  return 'openai';
}

function getLearnerTelemetrySummary(state: SeedLearningState): {
  elo: number;
  completedCount: number;
  retentionPct: number;
  dueCount: number;
  weakestSkillLabel: string;
  weakestSkillPct: number;
  skillsSummary: string;
} {
  const now = getEffectiveNow(state);
  const wrongCounts = state.attempts.map((a) => a.wrongAttempts);
  const truth = computeRetentionTruth(Object.values(state.cards), wrongCounts, now);
  const skills = Object.values(state.aiProfile.skills);
  const sorted = [...skills].sort((a, b) => a.pKnown - b.pKnown);
  const weakest = sorted[0];

  const skillsSummary = skills
    .map((s) => `${s.labelVi}: ${Math.round(s.pKnown * 100)}%`)
    .join('; ');

  return {
    elo: Math.round(state.aiProfile.eloRating),
    completedCount: state.completedLessonIds.length,
    retentionPct: Math.round(truth.averageRetrievability * 100),
    dueCount: truth.dueCount,
    weakestSkillLabel: weakest ? weakest.labelVi : 'Chưa có dữ liệu',
    weakestSkillPct: weakest ? Math.round(weakest.pKnown * 100) : 25,
    skillsSummary,
  };
}

export function buildPedagogicalSystemPrompt(state: SeedLearningState): string {
  const t = getLearnerTelemetrySummary(state);
  return [
    'Bạn là gia sư tiếng Hàn chuyên sâu của hệ thống SEED (dành cho người Việt học Sơ cấp 1).',
    'Phong cách: súc tích, chuẩn học thuật SLA, giải thích rõ ràng bằng tiếng Việt kèm Hangul, IPA khi cần và đối chiếu bẫy phát âm/ngữ pháp Việt-Hàn hoặc gốc Hán-Việt.',
    'Không dùng emoji.',
    `Hồ sơ người học hiện tại: Elo=${t.elo}, Bài đã xong=${t.completedCount}, Độ nhớ FSRS=${t.retentionPct}%, Thẻ đến hạn ôn=${t.dueCount}.`,
    `Năng lực 5 kỹ năng BKT: ${t.skillsSummary}.`,
    `Kỹ năng cần ưu tiên nhất: ${t.weakestSkillLabel} (${t.weakestSkillPct}%).`,
    `Khuyến nghị từ AI thích ứng: ${state.aiProfile.lastRecommendationVi}`,
    'Khi sửa câu tiếng Hàn, hãy chỉ rõ lỗi, đưa câu đúng và giải thích ngắn gọn quy tắc patchim hoặc tiểu từ.',
  ].join('\n');
}

function extractHangulTokens(text: string): string[] {
  const matches = text.match(/[\uAC00-\uD7A3]+/g);
  return matches ? matches : [];
}

function extractFirstKoreanPhrase(text: string): string | undefined {
  const matches = text.match(/[\uAC00-\uD7A3][\uAC00-\uD7A3\s?!.,]{0,40}[\uAC00-\uD7A3?!.]?/g);
  if (!matches || matches.length === 0) return undefined;
  return matches[0].trim();
}

function findVocabMatches(query: string) {
  const lower = query.toLowerCase();
  const matches = unit1Data.vocabulary.filter(
    (v) =>
      query.includes(v.hangul) ||
      lower.includes(v.meaningVi.toLowerCase()) ||
      (v.hanja && lower.includes(v.hanja.hanViet.toLowerCase()))
  );
  return matches;
}

function formatSkillDiagnostics(profile: AdaptiveAiProfile): { text: string; koreanSample?: string } {
  const skills = Object.keys(profile.skills) as KnowledgeComponentId[];
  const ranked = skills
    .map((id) => profile.skills[id])
    .sort((a, b) => a.pKnown - b.pKnown);
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];

  const lines = ranked.map(
    (s) => `- ${s.labelVi}: ${Math.round(s.pKnown * 100)}% (${s.attempts} lượt)`
  );

  let sample: string | undefined = '저는 베트남 사람이에요.';
  let tip = 'Hãy làm 1 bài luyện tập ngắn để cập nhật mô hình BKT.';
  if (weakest.kcId === 'kc_phonetics_3way') {
    sample = '달, 딸, 탈';
    tip = 'Mẹo: âm bật hơi (ㅋ, ㅌ, ㅍ) bật luồng gió mạnh; âm căng (ㄲ, ㄸ, ㅃ) giữ căng thanh quản và không bật hơi.';
  } else if (weakest.kcId === 'kc_morph_particles') {
    sample = '저는 학생이에요.';
    tip = 'Kiểm tra patchim của danh từ trước khi chọn 은/는, 이/가 hoặc 이에요/예요.';
  } else if (weakest.kcId === 'kc_phonetics_vowel_batchim') {
    sample = '한국어, 문, 물';
    tip = 'Phân biệt rõ đầu lưỡi chạm lợi (ㄴ) và cong nhẹ / uốn lưỡi (ㄹ) ở vị trí patchim.';
  } else if (weakest.kcId === 'kc_lexicon_hanja') {
    sample = '한국, 학생, 선생님';
    tip = 'Liên kết âm Hán-Việt (ví dụ: Học sinh = 학생, Hàn Quốc = 한국) giúp nhớ lâu hơn.';
  } else {
    sample = '안녕하세요. 만나서 반갑습니다.';
    tip = 'Luyện gõ Hangul không nhìn gợi ý để chuyển trí nhớ thụ động sang chủ động.';
  }

  return {
    text: [
      `Phân tích hồ sơ học tập hiện tại (Elo ${Math.round(profile.eloRating)}):`,
      ...lines,
      '',
      `Điểm mạnh nhất: ${strongest.labelVi} (${Math.round(strongest.pKnown * 100)}%).`,
      `Trọng tâm cần bù: ${weakest.labelVi} (${Math.round(weakest.pKnown * 100)}%).`,
      tip,
      `Gợi ý tiếp theo: ${profile.lastRecommendationVi}`,
    ].join('\n'),
    koreanSample: sample,
  };
}

export function generateLocalSlaTutorReply(
  query: string,
  state: SeedLearningState
): { text: string; koreanSample?: string } {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  // 1. Specific common L1 Vietnamese learner sentence corrections
  if (trimmed.includes('저은') || trimmed.includes('나은')) {
    return {
      text: [
        'Phát hiện lỗi patchim ở đại từ ngôi thứ nhất:',
        '- Sai: 저은 / 나은',
        '- Đúng: 저는 (tôi - trang trọng) / 나는 (tôi - thân mật)',
        'Giải thích: "저" kết thúc bằng nguyên âm ㅓ (không có patchim) nên phải gắn tiểu từ -는, không dùng -은.',
        'Nếu muốn nói "Tôi là học sinh": 저는 학생이에요.',
      ].join('\n'),
      koreanSample: '저는 학생이에요.',
    };
  }

  if (trimmed.includes('이름는')) {
    return {
      text: [
        'Phát hiện lỗi patchim với danh từ 이름 (tên):',
        '- Sai: 이름는',
        '- Đúng: 이름은',
        'Giải thích: "이름" kết thúc bằng phụ âm cuối ㅁ (có patchim), nên gắn tiểu từ -은.',
        'Ví dụ đầy đủ: 제 이름은 린이에요. (Tên tôi là Linh.)',
      ].join('\n'),
      koreanSample: '제 이름은 린이에요.',
    };
  }

  if (trimmed.includes('학생예요') || trimmed.includes('선생님예요')) {
    const noun = trimmed.includes('학생예요') ? '학생' : '선생님';
    const fixed = attachParticle(noun, '이에요/예요');
    return {
      text: [
        `Phát hiện lỗi chia đuôi câu "là" (이다) cho danh từ ${noun}:`,
        `- Sai: ${noun}예요`,
        `- Đúng: ${fixed}`,
        `Giải thích: "${noun}" có phụ âm cuối (patchim), nên bắt buộc đi với -이에요 thay vì -예요.`,
      ].join('\n'),
      koreanSample: `저는 ${fixed}.`,
    };
  }

  // 2. Learner telemetry / weakness / study plan request
  if (
    lower.includes('điểm yếu') ||
    lower.includes('hồ sơ') ||
    lower.includes('nên học') ||
    lower.includes('đánh giá') ||
    lower.includes('elo') ||
    lower.includes('bkt') ||
    lower.includes('thống kê')
  ) {
    return formatSkillDiagnostics(state.aiProfile);
  }

  // 3. Explicit batchim check on Hangul word in query
  if (lower.includes('patchim') || lower.includes('gắn tiểu từ') || lower.includes('tiểu từ của')) {
    const tokens = extractHangulTokens(trimmed);
    const target = tokens.find((w) => w !== '은' && w !== '는' && w !== '이' && w !== '가');
    if (target) {
      const batchim = hasBatchim(target);
      const topic = attachParticle(target, '은/는');
      const subject = attachParticle(target, '이/가');
      const obj = attachParticle(target, '을/를');
      const copula = attachParticle(target, '이에요/예요');
      return {
        text: [
          `Kiểm tra cấu trúc âm tiết cuối của "${target}":`,
          `- Patchim (phụ âm cuối): ${batchim ? 'Có patchim' : 'Không có patchim (kết thúc bằng nguyên âm)'}`,
          `- Tiểu từ chủ đề (은/는): ${topic}`,
          `- Tiểu từ chủ ngữ (이/가): ${subject}`,
          `- Tiểu từ tân ngữ (을/를): ${obj}`,
          `- Đuôi "là" (이에요/예요): ${copula}`,
        ].join('\n'),
        koreanSample: copula,
      };
    }
  }

  // 4. Grammar contrast: 은/는 vs 이/가
  if (
    lower.includes('은/는') ||
    lower.includes('이/가') ||
    lower.includes('은') && lower.includes('가') && lower.includes('phân biệt')
  ) {
    return {
      text: [
        'Phân biệt nhanh tiểu từ -은/는 và -이/가:',
        '1. -은 / -는 (Chủ đề / Đối chiếu): Dùng khi giới thiệu bản thân, nêu chủ đề đã biết, hoặc so sánh A với B.',
        '   Ví dụ: 저는 학생이에요. (Còn tôi thì là học sinh.)',
        '2. -이 / -가 (Chủ ngữ / Nhấn mạnh thông tin mới): Nhấn vào đối tượng thực hiện hoặc trả lời câu hỏi "Ai / Cái gì?".',
        '   Ví dụ: 이름이 뭐예요? (Tên là gì vậy?)',
        'Quy tắc ghép: có patchim dùng -은 / -이; không patchim dùng -는 / -가.',
      ].join('\n'),
      koreanSample: '저는 학생이에요. 이름이 뭐예요?',
    };
  }

  // 5. Copula 이에요 / 예요
  if (lower.includes('이에요') || lower.includes('예요')) {
    return {
      text: [
        'Quy tắc dùng đuôi "là" lịch sự (-이에요 / -예요):',
        '- Danh từ CÓ patchim + -이에요: 학생이에요 (là học sinh), 한국 사람이에요 (là người Hàn).',
        '- Danh từ KHÔNG patchim + -예요: 의사예요 (là bác sĩ), 베트남어예요 (là tiếng Việt).',
        'Bẫy người Việt hay gặp: quên kiểm tra patchim của từ mượn/Hán-Việt nên đọc nhầm "학생예요".',
      ].join('\n'),
      koreanSample: '저는 베트남 사람이에요. 의사가 아니에요.',
    };
  }

  // 6. Phonetics: 3-way stops, L/N, Liaison, Vowels
  if (
    lower.includes('3 bậc') ||
    lower.includes('phụ âm tắc') ||
    lower.includes('bật hơi') ||
    lower.includes('ㄱ') ||
    lower.includes('ㄲ') ||
    lower.includes('ㅋ')
  ) {
    return {
      text: [
        'Hệ thống 3 bậc phụ âm tắc tiếng Hàn (rất khác tiếng Việt ở chỗ không phân biệt hữu thanh/vô thanh ở đầu từ):',
        '- Bậc thường (ㄱ, ㄷ, ㅂ, ㅈ): đọc nhẹ, hơi thả lỏng, thanh điệu thấp hơn nhẹ.',
        '- Bậc căng (ㄲ, ㄸ, ㅃ, ㅉ): khép chặt thanh quản trước khi bật âm, tuyệt đối không bật hơi.',
        '- Bậc bật hơi (ㅋ, ㅌ, ㅍ, ㅊ): đẩy luồng hơi mạnh ra khỏi miệng (có thể thử bằng tờ giấy mỏng trước miệng).',
        'Ví dụ bộ 3 kinh điển: 달 (mặt trăng) - 딸 (con gái) - 탈 (mặt nạ).',
      ].join('\n'),
      koreanSample: '달, 딸, 탈',
    };
  }

  if (lower.includes('ㄴ') && lower.includes('ㄹ') || lower.includes('nối âm') || lower.includes('연음')) {
    return {
      text: [
        'Quy tắc nối âm (연음) và cặp ㄴ/ㄹ:',
        '- Khi âm tiết trước có patchim và âm tiết sau bắt đầu bằng ㅇ (nguyên âm), patchim sẽ nối sang làm âm đầu cho âm tiết sau.',
        '  Ví dụ: 한국어 đọc là [한구거], 이름은 đọc là [이르믄].',
        '- Với cặp ㄴ/ㄹ ở patchim: ㄴ giữ đầu lưỡi chạm chân răng trên (문 - cửa), còn ㄹ cuộn nhẹ đầu lưỡi lên (물 - nước).',
      ].join('\n'),
      koreanSample: '한국어, 물, 문',
    };
  }

  // 7. Self-introduction & greetings practice
  if (
    lower.includes('giới thiệu') ||
    lower.includes('tự giới thiệu') ||
    lower.includes('chào hỏi') ||
    trimmed.includes('안녕')
  ) {
    return {
      text: [
        'Mẫu tự giới thiệu 3 câu chuẩn Sơ cấp 1 (Unit 1):',
        '1. 안녕하세요. (Xin chào.)',
        '2. 저는 [Tên]이에요/예요. 저는 베트남 사람이에요. (Tôi là [Tên]. Tôi là người Việt Nam.)',
        '3. 저는 학생이에요. 만나서 반갑습니다. (Tôi là học sinh. Rất vui được gặp bạn.)',
        'Bạn có thể gõ câu giới thiệu của riêng bạn vào đây (bật "Bàn phím Hàn" ở dưới nếu cần), mình sẽ kiểm tra patchim và tiểu từ giúp bạn.',
      ].join('\n'),
      koreanSample: '안녕하세요. 저는 베트남 사람이에요. 만나서 반갑습니다.',
    };
  }

  // 8. Vocabulary / Hanja lookup from Unit 0 & Unit 1
  const vocabMatches = findVocabMatches(trimmed);
  if (vocabMatches.length > 0) {
    const top = vocabMatches.slice(0, 3);
    const lines = top.map((v) => {
      const hanjaPart = v.hanja ? ` | Hán-Việt: ${v.hanja.hanViet} (${v.hanja.characters})` : '';
      return `- ${v.hangul} [${v.ipa}]: ${v.meaningVi} (${v.hasBatchim ? 'có patchim' : 'không patchim'}${hanjaPart})`;
    });
    return {
      text: ['Tra cứu từ vựng trong giáo trình SEED:', ...lines].join('\n'),
      koreanSample: top[0].hangul,
    };
  }

  // 9. Sentence check fallback if user typed Hangul
  const hangulTokens = extractHangulTokens(trimmed);
  if (hangulTokens.length > 0) {
    const analysis = hangulTokens.slice(0, 4).map((w) => {
      const b = hasBatchim(w);
      return `- ${w}: ${b ? 'có patchim' : 'không patchim'} (gắn chủ đề -> ${attachParticle(w, '은/는')})`;
    });
    return {
      text: [
        'Mình đã nhận diện các từ tiếng Hàn bạn vừa gửi:',
        ...analysis,
        '',
        'Nếu bạn muốn giải thích tự do mọi chủ đề nâng cao ngoài giáo trình Unit 0-1, bạn có thể nhập khóa OpenAI hoặc Gemini ở nút "Cài đặt API" phía trên (khóa chỉ lưu tại trình duyệt của bạn).',
      ].join('\n'),
      koreanSample: hangulTokens.join(' '),
    };
  }

  // 10. General helpful guidance
  const unit0Titles = unit0Data.lessons.map((l) => l.title).slice(0, 2).join(', ');
  return {
    text: [
      'Mình là gia sư SEED AI. Ở chế độ nội bộ (không cần API key), mình hỗ trợ ngay các câu hỏi về:',
      '1. Kiểm tra patchim & sửa câu tiếng Hàn (ví dụ: "Sửa câu: 저은 학생예요", "Kiểm tra patchim của 한국").',
      '2. Ngữ pháp & phát âm Unit 0-1 ("Phân biệt 은/는 và 이/가", "Quy tắc 3 bậc phụ âm tắc", "Quy tắc nối âm").',
      `3. Tra cứu từ vựng & Hán-Việt (${unit0Titles} và Unit 1).`,
      '4. Phân tích điểm yếu cá nhân theo hồ sơ BKT & Elo ("Phân tích điểm yếu của tôi").',
      '',
      'Muốn trò chuyện mở rộng như ChatGPT đầy đủ? Nhấn "Cài đặt API" ở góc trên để gắn key OpenAI hoặc Gemini cá nhân.',
    ].join('\n'),
    koreanSample: '안녕하세요. 무엇을 도와드릴까요?',
  };
}

async function callOpenAiCompatibleChat(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: ChatMessage[];
  query: string;
}): Promise<string> {
  const fetchFn = getFetch();
  if (!fetchFn) {
    throw new Error('Môi trường hiện tại không hỗ trợ fetch');
  }

  const recentMessages = params.history.slice(-6).map((m) => ({
    role: m.role,
    content: m.text,
  }));

  const body = JSON.stringify({
    model: params.model,
    temperature: 0.4,
    messages: [
      { role: 'system', content: params.systemPrompt },
      ...recentMessages,
      { role: 'user', content: params.query },
    ],
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Quá thời gian chờ phản hồi AI (18s)')), 18000);
  });

  const response = await Promise.race([
    fetchFn(params.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body,
    }),
    timeoutPromise,
  ]);

  if (!response.ok) {
    throw new Error(`API trả về mã lỗi ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Phản hồi API trống');
  }
  return content;
}

export function buildMangaCoachingBubble(state: SeedLearningState): MangaCoachingBubbleData {
  const skills = Object.values(state.aiProfile.skills);
  const ranked = [...skills].sort((a, b) => a.pKnown - b.pKnown);
  const weakest = ranked[0];
  const pct = weakest ? Math.round(weakest.pKnown * 100) : 25;
  const label = weakest ? weakest.labelVi : 'Hangul';
  const headlineVi =
    state.aiProfile.lastRecommendationVi?.trim() ||
    `Ưu tiên củng cố "${label}" (${pct}%).`;

  const recentErrors = state.attempts.filter((a) => a.wrongAttempts > 0).slice(0, 6);
  const categoryCount = recentErrors.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});
  const recentTrapNote =
    recentErrors.length > 0
      ? `Gần đây bạn có ${recentErrors.length} lượt chọn nhầm (lệch nhiều ở nhóm ${
          Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'general'
        }).`
      : 'Hệ thống đang theo dõi độ thuần thục sau mỗi câu bạn hoàn thành.';

  switch (weakest?.kcId) {
    case 'kc_phonetics_3way':
      return {
        headlineVi,
        weakestSkillLabel: label,
        weakestSkillPct: pct,
        actionSummaryVi:
          'Phân biệt luồng hơi và độ căng thanh quản giữa 3 bậc ㄱ/ㄲ/ㅋ và ㄷ/ㄸ/ㅌ.',
        bulletPointsVi: [
          'Nghe lại cặp tối thiểu 3 bậc (달 - 딸 - 탈) ở tốc độ chậm rồi thường.',
          'Với âm bật hơi (ㅋ, ㅌ, ㅍ), đẩy luồng hơi mạnh; âm căng (ㄲ, ㄸ, ㅃ) giữ căng dây thanh, không bật hơi.',
          recentTrapNote,
        ],
        drillPromptVi: 'Quy tắc 3 bậc phụ âm tắc',
        koreanSample: '달, 딸, 탈',
      };

    case 'kc_phonetics_vowel_batchim':
      return {
        headlineVi,
        weakestSkillLabel: label,
        weakestSkillPct: pct,
        actionSummaryVi:
          'Kiểm tra vị trí đầu lưỡi ở patchim ㄴ/ㄹ và quy tắc nối âm sang âm tiết có ㅇ.',
        bulletPointsVi: [
          'Phân biệt đầu lưỡi chạm lợi (문 - ㄴ) với cong nhẹ đầu lưỡi (물 - ㄹ).',
          'Khi âm sau bắt đầu bằng ㅇ, nhớ nối âm patchim sang (한국어 -> [한구거]).',
          recentTrapNote,
        ],
        drillPromptVi: 'Quy tắc nối âm và cặp ㄴ/ㄹ',
        koreanSample: '한국어, 문, 물',
      };

    case 'kc_morph_particles':
      return {
        headlineVi,
        weakestSkillLabel: label,
        weakestSkillPct: pct,
        actionSummaryVi:
          'Xác định patchim ở âm tiết cuối danh từ trước khi chọn 은/는, 이/가 hoặc 이에요/예요.',
        bulletPointsVi: [
          'Danh từ có patchim đi với -은 / -이 / -이에요 (ví dụ: 학생이에요, 이름은).',
          'Danh từ không patchim đi với -는 / -가 / -예요 (ví dụ: 저는, 의사예요).',
          recentTrapNote,
        ],
        drillPromptVi: 'Phân biệt 은/는 và 이/가',
        koreanSample: '저는 학생이에요. 이름이 뭐예요?',
      };

    case 'kc_lexicon_hanja':
      return {
        headlineVi,
        weakestSkillLabel: label,
        weakestSkillPct: pct,
        actionSummaryVi:
          'Ôn lại nghĩa Hán-Việt để ghi nhớ nhanh cụm danh từ quốc tịch và nghề nghiệp Unit 1.',
        bulletPointsVi: [
          'Liên kết gốc Hán-Việt (학생 = Học sinh, 한국 = Hàn Quốc, 선생님 = Tiên sinh).',
          'Đọc to kèm IPA và kiểm tra trạng thái patchim ngay khi học từ mới.',
          recentTrapNote,
        ],
        drillPromptVi: 'Phân tích điểm yếu của tôi',
        koreanSample: '한국, 학생, 선생님',
      };

    default:
      return {
        headlineVi,
        weakestSkillLabel: label,
        weakestSkillPct: pct,
        actionSummaryVi:
          'Tập gõ Hangul 2-beolsik không nhìn gợi ý và ghép câu tự giới thiệu hoàn chỉnh.',
        bulletPointsVi: [
          'Gõ lại mẫu câu chào hỏi và tự giới thiệu bằng bàn phím Hàn 2-beolsik.',
          'Kiểm tra đủ tiểu từ chủ đề (-은/는) và đuôi câu (-이에요/예요) trong câu tự đặt.',
          recentTrapNote,
        ],
        drillPromptVi: 'Luyện tự giới thiệu bản thân',
        koreanSample: '안녕하세요. 저는 베트남 사람이에요.',
      };
  }
}

export async function askAiTutor(params: {
  query: string;
  history: ChatMessage[];
  state: SeedLearningState;
  apiConfig: AiApiConfig;
}): Promise<{
  text: string;
  koreanSample?: string;
  source: 'deepseek' | 'openai' | 'gemini' | 'local';
  fallbackReason?: string;
}> {
  const provider = resolveProvider(params.apiConfig);
  const key = params.apiConfig.apiKey.trim();
  const systemPrompt = buildPedagogicalSystemPrompt(params.state);

  if (provider && key) {
    const endpoint =
      provider === 'deepseek'
        ? 'https://api.deepseek.com/chat/completions'
        : provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    const defaultModel =
      provider === 'deepseek'
        ? 'deepseek-chat'
        : provider === 'gemini'
        ? 'gemini-2.5-flash'
        : 'gpt-4o-mini';
    const model = params.apiConfig.model?.trim() || defaultModel;

    try {
      const replyText = await callOpenAiCompatibleChat({
        endpoint,
        apiKey: key,
        model,
        systemPrompt,
        history: params.history,
        query: params.query,
      });
      return {
        text: replyText,
        koreanSample: extractFirstKoreanPhrase(replyText),
        source: provider,
      };
    } catch (err) {
      const localReply = generateLocalSlaTutorReply(params.query, params.state);
      const reason = err instanceof Error ? err.message : 'Lỗi kết nối API';
      return {
        text: `${localReply.text}\n\n[Đã chuyển về Gia sư nội bộ do lỗi gọi ${provider.toUpperCase()}: ${reason}]`,
        koreanSample: localReply.koreanSample,
        source: 'local',
        fallbackReason: reason,
      };
    }
  }

  // Try same-origin Vercel serverless AI endpoint (/api/ai/chat) automatically when no local key is set
  const fetchFn = getFetch() as
    | ((
        input: string,
        init?: { method?: string; headers?: Record<string, string>; body?: string }
      ) => Promise<{
        ok: boolean;
        status: number;
        headers?: { get?(name: string): string | null };
        json(): Promise<unknown>;
      }>)
    | null;
  const gLoc = (globalThis as unknown as { location?: { origin?: string } }).location;
  if (fetchFn && gLoc?.origin && /^https?:/i.test(gLoc.origin)) {
    try {
      const resp = await Promise.race([
        fetchFn('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: params.query,
            systemPrompt,
            history: params.history.slice(-8).map((m) => ({ role: m.role, text: m.text })),
          }),
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 14000)),
      ]);
      const ct = resp.headers?.get?.('content-type') || '';
      if (resp.ok && ct.includes('application/json')) {
        const data = (await resp.json()) as {
          reply?: string;
          provider?: 'deepseek' | 'openai' | 'gemini';
        };
        if (typeof data.reply === 'string' && data.reply.trim().length > 0) {
          const src =
            data.provider === 'deepseek' ||
            data.provider === 'gemini' ||
            data.provider === 'openai'
              ? data.provider
              : 'deepseek';
          return {
            text: data.reply.trim(),
            koreanSample: extractFirstKoreanPhrase(data.reply),
            source: src,
          };
        }
      }
    } catch {
      // Fall back silently to local deterministic SLA tutor when running static offline
    }
  }

  const localReply = generateLocalSlaTutorReply(params.query, params.state);
  return {
    text: localReply.text,
    koreanSample: localReply.koreanSample,
    source: 'local',
  };
}
