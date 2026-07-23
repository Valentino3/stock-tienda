import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
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
