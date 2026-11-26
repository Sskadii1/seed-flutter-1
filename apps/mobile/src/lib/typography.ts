import { Platform } from 'react-native';

export const FONT_SANS =
  "'Be Vietnam Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const FONT_HANGUL =
  "'Noto Sans KR', 'Be Vietnam Pro', 'Malgun Gothic', sans-serif";

export const WEB_SANS_STYLE = Platform.OS === 'web' ? { fontFamily: FONT_SANS } : {};
export const WEB_HANGUL_STYLE = Platform.OS === 'web' ? { fontFamily: FONT_HANGUL } : {};

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

  if (!doc.getElementById('seed-google-fonts')) {
    const link = doc.createElement('link');
    link.id = 'seed-google-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap';
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
