import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ensureTag } from "@/lib/core";

export const dynamic = "force-dynamic";

export default async function Tags() {
  const { data } = await db().from("tags").select("*, contact_tags(count)").order("name");

  async function create(fd: FormData) { "use server"; const n = String(fd.get("name") ?? "").trim(); if (n) await ensureTag(n); revalidatePath("/tags"); }
  async function remove(fd: FormData) { "use server"; await db().from("tags").delete().eq("id", String(fd.get("id"))); revalidatePath("/tags"); }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tags</h1>
      <form action={create} className="flex gap-2 max-w-md"><input className="input" name="name" placeholder="Nova tag (ex.: comprou-mvs)" /><button className="btn-primary">Criar</button></form>
      <div className="card p-0">
        <table className="w-full">
          <thead><tr><th className="th">Tag</th><th className="th">Slug</th><th className="th">Contatos</th><th className="th"></th></tr></thead>
          <tbody>
            {(data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="td font-medium">{t.name}</td>
                <td className="td"><Link href={`/contatos?tag=${t.slug}`} className="badge hover:border-brand">{t.slug}</Link></td>
                <td className="td">{(t.contact_tags as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
                <td className="td text-right"><form action={remove}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-muted hover:text-red-600">apagar</button></form></td>
              </tr>
            ))}
            {!data?.length && <tr><td className="td text-muted" colSpan={4}>Nenhuma tag.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
