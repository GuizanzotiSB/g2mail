import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeHubla, normalizeTmb, normalizeGeneric, applyNormalized, WebhookConfig } from "@/lib/webhooks";

type P = { provider: string; secret: string };

/**
 * POST /api/webhooks/{hubla|tmb|generic}/{secret}
 * O segredo é gerado ao criar o webhook em /api/keys (type: webhook) ou direto na tabela inbound_webhooks.
 * Sempre responde 200 (pra plataforma não ficar reenviando) e guarda o log.
 */
export async function POST(req: Request, ctx: { params: Promise<P> }) {
  const { provider, secret } = await ctx.params;
  const { data: wh } = await db().from("inbound_webhooks").select("*").eq("secret", secret).eq("active", true).maybeSingle();
  if (!wh || wh.provider !== provider) return NextResponse.json({ error: "webhook inválido" }, { status: 404 });

  let payload: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) payload = await req.json();
    else if (ct.includes("form")) payload = Object.fromEntries((await req.formData()).entries()) as Record<string, unknown>;
    else { const t = await req.text(); payload = t ? JSON.parse(t) : {}; }
  } catch { payload = {}; }

  const norm = provider === "hubla" ? normalizeHubla(payload) : provider === "tmb" ? normalizeTmb(payload) : normalizeGeneric(payload);
  let result: unknown; let ok = false;
  try {
    if (!norm) { result = { skipped: "sem email no payload" }; ok = true; }
    else { result = await applyNormalized(norm, (wh.config ?? {}) as WebhookConfig, `webhook:${wh.name}`); ok = true; }
  } catch (e) { result = { error: (e as Error).message }; }

  await db().from("webhook_logs").insert({ webhook_id: wh.id, provider, payload, result, ok });
  return NextResponse.json({ ok, result }, { status: 200 });
}

export async function GET(_req: Request, ctx: { params: Promise<P> }) {
  const { provider, secret } = await ctx.params;
  const { data: wh } = await db().from("inbound_webhooks").select("id,name").eq("secret", secret).eq("active", true).maybeSingle();
  return NextResponse.json(wh ? { ok: true, provider, name: wh.name } : { error: "webhook inválido" }, { status: wh ? 200 : 404 });
}
