/**
 * Motor de automações.
 *
 * - enrollForEvent(): chamado toda vez que um evento acontece (tag.added, purchase, webhook...).
 *   Procura automações ativas cujo gatilho casa e cria um "run" pro contato.
 * - processDueRuns(): chamado pelo cron (a cada minuto). Pega runs vencidos e executa passos
 *   até bater numa espera (wait) ou terminar.
 *
 * O cursor do run é um caminho dentro da árvore de passos: [2] = steps[2];
 * [2,"yes",0] = steps[2].yes[0]. Quando um ramo acaba, volta pro passo seguinte ao pai.
 */
import { db, slugify } from "../db";
import { listmonk } from "../listmonk";
import type { Automation, Condition, Run, Step, Trigger, RunLogEntry } from "./types";
import * as core from "../core";

type Cursor = (number | "yes" | "no")[];

/* ------------------------------------------------------------------ */
/* Gatilhos                                                            */
/* ------------------------------------------------------------------ */
function triggerMatches(trigger: Trigger, eventType: string, data: Record<string, unknown>): boolean {
  switch (trigger.type) {
    case "tag.added":   return eventType === "tag.added" && data.tag === slugify(trigger.tag);
    case "tag.removed": return eventType === "tag.removed" && data.tag === slugify(trigger.tag);
    case "list.added":  return eventType === "list.added" && data.list === slugify(trigger.list);
    case "contact.created": return eventType === "contact.created" && (!trigger.source || data.source === trigger.source);
    case "event": {
      if (eventType !== trigger.event) return false;
      for (const [k, v] of Object.entries(trigger.filter ?? {})) if (data[k] !== v) return false;
      return true;
    }
    case "webhook": return eventType === `webhook.${trigger.key}`;
    case "manual":  return false;
  }
}

export async function enrollForEvent(contactId: string, eventType: string, data: Record<string, unknown>) {
  const { data: autos } = await db().from("automations").select("*").eq("status", "active");
  for (const a of (autos ?? []) as Automation[]) {
    if (triggerMatches(a.trigger, eventType, data)) await enroll(a, contactId, { event: eventType, ...data });
  }
}

