import { randomBytes } from "crypto";
import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import { generateApiKey, sha256 } from "@/lib/auth";
import { env } from "@/lib/env";

/** GET /api/keys — chaves de API e webhooks de entrada (sem segredos completos) */
export const GET = withAuth("admin", async () => {
  const [{ data: keys }, { data: hooks }] = await Promise.all([
    db().from("api_keys").select("id,name,key_prefix,scopes,last_used_at,created_at,revoked_at").order("created_at", { ascending: false }),
    db().from("inbound_webhooks").select("id,name,provider,secret,config,active,created_at").order("created_at", { ascending: false }),
  ]);
  const base = env.appUrl();
  return json({
    keys,
    webhooks: (hooks ?? []).map((h) => ({ ...h, url: `${base}/api/webhooks/${h.provider}/${h.secret}` })),
  });
});

/**
 * POST /api/keys
 *  {type:"api_key", name, scopes?:["read","write"]}  → devolve a chave UMA vez
 *  {type:"webhook", name, provider:"hubla"|"tmb"|"generic", config?:{product_tags:{...}, default_tag, lists:[...]}}
 */
export const POST = withAuth("admin", async (req) => {
  const b = await body<{ type: "api_key" | "webhook"; name: string; scopes?: string[]; provider?: string; config?: Record<string, unknown> }>(req);
  if (!b.name) return err("name é obrigatório");
  if (b.type === "webhook") {
    if (!["hubla", "tmb", "generic"].includes(b.provider ?? "")) return err("provider deve ser hubla, tmb ou generic");
    const secret = randomBytes(18).toString("base64url");
    const { data, error } = await db().from("inbound_webhooks").insert({ name: b.name, provider: b.provider, secret, config: b.config ?? {} }).select("*").single();
    if (error) return err(error.message, 500);
    return json({ ...data, url: `${env.appUrl()}/api/webhooks/${b.provider}/${secret}` }, 201);
  }
  const key = generateApiKey();
  const { data, error } = await db().from("api_keys").insert({ name: b.name, key_hash: sha256(key), key_prefix: key.slice(0, 12), scopes: b.scopes ?? ["read", "write"] }).select("id,name,scopes").single();
  if (error) return err(error.message, 500);
  return json({ ...data, key, warning: "Guarde a chave: ela não será mostrada de novo." }, 201);
});

/** DELETE /api/keys {id} (api key) ou {webhook_id} */
export const DELETE = withAuth("admin", async (req) => {
  const b = await body<{ id?: string; webhook_id?: string }>(req);
  if (b.id) await db().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", b.id);
  if (b.webhook_id) await db().from("inbound_webhooks").update({ active: false }).eq("id", b.webhook_id);
  return json({ ok: true });
});
