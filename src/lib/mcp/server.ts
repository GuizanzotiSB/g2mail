/**
 * Servidor MCP do G2 Mail — expõe contatos, tags, listas, templates, automações e campanhas
 * como ferramentas pro Claude (claude.ai → Conectores → adicionar conector custom → URL /api/mcp).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db, slugify } from "../db";
import * as core from "../core";
import { listContacts } from "../queries";
import { listmonk } from "../listmonk";
import { createCampaign } from "../campaigns";
import { enroll, sendTemplateEmail } from "../automation/engine";
import { validateSteps } from "../automation/validate";
import type { Automation } from "../automation/types";
import { env } from "../env";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `ERRO: ${msg}` }], isError: true });

const STEP_DOCS = `Passos (array "steps", cada um com "id" único e "type"):
- {id,type:"send_email",template_id,from_email?}
- {id,type:"add_tag",tag} | {id,type:"remove_tag",tag}
- {id,type:"add_to_list",list} | {id,type:"remove_from_list",list}
- {id,type:"wait",amount,unit:"minutes"|"hours"|"days"}
- {id,type:"wait_until",hour,minute?}  (próximo horário no fuso America/Sao_Paulo)
- {id,type:"condition",condition,yes:[...passos],no:[...passos]}
- {id,type:"webhook",url,method?,body?,headers?}
- {id,type:"update_attribute",field,value}
- {id,type:"goal",condition}  (se verdadeira, encerra a automação como goal_reached)
- {id,type:"end"}
Condições: {kind:"has_tag",tag} | {kind:"not_has_tag",tag} | {kind:"in_list",list} |
 {kind:"attribute",field,op:"eq"|"neq"|"contains"|"exists"|"gt"|"lt",value} |
 {kind:"opened_email",step_id} | {kind:"clicked_email",step_id} | {kind:"event_since_start",event} |
 {kind:"all",conditions:[...]} | {kind:"any",conditions:[...]}
Gatilhos ("trigger"): {type:"tag.added",tag} | {type:"tag.removed",tag} | {type:"list.added",list} |
 {type:"contact.created",source?} | {type:"event",event:"purchase",filter:{product_slug:"mvs"}} |
 {type:"webhook",key} (dispara via POST /api/automations/trigger/<key>) | {type:"manual"}`;

export function buildServer(scopes: string[]) {
  const server = new McpServer({ name: "g2mail", version: "1.0.0" }, {
    instructions: `G2 Mail — email marketing da G2 Educação (contatos, tags, listas, automações, campanhas). ` +
      `Nomes de tag/lista podem ser passados como nome ou slug; são criados se não existirem. ` +
      `Variáveis em templates: {{nome}}, {{email}} e qualquer atributo do contato.\n\n${STEP_DOCS}`,
  });
  const canWrite = scopes.includes("write") || scopes.includes("admin");
  const isAdmin = scopes.includes("admin");
  const guard = () => (canWrite ? null : fail("chave sem permissão de escrita"));

  /* ---------------- Contatos ---------------- */
  server.registerTool("list_contacts", {
    description: "Lista/busca contatos. Filtros: q (email/nome/telefone), tag (slug), list (slug), status.",
    inputSchema: { q: z.string().optional(), tag: z.string().optional(), list: z.string().optional(), status: z.enum(["active", "unsubscribed", "bounced", "blocklisted"]).optional(), limit: z.number().int().min(1).max(500).default(50), offset: z.number().int().min(0).default(0) },
  }, async (a) => {
    try { const r = await listContacts(a); return ok({ total: r.total, contacts: r.rows }); } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("get_contact", {
    description: "Detalhes de um contato (por id ou email): tags, listas, últimos eventos, emails e automações.",
    inputSchema: { contact: z.string().describe("id ou email") },
  }, async ({ contact }) => {
    const c = await core.getContact(contact);
    if (!c) return fail("contato não encontrado");
    const [tags, lists, events, runs, sends] = await Promise.all([
      core.contactTags(c.id), core.contactLists(c.id),
      db().from("events").select("type,data,source,created_at").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(30).then((r) => r.data),
      db().from("automation_runs").select("status,current_step,next_run_at,started_at,finished_at,automations(name)").eq("contact_id", c.id).order("started_at", { ascending: false }).limit(10).then((r) => r.data),
      db().from("email_sends").select("id,subject,status,sent_at,opened_at,clicked_at").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(10).then((r) => r.data),
    ]);
    return ok({ ...c, tags: tags.map((t) => t.slug), lists: lists.map((l) => l.slug), events, automations: runs, emails: sends });
  });

  server.registerTool("upsert_contact", {
    description: "Cria ou atualiza um contato pelo email. Pode já aplicar tags e listas.",
    inputSchema: { email: z.string(), name: z.string().optional(), phone: z.string().optional(), attributes: z.record(z.string(), z.unknown()).optional(), tags: z.array(z.string()).optional(), lists: z.array(z.string()).optional(), source: z.string().optional() },
  }, async (a) => guard() ?? ok(await core.upsertContact(a, "mcp")));

  server.registerTool("import_contacts", {
    description: "Importa vários contatos de uma vez (até 1000). Cada item: {email,name?,phone?,attributes?,tags?,lists?}.",
    inputSchema: { contacts: z.array(z.object({ email: z.string(), name: z.string().optional(), phone: z.string().optional(), attributes: z.record(z.string(), z.unknown()).optional(), tags: z.array(z.string()).optional(), lists: z.array(z.string()).optional() })).max(1000), source: z.string().default("import") },
  }, async (a) => {
    if (guard()) return guard()!;
    let created = 0, updated = 0; const errors: string[] = [];
    for (const c of a.contacts) {
      try { const r = await core.upsertContact({ ...c, source: a.source }, "mcp:import"); if (r.created) created++; else updated++; }
      catch (e) { errors.push(`${c.email}: ${(e as Error).message}`); }
    }
    return ok({ created, updated, errors });
  });

  server.registerTool("add_tags", {
    description: "Adiciona tags a um contato (dispara automações com gatilho tag.added).",
    inputSchema: { contact: z.string(), tags: z.array(z.string()).min(1) },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = await core.getContact(a.contact); if (!c) return fail("contato não encontrado");
    const added = []; for (const t of a.tags) if (await core.addTag(c.id, t, "mcp")) added.push(t);
    return ok({ added, tags: (await core.contactTags(c.id)).map((t) => t.slug) });
  });

  server.registerTool("remove_tags", {
    description: "Remove tags de um contato.",
    inputSchema: { contact: z.string(), tags: z.array(z.string()).min(1) },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = await core.getContact(a.contact); if (!c) return fail("contato não encontrado");
    const removed = []; for (const t of a.tags) if (await core.removeTag(c.id, t, "mcp")) removed.push(t);
    return ok({ removed, tags: (await core.contactTags(c.id)).map((t) => t.slug) });
  });

  server.registerTool("bulk_tag", {
    description: "Adiciona ou remove uma tag em TODOS os contatos de um segmento (must/must_not) ou de uma lista.",
    inputSchema: { action: z.enum(["add", "remove"]), tag: z.string(), must: z.array(z.string()).optional(), must_not: z.array(z.string()).optional(), list: z.string().optional() },
  }, async (a) => {
    if (guard()) return guard()!;
    let ids: string[] = [];
    if (a.list) {
      const { data } = await db().from("list_members").select("contact_id, lists!inner(slug)").eq("lists.slug", slugify(a.list)).eq("status", "confirmed");
      ids = (data ?? []).map((r) => r.contact_id);
    } else {
      const { data } = await db().rpc("segment_contacts", { must: a.must ?? [], must_not: a.must_not ?? [], lim: 100000, off: 0 });
      ids = (data ?? []).map((r: { id: string }) => r.id);
    }
    let n = 0;
    for (const id of ids) if (a.action === "add" ? await core.addTag(id, a.tag, "mcp:bulk") : await core.removeTag(id, a.tag, "mcp:bulk")) n++;
    return ok({ affected: n, total_in_scope: ids.length });
  });

  server.registerTool("add_to_lists", {
    description: "Coloca um contato em listas (cria a lista aqui e no Listmonk se não existir).",
    inputSchema: { contact: z.string(), lists: z.array(z.string()).min(1) },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = await core.getContact(a.contact); if (!c) return fail("contato não encontrado");
    const added = []; for (const l of a.lists) if (await core.addToList(c.id, l, "mcp")) added.push(l);
    return ok({ added, lists: (await core.contactLists(c.id)).map((l) => l.slug) });
  });

  server.registerTool("remove_from_lists", {
    description: "Tira um contato de listas.",
    inputSchema: { contact: z.string(), lists: z.array(z.string()).min(1) },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = await core.getContact(a.contact); if (!c) return fail("contato não encontrado");
    const removed = []; for (const l of a.lists) if (await core.removeFromList(c.id, l, "mcp")) removed.push(l);
    return ok({ removed });
  });

  server.registerTool("unsubscribe_contact", {
    description: "Descadastra um contato (para de receber tudo, cancela automações em andamento).",
    inputSchema: { contact: z.string() },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = await core.getContact(a.contact); if (!c) return fail("contato não encontrado");
    await core.unsubscribeContact(c.id, "mcp"); return ok({ ok: true });
  });

  server.registerTool("segment", {
    description: "Contatos ativos que têm TODAS as tags de must e NENHUMA de must_not. Use count_only pra só contar.",
    inputSchema: { must: z.array(z.string()).default([]), must_not: z.array(z.string()).default([]), limit: z.number().int().max(1000).default(100), count_only: z.boolean().default(false) },
  }, async (a) => {
    const { data, error } = await db().rpc("segment_contacts", { must: a.must.map(slugify), must_not: a.must_not.map(slugify), lim: a.count_only ? 100000 : a.limit, off: 0 });
    if (error) return fail(error.message);
    return ok(a.count_only ? { count: data?.length ?? 0 } : { count: data?.length ?? 0, contacts: (data ?? []).map((c: { id: string; email: string; name: string }) => ({ id: c.id, email: c.email, name: c.name })) });
  });

  server.registerTool("record_event", {
    description: "Registra um evento custom pro contato (ex.: purchase, webinar.attended). Dispara automações com gatilho {type:'event', event}.",
    inputSchema: { contact: z.string(), event: z.string(), data: z.record(z.string(), z.unknown()).optional() },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = a.contact.includes("@") ? (await core.upsertContact({ email: a.contact }, "mcp")).contact : await core.getContact(a.contact);
    if (!c) return fail("contato não encontrado");
    await core.recordEvent(c.id, a.event, a.data ?? {}, "mcp"); return ok({ ok: true, contact_id: c.id });
  });

  /* ---------------- Tags & listas ---------------- */
  server.registerTool("list_tags", { description: "Todas as tags com contagem de contatos.", inputSchema: {} }, async () => {
    const { data } = await db().from("tags").select("name,slug,color,description, contact_tags(count)").order("name");
    return ok((data ?? []).map((t) => ({ name: t.name, slug: t.slug, color: t.color, description: t.description, count: (t.contact_tags as { count: number }[])?.[0]?.count ?? 0 })));
  });
  server.registerTool("create_tag", { description: "Cria uma tag.", inputSchema: { name: z.string(), color: z.string().optional(), description: z.string().optional() } }, async (a) => {
    if (guard()) return guard()!;
    const t = await core.ensureTag(a.name);
    if (a.color || a.description) await db().from("tags").update({ color: a.color ?? t.color, description: a.description ?? t.description }).eq("id", t.id);
    return ok(t);
  });
  server.registerTool("delete_tag", { description: "Apaga uma tag (remove de todos os contatos).", inputSchema: { tag: z.string() } }, async (a) => {
    if (guard()) return guard()!;
    const { error } = await db().from("tags").delete().eq("slug", slugify(a.tag)); return error ? fail(error.message) : ok({ ok: true });
  });
  server.registerTool("list_lists", { description: "Todas as listas com contagem de membros.", inputSchema: {} }, async () => {
    const { data } = await db().from("lists").select("name,slug,description,listmonk_id, list_members(count)").order("name");
    return ok((data ?? []).map((l) => ({ name: l.name, slug: l.slug, description: l.description, listmonk_id: l.listmonk_id, count: (l.list_members as { count: number }[])?.[0]?.count ?? 0 })));
  });
  server.registerTool("create_list", { description: "Cria uma lista (aqui e no Listmonk).", inputSchema: { name: z.string(), description: z.string().optional() } }, async (a) => {
    if (guard()) return guard()!;
    const l = await core.ensureList(a.name);
    if (a.description) await db().from("lists").update({ description: a.description }).eq("id", l.id);
    return ok(l);
  });

  /* ---------------- Templates ---------------- */
  server.registerTool("list_templates", { description: "Templates de email.", inputSchema: {} }, async () => {
    const { data } = await db().from("email_templates").select("id,name,subject,from_email,updated_at").order("updated_at", { ascending: false }); return ok(data);
  });
  server.registerTool("get_template", { description: "Template completo (HTML).", inputSchema: { template_id: z.string() } }, async (a) => {
    const { data } = await db().from("email_templates").select("*").eq("id", a.template_id).maybeSingle(); return data ? ok(data) : fail("não encontrado");
  });
  server.registerTool("create_template", {
    description: "Cria template de email. Variáveis: {{nome}}, {{email}}, {{qualquer_atributo}}. Links são rastreados automaticamente.",
    inputSchema: { name: z.string(), subject: z.string(), body_html: z.string(), body_text: z.string().optional(), from_name: z.string().optional(), from_email: z.string().optional() },
  }, async (a) => { if (guard()) return guard()!; const { data, error } = await db().from("email_templates").insert(a).select("id,name,subject").single(); return error ? fail(error.message) : ok(data); });
  server.registerTool("update_template", {
    description: "Atualiza um template.",
    inputSchema: { template_id: z.string(), name: z.string().optional(), subject: z.string().optional(), body_html: z.string().optional(), body_text: z.string().optional(), from_name: z.string().optional(), from_email: z.string().optional() },
  }, async ({ template_id, ...patch }) => { if (guard()) return guard()!; const { data, error } = await db().from("email_templates").update(patch).eq("id", template_id).select("id,name,subject").single(); return error ? fail(error.message) : ok(data); });

  /* ---------------- Envio ---------------- */
  server.registerTool("send_email", {
    description: "Envia um template agora pra UM contato (transacional, via Listmonk).",
    inputSchema: { contact: z.string(), template_id: z.string(), data: z.record(z.string(), z.unknown()).optional() },
  }, async (a) => {
    if (guard()) return guard()!;
    const c = await core.getContact(a.contact); if (!c) return fail("contato não encontrado");
    try { return ok({ send_id: await sendTemplateEmail(c.id, a.template_id, a.data ?? {}) }); } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("create_campaign", {
    description: "Campanha em massa via Listmonk pra listas e/ou segmento por tags. send_now=false cria como rascunho pra revisar no Listmonk.",
    inputSchema: { name: z.string(), subject: z.string(), template_id: z.string().optional(), body_html: z.string().optional(), lists: z.array(z.string()).optional(), segment: z.object({ must: z.array(z.string()).optional(), must_not: z.array(z.string()).optional() }).optional(), from_email: z.string().optional(), send_now: z.boolean().default(false), send_at: z.string().optional() },
  }, async (a) => {
    if (guard()) return guard()!;
    try { return ok(await createCampaign(a, "mcp")); } catch (e) { return fail((e as Error).message); }
  });
  server.registerTool("list_campaigns", { description: "Campanhas do Listmonk com estatísticas (enviados, aberturas, cliques).", inputSchema: {} }, async () => {
    if (!listmonk.enabled()) return fail("Listmonk não configurado"); return ok(await listmonk.campaigns());
  });

  /* ---------------- Automações ---------------- */
  server.registerTool("list_automations", { description: "Automações com status e contagem de contatos por estado.", inputSchema: {} }, async () => {
    const { data } = await db().from("automations").select("id,name,status,trigger,updated_at").order("updated_at", { ascending: false });
    const { data: counts } = await db().from("automation_runs").select("automation_id,status");
    const by: Record<string, Record<string, number>> = {};
    for (const r of counts ?? []) { by[r.automation_id] ??= {}; by[r.automation_id][r.status] = (by[r.automation_id][r.status] ?? 0) + 1; }
    return ok((data ?? []).map((a) => ({ ...a, runs: by[a.id] ?? {} })));
  });
  server.registerTool("get_automation", { description: "Definição completa da automação (gatilho + passos) e últimos runs.", inputSchema: { automation_id: z.string() } }, async (a) => {
    const { data } = await db().from("automations").select("*").eq("id", a.automation_id).maybeSingle(); if (!data) return fail("não encontrada");
    const { data: runs } = await db().from("automation_runs").select("status,current_step,next_run_at,started_at,finished_at,error,contacts(email)").eq("automation_id", a.automation_id).order("started_at", { ascending: false }).limit(20);
    return ok({ ...data, recent_runs: runs });
  });
  server.registerTool("create_automation", {
    description: `Cria uma automação. Começa como draft; use set_automation_status pra ativar.\n${STEP_DOCS}`,
    inputSchema: { name: z.string(), description: z.string().optional(), trigger: z.record(z.string(), z.unknown()), steps: z.array(z.record(z.string(), z.unknown())), allow_reentry: z.boolean().default(false), activate: z.boolean().default(false) },
  }, async (a) => {
    if (guard()) return guard()!;
    const v = validateSteps(a.steps); if (v) return fail(v);
    const { data, error } = await db().from("automations").insert({ name: a.name, description: a.description ?? null, trigger: a.trigger, steps: a.steps, status: a.activate ? "active" : "draft", settings: { allow_reentry: a.allow_reentry } }).select("id,name,status").single();
    return error ? fail(error.message) : ok(data);
  });
  server.registerTool("update_automation", {
    description: "Atualiza nome, gatilho, passos ou configurações de uma automação.",
    inputSchema: { automation_id: z.string(), name: z.string().optional(), description: z.string().optional(), trigger: z.record(z.string(), z.unknown()).optional(), steps: z.array(z.record(z.string(), z.unknown())).optional(), allow_reentry: z.boolean().optional() },
  }, async ({ automation_id, allow_reentry, ...patch }) => {
    if (guard()) return guard()!;
    if (patch.steps) { const v = validateSteps(patch.steps); if (v) return fail(v); }
    const upd: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (allow_reentry !== undefined) upd.settings = { allow_reentry };
    const { data, error } = await db().from("automations").update(upd).eq("id", automation_id).select("id,name,status").single();
    return error ? fail(error.message) : ok(data);
  });
  server.registerTool("set_automation_status", { description: "active | paused | draft", inputSchema: { automation_id: z.string(), status: z.enum(["active", "paused", "draft"]) } }, async (a) => {
    if (guard()) return guard()!;
    const { data, error } = await db().from("automations").update({ status: a.status }).eq("id", a.automation_id).select("id,name,status").single(); return error ? fail(error.message) : ok(data);
  });
  server.registerTool("delete_automation", { description: "Apaga uma automação e seus runs.", inputSchema: { automation_id: z.string() } }, async (a) => {
    if (guard()) return guard()!;
    const { error } = await db().from("automations").delete().eq("id", a.automation_id); return error ? fail(error.message) : ok({ ok: true });
  });
  server.registerTool("enroll_in_automation", {
    description: "Coloca contatos manualmente numa automação ativa.",
    inputSchema: { automation_id: z.string(), contacts: z.array(z.string()).min(1).describe("ids ou emails") },
  }, async (a) => {
    if (guard()) return guard()!;
    const { data: auto } = await db().from("automations").select("*").eq("id", a.automation_id).maybeSingle();
    if (!auto) return fail("automação não encontrada"); if (auto.status !== "active") return fail("automação não está ativa");
    const results = [];
    for (const x of a.contacts) { const c = await core.getContact(x); if (!c) { results.push({ contact: x, ok: false }); continue; } const run = await enroll(auto as Automation, c.id, { manual: true }); results.push({ contact: c.email, ok: !!run, run_id: run?.id }); }
    return ok(results);
  });
  server.registerTool("automation_runs", {
    description: "Runs de uma automação (filtra por status) — pra ver quem está em qual passo.",
    inputSchema: { automation_id: z.string(), status: z.enum(["running", "waiting", "completed", "failed", "cancelled", "goal_reached"]).optional(), limit: z.number().int().max(500).default(50) },
  }, async (a) => {
    let q = db().from("automation_runs").select("id,status,current_step,next_run_at,started_at,finished_at,error,log,contacts(email,name)").eq("automation_id", a.automation_id).order("started_at", { ascending: false }).limit(a.limit);
    if (a.status) q = q.eq("status", a.status);
    const { data, error } = await q; return error ? fail(error.message) : ok(data);
  });

  /* ---------------- Integrações ---------------- */
  server.registerTool("list_webhooks", { description: "Webhooks de entrada (Hubla, TMB, genérico) com URL pra colar nas plataformas.", inputSchema: {} }, async () => {
    if (!isAdmin) return fail("precisa de chave admin");
    const { data } = await db().from("inbound_webhooks").select("id,name,provider,secret,config,active,created_at");
    return ok((data ?? []).map((h) => ({ ...h, url: `${env.appUrl()}/api/webhooks/${h.provider}/${h.secret}` })));
  });
  server.registerTool("create_webhook", {
    description: "Cria webhook de entrada. config.product_tags mapeia nome do produto → tag (ex.: {'Máquina de Vendas': 'comprou-mvs'}); default_tag, pending_tag, refund_tag, lists.",
    inputSchema: { name: z.string(), provider: z.enum(["hubla", "tmb", "generic"]), config: z.object({ product_tags: z.record(z.string(), z.string()).optional(), default_tag: z.string().optional(), pending_tag: z.string().optional(), refund_tag: z.string().optional(), lists: z.array(z.string()).optional() }).optional() },
  }, async (a) => {
    if (!isAdmin) return fail("precisa de chave admin");
    const secret = randomBytes(18).toString("base64url");
    const { data, error } = await db().from("inbound_webhooks").insert({ name: a.name, provider: a.provider, secret, config: a.config ?? {} }).select("*").single();
    return error ? fail(error.message) : ok({ ...data, url: `${env.appUrl()}/api/webhooks/${a.provider}/${secret}` });
  });
  server.registerTool("update_webhook", { description: "Atualiza config/ativo de um webhook.", inputSchema: { webhook_id: z.string(), config: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional() } }, async ({ webhook_id, ...patch }) => {
    if (!isAdmin) return fail("precisa de chave admin");
    const { data, error } = await db().from("inbound_webhooks").update(patch).eq("id", webhook_id).select("id,name,provider,config,active").single(); return error ? fail(error.message) : ok(data);
  });
  server.registerTool("webhook_logs", { description: "Últimos webhooks recebidos (payload + resultado) — pra depurar integrações.", inputSchema: { limit: z.number().int().max(200).default(20), provider: z.string().optional() } }, async (a) => {
    let q = db().from("webhook_logs").select("id,provider,ok,result,payload,created_at").order("created_at", { ascending: false }).limit(a.limit);
    if (a.provider) q = q.eq("provider", a.provider);
    const { data } = await q; return ok(data);
  });

  /* ---------------- Visão geral ---------------- */
  server.registerTool("stats", { description: "Números gerais: contatos por status, tags, listas, automações, emails nos últimos 7 dias, saúde do Listmonk.", inputSchema: {} }, async () => {
    const since = new Date(Date.now() - 7 * 86400e3).toISOString();
    const [c, t, l, a, s, ev] = await Promise.all([
      db().from("contacts").select("status"),
      db().from("tags").select("id", { count: "exact", head: true }),
      db().from("lists").select("id", { count: "exact", head: true }),
      db().from("automations").select("status"),
      db().from("email_sends").select("status,opened_at,clicked_at").gte("created_at", since),
      db().from("events").select("type").gte("created_at", since),
    ]);
    const count = (rows: { status?: string }[] | null) => (rows ?? []).reduce<Record<string, number>>((m, r) => { const k = r.status ?? "?"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const evs = (ev.data ?? []).reduce<Record<string, number>>((m, r) => { m[r.type] = (m[r.type] ?? 0) + 1; return m; }, {});
    return ok({
      contacts: count(c.data), tags: t.count, lists: l.count, automations: count(a.data),
      emails_7d: { ...count(s.data), opened: (s.data ?? []).filter((x) => x.opened_at).length, clicked: (s.data ?? []).filter((x) => x.clicked_at).length },
      events_7d: evs, listmonk: listmonk.enabled() ? (await listmonk.health() ? "ok" : "sem resposta") : "não configurado",
    });
  });

  return server;
}
