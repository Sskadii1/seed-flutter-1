import {
  WonderBBox,
  WonderConversationMemoryTurn,
  WonderCropTransform,
  WonderSpatialTeachingAction,
  WonderSpatialTeachingActionSchema,
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
  /** Explicit DEV-ONLY session-memory key if no production gatewayUrl is set (never persisted to localStorage here) */
  devDirectApiKey?: string;
  devDirectProvider?: 'gemini' | 'openai' | 'deepseek' | 'auto';
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

export interface ObservationWindowSnapshotResult {
  imageDataUrl: string;
  cropTransform: WonderCropTransform;
  estimatedVisionTokens: number;
}

/**
 * Adaptive Ink Snapshot Exporter (adapted from MaximeRivest/riddle `src/ink.rs` `to_png`).
 * - Exports ONLY clean Layer 2 user ink (black ink on #FFFFFF), strictly excluding AI clouds,
 *   arrows, chalk dust, and #F5EFE6 UI chrome.
 * - Uses zoom-independent world coordinates so 25% zoom giant ink stays crisp and unclipped.
 * - Caps long dimension at 1024px (1280px for multi-word wide lines) to keep vision tokens bounded.
 */
export function renderObservationWindowSnapshot(
  regionStrokes: WonderStroke[],
  bbox: WonderBBox,
  options?: { paddingPx?: number; maxDimensionPx?: number }
): ObservationWindowSnapshotResult | null {
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
          arc(x: number, y: number, r: number, s: number, e: number): void;
          fill(): void;
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

  const pad =
    typeof options?.paddingPx === 'number'
      ? Math.max(options.paddingPx, Math.round(Math.min(bbox.width, bbox.height) * 0.12))
      : Math.max(24, Math.round(Math.min(bbox.width, bbox.height) * 0.14));

  const worldMinX = bbox.minX - pad;
  const worldMinY = bbox.minY - pad;
  const worldWidth = Math.max(48, bbox.width + pad * 2);
  const worldHeight = Math.max(48, bbox.height + pad * 2);
  const isWideSentence = bbox.width > bbox.height * 2.2 || bbox.width > 700;
  const maxDim = options?.maxDimensionPx ?? (isWideSentence ? 1280 : 1024);

  const scale = Math.min(2.4, maxDim / Math.max(worldWidth, worldHeight));
  const pixelWidth = Math.max(96, Math.min(maxDim, Math.round(worldWidth * scale)));
  const pixelHeight = Math.max(96, Math.min(maxDim, Math.round(worldHeight * scale)));

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
  ctx.fillStyle = '#111111';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const adaptiveInkFloor = Math.max(3.6, Math.max(worldWidth, worldHeight) * 0.006);

  for (const st of userOnly) {
    if (st.tool === 'eraser_pixel') continue;
    const lw = Math.max(adaptiveInkFloor, st.width);
    ctx.lineWidth = lw;
    const pts = st.points;
    if (
      pts.length === 1 ||
      (pts.length === 2 && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 3)
    ) {
      const px = pts[0].x + st.transform.dx;
      const py = pts[0].y + st.transform.dy;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2.6, lw * 0.65), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
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

  // Tile-based estimate matching OpenAI/Gemini multimodal vision billing buckets
  const tiles = Math.ceil(pixelWidth / 512) * Math.ceil(pixelHeight / 512);
  const estimatedVisionTokens = 85 + tiles * 170;

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
    estimatedVisionTokens,
  };
}

/** Backward-compatible alias used across Wonder Board recognition & diagnostics. */
export function renderRegionInkCropDataUrl(
  regionStrokes: WonderStroke[],
  bbox: WonderBBox,
  paddingPx?: number
): { imageDataUrl: string; cropTransform: WonderCropTransform } | null {
  const snap = renderObservationWindowSnapshot(regionStrokes, bbox, { paddingPx });
  return snap ? { imageDataUrl: snap.imageDataUrl, cropTransform: snap.cropTransform } : null;
}

export interface WonderServerTutorAction {
  actionId?: string;
  type:
    | 'WAIT'
    | 'EXPLAIN_CHARACTER'
    | 'EXPLAIN_WORD'
    | 'MARK_GRAMMAR_ERROR'
    | 'PROVIDE_HINT'
    | 'WRITE_CORRECTION'
    | 'WRITE_EXPLANATION'
    | 'CREATE_EXAMPLE'
    | 'CREATE_TRACE_GUIDE'
    | 'DRAW_CLOUD'
    | 'DRAW_ARROW'
    | 'PRAISE'
    | 'RETRACT_ANNOTATION'
    | 'WRITE_EXAMPLE'
    | 'DRAW_CHECKMARK';
  regionId: string;
  sourceRevision?: number;
  targetText: string;
  semanticTarget?: 'character' | 'syllable' | 'word' | 'phrase' | 'sentence' | 'region';
  suggestedCorrection: string;
  explanation: string;
  hint: string;
  confidence?: number;
  anchorHint?: 'below' | 'above' | 'right' | 'left';
}

/**
 * Browser SSE ReadableStream parser adapted from farhan-beg/riddle-web `src/index.html` (lines 734-758).
 * - Reads ONLY `choices[0].delta.content` (explicitly ignores reasoning/thinking fields).
 * - Buffers chunks until newline, validates each complete action against Zod schema, and drops partial JSON.
 */
export async function parseSseActionStream(
  body: ReadableStream<Uint8Array>,
  options?: {
    expectedRevision?: number;
    signal?: AbortSignal;
    onAction?: (action: WonderSpatialTeachingAction, providerId: string) => void;
  }
): Promise<{ actions: WonderSpatialTeachingAction[]; providerId: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let contentBuffer = '';
  let providerId = 'seed-stream-tutor';
  const actions: WonderSpatialTeachingAction[] = [];

  const flushContentLines = () => {
    const lines = contentBuffer.split('\n');
    contentBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
      try {
        const obj = JSON.parse(trimmed) as { action?: unknown; providerId?: string };
        if (typeof obj.providerId === 'string') providerId = obj.providerId;
        const parsed = WonderSpatialTeachingActionSchema.safeParse(obj.action ?? obj);
        if (!parsed.success) continue;
        if (
          typeof options?.expectedRevision === 'number' &&
          parsed.data.sourceRevision > 0 &&
          parsed.data.sourceRevision !== options.expectedRevision
        ) {
          continue; // Drop stale-revision streamed action
        }
        actions.push(parsed.data);
        options?.onAction?.(parsed.data, providerId);
      } catch {
        // Incomplete or non-JSON line; wait cleanly
      }
    }
  };

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split(/\r?\n/);
      sseBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        if (!rawLine.startsWith('data:')) continue;
        const payload = rawLine.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
            action?: unknown;
            providerId?: string;
          };
          if (typeof evt.providerId === 'string') providerId = evt.providerId;
          const deltaContent = evt?.choices?.[0]?.delta?.content;
          if (typeof deltaContent === 'string') {
            contentBuffer += deltaContent;
            flushContentLines();
          } else if (evt.action) {
            contentBuffer += JSON.stringify({ action: evt.action, providerId }) + '\n';
            flushContentLines();
          }
        } catch {
          // Ignore malformed keepalive chunks
        }
      }
    }
    if (contentBuffer.trim()) {
      contentBuffer += '\n';
      flushContentLines();
    }
  } finally {
    reader.releaseLock();
  }

  return { actions, providerId };
}

