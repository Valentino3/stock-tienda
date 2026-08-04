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
  /**
   * Deja que el stock quede negativo. SOLO para el replay de ventas hechas sin
   * conexión (src/domain/sales-replay.ts): esa mercadería ya salió del local y
   * ya se cobró, así que rechazar el movimiento no devuelve las unidades — solo
   * borra el registro de que se vendieron. El negativo queda visible a
   * propósito para que el dueño lo corrija con un ajuste.
   *
   * El camino online NUNCA lo usa: ahí el guard `>= 0` es lo que impide
   * sobrevender.
   */
  permitirNegativo?: boolean;
};

/** Devuelve el stock resultante de la variante. */
export async function applyStockMovement(tx: Tx, input: StockMovementInput): Promise<number> {
  // UPDATE condicional: solo aplica si el stock resultante es >= 0 Y la variante
  // pertenece a la tienda. Atómico frente a concurrencia (no sobrevende) y
  // defensa contra tocar stock de otra tienda por id.
  const guardaDeStock = input.permitirNegativo
    ? sql``
    : sql` AND ${productVariants.stock} + ${input.quantity} >= 0`;

  const updated = await tx
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} + ${input.quantity}` })
    .where(sql`${productVariants.id} = ${input.variantId} AND ${productVariants.storeId} = ${input.storeId}${guardaDeStock}`)
    .returning({ stock: productVariants.stock });

  if (updated.length === 0) {
    // Sin la guarda de stock, cero filas solo puede significar que la variante
    // no existe o es de otra tienda: decirlo así evita un mensaje de "stock
    // insuficiente" que mandaría a mirar el lugar equivocado.
    throw new Error(input.permitirNegativo ? "VARIANT_NOT_FOUND" : "INSUFFICIENT_STOCK");
  }

  await tx.insert(stockMovements).values({
    variantId: input.variantId,
    type: input.type,
    quantity: input.quantity,
    userId: input.userId,
    saleId: input.saleId,
    reason: input.reason,
  });

  return updated[0].stock;
}
