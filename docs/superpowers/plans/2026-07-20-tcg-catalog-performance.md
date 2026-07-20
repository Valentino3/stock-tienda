# TCG Catálogo + Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar atributos estructurados de carta (set/condición/foil/idioma) al catálogo, e implementar búsqueda indexada + paginación server-side para que la app escale a miles de variantes (hoy escrita para catálogos de decenas de productos).

**Architecture:** Migración aditiva de columnas + migraciones SQL a mano para índices trigram (fuera del alcance de drizzle-kit). Lógica de búsqueda extraída a `src/domain/catalog.ts` (testeable, mismo patrón que `src/domain/reports.ts`). Productos pasa de "traer todo + filtrar en el cliente" a paginación server-side vía `searchParams`. Import Excel gana batching (insert/update multi-fila) para no arriesgar timeout con miles de filas.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Neon Postgres (`drizzle-orm/neon-serverless`), PGlite (tests), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-tcg-catalog-performance-design.md` — leerla antes de cualquier tarea.
- **Cero cambios de comportamiento** en firmas externas ya usadas por UI/tests: `searchVariants(term)` (server action), `executeImport(db, rows, userId)`, `validateImportRows`, `getTopProducts`, `getLowStock`. Los campos nuevos son aditivos/opcionales.
- Los 27 tests existentes deben seguir en verde en todo momento — son la prueba de compatibilidad hacia atrás.
- **PGlite no soporta `pg_trgm` por default** — verificado en esta sesión (`CREATE EXTENSION pg_trgm` falla con "extension not available" en una instancia PGlite plana). Sí existe como bundle cargable: `@electric-sql/pglite/contrib/pg_trgm`, pasado como `new PGlite({ extensions: { pg_trgm } })`. **`tests/helpers/db.ts` debe actualizarse para cargar este bundle antes de que se agregue la primera migración con `CREATE EXTENSION pg_trgm`** (Tarea 2) — si no, los 27 tests existentes empiezan a fallar porque `createTestDb()` repite TODAS las migraciones de `drizzle/` antes de cada test.
- Verificado en esta sesión (scripts descartables, no quedan en el repo): `inArray(col, subquery)` funciona con drizzle-orm 0.45.2; `db.execute(sql\`UPDATE ... FROM (VALUES ${sql.join(...)}) ...\`)` funciona para updates en lote; `insert().values([...]).returning()` preserva el orden de entrada (Postgres garantiza esto para un único INSERT con lista VALUES, no paralelizado).
- Formato exacto de migraciones a mano (precedente ya en el repo, `drizzle/0002_cash_sessions_one_open_idx.sql`): comentario explicando el porqué, sin `--> statement-breakpoint` si es una sola sentencia; con él (pegado inmediatamente después del `;`, sin espacio) si son varias — ver `drizzle/0001_gorgeous_santa_claus.sql` para el formato exacto.
- UI en español, código/identificadores/commits en inglés.
- Commits frecuentes, mensajes convencionales (`feat:`, `fix:`, `test:`, `chore:`).

---

### Task 1: Migración de schema — columnas de atributos de carta

**Files:**
- Modify: `src/db/schema.ts:99-108`
- Create: migración generada por drizzle-kit (nombre exacto lo asigna la herramienta)
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Produces: `productVariants.setName: string | null`, `.condition: string | null`, `.foil: boolean`, `.language: string | null` — disponibles en el tipo `ProductVariant` inferido (`typeof productVariants.$inferSelect`), consumido por todas las tareas siguientes.

- [ ] **Step 1: Agregar las columnas al schema**

Modificar `src/db/schema.ts`, la tabla `productVariants` (línea 99-108 actual):

```ts
export const productVariants = pgTable("product_variants", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: integer("product_id").notNull().references(() => products.id),
  // '' para la variante default de productos sin variantes reales (UI la oculta)
  name: text("name").notNull().default(""),
  sku: text("sku").unique(),
  stock: integer("stock").notNull().default(0),
  price: numeric("price", { precision: 12, scale: 2, mode: "number" }), // null => hereda basePrice
  active: boolean("active").notNull().default(true),
  setName: text("set_name"),
  condition: text("condition"),
  foil: boolean("foil").notNull().default(false),
  language: text("language"),
});
```

- [ ] **Step 2: Generar la migración**

Run: `npx drizzle-kit generate`
Expected: crea un nuevo archivo `drizzle/000N_<nombre-generado>.sql` con 4 sentencias `ALTER TABLE "product_variants" ADD COLUMN ...` (aditivas, sin backfill necesario porque son nullable o tienen default). Anotar el nombre exacto del archivo generado para referenciarlo en el commit.

- [ ] **Step 3: Test — insertar variante con los campos nuevos**

Agregar a `tests/schema.test.ts` (después del test existente, dentro del mismo `describe`):

```ts
  it("supports card attribute columns on a variant, foil defaults to false", async () => {
    const db = await createTestDb();
    await seedTestUser(db);
    const [p] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    const [withAttrs] = await db.insert(productVariants).values({
      productId: p.id, name: "Base Set NM", stock: 3,
      setName: "Base Set", condition: "NM", foil: true, language: "EN",
    }).returning();
    expect(withAttrs.setName).toBe("Base Set");
    expect(withAttrs.condition).toBe("NM");
    expect(withAttrs.foil).toBe(true);
    expect(withAttrs.language).toBe("EN");

    const [defaults] = await db.insert(productVariants).values({ productId: p.id, name: "sin atributos" }).returning();
    expect(defaults.foil).toBe(false);
    expect(defaults.setName).toBeNull();
  });
```

- [ ] **Step 4: Verificar**

Run: `npm test`
Expected: todos los tests pasan (incluye el nuevo).

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpios.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/ tests/schema.test.ts
git commit -m "feat: add card attribute columns to product variants"
```

---

### Task 2: Índices trigram sobre columnas de texto existentes + fix del harness de tests

**Files:**
- Create: `drizzle/000N_trgm_search_indexes.sql` (migración a mano)
- Modify: `tests/helpers/db.ts`
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Produces: `createTestDb()` sigue con la misma firma, pero ahora carga el bundle `pg_trgm` — todas las tareas siguientes que agreguen migraciones con `CREATE EXTENSION`/índices GIN dependen de este fix.

**Contexto (verificado en esta sesión, no repetir la verificación):** una instancia PGlite plana (`new PGlite()`) rechaza `CREATE EXTENSION pg_trgm` con "extension not available". El paquete sí trae el bundle en `@electric-sql/pglite/contrib/pg_trgm`, cargable así: `new PGlite({ extensions: { pg_trgm } })`. Con eso, `CREATE EXTENSION pg_trgm` + `CREATE INDEX ... USING gin (col gin_trgm_ops)` funcionan igual que en Postgres real.

- [ ] **Step 1: Cargar el bundle en el harness de tests**

Modificar `tests/helpers/db.ts`:

```ts
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

export async function seedTestUser(db: Awaited<ReturnType<typeof createTestDb>>, id = "u1", role = "employee") {
  await db.insert(schema.user).values({ id, name: "Test", email: `${id}@test.com`, role });
  return id;
}
```

(Único cambio real: el import de `pg_trgm` y pasarlo como `extensions` al constructor de `PGlite`.)

- [ ] **Step 2: Verificar que nada se rompió todavía**

Run: `npm test`
Expected: los mismos tests de antes, todos en verde (este paso no agregó ninguna migración nueva, solo preparó el harness).

- [ ] **Step 3: Crear la migración a mano**

Run: `npx drizzle-kit generate --custom`
Expected: crea un archivo vacío `drizzle/000N_<nombre>.sql` y agrega la entrada correspondiente a `drizzle/meta/_journal.json` automáticamente (mismo mecanismo que generó `0002_cash_sessions_one_open_idx.sql` — no editar `_journal.json` a mano).

Renombrar/reescribir ese archivo (o el que haya generado) a `drizzle/000N_trgm_search_indexes.sql` con este contenido:

```sql
-- Custom SQL migration file, put your code below! --
-- Postgres no puede usar un índice btree común para `ilike '%term%'`
-- (comodín al inicio) — con miles de variantes esto degrada a Seq Scan.
-- pg_trgm + GIN permite que ILIKE con comodín al inicio use un índice.
-- Ver docs/superpowers/specs/2026-07-20-tcg-catalog-performance-design.md
-- para la justificación completa (por qué trigram y no full-text search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_variants_sku_trgm_idx" ON "product_variants" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_variants_name_trgm_idx" ON "product_variants" USING gin ("name" gin_trgm_ops);
```

- [ ] **Step 4: Test — la migración corre y el índice es usable**

Agregar a `tests/schema.test.ts`:

```ts
  it("pg_trgm indexes are created and support ILIKE with a leading wildcard", async () => {
    const db = await createTestDb();
    await seedTestUser(db);
    const [p] = await db.insert(products).values({ name: "Charizard Base Set", basePrice: 50000 }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "NM Foil", sku: "CHAR-BS-NM-F", stock: 1 });

    const found = await db.execute(sql`SELECT id FROM products WHERE name ILIKE '%izard%'`);
    expect(found.rows).toHaveLength(1);
  });
```

Este test prueba que la extensión/índice se crean sin error y que la búsqueda funciona — **no** prueba que el planner de Postgres real elija el índice en vez de un Seq Scan a escala (PGlite es de un solo usuario, sin estadísticas representativas de miles de filas). Esa verificación queda para el paso 3 de "Verificación end-to-end" al final del plan, contra Neon real.

- [ ] **Step 5: Verificar**

Run: `npm test`
Expected: todos los tests (incluidos los de Task 1) en verde.

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 6: Commit**

```bash
git add drizzle/ tests/helpers/db.ts tests/schema.test.ts
git commit -m "feat: add pg_trgm search indexes and load extension in test harness"
```

---

### Task 3: Índice trigram sobre `set_name` (depende de Task 1)

**Files:**
- Create: `drizzle/000N_set_name_trgm_index.sql`
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Consumes: columna `productVariants.setName` (Task 1).

- [ ] **Step 1: Migración**

```bash
npx drizzle-kit generate --custom
```

Contenido de `drizzle/000N_set_name_trgm_index.sql`:

```sql
-- Custom SQL migration file, put your code below! --
-- Índice trigram sobre set_name: usado por la búsqueda de Vender
-- (src/domain/catalog.ts) y por la paginación de Productos para que
-- un cashier/owner pueda encontrar cartas escribiendo el nombre del set.
CREATE INDEX "product_variants_set_name_trgm_idx" ON "product_variants" USING gin ("set_name" gin_trgm_ops);
```

- [ ] **Step 2: Test**

Agregar a `tests/schema.test.ts`:

```ts
  it("set_name trgm index supports ILIKE search on the set name", async () => {
    const db = await createTestDb();
    await seedTestUser(db);
    const [p] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "NM", stock: 1, setName: "Base Set" });

    const found = await db.execute(sql`SELECT id FROM product_variants WHERE set_name ILIKE '%base%'`);
    expect(found.rows).toHaveLength(1);
  });
