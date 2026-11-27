import { corsHeaders, jsonResponse } from '../_shared.mjs';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const deepseek = Boolean((process.env.DEEPSEEK_API_KEY ?? '').trim());
  const gemini = Boolean((process.env.GEMINI_API_KEY ?? '').trim());
  const openai = Boolean((process.env.OPENAI_API_KEY ?? '').trim());

  return jsonResponse({
    ok: true,
    providers: { deepseek, gemini, openai },
    tutorReady: deepseek || gemini || openai,
    visionReady: gemini || openai,
    authRequired: Boolean((process.env.SEED_GATEWAY_TOKEN ?? '').trim()),
  });
}
