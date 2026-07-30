import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user as userTable, stores } from "@/db/schema";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  // Tienda del usuario. null = super-admin de plataforma (sin tienda).
  storeId: number | null;
};

export async function requireUser(): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  const u = session.user as { id: string; name: string; email: string; role?: string; banned?: boolean };
  if (u.banned) redirect("/login");
  // storeId no viaja en la sesión de better-auth: se lee de la tabla user.
  const [row] = await db.select({ storeId: userTable.storeId }).from(userTable).where(eq(userTable.id, u.id));
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "employee", storeId: row?.storeId ?? null };
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "owner") throw new Error("FORBIDDEN");
  return u;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "superadmin") throw new Error("FORBIDDEN");
  return u;
}

// Tienda activa: storeId no-null y stores.active. Una tienda desactivada por el
// super-admin no puede operar (redirige a login).
async function resolveActiveStore(u: SessionUser): Promise<number> {
  if (u.storeId == null) redirect("/login");
  const [store] = await db.select({ active: stores.active }).from(stores).where(eq(stores.id, u.storeId));
  if (!store || !store.active) redirect("/login");
  return u.storeId;
}

/** Dueño CON tienda activa: owner-gate + store activa. Para rutas admin de tienda. */
export async function requireStoreOwner(): Promise<SessionUser & { storeId: number }> {
  const u = await requireUser();
  if (u.role !== "owner") throw new Error("FORBIDDEN");
  const storeId = await resolveActiveStore(u);
  return { ...u, storeId };
}

/**
 * Exige un usuario con tienda activa (owner o employee). Puerta de entrada a
 * todo el scope de tienda: cada acción y página resuelve el storeId acá.
 */
export async function requireStore(): Promise<SessionUser & { storeId: number }> {
  const u = await requireUser();
  const storeId = await resolveActiveStore(u);
  return { ...u, storeId };
}

/**
 * Guarda CSRF para route handlers que MUTAN.
 *
 * Las server actions traen el chequeo de origen de Next incorporado; los route
 * handlers planos NO. Un fetch cross-site con credenciales no puede leer la
 * respuesta, pero SÍ dispara el efecto — y acá el efecto es emitir un
 * comprobante fiscal irreversible.
 *
 * Se chequea Sec-Fetch-Site (lo mandan todos los navegadores actuales) y, como
 * respaldo, que el Origin coincida con el host de la request.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();

  const fetchSite = h.get("sec-fetch-site");
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return;
    throw new Error("FORBIDDEN");
  }

  const origin = h.get("origin");
  if (!origin) return; // no es una request de navegador (curl, health check)
  const host = h.get("host");
  try {
    if (new URL(origin).host !== host) throw new Error("FORBIDDEN");
  } catch {
    throw new Error("FORBIDDEN");
  }
}
