import { withAuth, json, err, body } from "@/lib/api";
import { upsertContact, recordEvent } from "@/lib/core";

type P = { key: string };

/**
 * POST /api/automations/trigger/:key  {email, name?, phone?, attributes?, ...dados}
 * Dispara automações com gatilho {type:"webhook", key:"<key>"}. Cria o contato se não existir.
 * Ideal pra chamar do n8n.
 */
export const POST = withAuth<P>("write", async (req, { params, auth }) => {
  const b = await body<{ email: string; name?: string; phone?: string; attributes?: Record<string, unknown> } & Record<string, unknown>>(req);
  if (!b.email) return err("email é obrigatório");
  const { contact } = await upsertContact({ email: b.email, name: b.name, phone: b.phone, attributes: b.attributes, source: `trigger:${params.key}` }, `api:${auth.name}`);
  const rest = Object.fromEntries(Object.entries(b).filter(([k]) => !["email", "name", "phone", "attributes"].includes(k)));
  await recordEvent(contact.id, `webhook.${params.key}`, rest, `api:${auth.name}`);
  return json({ ok: true, contact_id: contact.id });
});
