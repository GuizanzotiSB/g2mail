import { withAuth, json, err, body } from "@/lib/api";
import { getContact, addTag, removeTag, contactTags } from "@/lib/core";

type P = { id: string };

/** POST /api/contacts/:id/tags {tags:["comprou-mvs"]} ou {tag:"x"} */
export const POST = withAuth<P>("write", async (req, { params, auth }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  const b = await body<{ tag?: string; tags?: string[] }>(req);
  const tags = b.tags ?? (b.tag ? [b.tag] : []);
  if (!tags.length) return err("informe tag ou tags");
  const added: string[] = [];
  for (const t of tags) if (await addTag(c.id, t, `api:${auth.name}`)) added.push(t);
  return json({ ok: true, added, tags: await contactTags(c.id) });
});

/** DELETE /api/contacts/:id/tags {tags:[...]} */
export const DELETE = withAuth<P>("write", async (req, { params, auth }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  const b = await body<{ tag?: string; tags?: string[] }>(req);
  const tags = b.tags ?? (b.tag ? [b.tag] : []);
  const removed: string[] = [];
  for (const t of tags) if (await removeTag(c.id, t, `api:${auth.name}`)) removed.push(t);
  return json({ ok: true, removed, tags: await contactTags(c.id) });
});
