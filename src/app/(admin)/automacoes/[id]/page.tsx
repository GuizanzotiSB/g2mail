import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { validateSteps } from "@/lib/automation/validate";
import { FlowView, triggerText } from "@/components/FlowView";
import type { Automation, Step, Trigger } from "@/lib/automation/types";

export const dynamic = "force-dynamic";

const EXAMPLE: Step[] = [
  { id: "s1", type: "send_email", template_id: "<id do template>" },
  { id: "s2", type: "wait", amount: 2, unit: "days" },
  { id: "s3", type: "condition", condition: { kind: "opened_email", step_id: "s1" },
    yes: [{ id: "s4", type: "add_tag", tag: "engajado" }],
    no: [{ id: "s5", type: "send_email", template_id: "<id do template 2>" }] },
  { id: "s6", type: "goal", condition: { kind: "has_tag", tag: "comprou-cmp" } },
];

export default async function Automacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const { data } = await db().from("automations").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Automation;
  const [{ data: tpls }, { data: runs }, { data: tags }, { data: lists }] = await Promise.all([
    db().from("email_templates").select("id,name"),
    db().from("automation_runs").select("id,status,current_step,next_run_at,started_at,finished_at,error,contacts(email)").eq("automation_id", id).order("started_at", { ascending: false }).limit(50),
    db().from("tags").select("slug"), db().from("lists").select("slug"),
  ]);
  const templates = Object.fromEntries((tpls ?? []).map((t) => [t.id, t.name]));
  const waiting: Record<string, number> = {};
  for (const r of runs ?? []) if (r.status === "waiting" && r.current_step) waiting[r.current_step] = (waiting[r.current_step] ?? 0) + 1;
  const stats = (runs ?? []).reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});

  async function save(fd: FormData) {
    "use server";
    let trigger: Trigger, steps: Step[];
    try { trigger = JSON.parse(String(fd.get("trigger"))); steps = JSON.parse(String(fd.get("steps"))); }
    catch (e) { redirect(`/automacoes/${id}?msg=JSON inválido: ${(e as Error).message}`); }
    const v = validateSteps(steps!); if (v) redirect(`/automacoes/${id}?msg=${encodeURIComponent(v)}`);
    await db().from("automations").update({
      name: String(fd.get("name")), description: String(fd.get("description") ?? "") || null, trigger: trigger!, steps: steps!,
      settings: { ...a.settings, allow_reentry: fd.get("allow_reentry") === "on" },
    }).eq("id", id);
    redirect(`/automacoes/${id}?msg=salvo`);
  }
  async function setStatus(fd: FormData) { "use server"; await db().from("automations").update({ status: String(fd.get("status")) }).eq("id", id); redirect(`/automacoes/${id}`); }
  async function remove() { "use server"; await db().from("automations").delete().eq("id", id); redirect("/automacoes"); }
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

  return (
    <div className="space-y-4">
      <Link href="/automacoes" className="text-sm text-muted">← Automações</Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{a.name}</h1>
          <p className="text-muted text-sm">{triggerText(a.trigger)} · <span className={`badge ${a.status === "active" ? "text-green-700" : ""}`}>{a.status}</span></p>
        </div>
        <div className="flex gap-2">
          {a.status !== "active" && <form action={setStatus}><input type="hidden" name="status" value="active" /><button className="btn-primary">Ativar</button></form>}
          {a.status === "active" && <form action={setStatus}><input type="hidden" name="status" value="paused" /><button className="btn-ghost">Pausar</button></form>}
          <form action={remove}><button className="btn-danger">Apagar</button></form>
        </div>
      </div>
      {msg && <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">{decodeURIComponent(msg)}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="card">
            <h2 className="font-semibold mb-2">Fluxo</h2>
            <div className="rounded-md border-l-4 border-purple-400 bg-card border border-border px-3 py-2 text-sm mb-2">⚡ Gatilho: {triggerText(a.trigger)}</div>
            <FlowView steps={a.steps} templates={templates} counts={waiting} />
          </div>
          <div className="card text-sm">
            <h2 className="font-semibold mb-2">Contatos</h2>
            <div className="flex gap-3 flex-wrap">{Object.entries(stats).map(([k, v]) => <span key={k} className="badge">{k}: {v}</span>)}{!runs?.length && <span className="text-muted">ninguém passou ainda</span>}</div>
            <table className="w-full mt-2"><thead><tr><th className="th">Contato</th><th className="th">Status</th><th className="th">Passo</th><th className="th">Próximo</th></tr></thead>
              <tbody>{(runs ?? []).slice(0, 20).map((r) => (
                <tr key={r.id}><td className="td">{(r.contacts as unknown as { email: string })?.email}</td><td className="td">{r.status}{r.error && <div className="text-xs text-red-600">{r.error}</div>}</td><td className="td">{r.current_step ?? "—"}</td><td className="td text-muted">{fmt(r.next_run_at)}</td></tr>
              ))}</tbody></table>
          </div>
        </div>

        <form action={save} className="space-y-3">
          <div className="card space-y-3">
            <label className="block text-sm">Nome<input className="input" name="name" defaultValue={a.name} /></label>
            <label className="block text-sm">Descrição<input className="input" name="description" defaultValue={a.description ?? ""} /></label>
            <label className="block text-sm">Gatilho (JSON)<textarea className="input font-mono text-xs h-20" name="trigger" defaultValue={JSON.stringify(a.trigger, null, 2)} /></label>
            <label className="block text-sm">Passos (JSON)<textarea className="input font-mono text-xs h-96" name="steps" defaultValue={JSON.stringify(a.steps.length ? a.steps : EXAMPLE, null, 2)} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_reentry" defaultChecked={!!a.settings?.allow_reentry} /> Permitir que o contato entre de novo depois de concluir</label>
            <button className="btn-primary">Salvar</button>
          </div>
          <details className="card text-xs text-muted">
            <summary className="cursor-pointer text-sm text-foreground">Referência rápida</summary>
            <div className="mt-2 space-y-1 font-mono">
              <div>Gatilhos: {`{"type":"tag.added","tag":"x"}`} · {`{"type":"list.added","list":"x"}`} · {`{"type":"event","event":"purchase","filter":{"product_slug":"mvs"}}`} · {`{"type":"webhook","key":"minha-chave"}`} · {`{"type":"manual"}`}</div>
              <div>Passos: send_email(template_id) · add_tag/remove_tag(tag) · add_to_list/remove_from_list(list) · wait(amount,unit) · wait_until(hour,minute) · condition(condition,yes,no) · webhook(url) · update_attribute(field,value) · goal(condition) · end</div>
              <div>Condições: has_tag · not_has_tag · in_list · attribute(field,op,value) · opened_email(step_id) · clicked_email(step_id) · event_since_start(event) · all/any(conditions)</div>
              <div>Templates: {Object.entries(templates).map(([i, n]) => `${n} = ${i}`).join(" · ") || "nenhum"}</div>
              <div>Tags: {(tags ?? []).map((t) => t.slug).join(", ") || "nenhuma"}</div>
              <div>Listas: {(lists ?? []).map((l) => l.slug).join(", ") || "nenhuma"}</div>
            </div>
          </details>
        </form>
      </div>
    </div>
  );
}
