"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { createClient, recordPayment } from "@/domain/clients";

export async function saveClient(input: { name: string; phone?: string; note?: string }) {
  const { storeId } = await requireStore();
  if (!input.name.trim()) return { error: "Nombre requerido" };
  try {
    await createClient(db, { storeId, name: input.name, phone: input.phone, note: input.note });
  } catch {
    return { error: "No se pudo crear el cliente" };
  }
  revalidatePath("/clientes");
  return { ok: true as const };
}

export async function recordClientPayment(input: {
  clientId: number;
  amount: number;
  method?: string;
  note?: string;
}) {
  const { id: userId, storeId } = await requireStore();
  if (!(input.amount > 0)) return { error: "Monto inválido" };
  try {
    await recordPayment(db, {
      storeId,
      clientId: input.clientId,
      amount: input.amount,
      method: input.method || null,
      note: input.note,
      userId,
    });
  } catch (e) {
    return { error: e instanceof Error && e.message === "CLIENT_NOT_FOUND" ? "Cliente no encontrado" : "No se pudo registrar el pago" };
  }
  revalidatePath("/clientes");
  return { ok: true as const };
}
