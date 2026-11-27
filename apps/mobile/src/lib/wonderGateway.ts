import {
  WonderBBox,
  WonderCropTransform,
  WonderStroke,
} from '@seed/schema';
import {
  HandwritingRecognitionProvider,
  ProviderRecognitionRequest,
  ProviderRecognitionResult,
  validateVisionRecognitionPayload,
} from '@seed/learning-engine';

export interface BrowserVisionConfig {
  allowCloudAi: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  /** True when same-origin /api/wonder/health reports visionReady: true */
  sameOriginVisionReady?: boolean;
  /** Explicit DEV-ONLY fallback key if no production gatewayUrl is set */
  devDirectApiKey?: string;
  devDirectProvider?: 'gemini' | 'openai' | 'auto';
}

export interface WonderServerHealth {
  ok: boolean;
  tutorReady: boolean;
  visionReady: boolean;
  providers: {
    deepseek?: boolean;
    gemini?: boolean;
    openai?: boolean;
  };
}

/**
 * Discovers /api/wonder/health on same-origin web or configured gatewayUrl.
 * Returns null cleanly when running offline or on static local exports without API routes.
 */
export async function fetchWonderServerHealth(
  gatewayUrl = '',
  gatewayToken = ''
): Promise<WonderServerHealth | null> {
  const gFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  if (typeof gFetch !== 'function') return null;

  const gLoc = (globalThis as unknown as { location?: { origin?: string } }).location;
  const cleanGateway = gatewayUrl.trim().replace(/\/+$/, '');
  const endpoint = cleanGateway
    ? `${cleanGateway}/api/wonder/health`
    : gLoc?.origin && /^https?:/i.test(gLoc.origin)
      ? '/api/wonder/health'
      : '';
  if (!endpoint) return null;

  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), 4000) : null;
  try {
    const headers: Record<string, string> = {};
    if (gatewayToken.trim()) {
      headers.Authorization = `Bearer ${gatewayToken.trim()}`;
    }
    const resp = await gFetch(endpoint, {
      method: 'GET',
      signal: ac?.signal,
      headers,
    });
    const ct = resp.headers?.get?.('content-type') || '';
    if (!resp.ok || !ct.includes('application/json')) return null;
    const raw = (await resp.json()) as Partial<WonderServerHealth>;
    if (!raw || typeof raw.ok !== 'boolean') return null;
    return {
      ok: raw.ok,
      tutorReady: Boolean(raw.tutorReady),
      visionReady: Boolean(raw.visionReady),
      providers: raw.providers ?? {},
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Renders ONLY Layer 2 user ink strokes inside `bbox` into a high-contrast white PNG crop.
 * AI clouds, arrows, teaching cards, and background grid/dust are strictly excluded.
 */
export function renderRegionInkCropDataUrl(
  regionStrokes: WonderStroke[],
  bbox: WonderBBox,
  paddingPx = 18
): { imageDataUrl: string; cropTransform: WonderCropTransform } | null {
  const g = globalThis as unknown as {
    document?: {
      createElement(tag: string): {
        width: number;
        height: number;
        getContext(kind: '2d'): {
          fillStyle: string;
          strokeStyle: string;
          lineWidth: number;
          lineCap: string;
          lineJoin: string;
          fillRect(x: number, y: number, w: number, h: number): void;
          beginPath(): void;
          moveTo(x: number, y: number): void;
          lineTo(x: number, y: number): void;
          quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
          stroke(): void;
          save(): void;
          restore(): void;
          translate(x: number, y: number): void;
          scale(x: number, y: number): void;
        } | null;
        toDataURL(type?: string): string;
      };
    };
  };
  if (!g.document || typeof g.document.createElement !== 'function') return null;

  const userOnly = regionStrokes.filter(
    (s) => !s.deleted && s.provenance !== 'ai_teaching' && s.points.length >= 1
  );
  if (userOnly.length === 0) return null;

  const worldMinX = bbox.minX - paddingPx;
  const worldMinY = bbox.minY - paddingPx;
  const worldWidth = Math.max(40, bbox.width + paddingPx * 2);
  const worldHeight = Math.max(40, bbox.height + paddingPx * 2);
  const scale = Math.min(2.5, Math.max(1.2, 640 / Math.max(worldWidth, worldHeight)));
  const pixelWidth = Math.max(64, Math.min(1024, Math.round(worldWidth * scale)));
  const pixelHeight = Math.max(48, Math.min(1024, Math.round(worldHeight * scale)));

  const canvas = g.document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-worldMinX, -worldMinY);
  ctx.strokeStyle = '#111111';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const st of userOnly) {
    if (st.tool === 'eraser_pixel') continue;
    ctx.lineWidth = Math.max(2.4, st.width);
    const pts = st.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x + st.transform.dx, pts[0].y + st.transform.dy);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const mx = (prev.x + curr.x) / 2 + st.transform.dx;
      const my = (prev.y + curr.y) / 2 + st.transform.dy;
      ctx.quadraticCurveTo(prev.x + st.transform.dx, prev.y + st.transform.dy, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x + st.transform.dx, last.y + st.transform.dy);
    ctx.stroke();
  }

  ctx.restore();
  return {
    imageDataUrl: canvas.toDataURL('image/png'),
    cropTransform: {
      worldMinX,
      worldMinY,
      worldWidth,
      worldHeight,
      pixelWidth,
      pixelHeight,
      scale,
    },
  };
}

