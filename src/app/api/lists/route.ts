import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import { ensureList } from "@/lib/core";

/** GET /api/lists — com contagem de membros confirmados */
export const GET = withAuth("read", async () => {
  const { data, error } = await db().from("lists").select("*, list_members(count)").order("name");
  if (error) return err(error.message, 500);
  return json({ data: (data ?? []).map((l) => ({ ...l, count: (l.list_members as { count: number }[])?.[0]?.count ?? 0, list_members: undefined })) });
});

/** POST /api/lists {name, description?} — cria aqui e no Listmonk */
export const POST = withAuth("write", async (req) => {
  const b = await body<{ name: string; description?: string }>(req);
  if (!b.name) return err("name é obrigatório");
  const l = await ensureList(b.name);
  if (b.description) await db().from("lists").update({ description: b.description }).eq("id", l.id);
  return json(l, 201);
});

export const DELETE = withAuth("write", async (req) => {
  const b = await body<{ slug: string }>(req);
  if (!b.slug) return err("slug é obrigatório");
  const { error } = await db().from("lists").delete().eq("slug", b.slug);
  if (error) return err(error.message, 500);
  return json({ ok: true });
});
