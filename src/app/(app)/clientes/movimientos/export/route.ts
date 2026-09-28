import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { xlsxResponse } from "@/lib/xlsx";
import { METODO_LABEL, type PaymentMethod } from "@/domain/pagos";
import { listAccountMovements, type AccountMovementRow } from "@/domain/clients";
import { leerFiltros } from "../filtros";

/**
 * El registro de movimientos en Excel, con los mismos filtros que la pantalla.
 *
 * "Efecto en saldo" va con signo y en 0 para los anulados: sumando esa columna
 * da cuánto cambió la deuda de los clientes en el período, sin fórmulas.
 */

const TIPO: Record<string, string> = {
  pago: "Cobro", credito: "Carga de crédito", ajuste: "Ajuste",
};

function tipo(m: AccountMovementRow) {
  if (m.type === "cargo") return m.saleId ? "Venta a cuenta" : "Cargo manual";
  if (m.type === "anulacion") return "Anulación de venta";
  return TIPO[m.type] ?? m.type;
}

export async function GET(req: Request) {
  const { storeId } = await requireStore();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { rows } = await listAccountMovements(db, { storeId, ...leerFiltros(sp), page: null });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Movimientos");
  ws.addRow([
    "Fecha", "Cliente", "Tipo", "Medio", "Monto", "Efecto en saldo", "Registró", "Nota / Motivo",
    "Venta N°", "Estado", "Anulado por", "Anulado el", "Motivo de anulación",
  ]);
  for (const m of rows) {
    const signo = m.type === "cargo" ? 1 : -1;
    ws.addRow([
      m.createdAt.toLocaleString("es-AR"),
      m.clientName,
      tipo(m),
      m.method ? METODO_LABEL[m.method as PaymentMethod] ?? m.method : "",
      m.amount,
      m.voided ? 0 : signo * m.amount,
      m.createdByName ?? "",
      m.note ?? "",
      m.saleId ?? "",
      m.voided ? "Anulado" : "Vigente",
      m.voidedByName ?? "",
      m.voidedAt?.toLocaleString("es-AR") ?? "",
      m.voidedReason ?? "",
    ]);
  }

  return xlsxResponse(wb, "movimientos_cuentas.xlsx");
}
