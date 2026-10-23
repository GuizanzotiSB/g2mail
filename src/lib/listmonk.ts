import { env } from "./env";

/**
 * Cliente mínimo da API do Listmonk (https://listmonk.app/docs/apis/apis/).
 * Auth: usuário de API (Listmonk >= v4: "token user:token") ou basic auth (usuário/senha).
 */
export class ListmonkError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function enabled() {
  return !!env.listmonkUrl();
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!enabled()) throw new ListmonkError(503, "LISTMONK_URL não configurada");
  const user = env.listmonkUser();
  const pass = env.listmonkPassword();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.LISTMONK_AUTH === "token") headers.authorization = `token ${user}:${pass}`;
  else headers.authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  const res = await fetch(`${env.listmonkUrl().replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: { data?: T; message?: string } = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* resposta não-JSON */ }
  if (!res.ok) throw new ListmonkError(res.status, json.message ?? text ?? res.statusText);
  return json.data as T;
}

export type LmSubscriber = { id: number; email: string; name: string; status: string; lists: { id: number }[]; attribs: Record<string, unknown> };
export type LmList = { id: number; name: string; type: string; optin: string; subscriber_count?: number };
export type LmTemplate = { id: number; name: string; type: string; subject?: string };
export type LmCampaign = { id: number; name: string; status: string; sent?: number; to_send?: number; views?: number; clicks?: number; bounces?: number };

export const listmonk = {
  enabled,

  // ---------- subscribers ----------
  async findSubscriberByEmail(email: string): Promise<LmSubscriber | null> {
    const q = encodeURIComponent(`subscribers.email = '${email.replace(/'/g, "''")}'`);
    const r = await call<{ results: LmSubscriber[] }>("GET", `/api/subscribers?query=${q}&per_page=1`);
    return r.results?.[0] ?? null;
  },

  async upsertSubscriber(input: { email: string; name?: string | null; attribs?: Record<string, unknown>; lists?: number[]; status?: "enabled" | "blocklisted" }): Promise<LmSubscriber> {
    const existing = await this.findSubscriberByEmail(input.email);
    const payload = {
      email: input.email,
      name: input.name || input.email.split("@")[0],
      status: input.status ?? "enabled",
      lists: input.lists ?? existing?.lists?.map((l) => l.id) ?? [],
      attribs: { ...(existing?.attribs ?? {}), ...(input.attribs ?? {}) },
      preconfirm_subscriptions: true,
    };
    if (existing) return call<LmSubscriber>("PUT", `/api/subscribers/${existing.id}`, payload);
    return call<LmSubscriber>("POST", `/api/subscribers`, payload);
  },

  async addToLists(subscriberIds: number[], listIds: number[]) {
    return call("PUT", `/api/subscribers/lists`, { ids: subscriberIds, action: "add", target_list_ids: listIds, status: "confirmed" });
  },
  async removeFromLists(subscriberIds: number[], listIds: number[]) {
    return call("PUT", `/api/subscribers/lists`, { ids: subscriberIds, action: "remove", target_list_ids: listIds });
  },
  async blocklist(subscriberIds: number[]) {
    return call("PUT", `/api/subscribers/blocklist`, { ids: subscriberIds });
  },

  // ---------- lists ----------
  async lists(): Promise<LmList[]> {
    const r = await call<{ results: LmList[] }>("GET", `/api/lists?per_page=all`);
    return r.results ?? [];
  },
  async createList(name: string, description?: string): Promise<LmList> {
    return call<LmList>("POST", `/api/lists`, { name, type: "private", optin: "single", description: description ?? "" });
  },

  // ---------- templates (transacionais) ----------
  async upsertTxTemplate(input: { id?: number | null; name: string; subject: string; body: string }): Promise<LmTemplate> {
    const payload = { name: input.name, type: "tx", subject: input.subject, body: input.body };
    if (input.id) return call<LmTemplate>("PUT", `/api/templates/${input.id}`, payload);
    return call<LmTemplate>("POST", `/api/templates`, payload);
  },

  // ---------- envio transacional (1 contato) ----------
  async sendTx(input: { email: string; templateId: number; data?: Record<string, unknown>; fromEmail?: string; headers?: Record<string, string> }) {
    return call("POST", `/api/tx`, {
      subscriber_email: input.email,
      template_id: input.templateId,
      data: input.data ?? {},
      from_email: input.fromEmail,
      headers: input.headers ? Object.entries(input.headers).map(([k, v]) => ({ [k]: v })) : undefined,
      content_type: "html",
    });
  },

  // ---------- campanhas (envio em massa pra listas) ----------
  async createCampaign(input: { name: string; subject: string; listIds: number[]; body: string; fromEmail?: string; sendAt?: string; templateId?: number }): Promise<LmCampaign> {
    return call<LmCampaign>("POST", `/api/campaigns`, {
      name: input.name,
      subject: input.subject,
      lists: input.listIds,
      from_email: input.fromEmail,
      type: "regular",
      content_type: "html",
      body: input.body,
      send_at: input.sendAt,
      template_id: input.templateId,
    });
  },
  async startCampaign(id: number) {
    return call<LmCampaign>("PUT", `/api/campaigns/${id}/status`, { status: "running" });
  },
  async scheduleCampaign(id: number) {
    return call<LmCampaign>("PUT", `/api/campaigns/${id}/status`, { status: "scheduled" });
  },
  async campaign(id: number): Promise<LmCampaign> {
    return call<LmCampaign>("GET", `/api/campaigns/${id}`);
  },
  async campaigns(): Promise<LmCampaign[]> {
    const r = await call<{ results: LmCampaign[] }>("GET", `/api/campaigns?per_page=50&order_by=created_at&order=desc`);
    return r.results ?? [];
  },

  async health(): Promise<boolean> {
    try { await call("GET", `/api/health`); return true; } catch { return false; }
  },
};
