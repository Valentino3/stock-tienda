"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { voidSale } from "@/domain/sales";
import { getFiscalConfig } from "@/domain/fiscal-config";
import { emitirNotaCredito, getFacturaAutorizada } from "@/domain/fiscal-emision";
import { createArcaClientForStore } from "@/lib/arca/client";

const ERRORES_ANULAR: Record<string, string> = {
  ALREADY_VOIDED: "La venta ya está anulada",
  VOID_REASON_REQUIRED: "Escribí por qué se anula.",
  SALE_NOT_FOUND: "La venta no existe.",
};

export async function voidSaleAction(saleId: number, reason: string) {
  const { id, storeId } = await requireStoreOwner();
  try {
    await voidSale(db, { saleId, storeId, userId: id, reason });
  } catch (e) {
    const codigo = e instanceof Error ? e.message : "";
    return { error: ERRORES_ANULAR[codigo] ?? "No se pudo anular" };
  }

  // La anulación ya está commiteada: stock restaurado y cuenta corriente
  // revertida. Recién ahora se intenta la nota de crédito, FUERA de la
  // transacción de voidSale — esa transacción sostiene un FOR UPDATE sobre la
  // caja abierta, y meter ahí una llamada SOAP bloquearía todas las ventas de la
  // tienda mientras ARCA piensa.
  revalidatePath("/ventas");

  const aviso = await emitirNotaCreditoSiCorresponde(saleId, storeId, id);
  return aviso ? { ok: true as const, aviso } : { ok: true as const };
}

/**
 * Emite la nota de crédito de una venta recién anulada.
 *
 * Si falla, la anulación NO se bloquea: el stock y la caja tienen que quedar
 * bien YA, mientras que una NC faltante es un cabo suelto visible y reintentable.
 *
 * ⚠️ Pero eso crea exposición fiscal real — una venta anulada cuya factura
 * conserva CAE es IVA declarado que el comercio nunca cobró. Por eso el fallo
 * tiene que ser RUIDOSO: se devuelve un aviso al usuario y la venta queda
 * marcada como "NC pendiente" en la lista de /ventas.
 */
async function emitirNotaCreditoSiCorresponde(
  saleId: number, storeId: number, userId: string,
): Promise<string | null> {
  const AVISO = "La venta se anuló, pero la nota de crédito quedó pendiente. Reintentala desde el detalle de la venta.";

  try {
    const config = await getFiscalConfig(db, storeId);
    if (!config?.enabled) return null;

    // Si la venta nunca se facturó, no hay nada que anular ante ARCA.
    const factura = await getFacturaAutorizada(db, storeId, saleId);
    if (!factura) return null;

    const arca = await createArcaClientForStore(db, storeId);
    const nc = await emitirNotaCredito(db, arca, { storeId, saleId, userId });

    revalidatePath("/ventas");
    return nc.estado === "autorizado" ? null : AVISO;
  } catch (err) {
    console.error("[ventas/actions] nota de crédito tras anulación:", err instanceof Error ? err.message : err);
    return AVISO;
  }
}
