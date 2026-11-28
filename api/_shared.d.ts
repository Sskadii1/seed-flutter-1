export interface UpstreamConfig {
  providerId: string;
  providerKey: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

export function isAllowedUpstreamEndpoint(urlStr: string): boolean;
export function resolveVisionUpstreams(env?: Record<string, string | undefined>): UpstreamConfig[];
export function resolveTextUpstreams(env?: Record<string, string | undefined>): UpstreamConfig[];
export function callOpenAiCompatibleWithFallback(
  upstreams: UpstreamConfig[],
  buildBody: (upstream: UpstreamConfig) => Record<string, unknown>,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal; allowCustomEndpointForTest?: boolean }
): Promise<{
  ok: boolean;
  upstream: UpstreamConfig;
  resp: Response | null;
  failoverCount?: number;
  errors?: Array<{ provider: string; status: number; reason: string }>;
}>;
