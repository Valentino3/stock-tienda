import { and, eq } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";

/**
 * Ítem libre: una línea de venta con nombre, precio y cantidad escritos a mano,
 * para lo que no está en el catálogo ("Torta por encargo", "Descorche").
 *
 * Vive como un producto interno de cada tienda, marcado con este uid. Así la
 * línea de venta sigue teniendo una variante —todo lo que lee ventas (caja,
 * reportes, factura, remito) sigue funcionando sin un caso especial— y el
 * nombre escrito va en `sale_items.descripcion`.
 *
 * El producto se crea INACTIVO a propósito: lo inactivo ya queda afuera del
 * buscador, de la carta del salón y del catálogo offline, sin un filtro nuevo
 * en cada consulta. No lleva stock.
 */
export const UID_ITEM_LIBRE = "item-libre";

/** Hasta dónde llega el nombre escrito. Mismo tope que el check de la base. */
export const NOMBRE_LIBRE_MAX = 120;

/** Un precio de un ítem libre por encima de esto es casi seguro un error de tipeo. */
const PRECIO_LIBRE_MAX = 100_000_000;

export type DatosLibre = { nombre: string; precio: number };

/** Valida lo que viene del navegador. Devuelve el nombre ya limpio. */
export function validarLibre(libre: unknown): DatosLibre {
  const l = libre as Partial<DatosLibre> | null;
  const nombre = typeof l?.nombre === "string" ? l.nombre.trim() : "";
  const precio = typeof l?.precio === "number" ? l.precio : Number.NaN;
  if (!nombre || nombre.length > NOMBRE_LIBRE_MAX) throw new Error("ITEM_LIBRE_INVALIDO");
  if (!Number.isFinite(precio) || precio <= 0 || precio > PRECIO_LIBRE_MAX) throw new Error("ITEM_LIBRE_INVALIDO");
  return { nombre, precio: Math.round(precio * 100) / 100 };
}

/**
 * La variante del ítem libre de la tienda. La crea la primera vez. El índice
 * único `(store_id, uid)` de products hace que dos ventas simultáneas no creen
 * dos: la que pierde no inserta nada y lee la que ya está.
 */
export async function varianteItemLibre(db: any, storeId: number): Promise<number> {
  const buscar = async () => {
    const [v] = await db.select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(products.storeId, storeId), eq(products.uid, UID_ITEM_LIBRE)))
      .limit(1);
    return v?.id as number | undefined;
  };

  const ya = await buscar();
  if (ya) return ya;

  // Producto y variante en una transacción: la otra venta, si choca contra el
  // índice, espera a que esta confirme y después encuentra las dos filas.
  const creada: number | undefined = await db.transaction(async (tx: any) => {
    const [producto] = await tx.insert(products).values({
      storeId,
      uid: UID_ITEM_LIBRE,
      name: "Ítem libre",
      basePrice: 0,
      tracksStock: false,
      active: false,
    }).onConflictDoNothing().returning({ id: products.id });
    if (!producto) return undefined;
    const [v] = await tx.insert(productVariants)
      .values({ storeId, productId: producto.id, name: "", stock: 0, active: false })
      .returning({ id: productVariants.id });
    return v.id;
  });
  if (creada) return creada;

  const otra = await buscar();
  if (!otra) throw new Error("ITEM_LIBRE_NO_DISPONIBLE");
  return otra;
}
