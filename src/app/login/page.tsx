import { redirect } from "next/navigation";
import { login, isLoggedIn } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await isLoggedIn()) redirect("/");
  const { erro } = await searchParams;

  async function doLogin(formData: FormData) {
    "use server";
    const ok = await login(String(formData.get("password") ?? ""));
    redirect(ok ? "/" : "/login?erro=1");
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form action={doLogin} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="text-2xl font-bold text-brand">G²<span className="text-foreground"> Mail</span></div>
          <p className="text-sm text-muted">Email marketing e automações da G2 Educação</p>
        </div>
        <input className="input" type="password" name="password" placeholder="Senha de administrador" autoFocus />
        {erro && <p className="text-sm text-red-600">Senha incorreta.</p>}
        <button className="btn-primary w-full justify-center" type="submit">Entrar</button>
      </form>
    </main>
  );
}
