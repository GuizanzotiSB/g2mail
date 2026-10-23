import { withAuth, json, err, body, qp } from "@/lib/api";
import { listContacts } from "@/lib/queries";
import { upsertContact, UpsertContactInput } from "@/lib/core";

/** GET /api/contacts?q=&tag=&list=&status=&limit=&offset= */
export const GET = withAuth("read", async (req) => {
  const p = qp(req);
  const r = await listContacts({ q: p.get("q"), tag: p.get("tag"), list: p.get("list"), status: p.get("status"), limit: Number(p.get("limit") ?? 50), offset: Number(p.get("offset") ?? 0) });
  return json({ data: r.rows, total: r.total, limit: r.limit, offset: r.offset });
});

/** POST /api/contacts — cria ou atualiza (por email). Aceita um objeto ou {contacts:[...]} */
export const POST = withAuth("write", async (req, { auth }) => {
  const b = await body<UpsertContactInput | { contacts: UpsertContactInput[] }>(req);
  const items = "contacts" in b ? b.contacts : [b];
  if (!items.length || !items[0]?.email) return err("email é obrigatório");
  const results = [];
  for (const it of items) {
    try { results.push({ ok: true, ...(await upsertContact(it, `api:${auth.name}`)) }); }
    catch (e) { results.push({ ok: false, email: it.email, error: (e as Error).message }); }
  }
  return json(items.length === 1 ? results[0] : { results }, 201);
});
