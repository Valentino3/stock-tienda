import { rangoAR } from "@/lib/dates";
import type ExcelJS from "exceljs";
import { NextResponse } from "next/server";

// Empaqueta un workbook de ExcelJS como descarga .xlsx.
export async function xlsxResponse(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Rango de fechas desde ?from=&to= (YYYY-MM-DD), default últimos 30 días.
export function rangeFromQuery(url: string): { from: Date; to: Date; label: string } {
  const sp = new URL(url).searchParams;
  // Días de Argentina, igual que la pantalla de reportes: ver rangoAR.
  const { from, to, fromValue, toValue } = rangoAR({ from: sp.get("from"), to: sp.get("to") });
  return { from, to, label: `${fromValue}_${toValue}` };
}
