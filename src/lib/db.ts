import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

function make() {
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    db: { schema: "g2mail" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export type Db = ReturnType<typeof make>;
let client: Db | null = null;

/** Cliente Supabase (service role) apontando pro schema g2mail. Só usar no servidor. */
export function db(): Db {
  if (!client) client = make();
  return client;
}

export type Contact = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  phone_norm: string | null;
  status: "active" | "unsubscribed" | "bounced" | "blocklisted";
  attributes: Record<string, unknown>;
  listmonk_id: number | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type Tag = { id: string; name: string; slug: string; color: string | null; description: string | null };
export type List = { id: string; name: string; slug: string; description: string | null; listmonk_id: number | null };
export type EmailTemplate = {
  id: string; name: string; subject: string; body_html: string; body_text: string | null;
  from_name: string | null; from_email: string | null; listmonk_tpl_id: number | null;
};

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = "55" + d; // BR sem DDI
  return d;
}
