function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => req("SUPABASE_URL"),
  supabaseServiceKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  listmonkUrl: () => process.env.LISTMONK_URL ?? "",
  listmonkUser: () => process.env.LISTMONK_USER ?? "",
  listmonkPassword: () => process.env.LISTMONK_PASSWORD ?? "",
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
  adminPassword: () => process.env.ADMIN_PASSWORD ?? "",
  cronSecret: () => process.env.CRON_SECRET ?? "",
  masterApiKey: () => process.env.MASTER_API_KEY ?? "",
};
