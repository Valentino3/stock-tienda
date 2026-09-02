"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { savePricingConfig } from "@/domain/pricing-config";
import {
  crearLoteRecalculo, confirmarLoteRecalculo, revertirLoteRecalculo,
  type ResumenRecalculo,
} from "@/domain/pricing-recalc";

/**
 * Todo `requireStoreOwner`: esto reescribe el precio de todo lo que el local
 * vende. No es una acción de mostrador.
 */

const MENSAJES: Record<string, string> = {
  INVALID_USD_RATE: "La cotización tiene que ser mayor a cero.",
  INVALID_ROUNDING_MODE: "Redondeo inválido.",
  INVALID_ROUNDING_STEP: "Múltiplo de redondeo inválido.",
  INVALID_PCT: "El porcentaje tiene que estar entre 0 y 99,99.",
  USD_RATE_NOT_SET: "Cargá la cotización del dólar antes de actualizar precios.",
  BATCH_NOT_FOUND: "Esta actualización ya se aplicó o venció. Volvé a previsualizarla.",
  BATCH_NOT_REVERTIBLE: "Solo se puede deshacer la última actualización.",
};

function traducir(err: unknown) {
  const clave = err instanceof Error ? err.message : "";
  return { error: MENSAJES[clave] ?? "No se pudo completar la operación." };
}

export async function guardarCotizacion(input: {
  usdRate: number | null;
  roundingMode: string;
  roundingStep: number;
  cashPct: number | null;
  wholesalePct: number | null;
}) {
  const { id: userId, storeId } = await requireStoreOwner();
  try {
    await savePricingConfig(db, { storeId, userId, ...input });
  } catch (err) {
    return traducir(err);
  }
  revalidatePath("/precios");
  return { ok: true as const };
}

export async function previsualizarRecalculo():
  Promise<{ ok: true; resumen: ResumenRecalculo } | { error: string }> {
  const { id: userId, storeId } = await requireStoreOwner();
  try {
    return { ok: true as const, resumen: await crearLoteRecalculo(db, { storeId, userId }) };
  } catch (err) {
    return traducir(err);
  }
}

export async function confirmarRecalculo(batchId: string) {
  const { storeId } = await requireStoreOwner();
  try {
    await confirmarLoteRecalculo(db, storeId, batchId);
  } catch (err) {
    return traducir(err);
  }
  // El inventario y la venta muestran precios: los dos quedan viejos si no.
  revalidatePath("/precios");
  revalidatePath("/productos");
  revalidatePath("/vender");
  return { ok: true as const };
}

export async function revertirRecalculo(batchId: string) {
  const { id: userId, storeId } = await requireStoreOwner();
  let res;
  try {
    res = await revertirLoteRecalculo(db, storeId, batchId, userId);
  } catch (err) {
    return traducir(err);
  }
  revalidatePath("/precios");
  revalidatePath("/productos");
  revalidatePath("/vender");
  return { ok: true as const, ...res };
}
