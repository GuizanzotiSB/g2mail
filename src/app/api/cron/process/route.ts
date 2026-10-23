import { NextResponse } from "next/server";
import { processDueRuns } from "@/lib/automation/engine";
import { env } from "@/lib/env";

/**
 * GET|POST /api/cron/process — processa automações vencidas. Chamar a cada minuto:
 *   * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/process
 * (ou o worker embutido: `npm run worker`)
 */
async function handle(req: Request) {
  const secret = env.cronSecret() || env.masterApiKey();
  const h = req.headers.get("authorization") ?? "";
  const given = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret || given !== secret) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const started = Date.now();
  const r = await processDueRuns(200);
  return NextResponse.json({ ...r, ms: Date.now() - started, at: new Date().toISOString() });
}
export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