```

- [ ] **Step 3: Verificar**

Run: `npm test && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add drizzle/ tests/schema.test.ts
git commit -m "feat: add trigram index on variant set name"
```

---

### Task 4: Extraer y extender `searchVariants` (búsqueda en Vender)

**Files:**
- Create: `src/domain/catalog.ts`
- Test: `tests/catalog.test.ts`
- Modify: `src/app/(app)/vender/actions.ts`, `src/app/(app)/vender/sale-form.tsx`

**Interfaces:**
- Consumes: schema de Task 1 (`setName`, `condition`, `foil`, `language`).
- Produces: `searchVariants(db: DomainDb, term: string): Promise<SearchResult[]>` en `src/domain/catalog.ts`, donde `SearchResult` incluye `{variantId, productName, variantName, sku, stock, price, basePrice, setName, condition, foil, language}`. La server action `searchVariants(term: string)` en `vender/actions.ts` mantiene su firma externa actual (sin el parámetro `db`, que inyecta ella).

- [ ] **Step 1: Domain — búsqueda extraída y extendida**

Create `src/domain/catalog.ts`:

```ts
import { and, eq, ilike, or } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";

export async function searchVariants(db: any, term: string) {
  const t = term.trim();
  if (t.length < 2) return [];
  const pattern = `%${t}%`;
  return db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      stock: productVariants.stock,
      price: productVariants.price,
      basePrice: products.basePrice,
      setName: productVariants.setName,
      condition: productVariants.condition,
      foil: productVariants.foil,
      language: productVariants.language,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.active, true), eq(productVariants.active, true),
      or(
        ilike(products.name, pattern),
        ilike(productVariants.sku, pattern),
        ilike(productVariants.name, pattern),
        ilike(productVariants.setName, pattern),
      )
    ))
    .limit(20);
}
```

(Antes solo buscaba en `products.name` y `productVariants.sku` — se agregan `productVariants.name` y `productVariants.setName`, cerrando un gap real: hoy no se puede buscar por nombre de variante.)

- [ ] **Step 2: Test**

Create `tests/catalog.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { searchVariants } from "@/domain/catalog";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("searchVariants", () => {
  it("matches by variant name and by set name, not just product name or SKU", async () => {
    const [p] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    await db.insert(productVariants).values([
      { productId: p.id, name: "Base Set NM", sku: "CHAR-BS-NM", stock: 3, setName: "Base Set", condition: "NM" },
      { productId: p.id, name: "Jungle LP", sku: "CHAR-JU-LP", stock: 1, setName: "Jungle", condition: "LP" },
    ]);

    const byVariantName = await searchVariants(db, "Jungle LP");
    expect(byVariantName.map((r: { sku: string | null }) => r.sku)).toEqual(["CHAR-JU-LP"]);

    const bySetName = await searchVariants(db, "Base Set");
    expect(bySetName.map((r: { sku: string | null }) => r.sku)).toEqual(["CHAR-BS-NM"]);
  });

  it("returns empty for terms under 2 characters", async () => {
    expect(await searchVariants(db, "a")).toEqual([]);
  });

  it("excludes inactive products and variants", async () => {
    const [p] = await db.insert(products).values({ name: "Pikachu", basePrice: 1000, active: false }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "NM", sku: "PIKA-NM", stock: 1 });
    expect(await searchVariants(db, "Pikachu")).toEqual([]);
  });
});
```

- [ ] **Step 3: Correr — debe fallar antes de tocar la action (el módulo no existe todavía en este punto del flujo TDD)**

Run: `npm test -- catalog`
Expected: FAIL (`Cannot find module '@/domain/catalog'`) hasta completar el Step 1 — si ya se hizo Step 1 antes de este paso, correr ahora debería pasar directo. Verificar que efectivamente pasa:

Run: `npm test -- catalog`
Expected: PASS (3/3).

- [ ] **Step 4: Vender action — delega al dominio**

Modify `src/app/(app)/vender/actions.ts` (reemplazar el bloque de `searchVariants`, dejar el resto del archivo — `ERROR_MESSAGES`, `submitSale` — intacto):

```ts
"use server";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { createSale } from "@/domain/sales";
import { searchVariants as searchVariantsQuery } from "@/domain/catalog";

