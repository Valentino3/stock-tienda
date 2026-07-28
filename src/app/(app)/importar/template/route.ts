import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

// Las columnas se reconocen por NOMBRE (ver src/domain/import-columns.ts), así
// que esta plantilla es una sugerencia, no un contrato: se puede reordenar,
// borrar las que no se usen o subir una planilla propia con otros títulos.
const HEADERS = [
  "Producto", "Variante", "SKU", "Precio venta", "Stock",
  "Efectivo menor", "Precio mayorista", "Costo USD", "Costo ARS",
  "Proveedor", "SKU proveedor", "Set", "Condición", "Foil", "Idioma",
];

const EXAMPLES = [
  ["Remera Roja", "M", "REM-R-M", 12000, 5, 10800, 8400, "", 6000, "Textiles SA", "TX-114", "", "", "", ""],
  ["Remera Roja", "L", "REM-R-L", 12000, 3, 10800, 8400, "", 6000, "Textiles SA", "TX-115", "", "", "", ""],
  ["Gorra Negra", "", "GOR-N", 8000, 10, 7200, 5600, "", 4000, "Textiles SA", "", "", "", "", ""],
  ["Charizard", "Base Set NM", "CHAR-BS-NM", 50000, 3, 45000, 35000, 33.9, 50000, "TCG Dylan", "", "Base Set", "NM", "FALSE", "EN"],
  ["Charizard", "Base Set NM Foil", "CHAR-BS-NM-F", 150000, 1, 135000, 105000, 99, 146000, "Devir", "", "Base Set", "NM", "TRUE", "EN"],
];

export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Productos");
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };
  for (const row of EXAMPLES) ws.addRow(row);
  // Anchos legibles: sin esto los títulos largos quedan cortados al abrir.
  ws.columns.forEach((c, i) => { c.width = Math.max(12, HEADERS[i].length + 3); });

  const notes = wb.addWorksheet("Cómo usarla");
  notes.getColumn(1).width = 100;
  for (const line of [
    "Las columnas se reconocen por su TÍTULO, no por su posición.",
    "Podés reordenarlas, borrar las que no uses, o subir tu propia planilla con otros títulos.",
    "",
    "Producto y Precio venta son obligatorios para dar de alta algo nuevo.",
    "SKU sirve para reconocer lo que ya cargaste y actualizarlo. Sin SKU se busca por nombre de producto.",
    "",
    "Si la planilla NO trae columna Stock, el stock actual no se toca: sirve para actualizar solo precios.",
    "Si SÍ trae Stock, el valor de la planilla reemplaza al actual (no se suma).",
    "",
    "Efectivo menor, Precio mayorista, Costo USD, Costo ARS y Proveedor son informativos:",
    "se ven al revisar el inventario. La venta siempre usa Precio venta.",
    "",
    "Costo ARS se guarda tal cual lo escribís, no se recalcula desde Costo USD.",
  ]) notes.addRow([line]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
    },
  });
}
