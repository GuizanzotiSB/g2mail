import { cookies } from "next/headers";
import { createHmac } from "crypto";
import { env } from "./env";

const COOKIE = "g2mail_session";

function sign(v: string) {
  return createHmac("sha256", env.adminPassword() || "dev").update(v).digest("hex");
}

export async function isLoggedIn(): Promise<boolean> {
  if (!env.adminPassword()) return true; // sem senha configurada = acesso livre (só em dev)
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && c === sign("admin");
}

export async function login(password: string): Promise<boolean> {
  if (!env.adminPassword() || password !== env.adminPassword()) return false;
  (await cookies()).set(COOKIE, sign("admin"), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return true;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}
