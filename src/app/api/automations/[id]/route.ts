import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";
import { validateSteps } from "@/lib/automation/validate";

type P = { id: string };

/** GET /api/automations/:id — definição completa + últimos runs */
export const GET = withAuth<P>("read", async (_req, { params }) => {
  const { data } = await db().from("automations").select("*").eq("id", params.id).maybeSingle();
  if (!data) return err("Automação não encontrada", 404);
  const { data: runs } = await db().from("automation_runs").select("id,status,current_step,next_run_at,started_at,finished_at,error,contacts(email,name)").eq("automation_id", params.id).order("started_at", { ascending: false }).limit(50);
  return json({ ...data, recent_runs: runs ?? [] });
});

/** PATCH /api/automations/:id — name, description, trigger, steps, status (draft|active|paused), settings */
export const PATCH = withAuth<P>("write", async (req, { params }) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.steps) { const v = validateSteps(b.steps); if (v) return err(v); }
  const allowed = ["name", "description", "trigger", "steps", "status", "settings"];
  const patch = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  const { data, error } = await db().from("automations").update(patch).eq("id", params.id).select("*").single();
  if (error) return err(error.message, 500);
  return json(data);
});

export const DELETE = withAuth<P>("write", async (_req, { params }) => {
  const { error } = await db().from("automations").delete().eq("id", params.id);
  if (error) return err(error.message, 500);
  return json({ ok: true });
});
