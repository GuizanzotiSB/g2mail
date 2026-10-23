import { withAuth, json, err, body } from "@/lib/api";
import { getContact, addToList, removeFromList, contactLists } from "@/lib/core";

type P = { id: string };

/** POST /api/contacts/:id/lists {lists:["alunos-mvs"]} */
export const POST = withAuth<P>("write", async (req, { params, auth }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  const b = await body<{ list?: string; lists?: string[] }>(req);
  const lists = b.lists ?? (b.list ? [b.list] : []);
  if (!lists.length) return err("informe list ou lists");
  const added: string[] = [];
  for (const l of lists) if (await addToList(c.id, l, `api:${auth.name}`)) added.push(l);
  return json({ ok: true, added, lists: await contactLists(c.id) });
});

/** DELETE /api/contacts/:id/lists {lists:[...]} */
export const DELETE = withAuth<P>("write", async (req, { params, auth }) => {
  const c = await getContact(decodeURIComponent(params.id));
  if (!c) return err("Contato não encontrado", 404);
  const b = await body<{ list?: string; lists?: string[] }>(req);
  const lists = b.lists ?? (b.list ? [b.list] : []);
  const removed: string[] = [];
  for (const l of lists) if (await removeFromList(c.id, l, `api:${auth.name}`)) removed.push(l);
  return json({ ok: true, removed, lists: await contactLists(c.id) });
});
