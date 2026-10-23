import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import { env } from "./env";

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function generateApiKey(): string {
  return "g2m_" + randomBytes(24).toString("base64url");
}

export type AuthResult = { ok: true; keyId: string | null; name: string; scopes: string[] } | { ok: false; status: number; error: string };

/** Autentica por `Authorization: Bearer <key>` ou `x-api-key`. Aceita a MASTER_API_KEY do .env ou chaves da tabela api_keys. */
export async function authenticate(req: Request): Promise<AuthResult> {
  const h = req.headers.get("authorization") ?? "";
  const key = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : req.headers.get("x-api-key")?.trim() ?? "";
  if (!key) return { ok: false, status: 401, error: "Chave de API ausente (Authorization: Bearer ...)" };

  const master = env.masterApiKey();
  if (master && key === master) return { ok: true, keyId: null, name: "master", scopes: ["read", "write", "admin"] };

  const { data } = await db().from("api_keys").select("id,name,scopes,revoked_at").eq("key_hash", sha256(key)).maybeSingle();
  if (!data || data.revoked_at) return { ok: false, status: 401, error: "Chave de API inválida" };
  void db().from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { ok: true, keyId: data.id, name: data.name, scopes: data.scopes };
}

export function requireScope(auth: AuthResult, scope: string): AuthResult {
  if (!auth.ok) return auth;
  if (!auth.scopes.includes(scope) && !auth.scopes.includes("admin")) return { ok: false, status: 403, error: `Sem permissão: ${scope}` };
  return auth;
}
