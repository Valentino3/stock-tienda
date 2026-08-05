import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

// `neon-serverless` + Pool NO es intercambiable por `neon-http`: es una elección
// load-bearing. Con Pool, todas las sentencias de un db.transaction() comparten
// una conexión, que es lo que hace funcionar:
//   - el SELECT ... FOR UPDATE de la caja abierta (src/domain/sales.ts)
//   - el pg_advisory_xact_lock que serializa la numeración de comprobantes
//     (src/domain/fiscal-emision.ts)
// Bajo neon-http cada sentencia va por su propio request HTTP: el FOR UPDATE no
// sostiene nada y el advisory lock se vuelve un no-op SILENCIOSO. No fallaría en
// los tests; fallaría en producción como números de factura duplicados.

export type Db = NeonDatabase<typeof schema>;

/**
 * Con `DB_DRIVER=pg` se habla con un Postgres común por TCP en vez de con Neon
 * por WebSocket. Es lo que usan los tests de navegador contra el Postgres de
 * Docker: el driver de Neon necesita su proxy y levantarlo solo para eso sería
 * una pieza más que puede fallar.
 *
 * Los dos drivers son intercambiables de verdad, no por casualidad:
 * `@neondatabase/serverless` es un fork de node-postgres, así que comparten el
 * parseo de tipos, la serialización de Date y la forma de `err.code` que
 * desenvuelven openCashSession y createSale para atrapar el 23505. Y, lo que
 * importa acá, `pg.Pool` también da una conexión por transacción: el FOR UPDATE
 * y el advisory lock significan lo mismo de los dos lados.
 */
function crearDb(): Db {
  const url = process.env.DATABASE_URL!;
  if (process.env.DB_DRIVER === "pg") {
    const pool = new PgPool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
    // El `as unknown as Db` es el costo honesto de tener dos drivers: los tipos
    // de drizzle difieren en detalles que no afectan a ninguna consulta real.
    // Mismo pragmatismo que el `any` de DomainDb, y con los tests cubriendo el
    // comportamiento contra los dos.
    return drizzlePg(pool, { schema }) as unknown as Db;
  }
  return drizzleNeon(new NeonPool({ connectionString: url }), { schema });
}

export const db = crearDb();

// Tipo laxo para dominio: cualquier drizzle-pg con el schema (Neon o PGlite).
// Si el tipado exacto entre drivers Neon/PGlite roza, usar `any` es pragmatismo
// antes que pelea de genéricos; los tests cubren el comportamiento.
export type DomainDb = Pick<Db, "select" | "insert" | "update" | "delete" | "query" | "transaction">;
