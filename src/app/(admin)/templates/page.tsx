import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEFAULT_HTML = `<!doctype html>
<html><body style="margin:0;background:#f7f7f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px">
      <tr><td>
        <p>Oi {{nome}},</p>
        <p>Escreva aqui o seu email.</p>
        <p><a href="https://guilhermecirilo.com.br" style="background:#e8573d;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Botão</a></p>
        <p style="color:#6b6b6b;font-size:12px">G2 Educação · Uberlândia, MG</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

export default async function Templates() {
  const { data } = await db().from("email_templates").select("id,name,subject,from_email,updated_at").order("updated_at", { ascending: false });

  async function create(fd: FormData) {
    "use server";
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return;
    const { data } = await db().from("email_templates").insert({ name, subject: name, body_html: DEFAULT_HTML }).select("id").single();
    redirect(`/templates/${data!.id}`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Templates</h1>
      <form action={create} className="flex gap-2 max-w-md"><input className="input" name="name" placeholder="Nome do template" /><button className="btn-primary">Criar</button></form>
      <div className="card p-0">
        <table className="w-full">
          <thead><tr><th className="th">Nome</th><th className="th">Assunto</th><th className="th">Remetente</th><th className="th">Atualizado</th></tr></thead>
          <tbody>
            {(data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="td"><Link className="text-brand hover:underline" href={`/templates/${t.id}`}>{t.name}</Link></td>
                <td className="td">{t.subject}</td>
                <td className="td text-muted">{t.from_email ?? "padrão"}</td>
                <td className="td text-muted">{new Date(t.updated_at).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {!data?.length && <tr><td className="td text-muted" colSpan={4}>Nenhum template.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
