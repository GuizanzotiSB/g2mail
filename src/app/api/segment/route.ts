import { withAuth, json, err, qp } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/segment?must=tag1,tag2&must_not=tag3&limit=&offset=&count=1
 *  Contatos ativos que têm TODAS as tags de must e NENHUMA de must_not. */
export const GET = withAuth("read", async (req) => {
  const p = qp(req);
  const must = (p.get("must") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const must_not = (p.get("must_not") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const lim = Math.min(Number(p.get("limit") ?? 100), 5000);
  const off = Number(p.get("offset") ?? 0);
  const { data, error } = await db().rpc("segment_contacts", { must, must_not, lim, off });
  if (error) return err(error.message, 500);
  return json({ data, must, must_not, limit: lim, offset: off });
});
