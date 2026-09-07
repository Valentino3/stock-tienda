import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";

/**
 * 🔴 El backfill de `sale_payments`, contra ventas que YA existen.
 *
 * `createTestDb` aplica todas las migraciones sobre una base vacía, así que el
 * INSERT ... SELECT de 0033 corre sobre cero filas y nadie lo prueba. En
 * producción corre sobre años de ventas, y si se saltea aunque sea una, esa
 * venta desaparece del esperado de su caja: el arqueo de ese día pasa a
 * mostrar un faltante que no existe, meses después de que alguien pudiera
 * recordar por qué.
 *
 * Este test hace lo que hace el deploy: migra hasta ANTES del pago dividido,
 * carga ventas, y recién entonces aplica la migración.
 */

const dir = path.resolve(__dirname, "../drizzle");
const MIGRACION_PAGOS = "0033_pago_dividido.sql";

async function aplicar(db: any, archivos: string[]) {
  for (const file of archivos) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of raw.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.execute(sql.raw(stmt));
    }
  }
}

describe("migración 0033: backfill de pagos", () => {
  it("le da a cada venta preexistente un pago por su total y su medio", async () => {
    const client = new PGlite({ extensions: { pg_trgm } });
    const db = drizzle(client, { schema });

    const todas = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const antes = todas.slice(0, todas.indexOf(MIGRACION_PAGOS));
    expect(antes).not.toHaveLength(0);
    expect(antes).not.toContain(MIGRACION_PAGOS);

    await aplicar(db, antes);

    // Una tienda con ventas de los cuatro medios, como cualquier base real.
    await db.execute(sql`insert into stores (name, slug) values ('T', 't1')`);
    await db.execute(sql`insert into "user" (id, name, email, role, store_id)
      values ('u1', 'U', 'u@t.com', 'owner', 1)`);
    await db.execute(sql`insert into cash_sessions (store_id, opened_by, opening_cash)
      values (1, 'u1', 0)`);
    await db.execute(sql`insert into clients (store_id, name) values (1, 'C')`);
    await db.execute(sql`
      insert into sales (store_id, seller_id, registered_by, cash_session_id, total, payment_method, client_id)
      values
        (1, 'u1', 'u1', 1, 1000.50, 'efectivo', null),
        (1, 'u1', 'u1', 1, 2000, 'tarjeta', null),
        (1, 'u1', 'u1', 1, 3000, 'transferencia', null),
        (1, 'u1', 'u1', 1, 4000, 'cuenta', 1),
        -- Una anulada y una en cero: las dos existen en produccion y el
        -- backfill no puede saltearlas (el CHECK es >= 0, no > 0).
        (1, 'u1', 'u1', 1, 500, 'efectivo', null),
        (1, 'u1', 'u1', 1, 0, 'efectivo', null)`);
    await db.execute(sql`update sales set voided = true where total = 500`);

    await aplicar(db, [MIGRACION_PAGOS]);

    const filas: any = await db.execute(sql`
      select s.id, s.total, s.payment_method,
             coalesce(sum(p.amount), -1) as pagado,
             count(p.id) as n
      from sales s left join sale_payments p on p.sale_id = s.id
      group by s.id, s.total, s.payment_method order by s.id`);
    const rows = (Array.isArray(filas) ? filas : filas.rows) as any[];

    expect(rows).toHaveLength(6);
    for (const r of rows) {
      // Ninguna venta sin pago, ni siquiera la anulada o la de total 0.
      expect(Number(r.n)).toBe(1);
      expect(Number(r.pagado)).toBe(Number(r.total));
    }

    // Y el medio se conserva: el backfill no puede aplanar todo a efectivo.
    const medios: any = await db.execute(sql`
      select s.payment_method as venta, p.method as pago
      from sales s join sale_payments p on p.sale_id = s.id order by s.id`);
    for (const m of (Array.isArray(medios) ? medios : medios.rows) as any[]) {
      expect(m.pago).toBe(m.venta);
    }
  });

  it("es reejecutable: correrla dos veces no duplica pagos", async () => {
    // Importa si el deploy se corta en el medio y hay que correrla a mano.
    const client = new PGlite({ extensions: { pg_trgm } });
    const db = drizzle(client, { schema });
    const todas = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    await aplicar(db, todas.slice(0, todas.indexOf(MIGRACION_PAGOS)));

    await db.execute(sql`insert into stores (name, slug) values ('T', 't1')`);
    await db.execute(sql`insert into "user" (id, name, email, role, store_id)
      values ('u1', 'U', 'u@t.com', 'owner', 1)`);
    await db.execute(sql`insert into cash_sessions (store_id, opened_by, opening_cash)
      values (1, 'u1', 0)`);
    await db.execute(sql`
      insert into sales (store_id, seller_id, registered_by, cash_session_id, total, payment_method)
      values (1, 'u1', 'u1', 1, 1000, 'efectivo')`);

    await aplicar(db, [MIGRACION_PAGOS]);
    // Solo el INSERT, que es la parte reejecutable (el CREATE TABLE no lo es).
    await db.execute(sql.raw(`
      INSERT INTO "sale_payments" ("sale_id", "method", "amount", "created_at")
      SELECT s."id", s."payment_method", s."total", s."created_at"
      FROM "sales" s
      WHERE NOT EXISTS (SELECT 1 FROM "sale_payments" p WHERE p."sale_id" = s."id")`));

    const filas: any = await db.execute(sql`select count(*) as n from sale_payments`);
    const rows = (Array.isArray(filas) ? filas : filas.rows) as any[];
    expect(Number(rows[0].n)).toBe(1);
  });
});
