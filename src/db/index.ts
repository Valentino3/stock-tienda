import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
export type Db = typeof db;

// Tipo laxo para dominio: cualquier drizzle-pg con el schema (Neon o PGlite).
// Si el tipado exacto entre drivers Neon/PGlite roza, usar `any` es pragmatismo
// antes que pelea de genéricos; los tests cubren el comportamiento.
export type DomainDb = Pick<Db, "select" | "insert" | "update" | "delete" | "query" | "transaction">;
