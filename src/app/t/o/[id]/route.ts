import { db } from "@/lib/db";
import { recordEvent } from "@/lib/core";

export const dynamic = "force-dynamic";
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** GET /t/o/:sendId.gif — pixel de abertura */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sendId = Number(id.replace(/\.gif$/i, ""));
  if (sendId) {
    const { data } = await db().from("email_sends").select("id,contact_id,opened_at").eq("id", sendId).maybeSingle();
    if (data && !data.opened_at) {
      await db().from("email_sends").update({ opened_at: new Date().toISOString() }).eq("id", sendId);
      await recordEvent(data.contact_id, "email.opened", { send_id: sendId }, "tracking");
    }
  }
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate", "content-length": String(GIF.length) } });
}
