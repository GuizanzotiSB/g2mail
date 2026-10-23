import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listmonk } from "@/lib/listmonk";

export const dynamic = "force-dynamic";

export async function GET() {
  const out: Record<string, unknown> = { app: "g2mail", at: new Date().toISOString() };
  try { const { error } = await db().from("tags").select("id").limit(1); out.supabase = error ? `erro: ${error.message}` : "ok"; }
  catch (e) { out.supabase = `erro: ${(e as Error).message}`; }
  out.listmonk = listmonk.enabled() ? ((await listmonk.health()) ? "ok" : "sem resposta") : "não configurado";
  const { data: due } = await db().from("automation_runs").select("id", { count: "exact", head: true }).in("status", ["running", "waiting"]).lte("next_run_at", new Date().toISOString());
  out.automation_runs_due = (due as unknown as { count?: number })?.count ?? null;
  return NextResponse.json(out);
}
