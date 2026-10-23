import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/core";

export const dynamic = "force-dynamic";

/** GET /t/c/:sendId?u=<url> — redireciona e registra clique (e abertura) */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url).searchParams.get("u") ?? "/";
  const sendId = Number(id);
  if (sendId) {
    const { data } = await db().from("email_sends").select("id,contact_id,opened_at,clicked_at").eq("id", sendId).maybeSingle();
    if (data) {
      const now = new Date().toISOString();
      await db().from("email_sends").update({ clicked_at: data.clicked_at ?? now, opened_at: data.opened_at ?? now }).eq("id", sendId);
      await recordEvent(data.contact_id, "email.clicked", { send_id: sendId, url }, "tracking");
    }
  }
  const safe = /^https?:\/\//i.test(url) ? url : "/";
  return NextResponse.redirect(safe, 302);
}
