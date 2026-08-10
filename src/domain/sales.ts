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

/** Lista de precios elegida por línea. Ver `priceListEnum` en schema.ts. */
export type PriceList = "venta" | "efectivo" | "mayorista";

const LISTAS: readonly PriceList[] = ["venta", "efectivo", "mayorista"];
export const esListaValida = (x: unknown): x is PriceList =>
  typeof x === "string" && (LISTAS as readonly string[]).includes(x);

/**
 * Precio unitario de una variante según la lista elegida.
 *
 * ⚠️ Las comparaciones son `!= null` y NUNCA `||`. Un artículo en promo a $0 es
 * un precio válido: con `v.priceCash || v.price` se cobraría al precio de
 * lista, o sea MÁS de lo que el cajero le acaba de decir al cliente.
 *
 * Si la lista pedida no está cargada, tira. No cae al precio de venta: las
 * listas alternativas son siempre menores, así que un fallback silencioso
 * cobra de más. La UI solo ofrece las listas que la variante tiene; este error
 * es el backstop de la carrera "alguien borró priceCash con el carrito
 * abierto".
 *
 * `venta` no puede faltar nunca: `price` es nullable pero `products.basePrice`
 * es NOT NULL. Eso acota el error a las dos listas nuevas.
 */
export function resolverPrecio(
  v: { price: number | null; basePrice: number; priceCash?: number | null; priceWholesale?: number | null },
  lista: PriceList = "venta",
): number {
  if (lista === "efectivo") {
    if (v.priceCash == null) throw new Error("PRICE_LIST_NOT_SET");
    return v.priceCash;
  }
  if (lista === "mayorista") {
    if (v.priceWholesale == null) throw new Error("PRICE_LIST_NOT_SET");
    return v.priceWholesale;
  }
  return v.price ?? v.basePrice;
}

export type SaleInput = {
  storeId: number;
  sellerId: string;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  // `priceList` ausente = "venta", que resuelve exactamente lo que la app
  // cobró siempre. Esa es la propiedad de no-regresión: una venta que no
  // menciona listas da el mismo resultado que antes de esta feature, y es lo
  // que hace que gastronomía (que entra por pagarOrden sin mandar lista) no
  // se vea afectada.
  items: { variantId: number; quantity: number; discount?: Discount; priceList?: PriceList }[];
  // Descuento general aplicado sobre el subtotal ya neto de descuentos por línea.
  saleDiscount?: Discount;
  // Cliente de cuenta corriente — obligatorio cuando paymentMethod = "cuenta".
  clientId?: number | null;
  // Clave de idempotencia del carrito (ver sales.uid en schema.ts). Opcional:
  // sin uid la venta entra siempre, que es el comportamiento histórico.
  uid?: string | null;
  // Orden del salón que originó la venta, si vino de una mesa.
  orderId?: number | null;
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
          priceCash: productVariants.priceCash,
          priceWholesale: productVariants.priceWholesale,
          basePrice: products.basePrice,
          tracksStock: products.tracksStock,
          isPromo: products.isPromo,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(
          eq(productVariants.storeId, input.storeId),
          inArray(productVariants.id, input.items.map((i) => i.variantId)),
        ));

      const porId = new Map(variantRows.map((v: any) => [v.id, v]));
      // `!== false` y no `=== true`: una fila anterior a la columna, o un
      // driver que devuelva undefined, tiene que comportarse como el default
      // (sí descuenta). Un producto deja de mover stock solo si alguien lo
      // pidió explícitamente.
      const mueveStock = new Map(variantRows.map((v: any) => [v.id, v.tracksStock !== false]));
      if (porId.size !== new Set(input.items.map((i) => i.variantId)).size) throw new Error("VARIANT_NOT_FOUND");

      // La lista se valida acá y no se deja llegar al enum: una lista basura
      // daría un 22P02 de Postgres adentro de la transacción, abortando la
      // venta entera con un mensaje ilegible.
      if (input.items.some((i) => i.priceList !== undefined && !esListaValida(i.priceList))) {
        throw new Error("INVALID_PRICE_LIST");
      }

      const { lines, saleDiscount, total } = calcularTotales(
        input.items,
        (i) => resolverPrecio(porId.get(i.variantId) as any, i.priceList ?? "venta"),
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
        orderId: input.orderId ?? null,
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
          priceList: line.priceList ?? "venta",
          // Snapshot: la comisión de un período cerrado no puede cambiar
          // porque la promo terminó y alguien limpió el flag del producto.
          isPromo: Boolean((porId.get(line.variantId) as any)?.isPromo),
        });
        // Un producto que no lleva stock no genera movimiento. Sin esta
        // guarda, un plato con existencias en 0 rebota con INSUFFICIENT_STOCK
        // y el restaurante no puede vender nada.
        if (mueveStock.get(line.variantId)) {
          await applyStockMovement(tx, {
            variantId: line.variantId,
            storeId: input.storeId,
            type: "venta",
            quantity: -line.quantity,
            userId: input.sellerId,
            saleId: sale.id,
          });
        }
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

/** Mínimo de un motivo de anulación, ya recortado. Evita el "." y el "asd". */
const MOTIVO_MIN = 3;

export async function voidSale(
  db: any,
  input: { saleId: number; storeId: number; userId: string; reason: string },
): Promise<void> {
  // Se valida acá y no solo en el diálogo: si la guarda viviera únicamente en
  // la UI, la server action sería un bypass. La anulación es el vector de
  // faltante del sistema, así que es justo la operación donde el motivo tiene
  // que ser innegociable.
  const reason = input.reason?.trim() ?? "";
  if (reason.length < MOTIVO_MIN) throw new Error("VOID_REASON_REQUIRED");

  await db.transaction(async (tx: any) => {
    // Scopeado por tienda: no se puede anular una venta de otra tienda por id.
    // El motivo entra en el MISMO update que el resto de la anulación: nunca
    // un segundo write que pueda quedar a medias.
    const [voided] = await tx.update(sales)
      .set({ voided: true, voidedAt: new Date(), voidedBy: input.userId, voidedReason: reason })
      .where(and(eq(sales.id, input.saleId), eq(sales.storeId, input.storeId), eq(sales.voided, false)))
      .returning();
    if (!voided) {
      const [existing] = await tx.select().from(sales)
        .where(and(eq(sales.id, input.saleId), eq(sales.storeId, input.storeId)));
      throw new Error(existing ? "ALREADY_VOIDED" : "SALE_NOT_FOUND");
    }

    // La guarda de stock tiene que ser SIMÉTRICA con createSale. Si al vender
    // un plato no se descontó nada, al anular no se puede devolver nada: se
    // estaría inventando stock de la nada, en silencio y para siempre. Es peor
    // que el error del lado de la venta, porque ese al menos falla ruidoso.
    const items = await tx
      .select({
        variantId: saleItems.variantId,
        quantity: saleItems.quantity,
        tracksStock: products.tracksStock,
      })
      .from(saleItems)
      .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(saleItems.saleId, input.saleId));

    for (const item of items) {
      if (item.tracksStock === false) continue;
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
