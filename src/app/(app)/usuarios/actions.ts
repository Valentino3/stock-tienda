"use server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { session as sessionTable, user as userTable } from "@/db/schema";
import { requireStoreOwner } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function createEmployee(input: { name: string; email: string; password: string }) {
  const owner = await requireStoreOwner();
  if (input.password.length < 8) return { error: "Contraseña mínimo 8 caracteres" };
  try {
    // Sin headers a propósito: es el camino solo-servidor del plugin, que no
    // exige permisos admin. El dueño no los tiene (ver src/lib/auth.ts); la
    // guarda es requireStoreOwner de arriba.
    const created = await auth.api.createUser({
      body: { name: input.name, email: input.email, password: input.password, role: "employee" },
    });
    // El empleado pertenece a la tienda del dueño que lo crea.
    await db.update(userTable).set({ storeId: owner.storeId }).where(eq(userTable.id, created.user.id));
  } catch {
    return { error: "No se pudo crear (¿email ya usado?)" };
  }
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean) {
  const owner = await requireStoreOwner();
  if (!active && userId === owner.id) return { error: "No podés desactivarte a vos mismo" };
  // Solo se puede activar/desactivar usuarios de la propia tienda.
  const [target] = await db.select({ storeId: userTable.storeId }).from(userTable).where(eq(userTable.id, userId));
  if (!target || target.storeId !== owner.storeId) return { error: "Usuario no encontrado" };
  // Directo en la base y no con banUser/unbanUser del plugin: esos exigen
  // permisos admin, que el dueño no tiene. El plugin igual rechaza el login de
  // un usuario con `banned`; borrar sus sesiones lo saca de las que ya tenía
  // abiertas, que es lo que hacía banUser.
  try {
    await db.transaction(async (tx) => {
      await tx.update(userTable)
        .set(active
          ? { banned: false, banReason: null, banExpires: null }
          : { banned: true, banReason: "Desactivado", banExpires: null })
        .where(eq(userTable.id, userId));
      if (!active) await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
    });
  } catch {
    return { error: active ? "No se pudo activar el usuario" : "No se pudo desactivar el usuario" };
  }
  revalidatePath("/usuarios");
  return { ok: true };
}
