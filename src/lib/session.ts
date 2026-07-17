import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = { id: string; name: string; email: string; role: string };

export async function requireUser(): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  const u = session.user as SessionUser & { banned?: boolean };
  if (u.banned) redirect("/login");
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "employee" };
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "owner") throw new Error("FORBIDDEN");
  return u;
}
