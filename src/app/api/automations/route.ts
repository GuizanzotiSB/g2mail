import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import type { Step, Trigger } from "@/lib/automation/types";
import { validateSteps } from "@/lib/automation/validate";

/** GET /api/automations — com contagem de runs por status */
export const GET = withAuth("read", async () => {
  const { data, error } = await db().from("automations").select("id,name,description,status,trigger,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) return err(error.message, 500);
  const { data: counts } = await db().from("automation_runs").select("automation_id,status");
  const by: Record<string, Record<string, number>> = {};
  for (const r of counts ?? []) { by[r.automation_id] ??= {}; by[r.automation_id][r.status] = (by[r.automation_id][r.status] ?? 0) + 1; }
  return json({ data: (data ?? []).map((a) => ({ ...a, runs: by[a.id] ?? {} })) });
});

/** POST /api/automations {name, trigger, steps, status?, settings?, description?} */
export const POST = withAuth("write", async (req) => {
  const b = await body<{ name: string; description?: string; trigger: Trigger; steps: Step[]; status?: string; settings?: Record<string, unknown> }>(req);
  if (!b.name || !b.trigger?.type) return err("name e trigger.type são obrigatórios");
  const v = validateSteps(b.steps ?? []); if (v) return err(v);
  const { data, error } = await db().from("automations").insert({
    name: b.name, description: b.description ?? null, trigger: b.trigger, steps: b.steps ?? [],
    status: b.status ?? "draft", settings: b.settings ?? { allow_reentry: false },
  }).select("*").single();
  if (error) return err(error.message, 500);
  return json(data, 201);
});
