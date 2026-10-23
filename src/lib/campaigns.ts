import { db, slugify } from "./db";
import { listmonk } from "./listmonk";
import { ensureList, addToList } from "./core";

export type CampaignInput = {
  name: string; subject: string; body_html?: string; template_id?: string;
  lists?: string[]; segment?: { must?: string[]; must_not?: string[] };
  from_email?: string; send_now?: boolean; send_at?: string;
};

/** Cria (e opcionalmente dispara/agenda) uma campanha no Listmonk pra listas e/ou segmento por tags. */
export async function createCampaign(b: CampaignInput, by = "api") {
  if (!listmonk.enabled()) throw new Error("Listmonk não configurado");
  if (!b.name || !b.subject) throw new Error("name e subject são obrigatórios");

  let html = b.body_html ?? "";
  let fromEmail = b.from_email;
  if (!html && b.template_id) {
    const { data: tpl } = await db().from("email_templates").select("body_html,from_email").eq("id", b.template_id).maybeSingle();
    if (!tpl) throw new Error("Template não encontrado");
    html = tpl.body_html; fromEmail ??= tpl.from_email ?? undefined;
  }
  if (!html) throw new Error("informe body_html ou template_id");
  // variáveis do app ({{nome}}) → variáveis do Listmonk
  html = html
    .replace(/\{\{\s*nome\s*\}\}/g, "{{ .Subscriber.FirstName }}")
    .replace(/\{\{\s*email\s*\}\}/g, "{{ .Subscriber.Email }}")
    .replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_, k) => `{{ .Subscriber.Attribs.${k} }}`);

  const listIds: number[] = [];
  for (const slug of b.lists ?? []) {
    const l = await ensureList(slug);
    if (l.listmonk_id) listIds.push(l.listmonk_id);
  }
  let segmentSize: number | undefined;
  if (b.segment) {
    const { data: rows, error } = await db().rpc("segment_contacts", { must: (b.segment.must ?? []).map(slugify), must_not: (b.segment.must_not ?? []).map(slugify), lim: 100000, off: 0 });
    if (error) throw new Error(error.message);
    segmentSize = rows?.length ?? 0;
    const seg = await ensureList(`seg ${slugify(b.name)} ${Date.now()}`);
    for (const c of rows ?? []) await addToList(c.id, seg.slug, `campaign:${by}`);
    if (seg.listmonk_id) listIds.push(seg.listmonk_id);
  }
  if (!listIds.length) throw new Error("nenhuma lista válida (lists ou segment)");

  const camp = await listmonk.createCampaign({ name: b.name, subject: b.subject, listIds, body: html, fromEmail, sendAt: b.send_at });
  let status = camp.status;
  if (b.send_at) status = (await listmonk.scheduleCampaign(camp.id)).status;
  else if (b.send_now) status = (await listmonk.startCampaign(camp.id)).status;
  return { campaign_id: camp.id, status, lists: listIds, segment_size: segmentSize };
}
