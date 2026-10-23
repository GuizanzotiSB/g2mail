import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import { getContact } from "@/lib/core";
import { enroll } from "@/lib/automation/engine";
import type { Automation } from "@/lib/automation/types";

type P = { id: string };

/** POST /api/automations/:id/enroll {contact: "<id|email>" | contacts: [...], context?} — coloca contato(s) manualmente na automação */
export const POST = withAuth<P>("write", async (req, { params }) => {
  const { data: a } = await db().from("automations").select("*").eq("id", params.id).maybeSingle();
  if (!a) return err("Automação não encontrada", 404);
  if (a.status !== "active") return err("Automação não está ativa");
  const b = await body<{ contact?: string; contacts?: string[]; context?: Record<string, unknown> }>(req);
  const ids = b.contacts ?? (b.contact ? [b.contact] : []);
  if (!ids.length) return err("informe contact ou contacts");
  const results = [];
  for (const idOrEmail of ids) {
    const c = await getContact(idOrEmail);
    if (!c) { results.push({ contact: idOrEmail, ok: false, error: "não encontrado" }); continue; }
    const run = await enroll(a as Automation, c.id, { manual: true, ...(b.context ?? {}) });
    results.push({ contact: c.email, ok: !!run, run_id: run?.id ?? null, skipped: !run ? "já passou por esta automação" : undefined });
  }
  return json({ results });
});
