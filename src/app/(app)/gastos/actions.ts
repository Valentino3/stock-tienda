"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { anularGasto, crearRubro, editarRubro, registrarGasto } from "@/domain/gastos";
import type { MedioDeGasto } from "@/domain/gastos-medios";

/**
 * Gastos fuera de la caja y sus rubros. Del dueño: es la contabilidad del
 * local (sueldos, alquiler), no la operación del mostrador.
 */

const MENSAJES: Record<string, string> = {
  INVALID_AMOUNT: "Poné un monto mayor a cero.",
  FECHA_INVALIDA: "Fecha inválida.",
  MEDIO_INVALIDO: "Elegí cómo se pagó.",
  RUBRO_NO_ENCONTRADO: "Ese rubro no existe.",
  RUBRO_INACTIVO: "Ese rubro está desactivado.",
  RUBRO_DUPLICADO: "Ya hay un rubro con ese nombre.",
  EMPTY_NAME: "Poné un nombre.",
  MOTIVO_REQUERIDO: "Poné un motivo (al menos 3 letras).",
  YA_ANULADO: "Ese gasto ya estaba anulado.",
  GASTO_NO_ENCONTRADO: "Ese gasto no existe.",
};

const traducir = (e: unknown) =>
  (e instanceof Error ? MENSAJES[e.message] : undefined) ?? "No se pudo completar la operación.";

export async function registrarGastoAction(input: {
  rubroId: number; fecha: string; monto: number; medio: MedioDeGasto; detalle?: string;
}) {
  const { storeId, id: userId } = await requireStoreOwner();
  try {
    await registrarGasto(db, {
      storeId, userId,
      rubroId: Number(input.rubroId),
      fecha: String(input.fecha ?? ""),
      monto: Number(input.monto),
      medio: input.medio,
      detalle: input.detalle == null ? null : String(input.detalle),
    });
    revalidatePath("/gastos");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function anularGastoAction(gastoId: number, motivo: string) {
  const { storeId, id: userId } = await requireStoreOwner();
  try {
    await anularGasto(db, { storeId, userId, gastoId: Number(gastoId), motivo: String(motivo ?? "") });
    revalidatePath("/gastos");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function crearRubroAction(nombre: string) {
  const { storeId } = await requireStoreOwner();
  try {
    await crearRubro(db, { storeId, nombre: String(nombre ?? "") });
    revalidatePath("/gastos");
    revalidatePath("/caja");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function editarRubroAction(rubroId: number, cambios: { nombre?: string; activo?: boolean }) {
  const { storeId } = await requireStoreOwner();
  try {
    await editarRubro(db, {
      storeId, rubroId: Number(rubroId),
      nombre: cambios.nombre === undefined ? undefined : String(cambios.nombre),
      activo: cambios.activo === undefined ? undefined : cambios.activo === true,
    });
    revalidatePath("/gastos");
    revalidatePath("/caja");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}
