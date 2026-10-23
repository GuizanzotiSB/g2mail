import { db, slugify, normalizePhone, Contact, Tag, List } from "./db";
import { listmonk } from "./listmonk";
import { enrollForEvent } from "./automation/engine";

/* =========================================================
 * EVENTOS
 * ======================================================= */
export async function recordEvent(contactId: string | null, type: string, data: Record<string, unknown> = {}, source?: string) {
  await db().from("events").insert({ contact_id: contactId, type, data, source: source ?? null });
  if (contactId) {
    await db().from("contacts").update({ last_event_at: new Date().toISOString() }).eq("id", contactId);
    // dispara automações cujo gatilho casa com esse evento (não bloqueia em erro)
    try { await enrollForEvent(contactId, type, data); } catch (e) { console.error("enrollForEvent", e); }
  }
}

/* =========================================================
 * CONTATOS
 * ======================================================= */
export type UpsertContactInput = {
  email: string;
  name?: string | null;
  phone?: string | null;
  attributes?: Record<string, unknown>;
  source?: string;
  tags?: string[];     // slugs ou nomes — cria se não existir
  lists?: string[];    // slugs ou nomes — cria se não existir
};

export async function upsertContact(input: UpsertContactInput, by = "api"): Promise<{ contact: Contact; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Email inválido: ${input.email}`);

  const { data: existing } = await db().from("contacts").select("*").eq("email_norm", email).maybeSingle();
  let contact: Contact;
  let created = false;

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (input.name && input.name !== existing.name) patch.name = input.name;
    if (input.phone) { patch.phone = input.phone; patch.phone_norm = normalizePhone(input.phone); }
    if (input.attributes && Object.keys(input.attributes).length) patch.attributes = { ...existing.attributes, ...input.attributes };
    if (Object.keys(patch).length) {
      const { data, error } = await db().from("contacts").update(patch).eq("id", existing.id).select("*").single();
      if (error) throw error;
      contact = data;
    } else contact = existing;
  } else {
    const { data, error } = await db().from("contacts").insert({
      email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      phone_norm: normalizePhone(input.phone),
      attributes: input.attributes ?? {},
      source: input.source ?? by,
    }).select("*").single();
    if (error) throw error;
    contact = data;
    created = true;
    await recordEvent(contact.id, "contact.created", { source: contact.source }, by);
  }

  for (const t of input.tags ?? []) await addTag(contact.id, t, by);
  for (const l of input.lists ?? []) await addToList(contact.id, l, by);

  await syncContactToListmonk(contact.id).catch((e) => console.error("listmonk sync", e.message));
  return { contact, created };
}

export async function getContact(idOrEmail: string): Promise<Contact | null> {
  const q = db().from("contacts").select("*");
  const { data } = idOrEmail.includes("@") ? await q.eq("email_norm", idOrEmail.trim().toLowerCase()).maybeSingle() : await q.eq("id", idOrEmail).maybeSingle();
  return data;
}

export async function contactTags(contactId: string): Promise<Tag[]> {
  const { data } = await db().from("contact_tags").select("tags(*)").eq("contact_id", contactId);
  return (data ?? []).map((r) => r.tags as unknown as Tag).filter(Boolean);
}

export async function contactLists(contactId: string): Promise<List[]> {
  const { data } = await db().from("list_members").select("lists(*)").eq("contact_id", contactId).eq("status", "confirmed");
  return (data ?? []).map((r) => r.lists as unknown as List).filter(Boolean);
}

export async function unsubscribeContact(contactId: string, by = "api") {
  await db().from("contacts").update({ status: "unsubscribed" }).eq("id", contactId);
  await db().from("list_members").update({ status: "unsubscribed" }).eq("contact_id", contactId);
  await db().from("automation_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("contact_id", contactId).in("status", ["running", "waiting"]);
  await recordEvent(contactId, "contact.unsubscribed", {}, by);
  const c = await getContact(contactId);
  if (c?.listmonk_id && listmonk.enabled()) await listmonk.blocklist([c.listmonk_id]).catch(() => {});
}

/* =========================================================
 * TAGS
 * ======================================================= */
export async function ensureTag(nameOrSlug: string): Promise<Tag> {
  const slug = slugify(nameOrSlug);
  const { data } = await db().from("tags").select("*").eq("slug", slug).maybeSingle();
  if (data) return data;
  const { data: created, error } = await db().from("tags").insert({ name: nameOrSlug.trim(), slug }).select("*").single();
  if (error) {
    // corrida: outro processo criou
    const { data: again } = await db().from("tags").select("*").eq("slug", slug).single();
    return again;
  }
  return created;
}

export async function addTag(contactId: string, tag: string, by = "api"): Promise<boolean> {
  const t = await ensureTag(tag);
  const { data: has } = await db().from("contact_tags").select("tag_id").eq("contact_id", contactId).eq("tag_id", t.id).maybeSingle();
  if (has) return false;
  await db().from("contact_tags").insert({ contact_id: contactId, tag_id: t.id, added_by: by });
  await recordEvent(contactId, "tag.added", { tag: t.slug, tag_name: t.name }, by);
  void syncContactToListmonk(contactId).catch(() => {});
  return true;
}

export async function removeTag(contactId: string, tag: string, by = "api"): Promise<boolean> {
  const slug = slugify(tag);
  const { data: t } = await db().from("tags").select("*").eq("slug", slug).maybeSingle();
  if (!t) return false;
  const { data } = await db().from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", t.id).select("tag_id");
  if (!data?.length) return false;
  await recordEvent(contactId, "tag.removed", { tag: t.slug, tag_name: t.name }, by);
  void syncContactToListmonk(contactId).catch(() => {});
  return true;
}

export async function hasTag(contactId: string, tag: string): Promise<boolean> {
  const { data } = await db().from("contact_tags").select("tags!inner(slug)").eq("contact_id", contactId).eq("tags.slug", slugify(tag)).maybeSingle();
  return !!data;
}

/* =========================================================
 * LISTAS
 * ======================================================= */
export async function ensureList(nameOrSlug: string): Promise<List> {
  const slug = slugify(nameOrSlug);
  const { data } = await db().from("lists").select("*").eq("slug", slug).maybeSingle();
  if (data) return data;
  let listmonk_id: number | null = null;
  if (listmonk.enabled()) {
    try {
      const all = await listmonk.lists();
      const found = all.find((l) => slugify(l.name) === slug);
      listmonk_id = found ? found.id : (await listmonk.createList(nameOrSlug.trim())).id;
    } catch (e) { console.error("listmonk ensureList", (e as Error).message); }
  }
  const { data: created, error } = await db().from("lists").insert({ name: nameOrSlug.trim(), slug, listmonk_id }).select("*").single();
  if (error) {
    const { data: again } = await db().from("lists").select("*").eq("slug", slug).single();
    return again;
  }
  return created;
}

export async function addToList(contactId: string, list: string, by = "api"): Promise<boolean> {
  const l = await ensureList(list);
  const { data: has } = await db().from("list_members").select("status").eq("contact_id", contactId).eq("list_id", l.id).maybeSingle();
  if (has?.status === "confirmed") return false;
  await db().from("list_members").upsert({ list_id: l.id, contact_id: contactId, status: "confirmed" });
  await recordEvent(contactId, "list.added", { list: l.slug, list_name: l.name }, by);
  void syncContactToListmonk(contactId).catch(() => {});
  return true;
}

export async function removeFromList(contactId: string, list: string, by = "api"): Promise<boolean> {
  const { data: l } = await db().from("lists").select("*").eq("slug", slugify(list)).maybeSingle();
  if (!l) return false;
  const { data } = await db().from("list_members").delete().eq("contact_id", contactId).eq("list_id", l.id).select("list_id");
  if (!data?.length) return false;
  await recordEvent(contactId, "list.removed", { list: l.slug, list_name: l.name }, by);
  void syncContactToListmonk(contactId).catch(() => {});
  return true;
}

export async function inList(contactId: string, list: string): Promise<boolean> {
  const { data } = await db().from("list_members").select("lists!inner(slug)").eq("contact_id", contactId).eq("status", "confirmed").eq("lists.slug", slugify(list)).maybeSingle();
  return !!data;
}

/* =========================================================
 * SYNC → LISTMONK (espelha contato, listas e tags como atributos)
 * ======================================================= */
export async function syncContactToListmonk(contactId: string) {
  if (!listmonk.enabled()) return;
  const c = await getContact(contactId);
  if (!c) return;
  const [tags, lists] = await Promise.all([contactTags(c.id), contactLists(c.id)]);
  const listIds = lists.map((l) => l.listmonk_id).filter((x): x is number => typeof x === "number");
  const sub = await listmonk.upsertSubscriber({
    email: c.email,
    name: c.name,
    status: c.status === "active" ? "enabled" : "blocklisted",
    lists: listIds,
    attribs: { ...c.attributes, tags: tags.map((t) => t.slug), phone: c.phone_norm, g2mail_id: c.id },
  });
  if (sub?.id && sub.id !== c.listmonk_id) await db().from("contacts").update({ listmonk_id: sub.id }).eq("id", c.id);
}
