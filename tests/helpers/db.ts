import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, isNull, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";

export async function createTestDb() {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  const dir = path.resolve(__dirname, "../../drizzle");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of raw.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.execute(sql.raw(stmt));
    }
  }
  return db;
}

export async function seedTestStore(
  db: Awaited<ReturnType<typeof createTestDb>>,
  slug = "t1",
  name = "Tienda Test"
) {
  const [s] = await db.insert(schema.stores).values({ name, slug }).returning();
  return s.id;
}

export async function seedTestUser(
  db: Awaited<ReturnType<typeof createTestDb>>,
  id = "u1",
  role = "employee",
  storeId: number | null = null
) {
  await db.insert(schema.user).values({ id, name: "Test", email: `${id}@test.com`, role, storeId });
  return id;
}

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Venta mínima con una línea, sin pasar por createSale. Sirve para los tests
 * fiscales, que necesitan una venta a la que colgarle comprobantes pero no
 * están probando la lógica de venta.
 */
export async function seedTestSale(
  db: TestDb,
  opts: { storeId: number; userId?: string; total?: number; discountAmount?: number; quantity?: number; unitPrice?: number }
) {
  const userId = opts.userId ?? "u1";
  const quantity = opts.quantity ?? 1;
  const unitPrice = opts.unitPrice ?? opts.total ?? 1000;
  const total = opts.total ?? quantity * unitPrice;

  const [p] = await db.insert(schema.products)
    .values({ storeId: opts.storeId, name: "Producto test", basePrice: unitPrice }).returning();
  const [v] = await db.insert(schema.productVariants)
    .values({ storeId: opts.storeId, productId: p.id, name: "", stock: 100 }).returning();
  // Reusa la caja abierta si ya hay una: cash_sessions_one_open_idx solo permite
  // una por tienda, así que varias ventas seguidas comparten sesión.
  const [abierta] = await db.select().from(schema.cashSessions).where(and(
    eq(schema.cashSessions.storeId, opts.storeId),
    isNull(schema.cashSessions.closedAt),
  )).limit(1);
  const session = abierta ?? (await db.insert(schema.cashSessions)
    .values({ storeId: opts.storeId, openedBy: userId, openingCash: 0 }).returning())[0];
  const [sale] = await db.insert(schema.sales).values({
    storeId: opts.storeId, sellerId: userId, registeredBy: userId, cashSessionId: session.id,
    total, discountAmount: opts.discountAmount ?? 0, paymentMethod: "efectivo",
  }).returning();
  // Toda venta tiene su pago: es la invariante que sostiene el arqueo.
  await db.insert(schema.salePayments)
    .values({ saleId: sale.id, method: "efectivo", amount: total });
  await db.insert(schema.saleItems)
    .values({ saleId: sale.id, variantId: v.id, quantity, unitPrice });

  return { sale, variantId: v.id, productId: p.id, cashSessionId: session.id };
}


/**
 * Ventas insertadas a mano, con su fila de pago.
 *
 * Existe porque el arqueo suma de `sale_payments`: una venta insertada
 * directamente en `sales` no aporta nada al esperado, y el test falla con un
 * numero que no explica por que. Todo insert crudo a `sales` en los tests
 * deberia pasar por aca.
 */
export async function sembrarVentasCrudas(
  db: TestDb,
  filas: (typeof schema.sales.$inferInsert)[],
) {
  const ventas = await db.insert(schema.sales).values(filas).returning();
  await db.insert(schema.salePayments).values(
    ventas.map((v) => ({ saleId: v.id, method: v.paymentMethod, amount: v.total })),
  );
  return ventas;
}
