"use server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { stores, user as userTable } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { esRubroConocido } from "@/lib/verticals";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tienda";
}

export async function createStore(name: string, businessType?: string) {
  await requireSuperAdmin();
  if (!name.trim()) return { error: "Nombre requerido" };
  // El rubro decide qué ve la tienda. Se valida contra el registro y no contra
  // un enum de base: agregar un rubro tiene que ser un deploy, no un ALTER TYPE.
  const rubro = businessType ?? "retail";
  if (!esRubroConocido(rubro)) return { error: "Rubro desconocido" };
  let slug = slugify(name);
  // Desambiguar slug si ya existe.
  const existing = await db.select({ slug: stores.slug }).from(stores);
  const taken = new Set(existing.map((s) => s.slug));
  if (taken.has(slug)) {
    let n = 2;
    while (taken.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  const [store] = await db.insert(stores)
    .values({ name: name.trim(), slug, businessType: rubro })
    .returning();
  revalidatePath("/admin");
  return { ok: true as const, storeId: store.id, slug: store.slug };
}

export async function createStoreOwner(input: { storeId: number; name: string; email: string; password: string }) {
  await requireSuperAdmin();
  if (!input.name.trim() || !input.email.trim()) return { error: "Nombre y email requeridos" };
  if (input.password.length < 8) return { error: "Contraseña mínimo 8 caracteres" };
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, input.storeId));
  if (!store) return { error: "Tienda no encontrada" };
  try {
    const created = await auth.api.createUser({
      headers: await headers(),
      body: { name: input.name, email: input.email, password: input.password, role: "owner" },
    });
    await db.update(userTable).set({ role: "owner", storeId: input.storeId }).where(eq(userTable.id, created.user.id));
  } catch {
    return { error: "No se pudo crear el dueño (¿email ya usado?)" };
  }
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function toggleStoreActive(storeId: number, active: boolean) {
  await requireSuperAdmin();
  await db.update(stores).set({ active }).where(eq(stores.id, storeId));
  revalidatePath("/admin");
  return { ok: true as const };
}
