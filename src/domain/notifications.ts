import { and, desc, eq, sql } from "drizzle-orm";
import { notifications, productVariants, products, user } from "@/db/schema";

// Crea un aviso de stock bajo para una variante. Dedupe: si ya hay uno "open"
// para esa variante, no crea otro (devuelve el existente).
export async function createLowStockNotification(
  db: any,
  input: { storeId: number; variantId: number; userId: string; note?: string | null }
) {
  const [v] = await db
    .select({
      stock: productVariants.stock,
      variantName: productVariants.name,
      productName: products.name,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.id, input.variantId), eq(productVariants.storeId, input.storeId)));
  if (!v) throw new Error("VARIANT_NOT_FOUND");

  const [dup] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.storeId, input.storeId),
      eq(notifications.variantId, input.variantId),
      eq(notifications.status, "open"),
    ));
  if (dup) return dup;

  const label = v.variantName ? `${v.productName} — ${v.variantName}` : v.productName;
  const [row] = await db.insert(notifications).values({
    storeId: input.storeId,
    type: "low_stock",
    variantId: input.variantId,
    productName: v.productName,
    variantName: v.variantName || null,
    message: `Stock bajo: ${label} (${v.stock} u.)`,
    stockAtCreate: v.stock,
    note: input.note?.trim() || null,
    createdBy: input.userId,
  }).returning();
  return row;
}

/**
 * Aviso generado al sincronizar ventas hechas sin conexión.
 *
 * Va a la misma bandeja que los avisos de stock bajo porque el problema es el
 * mismo: algo que el dueño tiene que mirar y resolver a mano. Sin esto, un
 * stock que quedó negativo o una venta que entró después del cierre de caja
 * serían divergencias silenciosas entre lo que pasó y lo que dice el sistema.
 *
 * No deduplica: cada venta sincronizada con un problema es un hecho distinto.
 */
export async function createSyncNotification(
  db: any,
  input: {
    storeId: number;
    userId: string;
    type: "stock_negativo" | "venta_post_cierre" | "precio_distinto";
    message: string;
    label: string; // se guarda en product_name, que es NOT NULL
    variantId?: number | null;
    variantName?: string | null;
    stockAtCreate?: number | null;
  }
) {
  const [row] = await db.insert(notifications).values({
    storeId: input.storeId,
    type: input.type,
    variantId: input.variantId ?? null,
    productName: input.label,
    variantName: input.variantName ?? null,
    message: input.message,
    stockAtCreate: input.stockAtCreate ?? null,
    createdBy: input.userId,
  }).returning();
  return row;
}

export async function listNotifications(db: any, storeId: number, opts: { status?: "open" | "resolved" } = {}) {
  const conditions = [eq(notifications.storeId, storeId)];
  if (opts.status) conditions.push(eq(notifications.status, opts.status));
  return db
    .select({ notification: notifications, createdByName: user.name })
    .from(notifications)
    .innerJoin(user, eq(notifications.createdBy, user.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt));
}

export async function countOpenNotifications(db: any, storeId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(notifications)
    .where(and(eq(notifications.storeId, storeId), eq(notifications.status, "open")));
  return row?.n ?? 0;
}

// Scopeado por tienda: no resuelve avisos de otra tienda por id.
export async function resolveNotification(db: any, storeId: number, id: number, userId: string): Promise<void> {
  await db.update(notifications)
    .set({ status: "resolved", resolvedBy: userId, resolvedAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.storeId, storeId), eq(notifications.status, "open")));
}
