import Link from "next/link";
import { db } from "@/lib/db";
import { listmonk } from "@/lib/listmonk";

export const dynamic = "force-dynamic";

function Stat({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{href ? <Link href={href}>{value}</Link> : value}</div>
    </div>
  );
}

const sevenDaysAgo = () => new Date(Date.now() - 7 * 86400e3).toISOString();

export default async function Home() {
  const since = sevenDaysAgo();
  const [c, t, l, a, s, due, ev] = await Promise.all([
    db().from("contacts").select("status"),
    db().from("tags").select("id", { count: "exact", head: true }),
    db().from("lists").select("id", { count: "exact", head: true }),
    db().from("automations").select("id,name,status"),
    db().from("email_sends").select("status,opened_at,clicked_at").gte("created_at", since),
    db().from("automation_runs").select("id", { count: "exact", head: true }).in("status", ["running", "waiting"]),
    db().from("events").select("type,data,created_at,contacts(email)").order("created_at", { ascending: false }).limit(15),
  ]);
  const byStatus = (c.data ?? []).reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});
  const sends = s.data ?? [];
  const lm = listmonk.enabled() ? (await listmonk.health() ? "ok" : "sem resposta") : "não configurado";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Visão geral</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Contatos ativos" value={byStatus.active ?? 0} href="/contatos" />
        <Stat label="Descadastrados" value={(byStatus.unsubscribed ?? 0) + (byStatus.bounced ?? 0) + (byStatus.blocklisted ?? 0)} />
        <Stat label="Tags" value={t.count ?? 0} href="/tags" />
        <Stat label="Listas" value={l.count ?? 0} href="/listas" />
        <Stat label="Automações ativas" value={(a.data ?? []).filter((x) => x.status === "active").length} href="/automacoes" />
        <Stat label="Contatos em automação" value={due.count ?? 0} />
        <Stat label="Emails (7 dias)" value={`${sends.filter((x) => x.status === "sent").length} enviados · ${sends.filter((x) => x.opened_at).length} abertos · ${sends.filter((x) => x.clicked_at).length} cliques`} />
        <Stat label="Listmonk" value={<span className={lm === "ok" ? "text-green-700" : "text-red-700"}>{lm}</span>} />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Últimos eventos</h2>
        <table className="w-full">
          <thead><tr><th className="th">Quando</th><th className="th">Contato</th><th className="th">Evento</th><th className="th">Dados</th></tr></thead>
          <tbody>
            {(ev.data ?? []).map((e, i) => (
              <tr key={i}>
                <td className="td whitespace-nowrap text-muted">{new Date(e.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className="td">{(e.contacts as unknown as { email: string } | null)?.email ?? "—"}</td>
                <td className="td"><span className="badge">{e.type}</span></td>
                <td className="td text-muted truncate max-w-xs">{JSON.stringify(Object.fromEntries(Object.entries(e.data ?? {}).filter(([k]) => k !== "raw")))}</td>
              </tr>
            ))}
            {!ev.data?.length && <tr><td className="td text-muted" colSpan={4}>Nenhum evento ainda. Crie um contato ou conecte um webhook em Integrações.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
