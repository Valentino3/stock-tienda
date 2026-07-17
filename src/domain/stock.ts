import { eq, sql } from "drizzle-orm";
import { productVariants, stockMovements } from "@/db/schema";

type Tx = Parameters<Parameters<import("@/db").Db["transaction"]>[0]>[0] | any;

export type StockMovementInput = {
  variantId: number;
  type: "venta" | "reposicion" | "ajuste" | "anulacion";
  quantity: number; // con signo
  userId: string;
  saleId?: number;
  reason?: string;
};

export async function applyStockMovement(tx: Tx, input: StockMovementInput): Promise<void> {
  // UPDATE condicional: solo aplica si el stock resultante es >= 0.
  // Atómico frente a concurrencia: dos ventas simultáneas no pueden sobrevender.
  const updated = await tx
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} + ${input.quantity}` })
    .where(sql`${productVariants.id} = ${input.variantId} AND ${productVariants.stock} + ${input.quantity} >= 0`)
    .returning({ id: productVariants.id });

  if (updated.length === 0) throw new Error("INSUFFICIENT_STOCK");

  await tx.insert(stockMovements).values({
    variantId: input.variantId,
    type: input.type,
    quantity: input.quantity,
    userId: input.userId,
    saleId: input.saleId,
    reason: input.reason,
  });
}
