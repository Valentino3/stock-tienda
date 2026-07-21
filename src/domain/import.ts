import { and, eq, inArray, sql } from "drizzle-orm";
import { products, productVariants, stockMovements } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";

export type ImportRow = {
  rowNumber: number;
  product: string;
  variant: string;
  sku: string | null;
  price: number | null;
  stock: number;
  setName?: string | null;
  condition?: string | null;
  foil?: boolean;
  language?: string | null;
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
    // ---- updates por SKU ----
    const updateRows = valid.filter((r) => r.action === "update");
    if (updateRows.length) {
      const skus = updateRows.map((r) => r.sku!) ;
      const existingVariants = await tx.select().from(productVariants).where(inArray(productVariants.sku, skus));
      const bySku = new Map(existingVariants.map((v: any) => [v.sku, v]));

      // Batch: precio en un solo UPDATE ... FROM (VALUES ...) en vez de un
      // UPDATE por fila — con miles de filas esto evita miles de round-trips
      // secuenciales. Verificado en esta sesión que `sql.join` + `UPDATE ...
      // FROM (VALUES ...)` funciona con drizzle-orm 0.45.2 + PGlite/Neon.
      const priceUpdates = updateRows
        .map((r) => ({ variant: bySku.get(r.sku!), row: r }))
        .filter(({ variant, row }) => variant && row.price !== null);
      if (priceUpdates.length) {
        const valuesSql = sql.join(
          priceUpdates.map(({ variant, row }) => sql`(${(variant as any).id}::int, ${row.price}::numeric)`),
          sql`, `
        );
        await tx.execute(sql`
          UPDATE product_variants AS pv
          SET price = data.price
          FROM (VALUES ${valuesSql}) AS data(id, price)
          WHERE pv.id = data.id
        `);
      }

      // Stock y atributos de carta: por fila, porque el delta de stock pasa
      // por `applyStockMovement` (guarda atómica contra escrituras
      // concurrentes — sí relevante acá, a diferencia del camino de
      // creación, porque la fila YA existía y algo más pudo estar
      // tocando su stock).
      for (const r of updateRows) {
        const variant = bySku.get(r.sku!) as any;
        if (!variant) {
          // El SKU existía al validar pero desapareció antes de ejecutar
          // (fila borrada concurrentemente, etc.): error de dominio
          // explícito en vez de un TypeError crudo. La tx hace rollback
          // de todo lo hecho.
          throw new Error("VARIANT_GONE");
        }
        const attrUpdates: Record<string, unknown> = {};
        if (r.setName) attrUpdates.setName = r.setName;
        if (r.condition) attrUpdates.condition = r.condition;
        if (r.foil !== undefined) attrUpdates.foil = r.foil;
        if (r.language) attrUpdates.language = r.language;
        if (Object.keys(attrUpdates).length) {
          await tx.update(productVariants).set(attrUpdates).where(eq(productVariants.id, variant.id));
        }
        const delta = r.stock - variant.stock;
        // Nota: no se registra movimiento de ajuste cuando delta === 0 (sin
        // cambio real de stock no hay nada que auditar).
        if (delta !== 0) {
          await applyStockMovement(tx, {
            variantId: variant.id, type: "ajuste", quantity: delta, userId, reason: "importación",
          });
        }
        updated++;
      }
    }

    // ---- creates agrupados por nombre de producto ----
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

      // Batch: un solo insert multi-fila por grupo de producto en vez de un
      // insert por variante. El stock real se inserta directo (no 0 +
      // movimiento después) porque una fila recién creada no tiene con qué
      // competir — nadie más puede estar escribiendo el stock de una
      // variante que no existía hace un instante.
      const insertedVariants = await tx.insert(productVariants).values(
        group.map((r) => ({
          productId: product.id,
          name: r.variant.trim(),
          sku: r.sku,
          stock: r.stock,
          // Comparar contra el basePrice REAL del producto resuelto (reusado
          // o recién insertado), no contra `group[0].price`: si el producto
          // se reusa, su basePrice puede diferir del precio de la primera
          // fila del grupo.
          price: r.price !== null && r.price !== product.basePrice ? r.price : null,
          setName: r.setName ?? null,
          condition: r.condition ?? null,
          foil: r.foil ?? false,
          language: r.language ?? null,
        }))
      ).returning();

      // Postgres preserva el orden de entrada en RETURNING para un único
      // INSERT ... VALUES (...), (...) — verificado en esta sesión con
      // PGlite. Seguro correlacionar por índice.
      const movementValues = group
        .map((r, i) => ({ variantId: insertedVariants[i].id, quantity: r.stock }))
        .filter(({ quantity }) => quantity > 0);
      if (movementValues.length) {
        await tx.insert(stockMovements).values(
          movementValues.map(({ variantId, quantity }) => ({
            variantId, type: "ajuste" as const, quantity, userId, reason: "importación",
          }))
        );
      }
      created += group.length;
    }
  });

  return { created, updated, skipped };
}