export interface WonderServerTutorAction {
  type: 'DRAW_CLOUD' | 'WRITE_EXPLANATION' | 'WRITE_EXAMPLE' | 'DRAW_CHECKMARK' | 'WAIT';
  regionId: string;
  targetText: string;
  suggestedCorrection: string;
  explanation: string;
  hint: string;
}

/**
 * Queries /api/wonder/tutor (same-origin on Vercel or configured gatewayUrl)
 * to generate pedagogical feedback from server-side DeepSeek / Gemini / OpenAI
 * for recognized board regions without exposing any secret keys in browser bundles.
 */
export async function requestWonderServerTutor(params: {
  regions: Array<{ regionId: string; recognizedText: string; language: string }>;
  guidanceLevel: string;
  intent?: 'ambient' | 'explain' | 'translate' | 'grammar_check' | 'practice_exercise';
  gatewayUrl?: string;
  gatewayToken?: string;
  signal?: AbortSignal;
}): Promise<{ actions: WonderServerTutorAction[]; providerId: string }> {
  const gFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  if (typeof gFetch !== 'function' || params.regions.length === 0) {
    return { actions: [], providerId: 'offline' };
  }

  const gLoc = (globalThis as unknown as { location?: { origin?: string } }).location;
  const cleanGateway = (params.gatewayUrl ?? '').trim().replace(/\/+$/, '');
  const endpoint = cleanGateway
    ? `${cleanGateway}/api/wonder/tutor`
    : gLoc?.origin && /^https?:/i.test(gLoc.origin)
    ? '/api/wonder/tutor'
    : '';
  if (!endpoint) return { actions: [], providerId: 'offline' };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.gatewayToken?.trim()) {
      headers.Authorization = `Bearer ${params.gatewayToken.trim()}`;
    }
    const resp = await gFetch(endpoint, {
      method: 'POST',
      signal: params.signal,
      headers,
      body: JSON.stringify({
        regions: params.regions.slice(0, 8),
        guidanceLevel: params.guidanceLevel,
        intent: params.intent ?? 'ambient',
      }),
    });
    const ct = resp.headers?.get?.('content-type') || '';
    if (!resp.ok || !ct.includes('application/json')) {
      return { actions: [], providerId: `unavailable_${resp.status}` };
    }
    const raw = (await resp.json()) as {
      actions?: WonderServerTutorAction[];
      providerId?: string;
    };
    return {
      actions: Array.isArray(raw.actions) ? raw.actions : [],
      providerId: String(raw.providerId || 'vercel-tutor'),
    };
  } catch {
    return { actions: [], providerId: 'unavailable' };
  }
}

