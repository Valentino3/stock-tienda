import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
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
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
export type Db = typeof db;

// Tipo laxo para dominio: cualquier drizzle-pg con el schema (Neon o PGlite).
// Si el tipado exacto entre drivers Neon/PGlite roza, usar `any` es pragmatismo
// antes que pelea de genéricos; los tests cubren el comportamiento.
export type DomainDb = Pick<Db, "select" | "insert" | "update" | "delete" | "query" | "transaction">;
