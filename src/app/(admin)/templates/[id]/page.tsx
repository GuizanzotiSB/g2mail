import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getContact } from "@/lib/core";
import { sendTemplateEmail } from "@/lib/automation/engine";

export const dynamic = "force-dynamic";

export default async function Template({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const { data: t } = await db().from("email_templates").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();

  async function save(fd: FormData) {
    "use server";
    await db().from("email_templates").update({
      name: String(fd.get("name")), subject: String(fd.get("subject")), body_html: String(fd.get("body_html")),
      from_name: String(fd.get("from_name") ?? "") || null, from_email: String(fd.get("from_email") ?? "") || null,
    }).eq("id", id);
    revalidatePath(`/templates/${id}`);
    redirect(`/templates/${id}?msg=salvo`);
  }
  async function test(fd: FormData) {
    "use server";
    const c = await getContact(String(fd.get("email")));
    if (!c) redirect(`/templates/${id}?msg=contato não encontrado (crie o contato primeiro)`);
    try { await sendTemplateEmail(c.id, id, {}); redirect(`/templates/${id}?msg=enviado para ${c.email}`); }
    catch (e) { if ((e as Error).message?.includes("NEXT_REDIRECT")) throw e; redirect(`/templates/${id}?msg=erro: ${(e as Error).message}`); }
  }
  async function remove() { "use server"; await db().from("email_templates").delete().eq("id", id); redirect("/templates"); }

  return (
    <div className="space-y-4">
      <Link href="/templates" className="text-sm text-muted">← Templates</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.name}</h1>
        <form action={remove}><button className="btn-danger">Apagar</button></form>
      </div>
      {msg && <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">{msg}</div>}
      <form action={save} className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="block text-sm">Nome<input className="input" name="name" defaultValue={t.name} /></label>
          <label className="block text-sm">Assunto<input className="input" name="subject" defaultValue={t.subject} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">Nome do remetente<input className="input" name="from_name" defaultValue={t.from_name ?? ""} placeholder="padrão do Listmonk" /></label>
            <label className="block text-sm">Email do remetente<input className="input" name="from_email" defaultValue={t.from_email ?? ""} placeholder="padrão do Listmonk" /></label>
          </div>
          <label className="block text-sm">HTML <span className="text-muted">— variáveis: {"{{nome}}"}, {"{{email}}"}, {"{{atributo}}"}</span>
            <textarea className="input font-mono text-xs h-[480px]" name="body_html" defaultValue={t.body_html} />
          </label>
          <button className="btn-primary">Salvar</button>
        </div>
        <div className="space-y-2">
          <div className="text-sm text-muted">Pré-visualização</div>
          <iframe className="w-full h-[560px] rounded-md border border-border bg-white" srcDoc={t.body_html.replace(/\{\{\s*nome\s*\}\}/g, "Fulano").replace(/\{\{\s*email\s*\}\}/g, "fulano@email.com")} />
        </div>
      </form>
      <form action={test} className="card flex items-center gap-2 max-w-lg">
        <span className="text-sm whitespace-nowrap">Enviar teste para</span>
        <input className="input" name="email" placeholder="email de um contato cadastrado" />
        <button className="btn-ghost whitespace-nowrap">Enviar</button>
      </form>
    </div>
  );
}
