import { withAuth, json, err, body } from "@/lib/api";
import { listmonk } from "@/lib/listmonk";
import { createCampaign, CampaignInput } from "@/lib/campaigns";

/** GET /api/campaigns — campanhas do Listmonk com estatísticas */
export const GET = withAuth("read", async () => {
  if (!listmonk.enabled()) return err("Listmonk não configurado", 503);
  return json({ data: await listmonk.campaigns() });
});

/**
 * POST /api/campaigns — campanha em massa
 * { name, subject, body_html? | template_id?, lists?: ["alunos-mvs"], segment?: {must:[...], must_not:[...]},
 *   from_email?, send_now?: true, send_at?: "2026-11-01T10:00:00-03:00" }
 */
export const POST = withAuth("write", async (req, { auth }) => {
  const b = await body<CampaignInput>(req);
  try { return json({ ok: true, ...(await createCampaign(b, auth.name)) }, 201); }
  catch (e) { return err((e as Error).message, 400); }
});
