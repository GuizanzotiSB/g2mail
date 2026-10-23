/**
 * Normalização dos webhooks de entrada (Hubla, TMB, genérico).
 * Cada provedor vira um objeto padrão {email, name, phone, event, product, data}
 * e gera: upsert do contato + tag automática + evento (que dispara automações).
 */
import { upsertContact, addTag, removeTag, recordEvent } from "./core";
import { slugify } from "./db";

export type Normalized = {
  email: string;
  name?: string;
  phone?: string;
  event: string;            // purchase | purchase.pending | refund | payment.failed | subscription.canceled | abandoned_cart | <custom>
  product?: string;
  offer?: string;
  amount?: number;
  data: Record<string, unknown>;
};

export type WebhookConfig = {
  product_tags?: Record<string, string>;      // "Máquina de Vendas Shopee" -> "comprou-mvs" (match por slug/contém)
  default_tag?: string;                        // tag aplicada a toda compra (ex.: "cliente")
  pending_tag?: string;                        // ex.: "pendente"
  refund_tag?: string;                         // ex.: "reembolsou"
  lists?: string[];                            // listas em que o comprador entra
};

const get = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);
const first = (o: unknown, paths: string[]): unknown => { for (const p of paths) { const v = get(o, p); if (v !== undefined && v !== null && v !== "") return v; } return undefined; };

/* ---------------- Hubla ---------------- */
export function normalizeHubla(p: Record<string, unknown>): Normalized | null {
  const type = String(first(p, ["type", "event", "event_type"]) ?? "");
  const ev = (get(p, "event") && typeof get(p, "event") === "object" ? get(p, "event") : p) as Record<string, unknown>;
  const email = first(ev, ["user.email", "customer.email", "buyer.email", "email", "invoice.user.email"]);
  if (!email) return null;
  const fn = first(ev, ["user.firstName", "customer.firstName", "user.first_name"]) as string | undefined;
  const ln = first(ev, ["user.lastName", "customer.lastName", "user.last_name"]) as string | undefined;
  const name = (first(ev, ["user.name", "customer.name", "buyer.name", "name"]) as string | undefined) ?? [fn, ln].filter(Boolean).join(" ") ?? undefined;
  const phone = first(ev, ["user.phone", "customer.phone", "buyer.phone", "phone"]) as string | undefined;
  const products = (get(ev, "products") as Record<string, unknown>[] | undefined) ?? [];
  const product = (first(ev, ["product.name", "invoice.product.name", "productName"]) as string | undefined) ?? (products[0]?.name as string | undefined);
  const offer = first(ev, ["offer.name", "invoice.offer.name", "products.0.offers.0.name"]) as string | undefined;
  const amount = Number(first(ev, ["invoice.amount.totalCents", "invoice.amount.total", "amount.totalCents", "amount", "value"]) ?? 0);

  let event = "hubla." + (type || "unknown");
  const t = type.toLowerCase();
  if (t.includes("payment_succeeded") || t === "newsale" || t.includes("approved") || t.includes("paid")) event = "purchase";
  else if (t.includes("invoice.created") || t.includes("pending") || t.includes("waiting")) event = "purchase.pending";
  else if (t.includes("refund") || t.includes("chargeback")) event = "refund";
  else if (t.includes("payment_failed") || t.includes("failed") || t.includes("declined")) event = "payment.failed";
  else if (t.includes("canceled") || t.includes("cancelled") || t.includes("expired")) event = "subscription.canceled";
  else if (t.includes("abandon") || t.includes("checkout")) event = "abandoned_cart";
  else if (t.includes("renew")) event = "subscription.renewed";

  return { email: String(email), name: name || undefined, phone, event, product, offer, amount: amount > 1000 ? amount / 100 : amount, data: { provider: "hubla", type, product, offer, amount, raw: p } };
}

