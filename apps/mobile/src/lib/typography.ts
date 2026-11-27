import { Platform } from 'react-native';

export const FONT_SANS =
  "'Be Vietnam Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const FONT_HANGUL =
  "'Noto Sans KR', 'Be Vietnam Pro', 'Malgun Gothic', sans-serif";

export const FONT_CHALK_VI =
  "'Playpen Sans', 'Be Vietnam Pro', sans-serif";

export const FONT_CHALK_KO =
  "'Gaegu', 'Noto Sans KR', sans-serif";

export const FONT_CHALK =
  "'Playpen Sans', 'Be Vietnam Pro', 'Gaegu', 'Noto Sans KR', sans-serif";

export const WEB_SANS_STYLE = Platform.OS === 'web' ? { fontFamily: FONT_SANS } : {};
export const WEB_HANGUL_STYLE = Platform.OS === 'web' ? { fontFamily: FONT_HANGUL } : {};
export const WEB_CHALK_STYLE = Platform.OS === 'web' ? { fontFamily: FONT_CHALK } : {};

interface MinimalDocument {
  getElementById(id: string): unknown;
  createElement(tag: string): {
    id: string;
    rel?: string;
    href?: string;
    textContent: string | null;
  };
  head?: {
    appendChild(node: unknown): void;
  };
}

/**
 * Loads Be Vietnam Pro (optimized for Vietnamese diacritic legibility) and
 * Noto Sans KR (clear Korean Hangul strokes) on Web builds.
 */
export function injectWebTypography(): void {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as unknown as { document?: MinimalDocument }).document;
  if (!doc || !doc.head) return;

  const fontHref =
    'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Gaegu:wght@400;700&family=Mali:wght@500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&family=Playpen+Sans:wght@500;600;700&display=swap';
  const existingFontLink = doc.getElementById('seed-google-fonts') as
    | { id: string; rel?: string; href?: string }
    | null
    | undefined;
  if (existingFontLink) {
    existingFontLink.href = fontHref;
  } else {
    const link = doc.createElement('link');
    link.id = 'seed-google-fonts';
    link.rel = 'stylesheet';
    link.href = fontHref;
    doc.head.appendChild(link);
  }

  const existingStyle = doc.getElementById('seed-typography-css') as
    | { id?: string; textContent: string | null }
    | null
    | undefined;
  const style = existingStyle ?? doc.createElement('style');
  if (!existingStyle) {
    style.id = 'seed-typography-css';
  }
  style.textContent = `
      html, body, #root {
        background-color: #FFFFFF !important;
      }
      html, body, #root, input, textarea, button, [dir="auto"] {
        font-family: ${FONT_SANS} !important;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
      button, [role="button"], [tabindex="0"]:not(input):not(textarea) {
        transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1), background-color 200ms ease, border-color 200ms ease;
      }
      button:hover, [role="button"]:hover, [tabindex="0"]:not(input):not(textarea):hover {
        transform: scale(1.022);
      }
      button:active, [role="button"]:active, [tabindex="0"]:not(input):not(textarea):active {
        transform: scale(0.988);
      }
      #seed-manga-popup, #seed-manga-mobile, #seed-manga-hero {
        transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 360ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      #seed-manga-popup {
        transform-origin: 27px top;
      }
      #seed-manga-hero {
        transform-origin: left 22px;
      }
      #seed-manga-popup:hover, #seed-manga-mobile:hover, #seed-manga-hero:hover {
        transform: scale(1.032) translateY(-1.5px);
        box-shadow: 0 14px 26px rgba(44, 34, 30, 0.16);
      }
      [id="seed-manga-body"]:hover {
        transform: none !important;
      }
    `;
  if (!existingStyle) {
    doc.head.appendChild(style);
  }
}

interface FontFaceSetLike {
  ready?: Promise<unknown>;
  load?: (font: string, text?: string) => Promise<unknown[]>;
  addEventListener?: (ev: string, fn: () => void) => void;
  removeEventListener?: (ev: string, fn: () => void) => void;
}

/**
 * Loads Korean & Vietnamese chalk web fonts and resolves once metrics stabilize
 * (with a bounded timeout so offline tests never stall).
 */
export async function waitForWonderFontsReady(timeoutMs = 1800): Promise<void> {
  if (Platform.OS !== 'web') return;
  injectWebTypography();
  const doc = (globalThis as unknown as { document?: { fonts?: FontFaceSetLike } }).document;
  const fonts = doc?.fonts;
  if (!fonts) return;

  const fontSpecs = [
    "600 18px 'Playpen Sans'",
    "500 18px 'Be Vietnam Pro'",
    "700 26px 'Gaegu'",
    "600 22px 'Noto Sans KR'",
  ];
  const sampleKoVi = '아 Âm tiết ㅎ ㅏ [a] → ạ ữ ơ ê đ';

  try {
    await Promise.race([
      Promise.all([
        typeof fonts.load === 'function'
          ? Promise.allSettled(fontSpecs.map((f) => fonts.load!(f, sampleKoVi)))
          : Promise.resolve(),
        fonts.ready ?? Promise.resolve(),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Offline or blocked CDN; safe fallback fonts remain usable
  }
}
