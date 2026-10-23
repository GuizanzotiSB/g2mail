import { withAuth, json, err, body, qp } from "@/lib/api";
import { db } from "@/lib/db";
import { getContact, upsertContact, recordEvent } from "@/lib/core";

/** GET /api/events?type=&contact=&limit= */
export const GET = withAuth("read", async (req) => {
  const p = qp(req);
  let q = db().from("events").select("*, contacts(email,name)").order("created_at", { ascending: false }).limit(Math.min(Number(p.get("limit") ?? 100), 1000));
  if (p.get("type")) q = q.eq("type", p.get("type"));
  if (p.get("contact")) { const c = await getContact(p.get("contact")!); if (c) q = q.eq("contact_id", c.id); }
  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return json({ data });
});

/** POST /api/events {email, type, data?} — registra evento custom (ex.: "purchase", "webinar.attended") e dispara automações */
export const POST = withAuth("write", async (req, { auth }) => {
  const b = await body<{ email: string; type: string; data?: Record<string, unknown>; name?: string; phone?: string }>(req);
  if (!b.email || !b.type) return err("email e type são obrigatórios");
  const { contact } = await upsertContact({ email: b.email, name: b.name, phone: b.phone }, `api:${auth.name}`);
  await recordEvent(contact.id, b.type, b.data ?? {}, `api:${auth.name}`);
  return json({ ok: true, contact_id: contact.id }, 201);
});
