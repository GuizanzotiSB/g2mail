import { db, slugify } from "./db";

export type ContactRow = { id: string; email: string; name: string | null; phone_norm: string | null; status: string; attributes?: Record<string, unknown>; source?: string | null; created_at: string; contact_tags?: { tags: { slug: string } }[]; list_members?: { lists: { slug: string } }[] };
export type ContactFilters = { q?: string | null; tag?: string | null; list?: string | null; status?: string | null; limit?: number; offset?: number; fields?: string };

/**
 * Lista contatos com filtros. Quando filtra por tag/lista usa embed !inner (senão o PostgREST
 * só filtra as linhas embutidas e devolve todos os contatos).
 */
export async function listContacts(f: ContactFilters) {
  const limit = Math.min(f.limit ?? 50, 500);
  const offset = f.offset ?? 0;
  const tagEmbed = f.tag ? "contact_tags!inner(tags!inner(slug))" : "contact_tags(tags(slug))";
  const listEmbed = f.list ? "list_members!inner(lists!inner(slug))" : "list_members(lists(slug))";
  const fields = f.fields ?? "id,email,name,phone_norm,status,attributes,source,created_at";
  let q = db().from("contacts").select(`${fields}, ${tagEmbed}, ${listEmbed}`, { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (f.q) { const s = f.q.replace(/[,()]/g, " "); q = q.or(`email.ilike.%${s}%,name.ilike.%${s}%,phone_norm.ilike.%${s}%`); }
  if (f.status) q = q.eq("status", f.status);
  if (f.tag) q = q.eq("contact_tags.tags.slug", slugify(f.tag));
  if (f.list) { q = q.eq("list_members.lists.slug", slugify(f.list)); q = q.eq("list_members.status", "confirmed"); }
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as ContactRow[]).map((c) => ({
    ...c,
    tags: (c.contact_tags ?? []).map((x) => x.tags?.slug).filter(Boolean),
    lists: (c.list_members ?? []).map((x) => x.lists?.slug).filter(Boolean),
    contact_tags: undefined, list_members: undefined,
  }));
  return { rows, total: count ?? 0, limit, offset };
}
