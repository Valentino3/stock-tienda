import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user as userTable, stores } from "@/db/schema";

/**
 * Lo que aporta la tienda activa. Se devuelve junto al usuario para que una
 * página o acción tenga todo en una sola llamada.
 *
 * `businessType` es `string` y no `BusinessType` a propósito: viene de una
 * columna de texto y este deploy puede no conocer el valor. Quien lo consume
 * lo pasa por `verticalDe()`, que resuelve el desconocido a retail.
 */
export type StoreContext = { storeId: number; businessType: string };

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
//
// De paso trae el rubro: este SELECT ya corría en cada request, así que una
// columna más es gratis y evita una segunda consulta en el camino más caliente
// de la app (ver la nota en stores, src/db/schema.ts).
async function resolveActiveStore(u: SessionUser): Promise<{ storeId: number; businessType: string }> {
  if (u.storeId == null) redirect("/login");
  const [store] = await db
    .select({ active: stores.active, businessType: stores.businessType })
    .from(stores)
    .where(eq(stores.id, u.storeId));
  if (!store || !store.active) redirect("/login");
  return { storeId: u.storeId, businessType: store.businessType };
}

/** Dueño CON tienda activa: owner-gate + store activa. Para rutas admin de tienda. */
export async function requireStoreOwner(): Promise<SessionUser & StoreContext> {
  const u = await requireUser();
  if (u.role !== "owner") throw new Error("FORBIDDEN");
  return { ...u, ...(await resolveActiveStore(u)) };
}

/**
 * Exige un usuario con tienda activa (owner o employee). Puerta de entrada a
 * todo el scope de tienda: cada acción y página resuelve el storeId acá.
 */
export async function requireStore(): Promise<SessionUser & StoreContext> {
  const u = await requireUser();
  return { ...u, ...(await resolveActiveStore(u)) };
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
