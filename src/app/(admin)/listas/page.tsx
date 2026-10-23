import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ensureList } from "@/lib/core";

export const dynamic = "force-dynamic";

export default async function Listas() {
  const { data } = await db().from("lists").select("*, list_members(count)").order("name");

  async function create(fd: FormData) { "use server"; const n = String(fd.get("name") ?? "").trim(); if (n) await ensureList(n); revalidatePath("/listas"); }
  async function remove(fd: FormData) { "use server"; await db().from("lists").delete().eq("id", String(fd.get("id"))); revalidatePath("/listas"); }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Listas</h1>
      <p className="text-sm text-muted">Listas são espelhadas no Listmonk — campanhas em massa são enviadas pra listas.</p>
      <form action={create} className="flex gap-2 max-w-md"><input className="input" name="name" placeholder="Nova lista (ex.: Alunos MVS)" /><button className="btn-primary">Criar</button></form>
      <div className="card p-0">
        <table className="w-full">
          <thead><tr><th className="th">Lista</th><th className="th">Slug</th><th className="th">Membros</th><th className="th">Listmonk</th><th className="th"></th></tr></thead>
          <tbody>
            {(data ?? []).map((l) => (
              <tr key={l.id}>
                <td className="td font-medium">{l.name}</td>
                <td className="td"><Link href={`/contatos?list=${l.slug}`} className="badge hover:border-brand">{l.slug}</Link></td>
                <td className="td">{(l.list_members as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
                <td className="td text-muted">{l.listmonk_id ? `#${l.listmonk_id}` : "não sincronizada"}</td>
                <td className="td text-right"><form action={remove}><input type="hidden" name="id" value={l.id} /><button className="text-xs text-muted hover:text-red-600">apagar</button></form></td>
              </tr>
            ))}
            {!data?.length && <tr><td className="td text-muted" colSpan={5}>Nenhuma lista.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
