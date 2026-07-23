import { eq, sql } from "drizzle-orm";
import { productVariants, stockMovements } from "@/db/schema";

type Tx = Parameters<Parameters<import("@/db").Db["transaction"]>[0]>[0] | any;

export type StockMovementInput = {
  variantId: number;
  storeId: number; // guardia de tienda: no permite mover stock de otra tienda
  type: "venta" | "reposicion" | "ajuste" | "anulacion";
  quantity: number; // con signo
  userId: string;
  saleId?: number;
  reason?: string;
};

export async function applyStockMovement(tx: Tx, input: StockMovementInput): Promise<void> {
  // UPDATE condicional: solo aplica si el stock resultante es >= 0 Y la variante
  // pertenece a la tienda. Atómico frente a concurrencia (no sobrevende) y
  // defensa contra tocar stock de otra tienda por id.
  const updated = await tx
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} + ${input.quantity}` })
    .where(sql`${productVariants.id} = ${input.variantId} AND ${productVariants.storeId} = ${input.storeId} AND ${productVariants.stock} + ${input.quantity} >= 0`)
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