/* ---------------- TMB (The Members) ---------------- */
export function normalizeTmb(p: Record<string, unknown>): Normalized | null {
  const email = first(p, ["email", "cliente.email", "comprador.email", "customer.email", "dados.email"]);
  if (!email) return null;
  const name = first(p, ["nome", "name", "cliente.nome", "comprador.nome", "customer.name"]) as string | undefined;
  const phone = first(p, ["telefone", "phone", "celular", "cliente.telefone", "customer.phone"]) as string | undefined;
  const product = first(p, ["produto", "product", "produto_nome", "product_name", "nome_produto"]) as string | undefined;
  const offer = first(p, ["oferta", "offer", "plano"]) as string | undefined;
  const status = String(first(p, ["status_pedido", "status", "situacao", "evento", "event"]) ?? "").toLowerCase();
  const amount = Number(first(p, ["valor", "amount", "total", "valor_total"]) ?? 0);

  let event = "tmb." + (status || "unknown");
  if (["efetivado", "aprovado", "pago", "paid", "approved", "completo"].some((s) => status.includes(s))) event = "purchase";
  else if (["pendente", "aguardando", "pending", "boleto", "pix"].some((s) => status.includes(s))) event = "purchase.pending";
  else if (["reembols", "estorn", "refund", "chargeback"].some((s) => status.includes(s))) event = "refund";
  else if (["cancel", "expir"].some((s) => status.includes(s))) event = "subscription.canceled";
  else if (["recusad", "negad", "failed"].some((s) => status.includes(s))) event = "payment.failed";
  else if (["abandon"].some((s) => status.includes(s))) event = "abandoned_cart";

  return { email: String(email), name, phone, event, product, offer, amount, data: { provider: "tmb", status, product, offer, amount, raw: p } };
}

/* ---------------- Genérico ---------------- */
/** {email, name?, phone?, event?, tags?:[], remove_tags?:[], lists?:[], attributes?:{}, ...} */
export function normalizeGeneric(p: Record<string, unknown>): Normalized | null {
  const email = first(p, ["email", "contact.email", "data.email"]);
  if (!email) return null;
  return {
    email: String(email),
    name: first(p, ["name", "nome", "contact.name"]) as string | undefined,
    phone: first(p, ["phone", "telefone", "contact.phone"]) as string | undefined,
    event: String(first(p, ["event", "type", "evento"]) ?? "webhook.generic"),
    product: first(p, ["product", "produto"]) as string | undefined,
    data: { provider: "generic", raw: p },
  };
}

/* ---------------- Aplicação ---------------- */
function productTag(cfg: WebhookConfig, product?: string): string | null {
  if (!product) return null;
  const ps = slugify(product);
  for (const [k, tag] of Object.entries(cfg.product_tags ?? {})) {
    const ks = slugify(k);
    if (ps === ks || ps.includes(ks) || ks.includes(ps)) return tag;
  }
  return null;
}

export async function applyNormalized(n: Normalized, cfg: WebhookConfig, by: string) {
  const attributes: Record<string, unknown> = {};
  if (n.product) attributes.ultimo_produto = n.product;
  if (n.event === "purchase") attributes.ultima_compra = new Date().toISOString();
  const { contact, created } = await upsertContact({ email: n.email, name: n.name, phone: n.phone, attributes, source: by }, by);

  const tagsAdded: string[] = [];
  const pTag = productTag(cfg, n.product);
  const add = async (t?: string | null) => { if (t && (await addTag(contact.id, t, by))) tagsAdded.push(t); };

  if (n.event === "purchase") {
    await add(cfg.default_tag);
    await add(pTag);
    if (!pTag && n.product) await add(`comprou-${slugify(n.product)}`);
    if (cfg.pending_tag) await removeTag(contact.id, cfg.pending_tag, by);
    for (const l of cfg.lists ?? []) await (await import("./core")).addToList(contact.id, l, by);
  } else if (n.event === "purchase.pending" || n.event === "payment.failed" || n.event === "abandoned_cart") {
    await add(cfg.pending_tag ?? "pendente");
    if (n.product) await add(`pendente-${slugify(n.product)}`);
  } else if (n.event === "refund") {
    await add(cfg.refund_tag ?? "reembolsou");
    if (pTag) await removeTag(contact.id, pTag, by);
    if (n.product) await add(`reembolsou-${slugify(n.product)}`);
  }

  // o evento é o que dispara as automações com gatilho {type:"event", event:"purchase", filter:{product:...}}
  await recordEvent(contact.id, n.event, { product: n.product, product_slug: n.product ? slugify(n.product) : undefined, offer: n.offer, amount: n.amount, ...n.data }, by);
  return { contact_id: contact.id, email: contact.email, created, event: n.event, tags_added: tagsAdded };
}
