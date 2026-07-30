"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { deleteCredentials, getFiscalConfig, saveFiscalConfig } from "@/domain/fiscal-config";
import { normalizarDoc, validarCuit, ALICUOTAS } from "@/domain/fiscal-catalogs";
import { arcaUserMessage } from "@/lib/arca/errors";
import type { ArcaAmbiente } from "@/db/schema";

/**
 * Acciones de la config fiscal. Son server actions y no route handlers porque
 * son instantáneas y se benefician de revalidatePath. Todo lo que habla con ARCA
 * (lento) vive en route handlers.
 */

type Resultado = { ok: true } | { error: string };

export async function saveFiscalConfigAction(input: {
  cuit: string;
  razonSocial: string;
  domicilio: string;
  nombreFantasia?: string;
  ingresosBrutos?: string;
  inicioActividades?: string;
  puntoVenta: number;
  defaultIvaId: number;
  umbralConsumidorFinal?: number | null;
  empleadosPuedenEmitir: boolean;
  enabled: boolean;
}): Promise<Resultado> {
  try {
    const { storeId } = await requireStoreOwner();

    const cuit = normalizarDoc(input.cuit);
    if (!cuit || !validarCuit(cuit)) return { error: "El CUIT no es válido. Revisá el número." };
    if (!input.razonSocial.trim()) return { error: "La razón social es obligatoria." };
    if (!input.domicilio.trim()) return { error: "El domicilio comercial es obligatorio." };
    if (!Number.isInteger(input.puntoVenta) || input.puntoVenta < 1 || input.puntoVenta > 99999) {
      return { error: "El punto de venta tiene que ser un número entre 1 y 99999." };
    }
    if (!(input.defaultIvaId in ALICUOTAS)) return { error: "La alícuota de IVA no es válida." };
    if (input.umbralConsumidorFinal != null && input.umbralConsumidorFinal < 0) {
      return { error: "El umbral no puede ser negativo." };
    }

    // El ambiente NO se toca acá: se cambia por el flujo dedicado, que exige
    // probar la conexión antes de pasar a producción.
    const actual = await getFiscalConfig(db, storeId);

    await saveFiscalConfig(db, {
      storeId,
      cuit,
      razonSocial: input.razonSocial.trim(),
      domicilio: input.domicilio.trim(),
      nombreFantasia: input.nombreFantasia?.trim() || null,
      ingresosBrutos: input.ingresosBrutos?.trim() || null,
      inicioActividades: input.inicioActividades?.trim() || null,
      puntoVenta: input.puntoVenta,
      ambiente: actual?.ambiente ?? "homologacion",
      defaultIvaId: input.defaultIvaId,
      umbralConsumidorFinal: input.umbralConsumidorFinal ?? null,
      empleadosPuedenEmitir: input.empleadosPuedenEmitir,
      enabled: input.enabled,
    });

    revalidatePath("/facturacion");
    return { ok: true };
  } catch (err) {
    console.error("[facturacion/actions] saveFiscalConfig:", err);
    return { error: arcaUserMessage(err).message };
  }
}

/**
 * Cambia de ambiente. Separado del resto de la config a propósito: pasar a
 * producción significa que cada factura pasa a ser un comprobante fiscal real e
 * irreversible, y no puede ser un campo más de un formulario largo.
 */
export async function cambiarAmbienteAction(ambiente: ArcaAmbiente): Promise<Resultado> {
  try {
    const { storeId } = await requireStoreOwner();
    const cfg = await getFiscalConfig(db, storeId);
    if (!cfg) return { error: "Primero cargá los datos del emisor." };

    await saveFiscalConfig(db, { ...cfg, storeId, ambiente });
    revalidatePath("/facturacion");
    revalidatePath("/ventas");
    return { ok: true };
  } catch (err) {
    console.error("[facturacion/actions] cambiarAmbiente:", err);
    return { error: arcaUserMessage(err).message };
  }
}

export async function deleteCredentialsAction(ambiente: ArcaAmbiente): Promise<Resultado> {
  try {
    const { storeId } = await requireStoreOwner();
    await deleteCredentials(db, storeId, ambiente);
    revalidatePath("/facturacion");
    return { ok: true };
  } catch (err) {
    console.error("[facturacion/actions] deleteCredentials:", err);
    return { error: arcaUserMessage(err).message };
  }
}
