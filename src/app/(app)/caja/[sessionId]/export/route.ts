import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { getCashSessionClose } from "@/domain/cash-close";
import { xlsxResponse } from "@/lib/xlsx";

/**
 * El cierre de caja en Excel.
 *
 * Acompaña a la vista imprimible, no la reemplaza: 300 remitos en una planilla
 * no son remitos, son filas. Pero para los números del arqueo las columnas son
 * genuinamente mejores, y es lo que el contador quiere.
 *
 * Misma guarda que la vista: `requireStoreOwner` y scope por tienda.
 */

const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cuenta: "Cuenta",
};

export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch {
    return new NextResponse("No tenés permiso para hacer esto.", { status: 403 });
  }

  const { sessionId } = await ctx.params;
  const id = Number(sessionId);
  if (!Number.isInteger(id)) return new NextResponse("Caja inválida.", { status: 400 });

  const c = await getCashSessionClose(db, storeId, id);
  if (!c) return new NextResponse("Esa caja no existe.", { status: 404 });

  const s = c.session;
  const wb = new ExcelJS.Workbook();

  const arqueo = wb.addWorksheet("Arqueo");
  arqueo.addRow(["Caja", s.id]);
  arqueo.addRow(["Abierta", s.openedAt.toLocaleString("es-AR"), c.abiertaPor ?? ""]);
  arqueo.addRow(["Cerrada", s.closedAt?.toLocaleString("es-AR") ?? "sigue abierta", c.cerradaPor ?? ""]);
  arqueo.addRow([]);
  arqueo.addRow(["Monto inicial", s.openingCash]);
  for (const m of c.porMedio) arqueo.addRow([METODO[m.method] ?? m.method, m.total, `${m.count} venta(s)`]);
  arqueo.addRow(["Salidas (gastos y egresos)", -c.totalSalidas]);
  arqueo.addRow([]);
  arqueo.addRow(["Efectivo esperado (recalculado)", c.efectivoEsperado]);
  arqueo.addRow(["Efectivo esperado (guardado al cerrar)", s.expectedCash ?? ""]);
  arqueo.addRow(["Efectivo contado", s.countedCash ?? ""]);
  arqueo.addRow(["Diferencia", s.difference ?? ""]);
  arqueo.addRow(["Notas", s.notes ?? ""]);
  arqueo.addRow([]);
  // Las dos inconsistencias que el documento declara, también acá: si solo
  // estuvieran en la hoja imprimible, quien mira el Excel no las vería.
  arqueo.addRow(["Ventas anuladas (fuera de los totales)", c.anuladas.count, c.anuladas.total]);
  arqueo.addRow(["Ventas sincronizadas después del cierre", c.tardias.count, c.tardias.total]);

  const ventas = wb.addWorksheet("Ventas");
  ventas.addRow(["N°", "Fecha", "Vendedor", "Medio", "Cliente", "Descuento", "Total", "Estado", "Motivo de anulación", "Tardía"]);
  for (const r of c.remitos) {
    ventas.addRow([
      r.saleId,
      r.createdAt.toLocaleString("es-AR"),
      r.sellerName,
      METODO[r.paymentMethod] ?? r.paymentMethod,
      r.clientName ?? "",
      r.discountAmount,
      r.total,
      r.voided ? "Anulada" : "Activa",
      r.voidedReason ?? "",
      r.posteriorAlCierre ? "Sí" : "",
    ]);
  }

  const items = wb.addWorksheet("Ítems");
  items.addRow(["Venta", "Producto", "Variante", "Cantidad", "P. unitario", "Lista", "Descuento", "Neto", "Estado"]);
  for (const r of c.remitos) {
    for (const l of r.lineas) {
      items.addRow([
        r.saleId, l.productName, l.variantName ?? "", l.quantity, l.unitPrice,
        l.priceList, l.discountAmount, l.neto, r.voided ? "Anulada" : "Activa",
      ]);
    }
  }

  const movs = wb.addWorksheet("Gastos y egresos");
  movs.addRow(["Tipo", "Descripción", "Monto", "Fecha"]);
  for (const m of c.movimientos) {
    movs.addRow([m.kind, m.description, m.amount, m.createdAt.toLocaleString("es-AR")]);
  }

  return xlsxResponse(wb, `cierre_caja_${s.id}.xlsx`);
}
