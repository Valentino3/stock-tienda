"use server";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { createCommission, deleteCommission } from "@/domain/commissions";
import { revalidatePath } from "next/cache";

export async function saveCommission(input: {
  employeeId: string;
  amount: number;
  note?: string;
  periodFrom?: string;
  periodTo?: string;
}) {
  const owner = await requireStoreOwner();
  if (!input.employeeId) return { error: "Elegí un empleado" };
  if (!(input.amount > 0)) return { error: "Monto inválido" };
  try {
    await createCommission(db, {
      storeId: owner.storeId,
      employeeId: input.employeeId,
      amount: input.amount,
      note: input.note,
      periodFrom: input.periodFrom ? new Date(`${input.periodFrom}T00:00:00`) : null,
      periodTo: input.periodTo ? new Date(`${input.periodTo}T00:00:00`) : null,
      createdBy: owner.id,
    });
  } catch {
    return { error: "No se pudo guardar la comisión" };
  }
  revalidatePath("/comisiones");
  return { ok: true as const };
}

export async function removeCommission(id: number) {
  const { storeId } = await requireStoreOwner();
  await deleteCommission(db, storeId, id);
  revalidatePath("/comisiones");
  return { ok: true as const };
}