export async function requestWonderServerTutor(params: {
  regions: Array<{
    regionId: string;
    recognizedText: string;
    language: string;
    contentType?: string;
  }>;
  guidanceLevel: string;
  targetLanguage?: 'auto' | 'ko' | 'en';
  intent?: 'ambient' | 'explain' | 'translate' | 'grammar_check' | 'practice_exercise';
  revision?: number;
  conversationMemory?: WonderConversationMemoryTurn[];
  stream?: boolean;
  onStreamAction?: (action: WonderSpatialTeachingAction, providerId: string) => void;
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
        regions: params.regions.slice(0, 12),
        guidanceLevel: params.guidanceLevel,
        targetLanguage: params.targetLanguage ?? 'auto',
        intent: params.intent ?? 'ambient',
        revision: params.revision ?? 0,
        conversationMemory: (params.conversationMemory ?? []).slice(-6),
        stream: Boolean(params.stream),
      }),
    });
    const ct = resp.headers?.get?.('content-type') || '';
    if (!resp.ok) {
      return { actions: [], providerId: `unavailable_${resp.status}` };
    }
    if (ct.includes('text/event-stream') && resp.body) {
      const streamed = await parseSseActionStream(resp.body, {
        expectedRevision: params.revision,
        signal: params.signal,
        onAction: params.onStreamAction,
      });
      return {
        actions: streamed.actions as WonderServerTutorAction[],
        providerId: streamed.providerId,
      };
    }
    if (!ct.includes('application/json')) {
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
  // DeepSeek deepseek-flash supports multimodal Vision via https://api.deepseek.com/chat/completions
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
            rawTranscription: valid.raw_transcription ?? valid.rawTranscription ?? valid.recognizedText,
            normalizedCandidate: valid.normalizedCandidate,
            uncertainty: valid.estimated_uncertainty ?? valid.uncertainty,
            completenessEvidence: valid.completenessEvidence,
            revision: valid.revision,
            contentType: valid.content_type,
            completenessStatus: valid.completeness_status,
            detectedLanguages: valid.detected_languages,
            handwritingQualityObservations: valid.handwriting_quality_observations,
            language: valid.language,
            confidence: valid.confidence,
            alternatives:
              valid.alternative_candidates.length > 0
                ? valid.alternative_candidates
                : valid.alternatives,
            words: valid.words,
            providerId: String(raw.providerId || 'seed-ai-gateway-vision'),
            latencyMs: Date.now() - t0,
          };
        }

        // DEV-ONLY direct browser call (session memory only, never persisted to localStorage)
        const isGemini =
          cfg.devDirectProvider === 'gemini' || cleanDevKey.startsWith('AIza');
        const isDeepSeek =
          cfg.devDirectProvider === 'deepseek' || (!isGemini && cleanDevKey.startsWith('sk-'));
        const endpoint = isGemini
          ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
          : isDeepSeek
            ? 'https://api.deepseek.com/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
        const model = isGemini ? 'gemini-2.5-flash' : isDeepSeek ? 'deepseek-flash' : 'gpt-4o-mini';

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
            ...(isDeepSeek ? { thinking: { type: 'disabled' } } : {}),
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Read Korean/English/Vietnamese handwriting verbatim (preserve errors & punctuation ".", "?", "!"). Respond JSON only: {"recognizedText":string,"raw_transcription":string,"normalizedCandidate":string,"estimated_uncertainty":number,"completenessEvidence":string,"language":"ko"|"vi"|"en"|"mixed"|"unknown","recognitionStatus":"RECOGNIZED"|"PARTIALLY_RECOGNIZED"|"IN_PROGRESS"|"AMBIGUOUS"|"NON_TEXT","content_type":"single_character"|"hangul_syllable"|"word"|"phrase"|"sentence"|"paragraph"|"user_question"|"free_drawing"|"mixed_content"|"unknown","completeness_status":"complete"|"in_progress"|"fragment"|"non_text"|"unknown","confidence":number,"alternatives":[],"words":[]}',
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
          rawTranscription: valid.raw_transcription ?? valid.rawTranscription ?? valid.recognizedText,
          normalizedCandidate: valid.normalizedCandidate,
          uncertainty: valid.estimated_uncertainty ?? valid.uncertainty,
          completenessEvidence: valid.completenessEvidence,
          revision: valid.revision,
          contentType: valid.content_type,
          completenessStatus: valid.completeness_status,
          detectedLanguages: valid.detected_languages,
          handwritingQualityObservations: valid.handwriting_quality_observations,
          language: valid.language,
          confidence: valid.confidence,
          alternatives: valid.alternatives,
          words: valid.words,
          providerId: isGemini
            ? 'dev-direct-gemini-vision'
            : isDeepSeek
              ? 'dev-direct-deepseek-vision'
              : 'dev-direct-openai-vision',
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

