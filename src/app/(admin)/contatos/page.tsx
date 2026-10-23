import Link from "next/link";
import { redirect } from "next/navigation";
import { listContacts } from "@/lib/queries";
import { upsertContact } from "@/lib/core";

export const dynamic = "force-dynamic";

export default async function Contatos({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; list?: string; p?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p ?? 1));
  const per = 50;
  const { rows: data, total: count } = await listContacts({ q: sp.q, tag: sp.tag, list: sp.list, limit: per, offset: (page - 1) * per, fields: "id,email,name,phone_norm,status,created_at" });

  async function create(fd: FormData) {
    "use server";
    const email = String(fd.get("email") ?? "").trim();
    if (!email) return;
    const tags = String(fd.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { contact } = await upsertContact({ email, name: String(fd.get("name") ?? "") || undefined, phone: String(fd.get("phone") ?? "") || undefined, tags, source: "manual" }, "ui");
    redirect(`/contatos/${contact.id}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contatos <span className="text-muted text-base font-normal">({count ?? 0})</span></h1>
      </div>
      <form className="flex gap-2" method="get">
        <input className="input max-w-sm" name="q" placeholder="Buscar por email, nome ou telefone" defaultValue={sp.q} />
        <input className="input max-w-40" name="tag" placeholder="tag" defaultValue={sp.tag} />
        <input className="input max-w-40" name="list" placeholder="lista" defaultValue={sp.list} />
        <button className="btn-ghost" type="submit">Filtrar</button>
      </form>
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">+ Novo contato</summary>
        <form action={create} className="mt-3 grid grid-cols-5 gap-2">
          <input className="input" name="email" placeholder="email" required />
          <input className="input" name="name" placeholder="nome" />
          <input className="input" name="phone" placeholder="telefone" />
          <input className="input" name="tags" placeholder="tags (a, b)" />
          <button className="btn-primary justify-center" type="submit">Criar</button>
        </form>
      </details>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Email</th><th className="th">Nome</th><th className="th">Telefone</th><th className="th">Tags</th><th className="th">Listas</th><th className="th">Status</th><th className="th">Criado</th></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className="hover:bg-background">
                <td className="td"><Link className="text-brand hover:underline" href={`/contatos/${c.id}`}>{c.email}</Link></td>
                <td className="td">{c.name ?? "—"}</td>
                <td className="td text-muted">{c.phone_norm ?? "—"}</td>
                <td className="td"><div className="flex flex-wrap gap-1">{(c.tags as string[]).map((t) => <Link key={t} href={`/contatos?tag=${t}`} className="badge">{t}</Link>)}</div></td>
                <td className="td"><div className="flex flex-wrap gap-1">{(c.lists as string[]).map((l) => <Link key={l} href={`/contatos?list=${l}`} className="badge">{l}</Link>)}</div></td>
                <td className="td"><span className={`badge ${c.status === "active" ? "text-green-700" : "text-red-700"}`}>{c.status}</span></td>
                <td className="td text-muted whitespace-nowrap">{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {!data?.length && <tr><td className="td text-muted" colSpan={7}>Nenhum contato.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 text-sm">
        {page > 1 && <Link className="btn-ghost" href={`/contatos?${new URLSearchParams({ ...sp, p: String(page - 1) })}`}>← Anterior</Link>}
        {(count ?? 0) > page * per && <Link className="btn-ghost" href={`/contatos?${new URLSearchParams({ ...sp, p: String(page + 1) })}`}>Próxima →</Link>}
      </div>
    </div>
  );
}
