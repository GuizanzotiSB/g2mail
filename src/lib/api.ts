import { NextResponse } from "next/server";
import { authenticate, requireScope } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

type Handler<P> = (req: Request, ctx: { params: P; auth: { name: string; scopes: string[] } }) => Promise<Response>;

/** Envolve um route handler com autenticação por API key e tratamento de erro. */
export function withAuth<P = Record<string, string>>(scope: "read" | "write" | "admin", handler: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    const auth = requireScope(await authenticate(req), scope);
    if (!auth.ok) return err(auth.error, auth.status);
    try {
      return await handler(req, { params: await ctx.params, auth: { name: auth.name, scopes: auth.scopes } });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}:`, msg);
      return err(msg, 500);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

export function qp(req: Request) {
  return new URL(req.url).searchParams;
}