export interface WonderMultimodalClient {
  recognizeImage(req: ProviderRecognitionRequest): Promise<ProviderRecognitionResult>;
  recognizeWithContext(
    req: ProviderRecognitionRequest,
    recentMemory: WonderConversationMemoryTurn[]
  ): Promise<ProviderRecognitionResult>;
  analyzeRecognizedText(
    params: Parameters<typeof requestWonderServerTutor>[0]
  ): Promise<{ actions: WonderServerTutorAction[]; providerId: string }>;
  streamTeachingActions(
    params: Parameters<typeof requestWonderServerTutor>[0],
    onAction: (action: WonderSpatialTeachingAction, providerId: string) => void
  ): Promise<{ actions: WonderServerTutorAction[]; providerId: string }>;
  cancelRequest(key?: string): void;
}

/**
 * Unified Multimodal Provider Interface cleanly decoupling Vision OCR, Contextual Tutor,
 * SSE Streaming Actions, and AbortController cancellation from canvas UI state.
 */
export function createWonderMultimodalClient(cfg: BrowserVisionConfig): WonderMultimodalClient {
  const inflight = new Map<string, AbortController>();
  const vision = createBrowserVisionProvider(cfg);

  const trackSignal = (key: string, externalSignal?: AbortSignal): AbortSignal | undefined => {
    inflight.get(key)?.abort();
    if (typeof AbortController !== 'function') return externalSignal;
    const ac = new AbortController();
    inflight.set(key, ac);
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort();
      else externalSignal.addEventListener('abort', () => ac.abort(), { once: true });
    }
    return ac.signal;
  };

  return {
    async recognizeImage(req) {
      if (!vision) {
        return {
          status: 'PROVIDER_UNAVAILABLE',
          recognizedText: '',
          language: 'unknown',
          confidence: 0,
          alternatives: [],
          providerId: 'unconfigured',
          latencyMs: 0,
          errorCode: 'NO_VISION_PROVIDER',
        };
      }
      const sig = trackSignal(`rec:${req.regionId}`, req.signal);
      return vision.recognizeRegion({ ...req, signal: sig });
    },
    async recognizeWithContext(req) {
      return this.recognizeImage(req);
    },
    async analyzeRecognizedText(params) {
      const sig = trackSignal('tutor', params.signal);
      return requestWonderServerTutor({ ...params, signal: sig, stream: false });
    },
    async streamTeachingActions(params, onAction) {
      const sig = trackSignal('tutor', params.signal);
      return requestWonderServerTutor({
        ...params,
        signal: sig,
        stream: true,
        onStreamAction: onAction,
      });
    },
    cancelRequest(key) {
      if (key) {
        inflight.get(key)?.abort();
        inflight.delete(key);
        return;
      }
      for (const ac of inflight.values()) ac.abort();
      inflight.clear();
    },
  };
}
