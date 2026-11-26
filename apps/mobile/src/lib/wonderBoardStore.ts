import {
  WonderAnnotation,
  WonderBoardDocument,
  WonderBoardThemeId,
} from '@seed/schema';
import { createEmptyWonderBoard } from '@seed/learning-engine';

const LEGACY_BOARDS_STORAGE_KEY_V1 = 'seed_wonder_boards_v1';
const BOARDS_STORAGE_KEY = 'seed_wonder_boards_v2';
const ACTIVE_BOARD_ID_KEY = 'seed_wonder_active_board_v1';
const PRIVACY_PREF_KEY = 'seed_wonder_privacy_v1';

export interface WonderPrivacyConfig {
  allowCloudAi: boolean;
  cloudApiKey: string;
  cloudEndpoint: string;
  gatewayUrl: string;
  gatewayToken: string;
  chalkTextureEnabled: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): StorageLike | null {
  try {
    const g = globalThis as unknown as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

function migrateBoardToV2(b: Partial<WonderBoardDocument>, fromV1 = false): WonderBoardDocument {
  const targetTheme: WonderBoardThemeId =
    fromV1 && b.themeId === 'cozy-green-chalkboard'
      ? 'soft-cream-whiteboard'
      : ((b.themeId as WonderBoardThemeId) || 'soft-cream-whiteboard');
  const base = createEmptyWonderBoard(b.id, b.title, targetTheme);

  const migratedAnnotations: WonderAnnotation[] = Array.isArray(b.annotations)
    ? b.annotations.map((ann, idx) => {
        const isDone = ann.status === 'active' || ann.status === 'resolved';
        return {
          ...ann,
          stable_key:
            ann.stable_key ??
            `${ann.board_id}_${ann.linguistic_category}_${ann.target_text}`,
          cloud_seed: typeof ann.cloud_seed === 'number' ? ann.cloud_seed : idx + 1,
          lifecycle_state:
            ann.lifecycle_state ??
            (ann.status === 'stale' ? 'stale' : isDone ? 'completed' : 'queued'),
          animation_progress: ann.animation_progress ?? {
            cloud: isDone ? 1 : 0,
            arrow: isDone ? 1 : 0,
            correction: isDone ? 1 : 0,
            explanation: isDone ? 1 : 0,
            completed: isDone,
          },
        };
      })
    : [];

  return {
    ...base,
    ...b,
    themeId: targetTheme,
    guidanceLevel: b.guidanceLevel ?? 'guided',
    redoStack: Array.isArray(b.redoStack) ? b.redoStack : [],
    strokes: Array.isArray(b.strokes) ? b.strokes : [],
    annotations: migratedAnnotations,
    teachingCards: Array.isArray(b.teachingCards) ? b.teachingCards : [],
    hangulDemos: Array.isArray(b.hangulDemos) ? b.hangulDemos : [],
    deferredActions: Array.isArray(b.deferredActions) ? b.deferredActions : [],
    recordedEventKeys: Array.isArray(b.recordedEventKeys) ? b.recordedEventKeys : [],
    events: Array.isArray(b.events) ? b.events : [],
    regions: Array.isArray(b.regions) ? b.regions : [],
  };
}

export function loadWonderBoards(): WonderBoardDocument[] {
  const storage = getStorage();
  if (!storage) return [createEmptyWonderBoard()];
  try {
    let raw = storage.getItem(BOARDS_STORAGE_KEY);
    let migratedFromV1 = false;
    if (!raw) {
      raw = storage.getItem(LEGACY_BOARDS_STORAGE_KEY_V1);
      migratedFromV1 = Boolean(raw);
    }
    if (!raw) return [createEmptyWonderBoard()];
    const parsed = JSON.parse(raw) as Array<Partial<WonderBoardDocument>>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createEmptyWonderBoard()];
    }
    const migrated = parsed.map((b) => migrateBoardToV2(b, migratedFromV1));
    if (migratedFromV1) {
      storage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return [createEmptyWonderBoard()];
  }
}

export function saveWonderBoards(boards: WonderBoardDocument[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(boards));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function loadActiveBoardId(boards: WonderBoardDocument[]): string {
  const storage = getStorage();
  const fallback = boards[0]?.id ?? 'board_default';
  if (!storage) return fallback;
  try {
    const id = storage.getItem(ACTIVE_BOARD_ID_KEY);
    if (id && boards.some((b) => b.id === id)) return id;
  } catch {
    // Ignore
  }
  return fallback;
}

export function saveActiveBoardId(boardId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ACTIVE_BOARD_ID_KEY, boardId);
  } catch {
    // Ignore
  }
}

export function loadWonderPrivacyConfig(): WonderPrivacyConfig {
  const storage = getStorage();
  const defaults: WonderPrivacyConfig = {
    allowCloudAi: false,
    cloudApiKey: '',
    cloudEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    gatewayUrl: '',
    gatewayToken: '',
    chalkTextureEnabled: true,
  };
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(PRIVACY_PREF_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<WonderPrivacyConfig>) };
  } catch {
    return defaults;
  }
}

export function saveWonderPrivacyConfig(cfg: WonderPrivacyConfig): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(PRIVACY_PREF_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore
  }
}

export function deleteAllWonderBoardData(): WonderBoardDocument[] {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(BOARDS_STORAGE_KEY);
      storage.removeItem(ACTIVE_BOARD_ID_KEY);
    } catch {
      // Ignore
    }
  }
  const fresh = [createEmptyWonderBoard()];
  saveWonderBoards(fresh);
  saveActiveBoardId(fresh[0].id);
  return fresh;
}
