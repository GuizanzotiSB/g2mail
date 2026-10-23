/**
 * Worker de automações: chama /api/cron/process a cada minuto.
 * Uso: APP_URL=http://localhost:3000 CRON_SECRET=xxx node scripts/worker.mjs
 * (no docker-compose já roda como serviço "worker")
 */
const url = `${(process.env.APP_INTERNAL_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/cron/process`;
const secret = process.env.CRON_SECRET || process.env.MASTER_API_KEY;
const every = Number(process.env.WORKER_INTERVAL_MS || 60_000);

async function tick() {
  try {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) console.error(new Date().toISOString(), "worker erro", res.status, j);
    else if (j.processed) console.log(new Date().toISOString(), `processados=${j.processed} erros=${j.errors} ${j.ms}ms`);
  } catch (e) { console.error(new Date().toISOString(), "worker falhou:", e.message); }
}
console.log("worker g2mail →", url, `a cada ${every / 1000}s`);
tick();
setInterval(tick, every);
