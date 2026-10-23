import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import { getContact, contactTags, contactLists, unsubscribeContact, syncContactToListmonk } from "@/lib/core";

type P = { id: string };

/** GET /api/contacts/:idOrEmail — contato + tags + listas + últimos eventos + automações */
export const GET = withAuth<P>("read", async (_req, { params }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  const [tags, lists, events, runs, sends] = await Promise.all([
    contactTags(c.id),
    contactLists(c.id),
    db().from("events").select("*").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(50).then((r) => r.data ?? []),
    db().from("automation_runs").select("id,status,current_step,next_run_at,started_at,finished_at,automations(name)").eq("contact_id", c.id).order("started_at", { ascending: false }).limit(20).then((r) => r.data ?? []),
    db().from("email_sends").select("id,subject,status,sent_at,opened_at,clicked_at").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(20).then((r) => r.data ?? []),
  ]);
  return json({ ...c, tags, lists, events, automations: runs, emails: sends });
});

/** PATCH /api/contacts/:id — name, phone, attributes (merge), status */
export const PATCH = withAuth<P>("write", async (req, { params }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  const b = await body<{ name?: string; phone?: string; attributes?: Record<string, unknown>; status?: string }>(req);
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.phone !== undefined) patch.phone = b.phone;
  if (b.attributes) patch.attributes = { ...c.attributes, ...b.attributes };
  if (b.status) patch.status = b.status;
  const { data, error } = await db().from("contacts").update(patch).eq("id", c.id).select("*").single();
  if (error) return err(error.message, 500);
  await syncContactToListmonk(c.id).catch(() => {});
  return json(data);
});

/** DELETE /api/contacts/:id — descadastra (não apaga; ?hard=1 apaga de verdade) */
export const DELETE = withAuth<P>("write", async (req, { params }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  if (new URL(req.url).searchParams.get("hard") === "1") {
    await db().from("contacts").delete().eq("id", c.id);
    return json({ ok: true, deleted: true });
  }
  await unsubscribeContact(c.id);
  return json({ ok: true, unsubscribed: true });
});
