import { and, eq, inArray } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";

export type ImportRow = {
  rowNumber: number;
  product: string;
  variant: string;
  sku: string | null;
  price: number | null;
  stock: number;
};

export type ValidatedRow = ImportRow & { error: string | null; action: "create" | "update" | null };

export async function validateImportRows(db: any, rows: ImportRow[]): Promise<ValidatedRow[]> {
  const skus = rows.map((r) => r.sku).filter((s): s is string => !!s);
  const existing = skus.length
    ? await db.select({ sku: productVariants.sku }).from(productVariants).where(inArray(productVariants.sku, skus))
    : [];
  const existingSkus = new Set(existing.map((e: any) => e.sku));
  const seenInFile = new Set<string>();

  return rows.map((r) => {
    let error: string | null = null;
    if (!r.product.trim()) error = "Nombre de producto vacío";
    else if (r.price !== null && (Number.isNaN(r.price) || r.price < 0)) error = "Precio inválido";
    else if (r.price === null && !(r.sku && existingSkus.has(r.sku))) error = "Precio requerido para filas nuevas";
    else if (!Number.isInteger(r.stock) || r.stock < 0) error = "Stock inválido";
    else if (r.sku && seenInFile.has(r.sku)) error = "SKU duplicado en el archivo";
    // Solo se registra el SKU como "visto" cuando la fila es válida: una fila que
    // erroró por otra razón (ej. producto vacío) no debe hacer que una fila
    // posterior y válida con el mismo SKU se marque como duplicado.
    if (r.sku && !error) seenInFile.add(r.sku);
    const action = error ? null : r.sku && existingSkus.has(r.sku) ? "update" : "create";
    return { ...r, error, action };
  });
}

export async function executeImport(
  db: any,
  rows: ValidatedRow[],
  userId: string
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0, updated = 0;
  // IMPORTANTE: `rows` DEBE ser el output completo de validateImportRows, incluyendo
  // las filas con error — este cálculo de `skipped` (y el filtrado de `valid` debajo)
  // se hace acá adentro, no por el caller. Si el caller (Task 10) filtra las filas con
  // error antes de llamar a executeImport, `skipped` va a dar 0 silenciosamente.
  const skipped = rows.filter((r) => r.error).length;
  const valid = rows.filter((r) => !r.error);

  await db.transaction(async (tx: any) => {
    // updates por SKU
    for (const r of valid.filter((r) => r.action === "update")) {
      const [variant] = await tx.select().from(productVariants).where(eq(productVariants.sku, r.sku!));
      if (!variant) {
        // El SKU existía al validar pero desapareció antes de ejecutar (fila borrada
        // concurrentemente, etc.): error de dominio explícito en vez de un TypeError
        // crudo al desreferenciar `variant.id`. La tx hace rollback de todo lo hecho.
        throw new Error("VARIANT_GONE");
      }
      if (r.price !== null) {
        await tx.update(productVariants).set({ price: r.price }).where(eq(productVariants.id, variant.id));
      }
      const delta = r.stock - variant.stock;
      // Nota: no se registra movimiento de ajuste cuando delta === 0 (sin cambio real
      // de stock no hay nada que auditar; evita ruido de movimientos con quantity 0).
      if (delta !== 0) {
        await applyStockMovement(tx, {
          variantId: variant.id, type: "ajuste", quantity: delta, userId, reason: "importación",
        });
      }
      updated++;
    }

    // creates agrupados por nombre de producto
    const creates = valid.filter((r) => r.action === "create");
    const byProduct = new Map<string, ValidatedRow[]>();
    for (const r of creates) {
      const key = r.product.trim();
      byProduct.set(key, [...(byProduct.get(key) ?? []), r]);
    }
    for (const [name, group] of byProduct) {
      // Reusar un producto ACTIVO existente con el mismo nombre exacto en vez de
      // crear un duplicado: re-importar un SKU nuevo para "Remera" debe agregar una
      // variante al "Remera" existente, no crear una segunda fila en `products`.
      const [existingProduct] = await tx
        .select()
        .from(products)
        .where(and(eq(products.name, name), eq(products.active, true)))
        .limit(1);
      const product = existingProduct
        ?? (await tx.insert(products).values({ name, basePrice: group[0].price! }).returning())[0];
      for (const r of group) {
        // Comparar contra el basePrice REAL del producto resuelto (reusado o recién
        // insertado), no contra `group[0].price`: si el producto se reusa, su
        // basePrice puede diferir del precio de la primera fila del grupo, y usar
        // ese precio como referencia perdía silenciosamente el precio importado
        // (quedaba `null` => heredaba el basePrice existente en vez del importado).
        const price = r.price !== null && r.price !== product.basePrice ? r.price : null;
        const [variant] = await tx.insert(productVariants).values({
          productId: product.id,
          name: r.variant.trim(),
          sku: r.sku,
          stock: 0,
          price,
        }).returning();
        if (r.stock > 0) {
          await applyStockMovement(tx, {
            variantId: variant.id, type: "ajuste", quantity: r.stock, userId, reason: "importación",
          });
        }
        created++;
      }
    }
  });

  return { created, updated, skipped };
}
