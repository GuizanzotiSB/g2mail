import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Automacoes() {
  const { data } = await db().from("automations").select("id,name,status,trigger,updated_at").order("updated_at", { ascending: false });
  const { data: counts } = await db().from("automation_runs").select("automation_id,status");
  const by: Record<string, Record<string, number>> = {};
  for (const r of counts ?? []) { by[r.automation_id] ??= {}; by[r.automation_id][r.status] = (by[r.automation_id][r.status] ?? 0) + 1; }

  async function create(fd: FormData) {
    "use server";
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return;
    const { data } = await db().from("automations").insert({ name, trigger: { type: "tag.added", tag: "nova-tag" }, steps: [] }).select("id").single();
    redirect(`/automacoes/${data!.id}`);
  }
  const trig = (t: Record<string, unknown>) => `${t.type}${t.tag ? ` · ${t.tag}` : ""}${t.list ? ` · ${t.list}` : ""}${t.event ? ` · ${t.event}` : ""}${t.key ? ` · ${t.key}` : ""}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Automações</h1>
      <form action={create} className="flex gap-2 max-w-md"><input className="input" name="name" placeholder="Nome da automação" /><button className="btn-primary">Criar</button></form>
      <div className="card p-0">
        <table className="w-full">
          <thead><tr><th className="th">Nome</th><th className="th">Gatilho</th><th className="th">Status</th><th className="th">Ativos</th><th className="th">Concluídos</th><th className="th">Falhas</th></tr></thead>
          <tbody>
            {(data ?? []).map((a) => {
              const r = by[a.id] ?? {};
              return (
                <tr key={a.id}>
                  <td className="td"><Link className="text-brand hover:underline" href={`/automacoes/${a.id}`}>{a.name}</Link></td>
                  <td className="td text-muted">{trig(a.trigger as Record<string, unknown>)}</td>
                  <td className="td"><span className={`badge ${a.status === "active" ? "text-green-700" : a.status === "paused" ? "text-amber-700" : ""}`}>{a.status}</span></td>
                  <td className="td">{(r.running ?? 0) + (r.waiting ?? 0)}</td>
                  <td className="td">{(r.completed ?? 0) + (r.goal_reached ?? 0)}</td>
                  <td className="td">{r.failed ?? 0}</td>
                </tr>
              );
            })}
            {!data?.length && <tr><td className="td text-muted" colSpan={6}>Nenhuma automação.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
