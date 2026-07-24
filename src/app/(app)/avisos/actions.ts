"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { resolveNotification } from "@/domain/notifications";

export async function resolveAviso(id: number) {
  const { id: userId, storeId } = await requireStoreOwner();
  await resolveNotification(db, storeId, id, userId);
  revalidatePath("/avisos");
  return { ok: true as const };
}
