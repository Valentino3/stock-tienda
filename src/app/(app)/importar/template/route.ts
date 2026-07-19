import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Productos");
  ws.addRow(["Producto", "Variante", "SKU", "Precio", "Stock"]);
  ws.addRow(["Remera Roja", "M", "REM-R-M", 12000, 5]);
  ws.addRow(["Remera Roja", "L", "REM-R-L", 12000, 3]);
  ws.addRow(["Gorra Negra", "", "GOR-N", 8000, 10]);
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
    },
  });
}
