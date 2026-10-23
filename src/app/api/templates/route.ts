import { withAuth, json, err, body } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = withAuth("read", async () => {
  const { data, error } = await db().from("email_templates").select("id,name,subject,from_name,from_email,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) return err(error.message, 500);
  return json({ data });
});

/** POST /api/templates {name, subject, body_html, body_text?, from_name?, from_email?}
 *  Variáveis no corpo/assunto: {{nome}}, {{email}}, {{qualquer_atributo}}, {{contact.phone}} */
export const POST = withAuth("write", async (req) => {
  const b = await body<{ name: string; subject: string; body_html: string; body_text?: string; from_name?: string; from_email?: string }>(req);
  if (!b.name || !b.subject || !b.body_html) return err("name, subject e body_html são obrigatórios");
  const { data, error } = await db().from("email_templates").insert(b).select("*").single();
  if (error) return err(error.message, 500);
  return json(data, 201);
});
