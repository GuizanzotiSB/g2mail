import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";

type P = { id: string };

export const GET = withAuth<P>("read", async (_req, { params }) => {
  const { data } = await db().from("email_templates").select("*").eq("id", params.id).maybeSingle();
  return data ? json(data) : err("Template não encontrado", 404);
});

export const PATCH = withAuth<P>("write", async (req, { params }) => {
  const b = await body<Record<string, unknown>>(req);
  const allowed = ["name", "subject", "body_html", "body_text", "from_name", "from_email"];
  const patch = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  const { data, error } = await db().from("email_templates").update(patch).eq("id", params.id).select("*").single();
  if (error) return err(error.message, 500);
  return json(data);
});

export const DELETE = withAuth<P>("write", async (_req, { params }) => {
  const { error } = await db().from("email_templates").delete().eq("id", params.id);
  if (error) return err(error.message, 500);
  return json({ ok: true });
});
