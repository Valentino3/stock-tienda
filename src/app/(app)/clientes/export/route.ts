import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { xlsxResponse } from "@/lib/xlsx";
import { listClientsWithBalance } from "@/domain/clients";

export async function GET() {
  const { storeId } = await requireStore();
  const rows = await listClientsWithBalance(db, storeId);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clientes");
  // Deuda y A favor van desglosadas ademas del saldo crudo: en una planilla se
  // suma una columna entera sin escribir una formula, y el signo de "Saldo" no
  // alcanza para eso.
  ws.addRow(["Cliente", "Teléfono", "Estado", "Saldo", "Deuda", "A favor"]);
  for (const c of rows as { name: string; phone: string | null; active: boolean; balance: number }[]) {
    const estado = c.balance > 0 ? "Debe" : c.balance < 0 ? "A favor" : "Al día";
    ws.addRow([
      c.name, c.phone ?? "", estado, c.balance,
      Math.max(0, c.balance), Math.max(0, -c.balance),
    ]);
  }

  return xlsxResponse(wb, "clientes_saldos.xlsx");
}