export async function enroll(a: Automation, contactId: string, context: Record<string, unknown> = {}): Promise<Run | null> {
  if (!a.settings?.allow_reentry) {
    const { data: prev } = await db().from("automation_runs").select("id,status").eq("automation_id", a.id).eq("contact_id", contactId).limit(1);
    if (prev?.length) return null;
  } else {
    const { data: active } = await db().from("automation_runs").select("id").eq("automation_id", a.id).eq("contact_id", contactId).in("status", ["running", "waiting"]).limit(1);
    if (active?.length) return null;
  }
  const { data: run, error } = await db().from("automation_runs").insert({
    automation_id: a.id,
    contact_id: contactId,
    status: "running",
    current_step: null,
    next_run_at: new Date().toISOString(),
    context: { ...context, _cursor: [0] },
  }).select("*").single();
  if (error) { console.error("enroll", error); return null; }
  return run as Run;
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */
export async function processDueRuns(batch = 100): Promise<{ processed: number; errors: number }> {
  const { data: runs, error } = await db().rpc("claim_due_runs", { batch });
  if (error) throw error;
  let errors = 0;
  for (const run of (runs ?? []) as Run[]) {
    try { await processRun(run); } catch (e) {
      errors++;
      await db().from("automation_runs").update({ status: "failed", error: String((e as Error).message ?? e), finished_at: new Date().toISOString() }).eq("id", run.id);
    }
  }
  return { processed: runs?.length ?? 0, errors };
}

export function getStep(steps: Step[], cursor: Cursor): Step | null {
  let list: Step[] = steps;
  let step: Step | null = null;
  for (let i = 0; i < cursor.length; i++) {
    const c = cursor[i];
    if (c === "yes" || c === "no") {
      if (!step || step.type !== "condition") return null;
      list = step[c];
      step = null;
    } else {
      step = list[c] ?? null;
      if (!step) return null;
    }
  }
  return step;
}

/** próximo cursor "em sequência": avança o último índice; se o ramo acabou, sobe e avança o pai */
export function advance(steps: Step[], cursor: Cursor): Cursor | null {
  const c = [...cursor];
  while (c.length) {
    const last = c[c.length - 1];
    if (typeof last === "number") {
      c[c.length - 1] = last + 1;
      if (getStep(steps, c)) return c;
      // acabou esta lista: sobe (remove índice e, se houver, o marcador do ramo)
      c.pop();
      if (c.length && (c[c.length - 1] === "yes" || c[c.length - 1] === "no")) c.pop();
      // agora c aponta pro passo "condition" pai; o loop avança ele
    } else return null;
  }
  return null;
}

async function processRun(run: Run) {
  const { data: a } = await db().from("automations").select("*").eq("id", run.automation_id).single();
  const auto = a as Automation;
  if (!auto || auto.status !== "active") {
    await db().from("automation_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", run.id);
    return;
  }
  const contact = await core.getContact(run.contact_id);
  if (!contact || contact.status !== "active") {
    await db().from("automation_runs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: "contato inativo" }).eq("id", run.id);
    return;
  }

  let cursor: Cursor = (run.context._cursor as Cursor) ?? [0];
  const log: RunLogEntry[] = [...(run.log ?? [])];
  const ctx = { ...run.context };
  let guard = 0;

  const finish = async (status: Run["status"]) => {
    await db().from("automation_runs").update({ status, current_step: null, next_run_at: null, context: { ...ctx, _cursor: cursor }, log, finished_at: new Date().toISOString() }).eq("id", run.id);
  };

  while (guard++ < 200) {
    const step = getStep(auto.steps, cursor);
    if (!step) { await finish("completed"); return; }
    const entry = (result: string, detail?: unknown) => log.push({ at: new Date().toISOString(), step: step.id, type: step.type, result, detail });
    const by = `automation:${auto.id}`;

    switch (step.type) {
      case "send_email": {
        const sendId = await sendTemplateEmail(contact.id, step.template_id, { ...ctx, contact }, auto.id, run.id, step.from_email);
        ctx[`_send_${step.id}`] = sendId;
        entry(sendId ? "sent" : "skipped", { send_id: sendId });
        break;
      }
      case "add_tag":   entry((await core.addTag(contact.id, step.tag, by)) ? "added" : "already"); break;
      case "remove_tag": entry((await core.removeTag(contact.id, step.tag, by)) ? "removed" : "absent"); break;
      case "add_to_list": entry((await core.addToList(contact.id, step.list, by)) ? "added" : "already"); break;
      case "remove_from_list": entry((await core.removeFromList(contact.id, step.list, by)) ? "removed" : "absent"); break;
      case "update_attribute": {
        await db().from("contacts").update({ attributes: { ...contact.attributes, [step.field]: step.value } }).eq("id", contact.id);
        contact.attributes[step.field] = step.value;
        entry("updated");
        break;
      }
      case "webhook": {
        try {
          const res = await fetch(step.url, {
            method: step.method ?? "POST",
            headers: { "content-type": "application/json", ...(step.headers ?? {}) },
            body: (step.method ?? "POST") === "GET" ? undefined : JSON.stringify({ ...(step.body ?? {}), contact, context: ctx }),
          });
          entry(res.ok ? "ok" : "http_error", { status: res.status });
        } catch (e) { entry("error", String((e as Error).message)); }
        break;
      }
      case "wait": {
        const ms = step.amount * ({ minutes: 60e3, hours: 3600e3, days: 86400e3 }[step.unit]);
        const next = advance(auto.steps, cursor);
        entry("waiting", { until: new Date(Date.now() + ms).toISOString() });
        await db().from("automation_runs").update({
          status: "waiting", current_step: step.id, next_run_at: new Date(Date.now() + ms).toISOString(),
          context: { ...ctx, _cursor: next ?? [] }, log,
        }).eq("id", run.id);
        return;
      }
      case "wait_until": {
        const tz = auto.settings?.timezone ?? process.env.APP_TIMEZONE ?? "America/Sao_Paulo";
        const at = nextTimeInTz(step.hour, step.minute ?? 0, tz);
        const next = advance(auto.steps, cursor);
        entry("waiting", { until: at.toISOString() });
        await db().from("automation_runs").update({
          status: "waiting", current_step: step.id, next_run_at: at.toISOString(),
          context: { ...ctx, _cursor: next ?? [] }, log,
        }).eq("id", run.id);
        return;
      }
      case "condition": {
        const ok = await evalCondition(step.condition, contact.id, contact.attributes, ctx, run);
        entry(ok ? "yes" : "no");
        const branch: Cursor = [...cursor, ok ? "yes" : "no", 0];
        if (getStep(auto.steps, branch)) { cursor = branch; continue; }
        break; // ramo vazio: segue pro próximo
      }
      case "goal": {
        const ok = await evalCondition(step.condition, contact.id, contact.attributes, ctx, run);
        entry(ok ? "reached" : "not_reached");
        if (ok) { await finish("goal_reached"); return; }
        break;
      }
      case "end": entry("end"); await finish("completed"); return;
    }

    const next = advance(auto.steps, cursor);
    if (!next) { await finish("completed"); return; }
    cursor = next;
    await db().from("automation_runs").update({ current_step: step.id, context: { ...ctx, _cursor: cursor }, log }).eq("id", run.id);
  }
  await finish("failed");
}

function nextTimeInTz(hour: number, minute: number, tz: string): Date {
  // calcula o próximo HH:MM no fuso dado
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const localNow = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const offset = localNow - now.getTime(); // ms entre "local lido como UTC" e UTC real
  let target = Date.UTC(+p.year, +p.month - 1, +p.day, hour, minute, 0) - offset;
  if (target <= now.getTime()) target += 86400e3;
  return new Date(target);
}

/* ------------------------------------------------------------------ */
/* Condições                                                           */
/* ------------------------------------------------------------------ */
export async function evalCondition(c: Condition, contactId: string, attrs: Record<string, unknown>, ctx: Record<string, unknown>, run: Run): Promise<boolean> {
  switch (c.kind) {
    case "has_tag": return core.hasTag(contactId, c.tag);
    case "not_has_tag": return !(await core.hasTag(contactId, c.tag));
    case "in_list": return core.inList(contactId, c.list);
    case "attribute": {
      const v = attrs[c.field];
      switch (c.op) {
        case "exists": return v !== undefined && v !== null && v !== "";
        case "eq": return v == c.value;
        case "neq": return v != c.value;
        case "contains": return String(v ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
        case "gt": return Number(v) > Number(c.value);
        case "lt": return Number(v) < Number(c.value);
      }
      return false;
    }
    case "opened_email":
    case "clicked_email": {
      const sendId = ctx[`_send_${c.step_id}`];
      if (!sendId) return false;
      const { data } = await db().from("email_sends").select("opened_at,clicked_at").eq("id", sendId).maybeSingle();
      return c.kind === "opened_email" ? !!(data?.opened_at || data?.clicked_at) : !!data?.clicked_at;
    }
    case "event_since_start": {
      const { data } = await db().from("events").select("id").eq("contact_id", contactId).eq("type", c.event).gte("created_at", run.started_at).limit(1);
      return !!data?.length;
    }
    case "all": { for (const x of c.conditions) if (!(await evalCondition(x, contactId, attrs, ctx, run))) return false; return true; }
    case "any": { for (const x of c.conditions) if (await evalCondition(x, contactId, attrs, ctx, run)) return true; return false; }
  }
}

/* ------------------------------------------------------------------ */
/* Envio de email por template (transacional via Listmonk)             */
/* ------------------------------------------------------------------ */
function render(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), data);
    return v === undefined || v === null ? "" : String(v);
  });
}