export function createBrowserVisionProvider(
  cfg: BrowserVisionConfig
): HandwritingRecognitionProvider | undefined {
  const cleanGateway = cfg.gatewayUrl.trim().replace(/\/+$/, '');
  const cleanDevKey = (cfg.devDirectApiKey ?? '').trim();
  const gLoc = (globalThis as unknown as { location?: { origin?: string } }).location;
  const canSameOrigin =
    Boolean(cfg.sameOriginVisionReady) &&
    cleanGateway.length === 0 &&
    Boolean(gLoc?.origin && /^https?:/i.test(gLoc.origin));
  const hasGateway = cleanGateway.length > 0 || canSameOrigin;
  const hasDevDirect = !hasGateway && cfg.allowCloudAi && cleanDevKey.length > 0;

  if (!cfg.allowCloudAi && !hasGateway) {
    return undefined;
  }
  if (!hasGateway && !hasDevDirect) {
    return undefined;
  }

  const gatewayBase = cleanGateway;

  return {
    id: hasGateway ? 'seed-ai-gateway-vision' : 'dev-direct-vision',
    kind: 'multimodal_vision',
    capabilities: {
      supportsFreehandKorean: true,
      supportsFreehandVietnamese: true,
      supportsMixedLanguage: true,
      supportsWordPositioning: true,
      requiresNetwork: true,
    },
    async recognizeRegion(req: ProviderRecognitionRequest): Promise<ProviderRecognitionResult> {
      const t0 = Date.now();
      if (!req.imageDataUrl) {
        return {
          status: 'AMBIGUOUS',
          recognizedText: '',
          language: 'unknown',
          confidence: 0,
          alternatives: [],
          providerId: hasGateway ? 'seed-ai-gateway-vision' : 'dev-direct-vision',
          latencyMs: 0,
          errorCode: 'NO_CROP_IMAGE',
        };
      }

      const gFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
      if (typeof gFetch !== 'function') {
        return {
          status: 'PROVIDER_UNAVAILABLE',
          recognizedText: '',
          language: 'unknown',
          confidence: 0,
          alternatives: [],
          providerId: 'offline-no-fetch',
          latencyMs: 0,
        };
      }

      try {
        if (hasGateway) {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (cfg.gatewayToken.trim()) {
            headers.Authorization = `Bearer ${cfg.gatewayToken.trim()}`;
          }
          const resp = await gFetch(`${gatewayBase}/api/wonder/recognize`, {
            method: 'POST',
            signal: req.signal,
            headers,
            body: JSON.stringify({
              boardId: req.boardId,
              regionId: req.regionId,
              revision: req.revision,
              imageDataUrl: req.imageDataUrl,
              cropTransform: req.cropTransform,
              strokeCount: req.strokes.length,
            }),
          });
          if (!resp.ok) {
            return {
              status: 'PROVIDER_UNAVAILABLE',
              recognizedText: '',
              language: 'unknown',
              confidence: 0,
              alternatives: [],
              providerId: 'seed-ai-gateway-vision',
              latencyMs: Date.now() - t0,
              errorCode: `HTTP_${resp.status}`,
            };
          }
          const raw = (await resp.json()) as Record<string, unknown>;
          const valid = validateVisionRecognitionPayload(raw);
          if (!valid) {
            return {
              status: 'AMBIGUOUS',
              recognizedText: '',
              language: 'unknown',
              confidence: 0,
              alternatives: [],
              providerId: 'seed-ai-gateway-vision',
              latencyMs: Date.now() - t0,
            };
          }
          return {
            status: valid.recognitionStatus,
            recognizedText: valid.recognizedText,
            language: valid.language,
            confidence: valid.confidence,
            alternatives: valid.alternatives,
            words: valid.words,
            providerId: String(raw.providerId || 'seed-ai-gateway-vision'),
            latencyMs: Date.now() - t0,
          };
        }

        // DEV-ONLY direct browser call (never recommended for production)
        const isGemini =
          cfg.devDirectProvider === 'gemini' || cleanDevKey.startsWith('AIza');
        const endpoint = isGemini
          ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';
        const model = isGemini ? 'gemini-2.5-flash' : 'gpt-4o-mini';

        const resp = await gFetch(endpoint, {
          method: 'POST',
          signal: req.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cleanDevKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Read Korean/Vietnamese handwriting in this cropped image. Respond JSON only: {"recognizedText":string,"language":"ko"|"vi"|"en"|"mixed"|"unknown","recognitionStatus":"RECOGNIZED"|"AMBIGUOUS"|"NON_TEXT","confidence":number,"alternatives":[],"words":[]}',
                  },
                  { type: 'image_url', image_url: { url: req.imageDataUrl } },
                ],
              },
            ],
          }),
        });
        if (!resp.ok) {
          return {
            status: 'PROVIDER_UNAVAILABLE',
            recognizedText: '',
            language: 'unknown',
            confidence: 0,
            alternatives: [],
            providerId: 'dev-direct-vision',
            latencyMs: Date.now() - t0,
          };
        }
        const json = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json?.choices?.[0]?.message?.content ?? '';
        const match = content.match(/\{[\s\S]*\}/);
        const valid = match ? validateVisionRecognitionPayload(JSON.parse(match[0])) : null;
        if (!valid) {
          return {
            status: 'AMBIGUOUS',
            recognizedText: '',
            language: 'unknown',
            confidence: 0,
            alternatives: [],
            providerId: 'dev-direct-vision',
            latencyMs: Date.now() - t0,
          };
        }
        return {
          status: valid.recognitionStatus,
          recognizedText: valid.recognizedText,
          language: valid.language,
          confidence: valid.confidence,
          alternatives: valid.alternatives,
          words: valid.words,
          providerId: 'dev-direct-vision',
          latencyMs: Date.now() - t0,
        };
      } catch {
        return {
          status: 'PROVIDER_UNAVAILABLE',
          recognizedText: '',
          language: 'unknown',
          confidence: 0,
          alternatives: [],
          providerId: hasGateway ? 'seed-ai-gateway-vision' : 'dev-direct-vision',
          latencyMs: Date.now() - t0,
          errorCode: 'NETWORK_OR_ABORT',
        };
      }
    },
  };
}
