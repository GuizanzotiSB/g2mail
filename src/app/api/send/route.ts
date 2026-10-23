import { withAuth, json, err, body } from "@/lib/api";
import { getContact } from "@/lib/core";
import { sendTemplateEmail } from "@/lib/automation/engine";

/** POST /api/send {contact: "<id|email>", template_id, data?, from_email?} — envia 1 email transacional agora */
export const POST = withAuth("write", async (req) => {
  const b = await body<{ contact: string; template_id: string; data?: Record<string, unknown>; from_email?: string }>(req);
  if (!b.contact || !b.template_id) return err("contact e template_id são obrigatórios");
  const c = await getContact(b.contact);
  if (!c) return err("Contato não encontrado", 404);
  const sendId = await sendTemplateEmail(c.id, b.template_id, b.data ?? {}, undefined, undefined, b.from_email);
  return json({ ok: !!sendId, send_id: sendId });
});