export async function sendTemplateEmail(contactId: string, templateId: string, data: Record<string, unknown>, automationId?: string, runId?: string, fromEmail?: string): Promise<number | null> {
  const contact = await core.getContact(contactId);
  if (!contact || contact.status !== "active") return null;
  const { data: tpl } = await db().from("email_templates").select("*").eq("id", templateId).single();
  if (!tpl) throw new Error(`Template não encontrado: ${templateId}`);

  const vars = { ...data, contact, nome: contact.name ?? "", email: contact.email, ...contact.attributes };
  const subject = render(tpl.subject, vars);
  const html = render(tpl.body_html, vars);

  const { data: send } = await db().from("email_sends").insert({
    contact_id: contact.id, template_id: tpl.id, automation_id: automationId ?? null, run_id: runId ?? null, subject, status: "queued",
  }).select("id").single();
  const sendId = send?.id as number;

  if (!listmonk.enabled()) {
    await db().from("email_sends").update({ status: "failed", error: "Listmonk não configurado" }).eq("id", sendId);
    return sendId;
  }
  try {
    // garante subscriber + template tx no Listmonk
    if (!contact.listmonk_id) await core.syncContactToListmonk(contact.id);
    let lmTpl = tpl.listmonk_tpl_id as number | null;
    // template tx no Listmonk: corpo já renderizado por contato (simples e previsível)
    const t = await listmonk.upsertTxTemplate({ id: lmTpl, name: `g2mail:${tpl.name}`, subject: "{{ .Tx.Data.subject }}", body: "{{ .Tx.Data.html }}" });
    if (t?.id && t.id !== lmTpl) { lmTpl = t.id; await db().from("email_templates").update({ listmonk_tpl_id: t.id }).eq("id", tpl.id); }
    const appUrl = process.env.APP_URL ?? "";
    const htmlTracked = appUrl
      ? html.replace(/href="(https?:\/\/[^"]+)"/g, (_, u) => `href="${appUrl}/t/c/${sendId}?u=${encodeURIComponent(u)}"`) + `<img src="${appUrl}/t/o/${sendId}.gif" width="1" height="1" alt="" />`
      : html;
    await listmonk.sendTx({ email: contact.email, templateId: lmTpl!, data: { subject, html: htmlTracked }, fromEmail: fromEmail ?? tpl.from_email ?? undefined });
    await db().from("email_sends").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", sendId);
    await core.recordEvent(contact.id, "email.sent", { send_id: sendId, template: tpl.name, subject }, automationId ? `automation:${automationId}` : "api");
  } catch (e) {
    await db().from("email_sends").update({ status: "failed", error: String((e as Error).message) }).eq("id", sendId);
    throw e;
  }
  return sendId;
}
