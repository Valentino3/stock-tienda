import { and, eq } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";

/**
 * Alta de productos y variantes cargados a mano.
 *
 * Existe separado de `src/app/(app)/productos/actions.ts` por la misma razón
 * que `createSale` existe separado de `submitSale`: el server action arrastra
 * `next/cache`, `@/db` y la sesión, y nada de eso se puede montar en un test.
 * Acá adentro solo hay `db` y schema, así que corre contra PGlite.
 *
 * Las dos funciones abren transacción propia. Antes no la había —eran dos
 * INSERT sueltos— y si el segundo fallaba quedaba un producto sin ninguna
 * variante: invisible en Vender y en Productos (las dos pantallas joinean por
 * variante) e imposible de borrar desde la UI.
 */

/** Queda en `stock_movements.reason` y es lo que el dueño ve en el historial. */
const MOTIVO_ALTA = "alta manual";

export type CrearProductoInput = {
  storeId: number;
  userId: string;
  name: string;
  category?: string | null;
  basePrice: number;
  /** Precio de venta en dolares. null = no se ata a la cotizacion. */
  basePriceUsd?: number | null;
  lowStockThreshold: number;
  tracksStock: boolean;
  station?: string | null;
  isPromo?: boolean;
  /** Va a la variante default. Sin él, la búsqueda solo puede matchear por nombre. */
  sku?: string | null;
  stockInicial?: number;
};

/**
 * Producto nuevo con su variante default y, si corresponde, el stock con el
 * que entra al local.
 *
 * ⚠️ El stock inicial entra por `applyStockMovement` y NUNCA como un `stock:`
 * en el INSERT. Cuesta un UPDATE extra sobre una fila recién creada, y a
 * cambio queda el movimiento en `stock_movements`: sin él habría existencias
 * que ningún movimiento explica, que es justo lo que el historial y los
 * reportes de stock existen para poder reconstruir.
 */
export async function crearProducto(
  db: any,
  input: CrearProductoInput
): Promise<{ productId: number; variantId: number; stock: number }> {
  const stockInicial = input.stockInicial ?? 0;

  return db.transaction(async (tx: any) => {
    const [p] = await tx.insert(products).values({
      storeId: input.storeId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      basePrice: input.basePrice,
      basePriceUsd: input.basePriceUsd ?? null,
      lowStockThreshold: input.lowStockThreshold,
      tracksStock: input.tracksStock,
      station: input.station?.trim() || null,
      isPromo: input.isPromo === true,
    }).returning({ id: products.id });

    const [v] = await tx.insert(productVariants).values({
      storeId: input.storeId,
      productId: p.id,
      // Variante default de un producto sin variantes reales: nombre vacío a
      // propósito, y por eso `saveVariant` acepta nombre vacío al editar.
      name: "",
      sku: input.sku?.trim() || null,
    }).returning({ id: productVariants.id });

    const stock = await aplicarStockInicial(tx, {
      variantId: v.id,
      storeId: input.storeId,
      userId: input.userId,
      tracksStock: input.tracksStock,
      cantidad: stockInicial,
    });

    return { productId: p.id, variantId: v.id, stock };
  });
}

export type CrearVarianteInput = {
  storeId: number;
  userId: string;
  productId: number;
  /** Todo lo que `saveVariant` ya escribía: sku, price, listas, costos, atributos. */
  values: Record<string, unknown>;
  stockInicial?: number;
};

/**
 * Variante explícita de un producto que ya existe. Devuelve `null` si el
 * producto padre no es de esta tienda: la guarda va adentro de la transacción
 * y no antes, para que nadie pueda atar una variante a un producto ajeno
 * aprovechando la ventana entre el chequeo y el INSERT.
 */
export async function crearVariante(
  db: any,
  input: CrearVarianteInput
): Promise<{ variantId: number; stock: number } | null> {
  return db.transaction(async (tx: any) => {
    // El `tracksStock` del padre viene en la misma consulta que la guarda de
    // tienda: hace falta para decidir el stock inicial y no justifica un viaje
    // aparte.
    const [parent] = await tx
      .select({ id: products.id, tracksStock: products.tracksStock })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId)));
    if (!parent) return null;

    const [v] = await tx.insert(productVariants)
      .values({ ...input.values, storeId: input.storeId, productId: input.productId })
      .returning({ id: productVariants.id });

    const stock = await aplicarStockInicial(tx, {
      variantId: v.id,
      storeId: input.storeId,
      userId: input.userId,
      tracksStock: parent.tracksStock !== false,
      cantidad: input.stockInicial ?? 0,
    });

    return { variantId: v.id, stock };
  });
}

/**
 * `type: "ajuste"` y no `"reposicion"`: reposición significa que llegó
 * mercadería nueva al local, y la carga inicial es un ajuste del inventario
 * contra lo que ya había en el estante. Es el mismo criterio que usa
 * `executeImport` para el camino de creación.
 *
 * Un `tracksStock: false` con stock inicial se saltea EN SILENCIO. A
 * diferencia de `restock`/`adjustStock` —donde rechazar es la única lectura
 * posible de la acción— acá el número puede venir de un checkbox que el dueño
 * destildó después de tipearlo, y abortar el alta entera por eso sería perder
 * el producto para no perder un dato que no significa nada.
 */
async function aplicarStockInicial(
  tx: any,
  opts: { variantId: number; storeId: number; userId: string; tracksStock: boolean; cantidad: number }
): Promise<number> {
  if (!opts.tracksStock || opts.cantidad <= 0) return 0;
  return applyStockMovement(tx, {
    variantId: opts.variantId,
    storeId: opts.storeId,
    type: "ajuste",
    quantity: opts.cantidad,
    userId: opts.userId,
    reason: MOTIVO_ALTA,
  });
}