export async function searchVariants(term: string) {
  await requireUser();
  return searchVariantsQuery(db, term);
}

const ERROR_MESSAGES: Record<string, string> = {
  NO_OPEN_SESSION: "No hay caja abierta. Abrí la caja antes de vender.",
  INSUFFICIENT_STOCK: "Stock insuficiente para uno de los productos.",
  EMPTY_SALE: "El carrito está vacío.",
  INVALID_QUANTITY: "Cantidad inválida",
  VARIANT_NOT_FOUND: "Producto no encontrado",
};

export async function submitSale(input: {
  paymentMethod: "efectivo" | "transferencia" | "tarjeta";
  items: { variantId: number; quantity: number }[];
}) {
  const user = await requireUser();
  const invalid = input.items.some(
    (i) => !Number.isInteger(i.variantId) || !Number.isInteger(i.quantity) || i.quantity <= 0
  );
  if (invalid) return { error: "Cantidad inválida" };
  try {
    const sale = await createSale(db, { sellerId: user.id, ...input });
    return { ok: true as const, saleId: sale.id, total: sale.total };
  } catch (e) {
    const msg = e instanceof Error ? ERROR_MESSAGES[e.message] : undefined;
    return { error: msg ?? "Error al registrar la venta" };
  }
}
```

- [ ] **Step 5: Sale form — mostrar los atributos nuevos en el carrito**

Modify `src/app/(app)/vender/sale-form.tsx`: reemplazar el `type CartItem`, `label()` y `addToCart` (líneas 13-19, 27-29, 50-71 del archivo actual) por:

```ts
type CartItem = {
  variantId: number;
  productName: string;
  variantName: string;
  setName: string | null;
  condition: string | null;
  foil: boolean;
  language: string | null;
  price: number;
  quantity: number;
};
```

```ts
function label(item: {
  productName: string;
  variantName: string;
  setName?: string | null;
  condition?: string | null;
  foil?: boolean;
  language?: string | null;
}) {
  const parts = [item.variantName, item.setName, item.condition, item.foil ? "Foil" : null, item.language].filter(Boolean);
  return parts.length ? `${item.productName} — ${parts.join(" ")}` : item.productName;
}
```

```ts
  function addToCart(r: SearchResult) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === r.variantId);
      if (existing) {
        return prev.map((i) =>
          i.variantId === r.variantId ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          variantId: r.variantId,
          productName: r.productName,
          variantName: r.variantName,
          setName: r.setName,
          condition: r.condition,
          foil: r.foil,
          language: r.language,
          price: r.price ?? r.basePrice,
          quantity: 1,
        },
      ];
    });
    setTerm("");
    setResults([]);
  }
```

El resto del archivo (búsqueda debounced, stepper, `Table` del carrito, confirmación) no cambia — ya usa `label(item)`/`label(r)` genéricamente, así que recoge los campos nuevos sin más ediciones.

- [ ] **Step 6: Verificar**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde. `SearchResult` en `sale-form.tsx` se infiere de `Awaited<ReturnType<typeof searchVariants>>[number]`, así que recoge los campos nuevos automáticamente sin tocar esa línea.

- [ ] **Step 7: Commit**

```bash
git add src/domain/catalog.ts tests/catalog.test.ts src/app/\(app\)/vender/actions.ts src/app/\(app\)/vender/sale-form.tsx
git commit -m "feat: extend variant search to name/set fields, extract to domain layer"
```

---

### Task 5: Productos — paginación server-side (reemplaza el filtro client-side)

**Files:**
- Create: `src/app/(app)/productos/search-input.tsx`
- Modify: `src/app/(app)/productos/page.tsx`, `src/app/(app)/productos/product-list.tsx`

**Interfaces:**
- Consumes: `ProductWithVariants` (ya exportado de `page.tsx`), schema de Task 1 (`setName` en la búsqueda).
- Produces: `ProductList` deja de manejar estado/filtro — pasa a ser un componente de solo presentación que recibe `products` ya paginados/filtrados.

- [ ] **Step 1: Componente de búsqueda debounced**

Create `src/app/(app)/productos/search-input.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function SearchInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      // No se preserva `page` a propósito: una búsqueda nueva siempre
      // arranca en la página 1 (una página 3 de una búsqueda anterior
      // probablemente no tiene sentido para el término nuevo).
      router.push(params.toString() ? `${pathname}?${params}` : pathname);
    }, 300);
    return () => clearTimeout(handle);
  }, [value, pathname, router]);

  return (
    <Input
      placeholder="Buscar producto o SKU..."
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="max-w-sm"
    />
  );
}
```

- [ ] **Step 2: Reescribir la página con paginación server-side**

Replace `src/app/(app)/productos/page.tsx` en su totalidad:

```tsx
import Link from "next/link";
import { ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import type { Product, ProductVariant } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ProductForm } from "./product-form";
import { ProductList } from "./product-list";
import { SearchInput } from "./search-input";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

const PAGE_SIZE = 50;

async function getProducts(opts: { q?: string; page: number }): Promise<{ products: ProductWithVariants[]; hasNextPage: boolean }> {
  const q = opts.q?.trim();

  // Un término que solo matchea el SKU/nombre/set de una VARIANTE (no el
  // nombre del producto padre) igual debe traer el producto padre completo
  // — de lo contrario buscar por SKU de carta no encontraría nada.
  const matchesVariant = q
    ? db
        .select({ productId: productVariants.productId })
        .from(productVariants)
        .where(or(
          ilike(productVariants.sku, `%${q}%`),
          ilike(productVariants.name, `%${q}%`),
          ilike(productVariants.setName, `%${q}%`),
        ))
    : undefined;

  const where = q ? or(ilike(products.name, `%${q}%`), inArray(products.id, matchesVariant!)) : undefined;

  // Se pagina a nivel de PRODUCTO (no de fila post-join): un producto con
  // muchas variantes no puede hacer que una página traiga menos productos
  // de los esperados. Se pide una fila de más (`PAGE_SIZE + 1`) para saber
  // si hay página siguiente sin una segunda query de conteo.
  const matched = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(products.name)
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);

  const hasNextPage = matched.length > PAGE_SIZE;
  const pageProducts = matched.slice(0, PAGE_SIZE);
  const productIds = pageProducts.map((p) => p.id);

  const variantRows = productIds.length
    ? await db.select().from(productVariants).where(inArray(productVariants.productId, productIds)).orderBy(productVariants.id)
    : [];

  const byId = new Map<number, ProductWithVariants>();
  for (const p of pageProducts) byId.set(p.id, { ...p, variants: [] });
  for (const v of variantRows) byId.get(v.productId)?.variants.push(v);

  return { products: [...byId.values()], hasNextPage };
}

type Params = { q?: string; page?: string };

