import { eq, inArray, and, isNull } from "drizzle-orm";
import { products, productVariants, sales, saleItems, cashSessions, clients, clientAccountMovements, type Sale } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Descuento: monto fijo ($) o porcentaje. Resuelto contra una base, siempre
// acotado a [0, base] para que nunca deje un total/línea negativo.
export type Discount = { kind: "amount" | "percent"; value: number };

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

function resolveDiscount(d: Discount | undefined, base: number): number {
  if (!d || !(d.value > 0)) return 0;
  const raw = d.kind === "percent" ? (base * d.value) / 100 : d.value;
  return round2(clamp(raw, 0, base));
}

/**
 * Aritmética de la venta: descuento por línea sobre el bruto, después descuento
 * general sobre el subtotal ya neto.
 *
 * Vive acá y no dentro de createSale porque el replay de ventas offline
 * (src/domain/sales-replay.ts) tiene que dar EXACTAMENTE el mismo total. Lo
 * único que cambia entre los dos caminos es de dónde sale el precio unitario:
 * online lo resuelve el servidor contra el catálogo, en el replay es el precio
 * que se capturó al cobrar. Por eso el precio entra como función.
 */
export function calcularTotales<T extends { quantity: number; discount?: Discount }>(
  items: T[],
  precioDe: (item: T) => number,
  descuentoGeneral?: Discount,
) {
  const lines = items.map((i) => {
    const unitPrice = precioDe(i);
    const gross = round2(unitPrice * i.quantity);
    const lineDiscount = resolveDiscount(i.discount, gross);
    return { ...i, unitPrice, lineDiscount, net: round2(gross - lineDiscount) };
  });
  const subtotal = round2(lines.reduce((acc, l) => acc + l.net, 0));
  const saleDiscount = resolveDiscount(descuentoGeneral, subtotal);
  return { lines, subtotal, saleDiscount, total: round2(subtotal - saleDiscount) };
}

export type SaleInput = {
  storeId: number;
  sellerId: string;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  items: { variantId: number; quantity: number; discount?: Discount }[];
  // Descuento general aplicado sobre el subtotal ya neto de descuentos por línea.
  saleDiscount?: Discount;
  // Cliente de cuenta corriente — obligatorio cuando paymentMethod = "cuenta".
  clientId?: number | null;
  // Clave de idempotencia del carrito (ver sales.uid en schema.ts). Opcional:
  // sin uid la venta entra siempre, que es el comportamiento histórico.
  uid?: string | null;
};

const PG_UNIQUE_VIOLATION = "23505";

/**
 * `duplicada` marca que este uid ya tenía una venta y se devolvió esa misma
 * fila sin registrar nada nuevo. La forma sigue siendo un `Sale`, así que todo
 * lo que ya leía `.id`/`.total` funciona igual.
 */
export type SaleResult = Sale & { duplicada?: boolean };

async function buscarPorUid(db: any, storeId: number, uid: string): Promise<Sale | undefined> {
  const [existing] = await db.select().from(sales)
    .where(and(eq(sales.storeId, storeId), eq(sales.uid, uid))).limit(1);
  return existing;
}

