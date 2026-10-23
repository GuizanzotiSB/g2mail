import Link from "next/link";
import { redirect } from "next/navigation";
import { isLoggedIn, logout } from "@/lib/session";

const nav = [
  ["/", "Visão geral"],
  ["/contatos", "Contatos"],
  ["/tags", "Tags"],
  ["/listas", "Listas"],
  ["/templates", "Templates"],
  ["/automacoes", "Automações"],
  ["/integracoes", "Integrações"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLoggedIn())) redirect("/login");
  async function doLogout() { "use server"; await logout(); redirect("/login"); }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-card p-4 flex flex-col">
        <Link href="/" className="text-xl font-bold text-brand mb-6">G²<span className="text-foreground"> Mail</span></Link>
        <nav className="flex flex-col gap-1 text-sm">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-md px-3 py-2 hover:bg-background">{label}</Link>
          ))}
        </nav>
        <form action={doLogout} className="mt-auto"><button className="text-xs text-muted hover:text-foreground">Sair</button></form>
      </aside>
      <main className="flex-1 p-8 max-w-6xl">{children}</main>
    </div>
  );
}
