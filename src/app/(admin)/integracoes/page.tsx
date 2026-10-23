import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { generateApiKey, sha256 } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Integracoes({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  const [{ data: keys }, { data: hooks }, { data: logs }] = await Promise.all([
    db().from("api_keys").select("id,name,key_prefix,scopes,last_used_at,created_at").is("revoked_at", null).order("created_at", { ascending: false }),
    db().from("inbound_webhooks").select("*").eq("active", true).order("created_at", { ascending: false }),
    db().from("webhook_logs").select("id,provider,ok,result,created_at").order("created_at", { ascending: false }).limit(15),
  ]);
  const base = env.appUrl();

  async function createKey(fd: FormData) {
    "use server";
    const name = String(fd.get("name") ?? "").trim(); if (!name) return;
    const scopes = String(fd.get("scopes") ?? "read,write").split(",").map((s) => s.trim());
    const k = generateApiKey();
    await db().from("api_keys").insert({ name, key_hash: sha256(k), key_prefix: k.slice(0, 12), scopes });
    redirect(`/integracoes?key=${encodeURIComponent(k)}`);
  }
  async function revokeKey(fd: FormData) { "use server"; await db().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", String(fd.get("id"))); redirect("/integracoes"); }
  async function createHook(fd: FormData) {
    "use server";
    const name = String(fd.get("name") ?? "").trim(); if (!name) return;
    let config = {};
    try { config = JSON.parse(String(fd.get("config") || "{}")); } catch { /* ignora */ }
    await db().from("inbound_webhooks").insert({ name, provider: String(fd.get("provider")), secret: randomBytes(18).toString("base64url"), config });
    redirect("/integracoes");
  }
  async function removeHook(fd: FormData) { "use server"; await db().from("inbound_webhooks").update({ active: false }).eq("id", String(fd.get("id"))); redirect("/integracoes"); }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Integrações</h1>

      <section className="card space-y-3">
        <h2 className="font-semibold">Claude (MCP)</h2>
        <p className="text-sm text-muted">No claude.ai: Configurações → Conectores → Adicionar conector personalizado. URL do servidor: <code className="bg-background px-1 rounded">{base}/api/mcp</code> — autenticação por header <code className="bg-background px-1 rounded">Authorization: Bearer &lt;chave de API&gt;</code>. Pelo MCP dá pra gerenciar contatos, tags, listas, templates, automações, campanhas e webhooks.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Chaves de API</h2>
        {key && <div className="rounded-md border border-brand bg-orange-50 p-3 text-sm">Chave criada — copie agora, ela não aparece de novo:<br /><code className="font-mono text-base select-all">{key}</code></div>}
        <form action={createKey} className="flex gap-2"><input className="input max-w-xs" name="name" placeholder="nome (ex.: n8n, claude)" /><input className="input max-w-xs" name="scopes" placeholder="read,write[,admin]" defaultValue="read,write,admin" /><button className="btn-primary">Gerar chave</button></form>
        <table className="w-full"><thead><tr><th className="th">Nome</th><th className="th">Prefixo</th><th className="th">Permissões</th><th className="th">Último uso</th><th className="th"></th></tr></thead>
          <tbody>{(keys ?? []).map((k) => (
            <tr key={k.id}><td className="td">{k.name}</td><td className="td font-mono text-muted">{k.key_prefix}…</td><td className="td">{k.scopes.join(", ")}</td><td className="td text-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString("pt-BR") : "nunca"}</td><td className="td text-right"><form action={revokeKey}><input type="hidden" name="id" value={k.id} /><button className="text-xs text-muted hover:text-red-600">revogar</button></form></td></tr>
          ))}{!keys?.length && <tr><td className="td text-muted" colSpan={5}>Nenhuma chave (a MASTER_API_KEY do .env sempre funciona).</td></tr>}</tbody></table>
        <p className="text-xs text-muted">REST: <code>GET/POST {base}/api/contacts</code>, <code>/api/contacts/:id/tags</code>, <code>/api/tags</code>, <code>/api/lists</code>, <code>/api/templates</code>, <code>/api/automations</code>, <code>/api/automations/trigger/:key</code>, <code>/api/events</code>, <code>/api/segment</code>, <code>/api/send</code>, <code>/api/campaigns</code>.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Webhooks de entrada (Hubla, TMB, genérico)</h2>
        <p className="text-sm text-muted">Cole a URL na plataforma. Compra aprovada → contato criado + tag do produto + evento <code>purchase</code> (que dispara automações). Config (JSON): <code>{`{"product_tags":{"Máquina de Vendas":"comprou-mvs","Loja Express":"comprou-loja-express","Maverick":"comprou-cmp"},"default_tag":"cliente","pending_tag":"pendente","refund_tag":"reembolsou","lists":["clientes"]}`}</code></p>
        <form action={createHook} className="grid grid-cols-6 gap-2">
          <input className="input col-span-2" name="name" placeholder="nome (ex.: Hubla principal)" />
          <select className="input" name="provider"><option value="hubla">Hubla</option><option value="tmb">TMB</option><option value="generic">Genérico</option></select>
          <input className="input col-span-2 font-mono text-xs" name="config" placeholder='{"product_tags":{...}}' />
          <button className="btn-primary justify-center">Criar</button>
        </form>
        <table className="w-full"><thead><tr><th className="th">Nome</th><th className="th">Provedor</th><th className="th">URL</th><th className="th">Config</th><th className="th"></th></tr></thead>
          <tbody>{(hooks ?? []).map((h) => (
            <tr key={h.id}><td className="td">{h.name}</td><td className="td">{h.provider}</td><td className="td font-mono text-xs select-all">{base}/api/webhooks/{h.provider}/{h.secret}</td><td className="td font-mono text-xs text-muted max-w-xs truncate">{JSON.stringify(h.config)}</td><td className="td text-right"><form action={removeHook}><input type="hidden" name="id" value={h.id} /><button className="text-xs text-muted hover:text-red-600">desativar</button></form></td></tr>
          ))}{!hooks?.length && <tr><td className="td text-muted" colSpan={5}>Nenhum webhook.</td></tr>}</tbody></table>
        <h3 className="text-sm font-semibold mt-2">Últimos recebidos</h3>
        <table className="w-full"><tbody>{(logs ?? []).map((l) => (
          <tr key={l.id}><td className="td text-muted whitespace-nowrap">{new Date(l.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td><td className="td">{l.provider}</td><td className="td">{l.ok ? "✅" : "❌"}</td><td className="td font-mono text-xs text-muted truncate max-w-md">{JSON.stringify(l.result)}</td></tr>
        ))}{!logs?.length && <tr><td className="td text-muted">nenhum ainda</td></tr>}</tbody></table>
      </section>
    </div>
  );
}
