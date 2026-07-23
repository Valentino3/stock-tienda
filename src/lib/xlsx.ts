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
  const now = new Date();
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const from = fromParam ? new Date(`${fromParam}T00:00:00`) : defaultFrom;
  const to = toParam ? new Date(new Date(`${toParam}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 - 1) : defaultTo;
  const label = `${fromParam ?? defaultFrom.toISOString().slice(0, 10)}_${toParam ?? defaultTo.toISOString().slice(0, 10)}`;
  return { from, to, label };
}
