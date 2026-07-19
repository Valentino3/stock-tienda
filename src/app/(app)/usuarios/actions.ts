"use server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function createEmployee(input: { name: string; email: string; password: string }) {
  await requireOwner();
  if (input.password.length < 8) return { error: "Contraseña mínimo 8 caracteres" };
  try {
    await auth.api.createUser({
      headers: await headers(),
      body: { name: input.name, email: input.email, password: input.password, role: "employee" },
    });
  } catch {
    return { error: "No se pudo crear (¿email ya usado?)" };
  }
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean) {
  const owner = await requireOwner();
  if (!active && userId === owner.id) return { error: "No podés desactivarte a vos mismo" };
  const h = await headers();
  if (active) await auth.api.unbanUser({ headers: h, body: { userId } });
  else await auth.api.banUser({ headers: h, body: { userId, banReason: "Desactivado" } });
  revalidatePath("/usuarios");
  return { ok: true };
}
