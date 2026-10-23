import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getContact, contactTags, contactLists, addTag, removeTag, addToList, removeFromList, unsubscribeContact } from "@/lib/core";
import { enroll } from "@/lib/automation/engine";
import type { Automation } from "@/lib/automation/types";

export const dynamic = "force-dynamic";

export default async function Contato({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getContact(id);
  if (!c) notFound();
  const [tags, lists, events, runs, sends, autos] = await Promise.all([
    contactTags(c.id), contactLists(c.id),
    db().from("events").select("*").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(40).then((r) => r.data ?? []),
    db().from("automation_runs").select("*, automations(name)").eq("contact_id", c.id).order("started_at", { ascending: false }).then((r) => r.data ?? []),
    db().from("email_sends").select("*").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(20).then((r) => r.data ?? []),
    db().from("automations").select("id,name").eq("status", "active").then((r) => r.data ?? []),
  ]);

  const act = async (fn: () => Promise<unknown>) => { await fn(); revalidatePath(`/contatos/${c.id}`); };
  async function tagAdd(fd: FormData) { "use server"; await act(() => addTag(c!.id, String(fd.get("tag")), "ui")); }
  async function tagRemove(fd: FormData) { "use server"; await act(() => removeTag(c!.id, String(fd.get("tag")), "ui")); }
  async function listAdd(fd: FormData) { "use server"; await act(() => addToList(c!.id, String(fd.get("list")), "ui")); }
  async function listRemove(fd: FormData) { "use server"; await act(() => removeFromList(c!.id, String(fd.get("list")), "ui")); }
  async function unsub() { "use server"; await unsubscribeContact(c!.id, "ui"); redirect(`/contatos/${c!.id}`); }
  async function enrollIn(fd: FormData) {
    "use server";
    const { data: a } = await db().from("automations").select("*").eq("id", String(fd.get("automation"))).single();
    if (a) await enroll(a as Automation, c!.id, { manual: true });
    revalidatePath(`/contatos/${c!.id}`);
  }
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/contatos" className="text-sm text-muted">← Contatos</Link>
          <h1 className="text-2xl font-semibold">{c.name ?? c.email}</h1>
          <p className="text-muted">{c.email} · {c.phone_norm ?? "sem telefone"} · <span className={c.status === "active" ? "text-green-700" : "text-red-700"}>{c.status}</span> · origem: {c.source ?? "—"}</p>
        </div>
        {c.status === "active" && <form action={unsub}><button className="btn-danger">Descadastrar</button></form>}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card space-y-2">
          <h2 className="font-semibold">Tags</h2>
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <form key={t.id} action={tagRemove} className="badge gap-1"><span>{t.slug}</span><input type="hidden" name="tag" value={t.slug} /><button className="text-muted hover:text-red-600" title="remover">×</button></form>
            ))}
            {!tags.length && <span className="text-sm text-muted">nenhuma</span>}
          </div>
          <form action={tagAdd} className="flex gap-1"><input className="input" name="tag" placeholder="nova tag" /><button className="btn-ghost">+</button></form>
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold">Listas</h2>
          <div className="flex flex-wrap gap-1">
            {lists.map((l) => (
              <form key={l.id} action={listRemove} className="badge gap-1"><span>{l.slug}</span><input type="hidden" name="list" value={l.slug} /><button className="text-muted hover:text-red-600">×</button></form>
            ))}
            {!lists.length && <span className="text-sm text-muted">nenhuma</span>}
          </div>
          <form action={listAdd} className="flex gap-1"><input className="input" name="list" placeholder="nova lista" /><button className="btn-ghost">+</button></form>
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold">Atributos</h2>
          <pre className="text-xs bg-background rounded p-2 overflow-auto max-h-40">{JSON.stringify(c.attributes, null, 2)}</pre>
          <form action={enrollIn} className="flex gap-1">
            <select className="input" name="automation">{autos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <button className="btn-ghost whitespace-nowrap" disabled={!autos.length}>Colocar na automação</button>
          </form>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold mb-2">Automações</h2>
          <table className="w-full"><thead><tr><th className="th">Automação</th><th className="th">Status</th><th className="th">Passo</th><th className="th">Próximo</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}><td className="td"><Link className="text-brand" href={`/automacoes/${r.automation_id}`}>{(r.automations as unknown as { name: string })?.name}</Link></td><td className="td"><span className="badge">{r.status}</span></td><td className="td">{r.current_step ?? "—"}</td><td className="td text-muted">{fmt(r.next_run_at)}</td></tr>
            ))}{!runs.length && <tr><td className="td text-muted" colSpan={4}>nenhuma</td></tr>}</tbody></table>
        </div>
        <div className="card">
          <h2 className="font-semibold mb-2">Emails</h2>
          <table className="w-full"><thead><tr><th className="th">Assunto</th><th className="th">Status</th><th className="th">Abriu</th><th className="th">Clicou</th></tr></thead>
            <tbody>{sends.map((s) => (
              <tr key={s.id}><td className="td">{s.subject}</td><td className="td"><span className="badge">{s.status}</span>{s.error && <div className="text-xs text-red-600">{s.error}</div>}</td><td className="td text-muted">{fmt(s.opened_at)}</td><td className="td text-muted">{fmt(s.clicked_at)}</td></tr>
            ))}{!sends.length && <tr><td className="td text-muted" colSpan={4}>nenhum</td></tr>}</tbody></table>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Linha do tempo</h2>
        <ul className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3"><span className="text-muted w-40 shrink-0">{fmt(e.created_at)}</span><span className="badge">{e.type}</span><span className="text-muted truncate">{JSON.stringify(Object.fromEntries(Object.entries(e.data ?? {}).filter(([k]) => k !== "raw")))}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