export async function createSale(db: any, input: SaleInput): Promise<SaleResult> {
  if (input.items.length === 0) throw new Error("EMPTY_SALE");
  if (input.items.some((i) => i.quantity <= 0 || !Number.isInteger(i.quantity))) throw new Error("INVALID_QUANTITY");
  if (input.paymentMethod === "cuenta" && !input.clientId) throw new Error("CLIENT_REQUIRED");

  const uid = input.uid?.trim() || null;

  try {
    return await db.transaction(async (tx: any) => {
      // Reintento tras un corte de red: la venta ya entró y lo único que se
      // perdió fue la respuesta. Se sale ANTES del FOR UPDATE a propósito —
      // exigir caja abierta acá rechazaría un reintento hecho después del
      // cierre, cuando la venta original ya está registrada y cobrada.
      if (uid) {
        const ya = await buscarPorUid(tx, input.storeId, uid);
        if (ya) return { ...ya, duplicada: true };
      }

      const [session] = await tx.select().from(cashSessions)
        .where(and(eq(cashSessions.storeId, input.storeId), isNull(cashSessions.closedAt))).limit(1).for("update");
      if (!session) throw new Error("NO_OPEN_SESSION");
      const variantRows = await tx
        .select({
          id: productVariants.id,
          price: productVariants.price,
          basePrice: products.basePrice,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(
          eq(productVariants.storeId, input.storeId),
          inArray(productVariants.id, input.items.map((i) => i.variantId)),
        ));

      const priceOf = new Map(variantRows.map((v: any) => [v.id, v.price ?? v.basePrice]));
      if (priceOf.size !== new Set(input.items.map((i) => i.variantId)).size) throw new Error("VARIANT_NOT_FOUND");

      const { lines, saleDiscount, total } = calcularTotales(
        input.items,
        (i) => priceOf.get(i.variantId) as number,
        input.saleDiscount,
      );

      // Venta a cuenta: el cliente debe ser de esta tienda.
      if (input.paymentMethod === "cuenta") {
        const [client] = await tx.select({ id: clients.id }).from(clients)
          .where(and(eq(clients.id, input.clientId as number), eq(clients.storeId, input.storeId)));
        if (!client) throw new Error("CLIENT_NOT_FOUND");
      }

      const [sale] = await tx.insert(sales).values({
        storeId: input.storeId,
        uid,
        sellerId: input.sellerId,
        cashSessionId: session.id,
        total,
        discountAmount: saleDiscount,
        paymentMethod: input.paymentMethod,
        clientId: input.paymentMethod === "cuenta" ? input.clientId : null,
      }).returning();

      // Cargo en la cuenta corriente del cliente (queda como deuda).
      if (input.paymentMethod === "cuenta") {
        await tx.insert(clientAccountMovements).values({
          storeId: input.storeId,
          clientId: input.clientId as number,
          type: "cargo",
          amount: total,
          saleId: sale.id,
          createdBy: input.sellerId,
        });
      }

      for (const line of lines) {
        await tx.insert(saleItems).values({
          saleId: sale.id,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.lineDiscount,
        });
        await applyStockMovement(tx, {
          variantId: line.variantId,
          storeId: input.storeId,
          type: "venta",
          quantity: -line.quantity,
          userId: input.sellerId,
          saleId: sale.id,
        });
      }
      return sale;
    });
  } catch (err: any) {
    // Carrera: dos submits con el mismo uid a la vez. El chequeo de arriba es
    // check-then-insert, así que el que pierde rebota contra
    // `sales_store_uid_idx` y aborta su transacción. Se relee por uid: si
    // aparece la venta del que ganó, el reintento devuelve esa. Si el 23505
    // vino de otro lado, `ya` queda undefined y el error sigue subiendo.
    // Mismo desenvoltorio de error que openCashSession (drizzle envuelve el
    // error del driver en `err.cause`).
    if (uid) {
      const code = err?.code ?? err?.cause?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        const ya = await buscarPorUid(db, input.storeId, uid);
        if (ya) return { ...ya, duplicada: true };
      }
    }
    throw err;
  }
}

export async function voidSale(db: any, input: { saleId: number; storeId: number; userId: string }): Promise<void> {
  await db.transaction(async (tx: any) => {
    // Scopeado por tienda: no se puede anular una venta de otra tienda por id.
    const [voided] = await tx.update(sales)
      .set({ voided: true, voidedAt: new Date(), voidedBy: input.userId })
      .where(and(eq(sales.id, input.saleId), eq(sales.storeId, input.storeId), eq(sales.voided, false)))
      .returning();
    if (!voided) {
      const [existing] = await tx.select().from(sales)
        .where(and(eq(sales.id, input.saleId), eq(sales.storeId, input.storeId)));
      throw new Error(existing ? "ALREADY_VOIDED" : "SALE_NOT_FOUND");
    }

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, input.saleId));
    for (const item of items) {
      await applyStockMovement(tx, {
        variantId: item.variantId,
        storeId: input.storeId,
        type: "anulacion",
        quantity: item.quantity,
        userId: input.userId,
        saleId: input.saleId,
      });
    }

    // Una venta a cuenta dejó un cargo en la cuenta corriente del cliente.
    // Anularla tiene que revertirlo: si no, el cliente sigue debiendo una venta
    // que no existe. Se registra como movimiento propio en vez de borrar el
    // cargo, para que el historial muestre qué pasó y cuándo.
    //
    // No hace falta guarda de doble reversión: el UPDATE de arriba filtra por
    // `voided = false`, así que esta transacción corre una sola vez por venta.
    if (voided.clientId != null) {
      const [cargo] = await tx.select().from(clientAccountMovements)
        .where(and(
          eq(clientAccountMovements.saleId, input.saleId),
          eq(clientAccountMovements.type, "cargo"),
        ));
      // Puede no haber cargo si la venta es anterior a la cuenta corriente.
      if (cargo) {
        await tx.insert(clientAccountMovements).values({
          storeId: input.storeId,
          clientId: cargo.clientId,
          type: "anulacion",
          amount: cargo.amount,
          saleId: input.saleId,
          createdBy: input.userId,
          note: `Anulación de la venta #${input.saleId}`,
        });
      }
    }
  });
}
