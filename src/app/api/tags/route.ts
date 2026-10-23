import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import { ensureTag } from "@/lib/core";

/** GET /api/tags — com contagem de contatos */
export const GET = withAuth("read", async () => {
  const { data, error } = await db().from("tags").select("*, contact_tags(count)").order("name");
  if (error) return err(error.message, 500);
  return json({ data: (data ?? []).map((t) => ({ ...t, count: (t.contact_tags as { count: number }[])?.[0]?.count ?? 0, contact_tags: undefined })) });
});

/** POST /api/tags {name, color?, description?} */
export const POST = withAuth("write", async (req) => {
  const b = await body<{ name: string; color?: string; description?: string }>(req);
  if (!b.name) return err("name é obrigatório");
  const t = await ensureTag(b.name);
  if (b.color || b.description) await db().from("tags").update({ color: b.color ?? t.color, description: b.description ?? t.description }).eq("id", t.id);
  return json(t, 201);
});

/** DELETE /api/tags {slug} */
export const DELETE = withAuth("write", async (req) => {
  const b = await body<{ slug: string }>(req);
  if (!b.slug) return err("slug é obrigatório");
  const { error } = await db().from("tags").delete().eq("slug", b.slug);
  if (error) return err(error.message, 500);
  return json({ ok: true });
});
