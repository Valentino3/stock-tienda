import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { xlsxResponse, rangeFromQuery } from "@/lib/xlsx";
import {
  getSalesReport, getTopProducts, getLowStock, getCashMovementsReport, getClientAccountReport,
} from "@/domain/reports";

const METHOD: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cuenta: "Cuenta" };
const KIND: Record<string, string> = { gasto: "Gastos", egreso: "Egresos" };

export async function GET(req: Request) {
  const { storeId } = await requireStoreOwner();
  const { from, to, label } = rangeFromQuery(req.url);

  const [{ byDay, byMethod }, top, low, movements, cuenta] = await Promise.all([
    getSalesReport(db, storeId, { from, to }),
    getTopProducts(db, storeId, { from, to, limit: 50 }),
    getLowStock(db, storeId),
    getCashMovementsReport(db, storeId, { from, to }),
    getClientAccountReport(db, storeId, { from, to }),
  ]);

  const wb = new ExcelJS.Workbook();

  const d = wb.addWorksheet("Ventas por día");
  d.addRow(["Fecha", "Cantidad", "Total"]);
  for (const r of byDay as { day: string; count: number; total: number }[]) d.addRow([r.day, r.count, r.total]);

  const m = wb.addWorksheet("Medios de pago");
  m.addRow(["Medio", "Cantidad", "Total"]);
  for (const r of byMethod as { method: string; count: number; total: number }[]) m.addRow([METHOD[r.method] ?? r.method, r.count, r.total]);

  const t = wb.addWorksheet("Top productos");
  t.addRow(["Producto", "Variante", "Set", "Unidades", "Ingresos"]);
  for (const r of top as { productName: string; variantName: string; setName: string | null; unitsSold: number; revenue: number }[])
    t.addRow([r.productName, r.variantName, r.setName ?? "", r.unitsSold, r.revenue]);

  const s = wb.addWorksheet("Stock bajo");
  s.addRow(["Producto", "Variante", "Set", "Stock", "Umbral"]);
  for (const r of low as { productName: string; variantName: string; setName: string | null; stock: number; threshold: number }[])
    s.addRow([r.productName, r.variantName, r.setName ?? "", r.stock, r.threshold]);

  const g = wb.addWorksheet("Gastos y egresos");
  g.addRow(["Tipo", "Cantidad", "Total"]);
  for (const r of movements as { kind: string; count: number; total: number }[]) g.addRow([KIND[r.kind] ?? r.kind, r.count, r.total]);

  // Hoja aparte y no sumada a las ventas: cuando el cliente use su crédito va a
  // generar una venta a cuenta, y contarlo en los dos lados sería doble conteo.
  if (cuenta.length) {
    const cc = wb.addWorksheet("Cuenta corriente");
    cc.addRow(["Concepto", "Medio", "Cantidad", "Total"]);
    for (const r of cuenta as { type: string; method: string | null; count: number; total: number }[]) {
      cc.addRow([
        r.type === "credito" ? "Crédito cargado" : "Cobro de deuda",
        r.method ? (METHOD[r.method] ?? r.method) : "",
        r.count,
        r.total,
      ]);
    }
  }

  return xlsxResponse(wb, `reportes_${label}.xlsx`);
}
