import ExcelJS from "exceljs";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { sales, user } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { xlsxResponse, rangeFromQuery } from "@/lib/xlsx";

const METHOD: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cuenta: "Cuenta" };

export async function GET(req: Request) {
  const { id, role, storeId } = await requireStore();
  const { from, to, label } = rangeFromQuery(req.url);

  const conditions = [eq(sales.storeId, storeId), gte(sales.createdAt, from), lt(sales.createdAt, to)];
  // Empleado: solo sus ventas. Dueño: todas.
  if (role !== "owner") conditions.push(eq(sales.sellerId, id));

  const rows = await db
    .select({ sale: sales, sellerName: user.name })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt), desc(sales.id));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ventas");
  // El motivo va en el Excel y no solo en pantalla: es donde el dueno revisa
  // el mes, y una anulacion sin explicacion es justo la que hay que mirar.
  ws.addRow(["N°", "Fecha", "Vendedor", "Medio", "Descuento", "Total", "Estado", "Motivo de anulación"]);
  for (const { sale, sellerName } of rows as { sale: typeof sales.$inferSelect; sellerName: string }[]) {
    ws.addRow([
      sale.id,
      sale.createdAt.toLocaleString("es-AR"),
      sellerName,
      METHOD[sale.paymentMethod] ?? sale.paymentMethod,
      sale.discountAmount,
      sale.total,
      sale.voided ? "Anulada" : "Activa",
      sale.voidedReason ?? "",
    ]);
  }

  return xlsxResponse(wb, `ventas_${label}.xlsx`);
}