export default async function ProductosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const isOwner = user.role === "owner";
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const q = params.q ?? "";
  const { products: productList, hasNextPage } = await getProducts({ q, page });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
        {isOwner && <ProductForm />}
      </div>

      <SearchInput defaultValue={q} />

      {productList.length === 0 ? (
        <p className="text-sm text-muted-foreground">{q ? "Sin resultados." : "No hay productos cargados."}</p>
      ) : (
        <ProductList products={productList} isOwner={isOwner} />
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/productos?q=${encodeURIComponent(q)}&page=${page - 1}`}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="flex items-center text-sm text-muted-foreground">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/productos?q=${encodeURIComponent(q)}&page=${page + 1}`}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
```

(Paginación por offset, no keyset — a 2.000-20.000 filas offset es suficiente; keyset sería sobre-ingeniería para el volumen esperado.)

- [ ] **Step 3: Simplificar ProductList a componente de solo presentación**

Replace `src/app/(app)/productos/product-list.tsx` en su totalidad:

```tsx
import type { ProductWithVariants } from "./page";
import { ProductForm } from "./product-form";
import { VariantRow } from "./variant-row";

export function ProductList({ products, isOwner }: { products: ProductWithVariants[]; isOwner: boolean }) {
  return (
    <div className="space-y-4">
      {products.map((product) => (
        <div key={product.id} className={`rounded-lg border p-4 ${!product.active ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">{product.name}</h2>
              <p className="text-xs text-muted-foreground">
                Precio base: ${product.basePrice.toFixed(2)} · Umbral stock bajo: {product.lowStockThreshold}
                {!product.active && " · Inactivo"}
              </p>
            </div>
            {isOwner && <ProductForm product={product} />}
          </div>
          <div className="mt-3 divide-y">
            {product.variants.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                basePrice={product.basePrice}
                lowStockThreshold={product.lowStockThreshold}
                isOwner={isOwner}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

(Ya no tiene `"use client"`, `useState`, `useMemo` — el filtro se movió al servidor en `getProducts()`. Sigue siendo un archivo separado por claridad, pero ahora es renderizable como Server Component.)

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpios. `npm test` no debería verse afectado (esta tarea no toca `src/domain/*`, no hay test unitario nuevo — la verificación es manual en el navegador, ver abajo).

Run: `npm run dev`, cargar `/productos`, confirmar que la búsqueda navega con `?q=` (URL cambia, resultados se filtran), confirmar paginación si hay más de 50 productos (o bajar `PAGE_SIZE` temporalmente para probar con pocos productos, y volver a subirlo a 50 antes de commitear).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/productos/page.tsx src/app/\(app\)/productos/product-list.tsx src/app/\(app\)/productos/search-input.tsx
git commit -m "feat: replace client-side product filter with server-side pagination"
```

---

### Task 6: Productos — campos de atributos en los formularios

**Files:**
- Create: `src/lib/card-conditions.ts`
- Modify: `src/app/(app)/productos/actions.ts`, `src/app/(app)/productos/product-form.tsx`, `src/app/(app)/productos/variant-row.tsx`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `saveVariant(input)` acepta `setName?`, `condition?`, `foil?`, `language?` opcionales — no rompe los call sites existentes que no los pasan.

- [ ] **Step 1: Listas de sugerencias**

Create `src/lib/card-conditions.ts`:

```ts
// Sugerencias para los <datalist> de condición e idioma en los formularios
// de variante — no son un enum rígido: el owner puede escribir cualquier
// valor de texto libre, esto solo ayuda a autocompletar los más comunes.
export const CONDITION_SUGGESTIONS = ["NM", "LP", "MP", "HP", "DMG", "Sellado", "Abierto"];
export const LANGUAGE_SUGGESTIONS = ["EN", "ES", "JP"];
```

- [ ] **Step 2: `saveVariant` — aceptar los campos nuevos**

Modify `src/app/(app)/productos/actions.ts`, función `saveVariant` (líneas 38-58 actuales):

```ts
export async function saveVariant(input: {
  id?: number;
  productId: number;
  name: string;
  sku: string | null;
  price: number | null;
  setName?: string | null;
  condition?: string | null;
  foil?: boolean;
  language?: string | null;
}) {
  await requireOwner();
  // Empty name is legitimate on UPDATE: every product gets a hidden "default"
  // variant with `name: ""` (see saveProduct above), and its SKU/price must
  // stay editable without forcing the owner to name it. Only INSERT (a new,
  // explicit variant) requires a non-empty name.
  if ((!input.id && !input.name.trim()) || (input.price !== null && input.price < 0)) return { error: "Datos inválidos" };
  const values = {
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    price: input.price,
    setName: input.setName?.trim() || null,
    condition: input.condition?.trim() || null,
    foil: input.foil ?? false,
    language: input.language?.trim() || null,
  };
  try {
    if (input.id) await db.update(productVariants).set(values).where(eq(productVariants.id, input.id));
    else await db.insert(productVariants).values({ ...values, productId: input.productId });
  } catch (err) {
    const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = e?.code ?? e?.cause?.code;
    const message = String(e?.message ?? e?.cause?.message ?? err ?? "");
    if (code === PG_UNIQUE_VIOLATION || /sku/i.test(message)) return { error: "SKU ya existe" };
    return { error: "No se pudo guardar la variante" };
  }
  revalidatePath("/productos");
  return { ok: true };
}
```

(El resto del archivo — `saveProduct`, `restock`, `adjustStock`, `toggleProductActive`, `toggleVariantActive` — no cambia.)

- [ ] **Step 3: Formulario de alta de variante (product-form.tsx)**

Modify `src/app/(app)/productos/product-form.tsx`:

Agregar el import y los 4 estados nuevos (junto a `vName`/`vSku`/`vPrice`, líneas 31-34 actuales):

```ts
import { CONDITION_SUGGESTIONS, LANGUAGE_SUGGESTIONS } from "@/lib/card-conditions";
```

```ts
  const [vName, setVName] = useState("");
  const [vSku, setVSku] = useState("");
  const [vPrice, setVPrice] = useState("");
  const [vSetName, setVSetName] = useState("");
  const [vCondition, setVCondition] = useState("");
  const [vFoil, setVFoil] = useState(false);
  const [vLanguage, setVLanguage] = useState("");
  const [vError, setVError] = useState("");
```

`submitVariant` (líneas 53-72 actuales) pasa los campos nuevos y los limpia al terminar:

```ts
  function submitVariant(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    startTransition(async () => {
      const res = await saveVariant({
        productId: product.id,
        name: vName,
        sku: vSku || null,
        price: vPrice === "" ? null : Number(vPrice),
        setName: vSetName || null,
        condition: vCondition || null,
        foil: vFoil,
        language: vLanguage || null,
      });
      if ("error" in res && res.error) setVError(res.error);
      else {
        setVError("");
        setVName("");
        setVSku("");
        setVPrice("");
        setVSetName("");
        setVCondition("");
        setVFoil(false);
        setVLanguage("");
        setAddingVariant(false);
      }
    });
  }
```

El formulario inline (líneas 148-170 actuales) gana los inputs nuevos, con `<datalist>` para condición/idioma:

```tsx
      {addingVariant && product && (
        <form onSubmit={submitVariant} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre variante</Label>
            <Input className="h-8" value={vName} onChange={(e) => setVName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SKU</Label>
            <Input className="h-8" value={vSku} onChange={(e) => setVSku(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Precio (opcional)</Label>
            <Input className="h-8 w-32" type="number" step="0.01" value={vPrice} onChange={(e) => setVPrice(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Set</Label>
            <Input className="h-8" value={vSetName} onChange={(e) => setVSetName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Condición</Label>
            <Input className="h-8" list="condition-suggestions" value={vCondition} onChange={(e) => setVCondition(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Idioma</Label>
            <Input className="h-8" list="language-suggestions" value={vLanguage} onChange={(e) => setVLanguage(e.target.value)} />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={vFoil} onChange={(e) => setVFoil(e.target.checked)} />
            Foil
          </label>
          {vError && <p className="text-xs text-destructive">{vError}</p>}
          <Button type="submit" size="sm" disabled={pending}>
            Agregar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingVariant(false)}>
            Cancelar
          </Button>
        </form>
      )}
      <datalist id="condition-suggestions">
        {CONDITION_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="language-suggestions">
        {LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}
      </datalist>
```

- [ ] **Step 4: Diálogo de edición de variante (variant-row.tsx)**

Modify `src/app/(app)/productos/variant-row.tsx`:

Import nuevo:

```ts
import { CONDITION_SUGGESTIONS, LANGUAGE_SUGGESTIONS } from "@/lib/card-conditions";
```

Estados nuevos, seedeados desde `variant` (junto a `name`/`sku`/`price`, líneas 34-39 actuales):

```ts
  const [name, setName] = useState(variant.name);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [price, setPrice] = useState(variant.price != null ? String(variant.price) : "");
  const [setNameField, setSetNameField] = useState(variant.setName ?? "");
  const [condition, setCondition] = useState(variant.condition ?? "");
  const [foil, setFoil] = useState(variant.foil);
  const [language, setLanguage] = useState(variant.language ?? "");
  const [qty, setQty] = useState("1");
  const [newStock, setNewStock] = useState(String(variant.stock));
  const [reason, setReason] = useState("");
```

`submitEdit` (líneas 68-84 actuales) pasa los campos nuevos:

```ts
  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveVariant({
        id: variant.id,
        productId: variant.productId,
        name,
        sku: sku || null,
        price: price === "" ? null : Number(price),
        setName: setNameField || null,
        condition: condition || null,
        foil,
        language: language || null,
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        setError("");
        setEditOpen(false);
      }
    });
  }
```

Diálogo de edición (dentro del `<DialogContent>`, después del campo Precio, líneas 145-154 actuales):

```tsx
                  <div className="space-y-2">
                    <Label htmlFor={`variant-price-${variant.id}`}>Precio (opcional)</Label>
                    <Input
                      id={`variant-price-${variant.id}`}
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-set-${variant.id}`}>Set</Label>
                    <Input id={`variant-set-${variant.id}`} value={setNameField} onChange={(e) => setSetNameField(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-condition-${variant.id}`}>Condición</Label>
                    <Input
                      id={`variant-condition-${variant.id}`}
                      list="condition-suggestions"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-language-${variant.id}`}>Idioma</Label>
                    <Input
                      id={`variant-language-${variant.id}`}
                      list="language-suggestions"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={foil} onChange={(e) => setFoil(e.target.checked)} />
                    Foil
                  </label>
                  <datalist id="condition-suggestions">
                    {CONDITION_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                  </datalist>
                  <datalist id="language-suggestions">
                    {LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}
                  </datalist>
```

Fila de visualización (línea 112-121 actuales) — agregar los badges/spans nuevos después de `Stock:`:

```tsx
        {lowStock ? (
          <Badge variant="destructive">Stock: {variant.stock}</Badge>
        ) : (
          <span className="text-muted-foreground">Stock: {variant.stock}</span>
        )}
        {variant.setName && <span className="text-muted-foreground">{variant.setName}</span>}
        {variant.condition && <Badge variant="outline">{variant.condition}</Badge>}
        {variant.foil && <Badge variant="secondary">Foil</Badge>}
        {variant.language && <Badge variant="outline">{variant.language}</Badge>}
        {!variant.active && <Badge variant="outline">Inactivo</Badge>}
```

(Todos los campos son condicionales — una variante sin atributos de carta se ve exactamente igual que antes.)

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpios.

Run: `npm run dev`, como owner: crear una variante nueva con Set/Condición/Foil/Idioma, confirmar que aparecen los badges en la fila; editar una variante existente y confirmar que los valores se guardan.

- [ ] **Step 6: Commit**

```bash
git add src/lib/card-conditions.ts src/app/\(app\)/productos/actions.ts src/app/\(app\)/productos/product-form.tsx src/app/\(app\)/productos/variant-row.tsx
git commit -m "feat: add card attribute fields to product/variant forms"
```

---

### Task 7: Import Excel — campos nuevos + ejecución en lote

**Files:**
- Modify: `src/domain/import.ts`, `src/app/(app)/importar/actions.ts`, `src/app/(app)/importar/import-form.tsx`, `src/app/(app)/importar/template/route.ts`
- Test: `tests/import.test.ts`

**Interfaces:**
- Produces: `ImportRow`/`ValidatedRow` con `setName?`, `condition?`, `foil?`, `language?` opcionales — no rompe el helper `row()` de tests existente. `executeImport(db, rows, userId)` mantiene su firma y su contrato (recibe TODAS las filas, incluidas las que tienen error).

**Contexto:** dos cambios al mismo archivo (`src/domain/import.ts`) hechos juntos para no tocar `executeImport` dos veces. El camino de actualización sigue llamando `applyStockMovement` por fila (su guarda atómica protege contra escrituras concurrentes, algo que sí puede pasar en una actualización); el camino de creación inserta el stock real directamente (sin el paso intermedio "insertar en 0, después ajustar") porque una fila recién creada no tiene con qué competir — nadie más puede estar escribiendo el stock de una variante que no existía hace un instante.

- [ ] **Step 1: Tipos — campos nuevos opcionales**

Modify `src/domain/import.ts`, tipo `ImportRow` (líneas 5-12 actuales):

```ts
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
```

(`ValidatedRow = ImportRow & { error, action }` no cambia — hereda los campos nuevos automáticamente.)

- [ ] **Step 2: Test — creación y actualización sincronizan los campos nuevos**

Agregar a `tests/import.test.ts`, dentro de `describe("executeImport")`:

```ts
  it("stores card attributes on create and syncs them on update when provided", async () => {
    const validated = await validateImportRows(db, [
      row(2, {
        product: "Charizard", variant: "Base Set NM", sku: "CHAR-BS-NM", stock: 3,
        setName: "Base Set", condition: "NM", foil: true, language: "EN",
      }),
    ]);
    await executeImport(db, validated, "u1");
    const [created] = await db.select().from(productVariants).where(eq(productVariants.sku, "CHAR-BS-NM"));
    expect(created.setName).toBe("Base Set");
    expect(created.condition).toBe("NM");
    expect(created.foil).toBe(true);
    expect(created.language).toBe("EN");
    expect(created.stock).toBe(3); // stock real al crear, no 0 + movimiento

    const reimport = await validateImportRows(db, [
      row(3, { product: "Charizard", variant: "Base Set NM", sku: "CHAR-BS-NM", stock: 3, condition: "LP" }),
    ]);
    await executeImport(db, reimport, "u1");
    const [updated] = await db.select().from(productVariants).where(eq(productVariants.sku, "CHAR-BS-NM"));
    expect(updated.condition).toBe("LP"); // sincronizado en el update
    expect(updated.setName).toBe("Base Set"); // no se borró por no venir en la segunda fila... espera, ver Step 3
  });
```

**Nota para quien implemente:** el último `expect` de este test fija una decisión de diseño real que hay que tomar al escribir `executeImport`: si una fila de actualización NO trae `setName` (viene `undefined`, no un string vacío explícito), ¿se debe dejar el valor existente sin tocar, o borrarlo? La opción correcta es **dejarlo sin tocar** (mismo patrón que `price`: solo se actualiza si la celda vino con contenido) — así una planilla de sync diario que solo trae SKU/Precio/Stock no borra accidentalmente el Set/Condición/Foil/Idioma ya cargados a mano en la UI. Implementar `executeImport` de forma que este test pase tal cual está escrito arriba.

- [ ] **Step 3: `executeImport` — sincronizar campos nuevos + batching**

Replace la función `executeImport` completa en `src/domain/import.ts`:

```ts
export async function executeImport(
  db: any,
  rows: ValidatedRow[],
  userId: string
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0, updated = 0;
  // IMPORTANTE: `rows` DEBE ser el output completo de validateImportRows, incluyendo
  // las filas con error — este cálculo de `skipped` (y el filtrado de `valid` debajo)
  // se hace acá adentro, no por el caller. Si el caller filtra las filas con
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
```

Actualizar los imports al inicio de `src/domain/import.ts`:

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { products, productVariants, stockMovements } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";
```

- [ ] **Step 4: Verificar que los tests existentes y el nuevo pasan**

Run: `npm test -- import`
Expected: todos los tests de `tests/import.test.ts` en verde, incluidos los 4 preexistentes (compatibilidad hacia atrás) y el nuevo del Step 2.

- [ ] **Step 5: Test de volumen — el batching realmente funciona con muchas filas**

Agregar a `tests/import.test.ts`:

```ts
  it("handles a large batch of create rows correctly (batching sanity check)", async () => {
    const rows = Array.from({ length: 150 }, (_, i) =>
      row(i + 2, { product: `Carta ${i}`, variant: "NM", sku: `BULK-${i}`, price: 100 + i, stock: i })
    );
    const validated = await validateImportRows(db, rows);
    const res = await executeImport(db, validated, "u1");
    expect(res).toEqual({ created: 150, updated: 0, skipped: 0 });

    const allVariants = await db.select().from(productVariants).where(eq(productVariants.sku, "BULK-100"));
    expect(allVariants[0].stock).toBe(100);
    expect(allVariants[0].price).toBe(200);

    const movements = await db.select().from(stockMovements).where(eq(stockMovements.reason, "importación"));
    // 149 filas con stock > 0 (la fila 0 tiene stock: 0, no genera movimiento)
    expect(movements.length).toBe(149);
  });
```

Run: `npm test -- import`
Expected: PASS.

- [ ] **Step 6: Extender plantilla, parseo y preview**

Modify `src/app/(app)/importar/template/route.ts`:

```ts
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Productos");
  ws.addRow(["Producto", "Variante", "SKU", "Precio", "Stock", "Set", "Condición", "Foil", "Idioma"]);
  ws.addRow(["Remera Roja", "M", "REM-R-M", 12000, 5, "", "", "", ""]);
  ws.addRow(["Remera Roja", "L", "REM-R-L", 12000, 3, "", "", "", ""]);
  ws.addRow(["Gorra Negra", "", "GOR-N", 8000, 10, "", "", "", ""]);
  ws.addRow(["Charizard", "Base Set NM", "CHAR-BS-NM", 50000, 3, "Base Set", "NM", "FALSE", "EN"]);
  ws.addRow(["Charizard", "Base Set NM Foil", "CHAR-BS-NM-F", 150000, 1, "Base Set", "NM", "TRUE", "EN"]);
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
    },
  });
}
```

Modify `src/app/(app)/importar/actions.ts`, función `parseAndValidate` (líneas 34-50 actuales) — leer las 4 columnas nuevas y coercionar `Foil`:

```ts
  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const product = cellText(row.getCell(1).value).trim();
    const variant = cellText(row.getCell(2).value).trim();
    const sku = cellText(row.getCell(3).value).trim() || null;
    const priceRaw = cellText(row.getCell(4).value).trim();
    const stockRaw = cellText(row.getCell(5).value).trim();
    const setName = cellText(row.getCell(6).value).trim() || null;
    const condition = cellText(row.getCell(7).value).trim() || null;
    const foilRaw = cellText(row.getCell(8).value).trim().toLowerCase();
    const foil = ["true", "1", "sí", "si", "x"].includes(foilRaw);
    const language = cellText(row.getCell(9).value).trim() || null;
    if (!product && !variant && !sku && !priceRaw && !stockRaw) return; // fila vacía
    rows.push({
      rowNumber, product, variant, sku,
      price: priceRaw === "" ? null : Number(priceRaw.replace(",", ".")),
      stock: stockRaw === "" ? 0 : Number(stockRaw),
      setName, condition, foil, language,
    });
  });
```

Modify `src/app/(app)/importar/import-form.tsx` — agregar columnas al preview (dentro de `<TableHeader>`/`<TableRow>` de cabecera, después de "Stock", y las celdas correspondientes en el body):

```tsx
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead>Condición</TableHead>
                  <TableHead>Foil</TableHead>
                  <TableHead>Idioma</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rowNumber} className={r.error ? "bg-destructive/10" : ""}>
                    <TableCell>{r.rowNumber}</TableCell>
                    <TableCell>{r.product}</TableCell>
                    <TableCell>{r.variant}</TableCell>
                    <TableCell>{r.sku ?? ""}</TableCell>
                    <TableCell>{r.price ?? ""}</TableCell>
                    <TableCell>{r.stock}</TableCell>
                    <TableCell>{r.setName ?? ""}</TableCell>
                    <TableCell>{r.condition ?? ""}</TableCell>
                    <TableCell>{r.foil ? "Sí" : ""}</TableCell>
                    <TableCell>{r.language ?? ""}</TableCell>
                    <TableCell>
                      {r.error ? (
                        <span className="text-sm text-destructive">{r.error}</span>
                      ) : (
                        <Badge variant="secondary">{r.action === "update" ? "actualizar" : "crear"}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
```

- [ ] **Step 7: Verificar**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde.

Run: `npm run dev`, como owner: descargar la plantilla nueva, subirla, confirmar que el preview muestra las columnas Set/Condición/Foil/Idioma, confirmar la importación.

- [ ] **Step 8: Commit**

```bash
git add src/domain/import.ts tests/import.test.ts src/app/\(app\)/importar/
git commit -m "feat: add card attributes to import and batch execution for large files"
```

---

### Task 8: Reportes — filtro por set

**Files:**
- Modify: `src/domain/reports.ts`, `src/app/(app)/reportes/page.tsx`
- Create: `tests/reports.test.ts`

**Interfaces:**
- Produces: `getTopProducts(db, opts: {from, to, limit?, setName?})`, `getLowStock(db, opts?: {setName?})` — ambos parámetros nuevos opcionales, aditivos.

- [ ] **Step 1: Test — no existe `tests/reports.test.ts` hoy (gap real encontrado en la investigación)**

Create `tests/reports.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getTopProducts, getLowStock } from "@/domain/reports";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("getTopProducts with setName filter", () => {
  it("filters top products by set when provided, and is unaffected when omitted", async () => {
    const [charizard] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    const [baseSet] = await db.insert(productVariants).values({ productId: charizard.id, name: "Base Set", stock: 5, setName: "Base Set" }).returning();
    const [jungle] = await db.insert(productVariants).values({ productId: charizard.id, name: "Jungle", stock: 5, setName: "Jungle" }).returning();

    await openCashSession(db, { userId: "u1", openingCash: 0 });
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: baseSet.id, quantity: 2 }] });
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: jungle.id, quantity: 1 }] });

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const allSets = await getTopProducts(db, { from, to });
    expect(allSets).toHaveLength(2);

    const onlyBaseSet = await getTopProducts(db, { from, to, setName: "Base Set" });
    expect(onlyBaseSet).toHaveLength(1);
    expect(onlyBaseSet[0].variantName).toBe("Base Set");
  });
});

describe("getLowStock with setName filter", () => {
  it("filters low-stock variants by set when provided", async () => {
    const [charizard] = await db.insert(products).values({ name: "Charizard", basePrice: 50000, lowStockThreshold: 5 }).returning();
    await db.insert(productVariants).values([
      { productId: charizard.id, name: "Base Set", stock: 1, setName: "Base Set" },
      { productId: charizard.id, name: "Jungle", stock: 1, setName: "Jungle" },
    ]);

    const all = await getLowStock(db);
    expect(all).toHaveLength(2);

    const onlyJungle = await getLowStock(db, { setName: "Jungle" });
    expect(onlyJungle).toHaveLength(1);
    expect(onlyJungle[0].variantName).toBe("Jungle");
  });
});
```

- [ ] **Step 2: `getTopProducts`/`getLowStock` — parámetro opcional**

Modify `src/domain/reports.ts`:

```ts
export async function getTopProducts(db: any, opts: { from: Date; to: Date; limit?: number; setName?: string }) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      setName: productVariants.setName,
      unitsSold: sql<number>`sum(${saleItems.quantity})`.mapWith(Number),
      revenue: sql<number>`sum(${saleItems.quantity} * ${saleItems.unitPrice})`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(sales.voided, false),
      between(sales.createdAt, opts.from, opts.to),
      opts.setName ? ilike(productVariants.setName, `%${opts.setName}%`) : undefined,
    ))
    .groupBy(products.name, productVariants.name, productVariants.setName)
    .orderBy(desc(sql`sum(${saleItems.quantity})`))
    .limit(opts.limit ?? 10);
}

export async function getLowStock(db: any, opts: { setName?: string } = {}) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      setName: productVariants.setName,
      stock: productVariants.stock,
      threshold: products.lowStockThreshold,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.active, true), eq(productVariants.active, true),
      sql`${productVariants.stock} <= ${products.lowStockThreshold}`,
      opts.setName ? ilike(productVariants.setName, `%${opts.setName}%`) : undefined,
    ))
    .orderBy(productVariants.stock);
}
```

Actualizar el import al inicio del archivo:

```ts
import { and, between, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -- reports`
Expected: PASS (2/2 nuevos). Correr también `npm test` completo para confirmar que `reportes/page.tsx`'s llamadas existentes (`getTopProducts(db, {from, to, limit: 10})`, `getLowStock(db)`, ambas sin `setName`) siguen funcionando — no hay test de UI para esta página, así que la garantía real viene de que el parámetro nuevo es opcional y no altera el `WHERE` cuando se omite.

- [ ] **Step 4: UI — input de set + columna nueva**

Modify `src/app/(app)/reportes/page.tsx`:

Tipo `Params` y llamadas (líneas 22, 56-61 actuales):

```ts
type Params = { from?: string; to?: string; set?: string };
```

```ts
  const [{ byDay, byMethod }, topProducts, lowStock, cashHistory] = await Promise.all([
    getSalesReport(db, { from, to }),
    getTopProducts(db, { from, to, limit: 10, setName: params.set || undefined }),
    getLowStock(db, { setName: params.set || undefined }),
    getCashSessionHistory(db, { limit: 30 }),
  ]);
```

Formulario de filtros (dentro del `<form method="get">`, después del input "Hasta", líneas 118-126 actuales):

```tsx
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Hasta</span>
            <input
              type="date"
              name="to"
              defaultValue={toValue}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Set</span>
            <input
              type="text"
              name="set"
              defaultValue={params.set ?? ""}
              placeholder="Ej: Base Set"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
```

Tabla "Top 10 productos" — agregar columna Set (líneas 203-225 actuales):

```tsx
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Unidades vendidas</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map(
                (row: { productName: string; variantName: string; setName: string | null; unitsSold: number; revenue: number }, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.variantName || "—"}</TableCell>
                    <TableCell>{row.setName || "—"}</TableCell>
                    <TableCell>{row.unitsSold}</TableCell>
                    <TableCell className="text-right">{money(row.revenue)}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
```

Tabla "Stock bajo" — misma columna (líneas 233-256 actuales):

```tsx
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Umbral</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lowStock.map(
                (row: { productName: string; variantName: string; setName: string | null; stock: number; threshold: number }, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.variantName || "—"}</TableCell>
                    <TableCell>{row.setName || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{row.stock}</Badge>
                    </TableCell>
                    <TableCell>{row.threshold}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
```

- [ ] **Step 5: Verificar**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde.

Run: `npm run dev`, cargar `/reportes` como owner, escribir un set en el filtro, confirmar que las tablas "Top 10" y "Stock bajo" se acotan.

- [ ] **Step 6: Commit**

```bash
git add src/domain/reports.ts tests/reports.test.ts src/app/\(app\)/reportes/page.tsx
git commit -m "feat: add set filter to reports"
```

---

### Task 9: Ventas — ventana default de 30 días + paginación

**Files:**
- Modify: `src/app/(app)/ventas/page.tsx`
- Create: `src/domain/sales-history.ts`
- Test: `tests/sales-history.test.ts`

**Interfaces:**
- Produces: `getSalesHistory(db, opts: {from?: Date; to?: Date; sellerId?: string; page: number}): Promise<{sales: ..., hasNextPage: boolean}>` — extraída para poder testear con PGlite el default de 30 días.

- [ ] **Step 1: Test**

Create `tests/sales-history.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getSalesHistory } from "@/domain/sales-history";

let db: Awaited<ReturnType<typeof createTestDb>>;
let variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
  const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 100 }).returning();
  variantId = v.id;
  await openCashSession(db, { userId: "u1", openingCash: 0 });
});

describe("getSalesHistory", () => {
  it("defaults to the last 30 days when no from/to is given", async () => {
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    const result = await getSalesHistory(db, { page: 1 });
    expect(result.sales).toHaveLength(1);
  });

  it("paginates results (page size 50) and reports hasNextPage", async () => {
    for (let i = 0; i < 55; i++) {
      await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    }
    const page1 = await getSalesHistory(db, { page: 1 });
    expect(page1.sales).toHaveLength(50);
    expect(page1.hasNextPage).toBe(true);

    const page2 = await getSalesHistory(db, { page: 2 });
    expect(page2.sales).toHaveLength(5);
    expect(page2.hasNextPage).toBe(false);
  });

  it("an explicit wide from/to range bypasses the 30-day default but still paginates", async () => {
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    const oldFrom = new Date("2000-01-01");
    const result = await getSalesHistory(db, { from: oldFrom, to: new Date(), page: 1 });
    expect(result.sales).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Extraer la consulta a `src/domain/sales-history.ts`**

Create `src/domain/sales-history.ts`:

```ts
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { sales, saleItems, productVariants, products, user } from "@/db/schema";

const PAGE_SIZE = 50;

export type SalesHistoryOpts = {
  from?: Date;
  to?: Date;
  sellerId?: string;
  page: number;
};

export async function getSalesHistory(db: any, opts: SalesHistoryOpts) {
  // Sin rango explícito, se acota a los últimos 30 días — un pedido sin
  // filtro no debe traer TODO el historial de ventas de por vida.
  const from = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = opts.to ?? new Date();

  const conditions = [gte(sales.createdAt, from), lt(sales.createdAt, to)];
  if (opts.sellerId) conditions.push(eq(sales.sellerId, opts.sellerId));

  const rows = await db
    .select({ sale: sales, sellerName: user.name })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);

  const hasNextPage = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  const saleIds = pageRows.map((r: any) => r.sale.id);

  const itemRows = saleIds.length
    ? await db
        .select({
          id: saleItems.id,
          saleId: saleItems.saleId,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          productName: products.name,
          variantName: productVariants.name,
        })
        .from(saleItems)
        .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
    : [];

  return { sales: pageRows, itemRows, hasNextPage };
}
```

(El fan-out a `saleItems` hereda el límite automáticamente porque `saleIds` ya viene acotado por la paginación de `sales` — no hace falta ningún cambio adicional para acotarlo.)

- [ ] **Step 3: Correr el test**

Run: `npm test -- sales-history`
Expected: PASS (3/3).

- [ ] **Step 4: Página — usar la función extraída + link "ver todo"**

Replace `src/app/(app)/ventas/page.tsx` en su totalidad:

```tsx
import Link from "next/link";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { getSalesHistory } from "@/domain/sales-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoidButton } from "./void-button";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type Params = { from?: string; to?: string; seller?: string; all?: string; page?: string };

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const currentUser = await requireUser();
  const isOwner = currentUser.role === "owner";
  const page = Math.max(1, Number(params.page) || 1);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : (params.all ? new Date(0) : undefined);
  const to = params.to ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) : undefined;
  const sellerId = !isOwner ? currentUser.id : params.seller || undefined;

  const { sales: rows, itemRows, hasNextPage } = await getSalesHistory(db, { from, to, sellerId, page });

  const itemsBySale = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsBySale.get(item.saleId) ?? [];
    list.push(item);
    itemsBySale.set(item.saleId, list);
  }

  const sellers = isOwner
    ? await db.select({ id: user.id, name: user.name }).from(user).orderBy(user.name)
    : [];

  const hasFilters = Boolean(params.from || params.to || params.seller);
  const usingDefaultWindow = !params.from && !params.to && !params.all;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Construye el querystring de paginación a mano en vez de
  // `new URLSearchParams({...params, page})`: `params` puede tener
  // `from`/`to`/`seller`/`all` en `undefined`, y pasar un objeto con
  // valores `undefined` a `URLSearchParams` los serializa como el string
  // literal "undefined" en vez de omitirlos.
  function pageHref(page: number) {
    const sp = new URLSearchParams();
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (params.seller) sp.set("seller", params.seller);
    if (params.all) sp.set("all", params.all);
    sp.set("page", String(page));
    return `/ventas?${sp.toString()}`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>

      <div className="flex flex-wrap items-end gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Desde</span>
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Hasta</span>
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          {isOwner && (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Vendedor</span>
              <select
                name="seller"
                defaultValue={params.seller ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">Todos</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          {hasFilters && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/ventas">Limpiar</Link>
            </Button>
          )}
        </form>

        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/ventas?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/ventas?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
          </Button>
        </div>
      </div>

      {usingDefaultWindow && (
        <p className="text-xs text-muted-foreground">
          Mostrando los últimos 30 días.{" "}
          <Link href="/ventas?all=1" className="underline underline-offset-4">
            Ver todo el historial
          </Link>
        </p>
      )}

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No hay ventas para el filtro seleccionado.</p>}

      {rows.length > 0 && (
        <div className="rounded-md border">
          <div className="grid grid-cols-6 gap-2 border-b bg-muted/50 px-4 py-3 text-sm font-medium text-muted-foreground">
            <span>Fecha</span>
            <span>N°</span>
            <span>Vendedor</span>
            <span>Medio de pago</span>
            <span className="text-right">Total</span>
            <span>Estado</span>
          </div>
          <div className="divide-y">
            {rows.map(({ sale, sellerName }: any) => (
              <details key={sale.id} className={sale.voided ? "opacity-60" : ""}>
                <summary className={`grid cursor-pointer grid-cols-6 gap-2 px-4 py-3 text-sm ${sale.voided ? "line-through" : ""}`}>
                  <span>{sale.createdAt.toLocaleString("es-AR")}</span>
                  <span>#{sale.id}</span>
                  <span>{sellerName}</span>
                  <span>{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                  <span className="text-right">${sale.total.toFixed(2)}</span>
                  <span>
                    {sale.voided ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                        Anulada
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">
                        Activa
                      </Badge>
                    )}
                  </span>
                </summary>
                <div className="space-y-2 border-t bg-muted/30 px-4 py-3 pl-8 text-sm">
                  <ul className="space-y-1">
                    {(itemsBySale.get(sale.id) ?? []).map((item: any) => (
                      <li key={item.id}>
                        {item.productName}
                        {item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity} — $
                        {item.unitPrice.toFixed(2)} c/u = ${(item.quantity * item.unitPrice).toFixed(2)}
                      </li>
                    ))}
                  </ul>
                  {isOwner && !sale.voided && <VoidButton saleId={sale.id} />}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="flex items-center text-sm text-muted-foreground">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page + 1)}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verificar**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde.

Run: `npm run dev`, cargar `/ventas` sin filtros — confirmar el aviso "Mostrando los últimos 30 días" con el link "Ver todo el historial"; hacer clic y confirmar que trae todo (sin el aviso); si hay más de 50 ventas, confirmar paginación.

- [ ] **Step 6: Commit**

```bash
git add src/domain/sales-history.ts tests/sales-history.test.ts src/app/\(app\)/ventas/page.tsx
git commit -m "feat: add default 30-day window and pagination to sales history"
```

---

## Self-Review (hecho al escribir el plan)

- **Cobertura de spec:** columnas de atributos (Task 1), índices trigram existentes+nuevos (Tasks 2-3), búsqueda extendida en Vender (Task 4), paginación + campos en Productos (Tasks 5-6), import con campos+batching (Task 7), filtro de set en Reportes (Task 8), ventana default + paginación en Ventas (Task 9). Las decisiones de alcance del spec (sin buylist, sin chips de condición/foil en Vender, offset no keyset) se respetan en todas las tareas.
- **Corrección de diseño real hecha durante la escritura del plan, no asumida:** los dos agentes de diseño previos asumieron que PGlite aceptaría `CREATE EXTENSION pg_trgm` sin más — se verificó en esta sesión que **no** lo hace por default, y se corrigió el harness de tests (Task 2, Step 1) antes de que rompiera los 27 tests existentes. También se verificó (no se asumió) que `inArray` con subquery, `UPDATE ... FROM VALUES`, y el orden de `.returning()` en inserts multi-fila funcionan con la versión instalada de drizzle-orm.
- **Simplificación YAGNI respecto al diseño original:** se descartaron los índices btree sobre `condition`/`foil`/`language` que proponía el diseño inicial — nada en las tareas 4-9 filtra por esas columnas individualmente (la decisión de brainstorming fue explícitamente no agregar chips de filtro en esta vuelta), así que esos índices no servirían a ninguna query real todavía.
- **Reordenamiento respecto al diseño original:** la paginación de Productos (antes "Task 6") se movió antes que los campos de formulario (antes "Task 5") para no escribir una extensión del filtro client-side que la tarea siguiente iba a borrar.
- **Consistencia de tipos:** `ImportRow`/`ValidatedRow`, `ProductWithVariants`, `SearchResult` (inferido), `CartItem` — todos los campos nuevos son opcionales/nullable en los tipos de entrada, coherentes entre la tarea que los define y las que los consumen.
- **Bug real encontrado y corregido en esta misma revisión:** el primer borrador de la Task 9 armaba el link de paginación con `new URLSearchParams({...params, page})`, donde `params` puede tener `from`/`to`/`seller`/`all` en `undefined` — eso serializa como el string literal `"undefined"` en la URL en vez de omitirse. Corregido a una función `pageHref()` que arma el querystring campo por campo, solo incluyendo los que están presentes.
