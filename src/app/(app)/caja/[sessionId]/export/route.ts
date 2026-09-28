import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { getCashSessionClose } from "@/domain/cash-close";
import { METODO_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/domain/pagos";
import { montosPorMedio, resumirLineas, totalesDelListado } from "@/domain/resumen-venta";
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

const metodo = (m: string) => METODO_LABEL[m as PaymentMethod] ?? m;

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
  // PAGOS y no ventas: con pago dividido una venta cuenta en dos medios. La
  // cantidad de ventas va en su propia fila, que es la que se puede contrastar.
  const listado = totalesDelListado(c.remitos);
  for (const m of c.porMedio) arqueo.addRow([metodo(m.method), m.total, `${m.count} pago(s)`]);
  arqueo.addRow(["Ventas del turno", listado.ventas]);
  if (c.efectivoCuenta > 0) {
    arqueo.addRow(["Cobros de cuenta corriente (efectivo)", c.efectivoCuenta]);
  }
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

  if (c.cobrosCuenta.length) {
    const cuenta = wb.addWorksheet("Cuenta corriente");
    cuenta.addRow(["Fecha", "Cliente", "Tipo", "Monto"]);
    for (const m of c.cobrosCuenta) {
      cuenta.addRow([
        m.createdAt.toLocaleString("es-AR"),
        m.clientName,
        m.type === "credito" ? "Carga de crédito" : "Cobro de deuda",
        m.amount,
      ]);
    }
  }

  // Una columna fija por medio, siempre en el mismo orden: el contador filtra y
  // suma por columna, y si las columnas cambiaran según el día no podría pegar
  // una planilla abajo de la otra. Antes había una sola columna con el medio
  // predominante, y la parte con tarjeta de un pago dividido no aparecía.
  const ventas = wb.addWorksheet("Ventas");
  ventas.addRow([
    "N° venta", "Remito", "Fecha", "Vendedor", "Cliente", "Productos", "Medio(s)",
    ...PAYMENT_METHODS.map((m) => m.label),
    "Descuento", "Total", "Estado", "Motivo de anulación", "Tardía",
  ]);
  for (const r of c.remitos) {
    const montos = montosPorMedio(r.pagos);
    ventas.addRow([
      r.saleId,
      r.numero ?? "",
      r.createdAt.toLocaleString("es-AR"),
      r.sellerName,
      r.clientName ?? "",
      resumirLineas(r.lineas, Infinity).texto,
      r.pagos.map((p) => metodo(p.method)).join(" + "),
      ...PAYMENT_METHODS.map((m) => montos[m.value] ?? ""),
      r.discountAmount,
      r.total,
      r.voided ? "Anulada" : "Activa",
      r.voidedReason ?? "",
      r.posteriorAlCierre ? "Sí" : "",
    ]);
  }
  // Las anuladas están arriba con sus montos pero no suman. Esta fila sale del
  // mismo agrupado que la hoja "Arqueo", así que tiene que dar igual: si no da,
  // el problema está en los datos, no en la planilla.
  const porMedio = new Map(c.porMedio.map((m) => [m.method, m.total]));
  ventas.addRow([]);
  ventas.addRow([
    "Total activas (cuadra con Arqueo)", "", "", "", "", "", "",
    ...PAYMENT_METHODS.map((m) => porMedio.get(m.value) ?? 0),
    "", listado.total,
  ]);

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
