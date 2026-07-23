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
  ws.addRow(["Cliente", "Teléfono", "Estado", "Saldo"]);
  for (const c of rows as { name: string; phone: string | null; active: boolean; balance: number }[]) {
    ws.addRow([c.name, c.phone ?? "", c.active ? "Activo" : "Inactivo", c.balance]);
  }

  return xlsxResponse(wb, "clientes_saldos.xlsx");
}
