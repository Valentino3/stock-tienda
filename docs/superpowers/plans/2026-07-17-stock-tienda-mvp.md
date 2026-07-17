# Stock Tienda MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema web de stock + ventas para comercio chico: ventas descuentan stock, variantes de producto, importación Excel, cierre de caja por sesión. Sin facturación fiscal.

**Architecture:** Next.js App Router en Vercel con Server Actions (sin API REST). Postgres en Neon vía Drizzle ORM. Lógica de dominio en funciones puras que reciben `db`/`tx` como parámetro — testeables con PGlite en memoria. Auth con better-auth + plugin admin (roles owner/employee, sin registro público).

**Tech Stack:** Next.js (App Router, TypeScript), Tailwind CSS, Drizzle ORM, Neon Postgres, better-auth (+ admin plugin), exceljs, Vitest + @electric-sql/pglite.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-stock-tienda-design.md` — leerla antes de cualquier tarea.
- Idioma de UI: **español** (Argentina). Código, identificadores y commits en inglés.
- Precios/importes: `numeric(12,2)` en Postgres, `mode: 'number'` en Drizzle. Nunca float aritmético encadenado; redondear con `Math.round(x * 100) / 100` al persistir.
- Stock: **nunca negativo**. Todo cambio de stock pasa por `stock_movements` dentro de una transacción.
- Roles: `owner` y `employee`. Mutaciones sensibles (productos, anulación, import, usuarios, reportes) verifican rol **en el servidor**, no solo en UI.
- Productos/variantes/usuarios nunca se borran: se desactivan.
- No se puede vender sin sesión de caja abierta.
- Tests: Vitest + PGlite (Postgres en memoria). Solo lógica de dominio; UI sin tests automáticos.
- Commits frecuentes, mensajes convencionales (`feat:`, `test:`, `chore:`).

## File Structure

```
src/
  db/
    index.ts            # cliente Drizzle (Neon)
    schema.ts           # todo el schema (dominio + auth)
  lib/
    auth.ts             # instancia better-auth (server)
    auth-client.ts      # cliente better-auth (browser)
    session.ts          # helpers requireUser / requireOwner
  domain/
    stock.ts            # applyStockMovement
    sales.ts            # createSale, voidSale
    cash.ts             # openCashSession, closeCashSession, getOpenSession
    import.ts           # validateImportRows, executeImport
    reports.ts          # queries de reportes
  app/
    login/page.tsx
    (app)/layout.tsx    # guard de sesión + nav
    (app)/vender/       # page.tsx, actions.ts, sale-form.tsx
    (app)/productos/    # page.tsx, actions.ts, product-form.tsx
    (app)/ventas/       # page.tsx, actions.ts
    (app)/caja/         # page.tsx, actions.ts
    (app)/importar/     # page.tsx, actions.ts, route.ts (plantilla)
    (app)/reportes/page.tsx
    (app)/usuarios/     # page.tsx, actions.ts
tests/
  helpers/db.ts         # PGlite + migraciones para tests
  stock.test.ts
  sales.test.ts
  cash.test.ts
  import.test.ts
scripts/
  seed-owner.ts
drizzle/                # migraciones generadas
```

---

### Task 1: Scaffold del proyecto + tooling de tests

**Files:**
- Create: proyecto Next.js completo (create-next-app), `vitest.config.ts`, `drizzle.config.ts`, `.env.local`

**Interfaces:**
- Produces: proyecto corriendo con `npm run dev`, `npm test` (vitest) y `npx drizzle-kit` operativos.

- [ ] **Step 1: Scaffold Next.js**

En la raíz del repo (ya tiene `.git`, `docs/`, `.gitattributes` — scaffold en el lugar):

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --use-npm --no-import-alias --turbopack
```

Si pregunta por sobrescribir, aceptar (solo hay docs y .gitattributes; verificar que sigan existiendo después).

- [ ] **Step 2: Instalar dependencias**

```bash
npm install drizzle-orm @neondatabase/serverless better-auth exceljs
npm install -D drizzle-kit vitest @electric-sql/pglite dotenv tsx
```

- [ ] **Step 3: Configurar Drizzle**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Create `.env.local` (y agregar `.env*` a `.gitignore` si create-next-app no lo hizo):

```
DATABASE_URL=postgres://PENDIENTE_NEON
BETTER_AUTH_SECRET=GENERAR_CON_openssl_rand_-base64_32
BETTER_AUTH_URL=http://localhost:3000
```

Nota: `DATABASE_URL` real se configura en Task 12 (Neon). Hasta entonces los tests usan PGlite y no necesitan DB real.

- [ ] **Step 4: Configurar Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

Agregar a `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 5: Verificar**

Run: `npm run dev` — abre en http://localhost:3000 sin errores. Cortar.
Run: `npm test` — "No test files found" (esperado, exit 0 con `--passWithNoTests`; agregar ese flag al script si falla).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with drizzle, better-auth, vitest tooling"
```

---

### Task 2: Schema completo + migraciones + helper de tests

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `tests/helpers/db.ts`
- Test: verificación de migración vía PGlite

**Interfaces:**
- Produces: tablas `user`, `session`, `account`, `verification` (better-auth), `products`, `product_variants`, `sales`, `sale_items`, `stock_movements`, `cash_sessions`. Export `db` (Neon) y `createTestDb()` (PGlite). Tipos exportados: `Product`, `ProductVariant`, `Sale`, `SaleItem`, `StockMovement`, `CashSession` vía `typeof table.$inferSelect`.

- [ ] **Step 1: Escribir schema**

Create `src/db/schema.ts`:

```ts
import {
  pgTable, text, timestamp, boolean, integer, numeric, pgEnum,
} from "drizzle-orm/pg-core";

// ---- better-auth (generado según docs de better-auth drizzle adapter + admin plugin) ----
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("employee"), // 'owner' | 'employee'
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// IMPORTANTE: antes de dar por buena esta sección, correr
// `npx @better-auth/cli generate` con la config de Task 3 y comparar:
// si el generador difiere en columnas, gana el generador.

// ---- dominio ----
export const paymentMethodEnum = pgEnum("payment_method", ["efectivo", "transferencia", "tarjeta"]);
export const movementTypeEnum = pgEnum("movement_type", ["venta", "reposicion", "ajuste", "anulacion"]);

export const products = pgTable("products", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  basePrice: numeric("base_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const productVariants = pgTable("product_variants", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: integer("product_id").notNull().references(() => products.id),
  // '' para la variante default de productos sin variantes reales (UI la oculta)
  name: text("name").notNull().default(""),
  sku: text("sku").unique(),
  stock: integer("stock").notNull().default(0),
  price: numeric("price", { precision: 12, scale: 2, mode: "number" }), // null => hereda basePrice
  active: boolean("active").notNull().default(true),
});

export const cashSessions = pgTable("cash_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  openedBy: text("opened_by").notNull().references(() => user.id),
  closedBy: text("closed_by").references(() => user.id),
  openingCash: numeric("opening_cash", { precision: 12, scale: 2, mode: "number" }).notNull(),
  expectedCash: numeric("expected_cash", { precision: 12, scale: 2, mode: "number" }),
  totalTransfer: numeric("total_transfer", { precision: 12, scale: 2, mode: "number" }),
  totalCard: numeric("total_card", { precision: 12, scale: 2, mode: "number" }),
  countedCash: numeric("counted_cash", { precision: 12, scale: 2, mode: "number" }),
  difference: numeric("difference", { precision: 12, scale: 2, mode: "number" }),
  notes: text("notes"),
});

export const sales = pgTable("sales", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sellerId: text("seller_id").notNull().references(() => user.id),
  cashSessionId: integer("cash_session_id").notNull().references(() => cashSessions.id),
  total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  voided: boolean("voided").notNull().default(false),
  voidedAt: timestamp("voided_at"),
  voidedBy: text("voided_by").references(() => user.id),
});

export const saleItems = pgTable("sale_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  variantId: integer("variant_id").notNull().references(() => productVariants.id),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
});

export const stockMovements = pgTable("stock_movements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  variantId: integer("variant_id").notNull().references(() => productVariants.id),
  type: movementTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(), // con signo: venta negativo, reposición positivo
  createdAt: timestamp("created_at").notNull().defaultNow(),
  userId: text("user_id").notNull().references(() => user.id),
  saleId: integer("sale_id").references(() => sales.id),
  reason: text("reason"),
});

export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type CashSession = typeof cashSessions.$inferSelect;
```

- [ ] **Step 2: Cliente de DB**

Create `src/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
export type Db = typeof db;
```

Nota: `neon-http` no soporta transacciones interactivas. Las funciones de dominio que necesitan transacción real (ventas, anulación) reciben un cliente transaccional; para producción usar el driver websocket en esas rutas. Simplificación: usar `drizzle-orm/neon-serverless` (websocket, soporta `db.transaction`) como cliente único:

```ts
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

Usar la versión websocket (segunda). Definir además el tipo que consumen las funciones de dominio:

```ts
import type { PgTransaction } from "drizzle-orm/pg-core";
// Tipo laxo para dominio: cualquier drizzle-pg con el schema (Neon o PGlite)
export type DomainDb = Pick<Db, "select" | "insert" | "update" | "delete" | "query" | "transaction">;
```

Si el tipado exacto entre drivers Neon/PGlite roza, usar `export type DomainDb = any` con un comentario — pragmatismo antes que pelea de genéricos; los tests cubren el comportamiento.

- [ ] **Step 3: Generar migración**

```bash
npx drizzle-kit generate
```

Expected: crea `drizzle/0000_*.sql` con todas las tablas.

- [ ] **Step 4: Helper de test con PGlite**

Create `tests/helpers/db.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";

export async function createTestDb() {
  const client = new PGlite();
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

- [ ] **Step 5: Test de humo de migración**

Create `tests/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";

describe("schema", () => {
  it("migrates and inserts a product with variant", async () => {
    const db = await createTestDb();
    await seedTestUser(db);
    const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1500.5 }).returning();
    const [v] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 10 }).returning();
    expect(v.stock).toBe(10);
    expect(p.basePrice).toBe(1500.5);
  });
});
```

- [ ] **Step 6: Correr tests**

Run: `npm test`
Expected: PASS. Si `basePrice` vuelve como string, ajustar `mode: "number"` en el schema (verificar versión de drizzle-orm; si la versión instalada no soporta `mode` en `numeric`, crear helper `const money = (name: string) => numeric(name, { precision: 12, scale: 2 })` y castear con `Number()` en el dominio — decidirlo acá y aplicarlo consistente en todo el plan).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add database schema, migrations and pglite test harness"
```

---

### Task 3: Auth (better-auth + roles) + login

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/session.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/login/page.tsx`, `scripts/seed-owner.ts`

**Interfaces:**
- Consumes: `db`, schema de Task 2.
- Produces: `auth` (server), `authClient` (browser), `requireUser(): Promise<SessionUser>` y `requireOwner(): Promise<SessionUser>` donde `SessionUser = { id: string; name: string; email: string; role: string }`. Ambas redirigen a `/login` sin sesión; `requireOwner` tira `Error("FORBIDDEN")` si rol ≠ owner.

- [ ] **Step 1: Instancia server**

Create `src/lib/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [admin({ defaultRole: "employee", adminRoles: ["owner"] })],
});
```

Consultar docs de better-auth (context7: `better-auth`) si la firma del plugin admin difiere — la intención: rol default `employee`, rol con permisos de administración `owner`, registro público deshabilitado.

- [ ] **Step 2: Route handler + cliente**

Create `src/app/api/auth/[...all]/route.ts`:

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth.handler);
```

Create `src/lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({ plugins: [adminClient()] });
```

- [ ] **Step 3: Helpers de sesión**

Create `src/lib/session.ts`:

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = { id: string; name: string; email: string; role: string };

export async function requireUser(): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  const u = session.user as SessionUser & { banned?: boolean };
  if (u.banned) redirect("/login");
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "employee" };
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "owner") throw new Error("FORBIDDEN");
  return u;
}
```

- [ ] **Step 4: Página de login**

Create `src/app/login/page.tsx` (client component):

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await authClient.signIn.email({ email, password });
    if (error) setError("Email o contraseña incorrectos");
    else router.push("/vender");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border p-6">
        <h1 className="text-xl font-bold">Ingresar</h1>
        <input className="w-full rounded border p-2" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded border p-2" type="password" placeholder="Contraseña"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-black p-2 text-white" type="submit">Entrar</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Seed del owner**

Create `scripts/seed-owner.ts`:

```ts
import "dotenv/config";
import { auth } from "../src/lib/auth";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.OWNER_EMAIL!;
  const password = process.env.OWNER_PASSWORD!;
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(password);
  await ctx.internalAdapter.createUser({ email, name: "Dueño", emailVerified: true });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hashed });
  await db.update(user).set({ role: "owner" }).where(eq(user.id, u.id));
  console.log("Owner created:", email);
}
main().then(() => process.exit(0));
```

Agregar script a `package.json`: `"seed:owner": "tsx scripts/seed-owner.ts"`. Si la API interna de better-auth difiere, alternativa: habilitar signup temporalmente y usar `auth.api.signUpEmail({ body: { email, password, name } })`, luego update de rol. Requiere `DATABASE_URL` real (se corre en Task 12).

- [ ] **Step 6: Verificar build**

Run: `npx tsc --noEmit`
Expected: sin errores de tipos. (Login funcional se verifica end-to-end en Task 12 con DB real.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add better-auth with owner/employee roles and login page"
```

---

### Task 4: Dominio — movimientos de stock

**Files:**
- Create: `src/domain/stock.ts`
- Test: `tests/stock.test.ts`

**Interfaces:**
- Consumes: schema Task 2.
- Produces: `applyStockMovement(tx, { variantId, type, quantity, userId, saleId?, reason? }): Promise<void>` — actualiza `product_variants.stock` e inserta en `stock_movements` de forma atómica. Tira `Error("INSUFFICIENT_STOCK")` si el resultado sería negativo. `quantity` con signo (venta: negativo).

- [ ] **Step 1: Test failing**

Create `tests/stock.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants, stockMovements } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
  const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 5 }).returning();
  variantId = v.id;
});

describe("applyStockMovement", () => {
  it("decrements stock and records movement", async () => {
    await db.transaction(async (tx) => {
      await applyStockMovement(tx, { variantId, type: "venta", quantity: -3, userId: "u1" });
    });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(2);
    const movs = await db.select().from(stockMovements);
    expect(movs).toHaveLength(1);
    expect(movs[0].quantity).toBe(-3);
  });

  it("rejects movement that would make stock negative", async () => {
    await expect(
      db.transaction(async (tx) => {
        await applyStockMovement(tx, { variantId, type: "venta", quantity: -6, userId: "u1" });
      })
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(5); // rollback
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("increments stock on reposicion", async () => {
    await db.transaction(async (tx) => {
      await applyStockMovement(tx, { variantId, type: "reposicion", quantity: 10, userId: "u1" });
    });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(15);
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npm test -- stock`
Expected: FAIL — módulo `@/domain/stock` no existe.

- [ ] **Step 3: Implementación**

Create `src/domain/stock.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { productVariants, stockMovements } from "@/db/schema";

type Tx = Parameters<Parameters<import("@/db").Db["transaction"]>[0]>[0] | any;

export type StockMovementInput = {
  variantId: number;
  type: "venta" | "reposicion" | "ajuste" | "anulacion";
  quantity: number; // con signo
  userId: string;
  saleId?: number;
  reason?: string;
};

export async function applyStockMovement(tx: Tx, input: StockMovementInput): Promise<void> {
  // UPDATE condicional: solo aplica si el stock resultante es >= 0.
  // Atómico frente a concurrencia: dos ventas simultáneas no pueden sobrevender.
  const updated = await tx
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} + ${input.quantity}` })
    .where(sql`${productVariants.id} = ${input.variantId} AND ${productVariants.stock} + ${input.quantity} >= 0`)
    .returning({ id: productVariants.id });

  if (updated.length === 0) throw new Error("INSUFFICIENT_STOCK");

  await tx.insert(stockMovements).values({
    variantId: input.variantId,
    type: input.type,
    quantity: input.quantity,
    userId: input.userId,
    saleId: input.saleId,
    reason: input.reason,
  });
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npm test -- stock`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add transactional stock movement domain logic"
```

---

### Task 5: Dominio — caja (sesiones)

**Files:**
- Create: `src/domain/cash.ts`
- Test: `tests/cash.test.ts`

**Interfaces:**
- Consumes: schema, `Db`.
- Produces:
  - `getOpenSession(db): Promise<CashSession | null>`
  - `openCashSession(db, { userId, openingCash }): Promise<CashSession>` — tira `Error("SESSION_ALREADY_OPEN")` si hay una abierta.
  - `closeCashSession(db, { sessionId, userId, countedCash, notes? }): Promise<CashSession>` — calcula totales por medio de pago de ventas no anuladas de la sesión, `expectedCash = openingCash + total efectivo`, `difference = countedCash - expectedCash`. Tira `Error("SESSION_NOT_OPEN")` si ya cerrada o no existe.

- [ ] **Step 1: Test failing**

Create `tests/cash.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { sales } from "@/db/schema";
import { openCashSession, closeCashSession, getOpenSession } from "@/domain/cash";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("cash sessions", () => {
  it("opens a session and finds it", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 5000 });
    expect((await getOpenSession(db))?.id).toBe(s.id);
  });

  it("rejects opening when one is already open", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 5000 });
    await expect(openCashSession(db, { userId: "u1", openingCash: 0 })).rejects.toThrow("SESSION_ALREADY_OPEN");
  });

  it("closes computing expected cash and difference, ignoring voided sales", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 1000 });
    await db.insert(sales).values([
      { sellerId: "u1", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" },
      { sellerId: "u1", cashSessionId: s.id, total: 3000, paymentMethod: "tarjeta" },
      { sellerId: "u1", cashSessionId: s.id, total: 500, paymentMethod: "efectivo", voided: true },
    ]);
    const closed = await closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 2900 });
    expect(closed.expectedCash).toBe(3000); // 1000 + 2000
    expect(closed.totalCard).toBe(3000);
    expect(closed.difference).toBe(-100);
    expect(await getOpenSession(db)).toBeNull();
  });

  it("rejects closing an already closed session", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 0 });
    await closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 0 });
    await expect(closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npm test -- cash`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

Create `src/domain/cash.ts`:

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { cashSessions, sales, type CashSession } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getOpenSession(db: any): Promise<CashSession | null> {
  const rows = await db.select().from(cashSessions).where(isNull(cashSessions.closedAt)).limit(1);
  return rows[0] ?? null;
}

export async function openCashSession(db: any, input: { userId: string; openingCash: number }): Promise<CashSession> {
  if (await getOpenSession(db)) throw new Error("SESSION_ALREADY_OPEN");
  const [s] = await db.insert(cashSessions)
    .values({ openedBy: input.userId, openingCash: round2(input.openingCash) })
    .returning();
  return s;
}

export async function closeCashSession(
  db: any,
  input: { sessionId: number; userId: string; countedCash: number; notes?: string }
): Promise<CashSession> {
  const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId));
  if (!session || session.closedAt) throw new Error("SESSION_NOT_OPEN");

  const totals = await db
    .select({
      method: sales.paymentMethod,
      total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
    })
    .from(sales)
    .where(and(eq(sales.cashSessionId, input.sessionId), eq(sales.voided, false)))
    .groupBy(sales.paymentMethod);

  const byMethod = Object.fromEntries(totals.map((t: any) => [t.method, t.total]));
  const expectedCash = round2(session.openingCash + (byMethod.efectivo ?? 0));

  const [closed] = await db.update(cashSessions)
    .set({
      closedAt: new Date(),
      closedBy: input.userId,
      expectedCash,
      totalTransfer: byMethod.transferencia ?? 0,
      totalCard: byMethod.tarjeta ?? 0,
      countedCash: round2(input.countedCash),
      difference: round2(input.countedCash - expectedCash),
      notes: input.notes,
    })
    .where(eq(cashSessions.id, input.sessionId))
    .returning();
  return closed;
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npm test -- cash`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add cash session domain logic with close totals"
```

---

### Task 6: Dominio — ventas (crear y anular)

**Files:**
- Create: `src/domain/sales.ts`
- Test: `tests/sales.test.ts`

**Interfaces:**
- Consumes: `applyStockMovement` (Task 4), `getOpenSession` (Task 5).
- Produces:
  - `createSale(db, { sellerId, paymentMethod, items: { variantId, quantity }[] }): Promise<Sale>` — transacción: valida sesión abierta (`Error("NO_OPEN_SESSION")`), items no vacíos (`Error("EMPTY_SALE")`), precio unitario = `variant.price ?? product.basePrice` leído en el momento, descuenta stock vía `applyStockMovement` (propaga `INSUFFICIENT_STOCK`), inserta venta + items.
  - `voidSale(db, { saleId, userId }): Promise<void>` — transacción: marca `voided`, revierte stock con movimientos `anulacion`. Tira `Error("ALREADY_VOIDED")`.

- [ ] **Step 1: Test failing**

Create `tests/sales.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants, sales, saleItems, stockMovements } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let vId: number, vId2: number;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
  const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
  const [v1] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 5 }).returning();
  const [v2] = await db.insert(productVariants).values({ productId: p.id, name: "L", stock: 2, price: 1200 }).returning();
  vId = v1.id; vId2 = v2.id;
});

describe("createSale", () => {
  it("fails without open cash session", async () => {
    await expect(
      createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] })
    ).rejects.toThrow("NO_OPEN_SESSION");
  });

  it("creates sale, decrements stock, snapshots prices (variant override wins)", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 2 }, { variantId: vId2, quantity: 1 }],
    });
    expect(sale.total).toBe(3200); // 2*1000 + 1*1200
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(items.map((i) => i.unitPrice).sort()).toEqual([1000, 1200]);
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(3);
  });

  it("rolls back everything on insufficient stock", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    await expect(
      createSale(db, {
        sellerId: "u1", paymentMethod: "efectivo",
        items: [{ variantId: vId, quantity: 1 }, { variantId: vId2, quantity: 99 }],
      })
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect(await db.select().from(sales)).toHaveLength(0);
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5); // rollback del primer item
  });

  it("rejects empty sale", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    await expect(createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [] })).rejects.toThrow("EMPTY_SALE");
  });
});

describe("voidSale", () => {
  it("restores stock and marks voided", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { sellerId: "u1", paymentMethod: "tarjeta", items: [{ variantId: vId, quantity: 2 }] });
    await voidSale(db, { saleId: sale.id, userId: "u1" });
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5);
    const [s] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(s.voided).toBe(true);
    const movs = await db.select().from(stockMovements).where(eq(stockMovements.type, "anulacion"));
    expect(movs).toHaveLength(1);
    expect(movs[0].quantity).toBe(2);
  });

  it("rejects double void", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] });
    await voidSale(db, { saleId: sale.id, userId: "u1" });
    await expect(voidSale(db, { saleId: sale.id, userId: "u1" })).rejects.toThrow("ALREADY_VOIDED");
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npm test -- sales`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

Create `src/domain/sales.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { products, productVariants, sales, saleItems, type Sale } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";
import { getOpenSession } from "@/domain/cash";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SaleInput = {
  sellerId: string;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta";
  items: { variantId: number; quantity: number }[];
};

export async function createSale(db: any, input: SaleInput): Promise<Sale> {
  if (input.items.length === 0) throw new Error("EMPTY_SALE");
  if (input.items.some((i) => i.quantity <= 0)) throw new Error("INVALID_QUANTITY");

  const session = await getOpenSession(db);
  if (!session) throw new Error("NO_OPEN_SESSION");

  return db.transaction(async (tx: any) => {
    const variantRows = await tx
      .select({
        id: productVariants.id,
        price: productVariants.price,
        basePrice: products.basePrice,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(inArray(productVariants.id, input.items.map((i) => i.variantId)));

    const priceOf = new Map(variantRows.map((v: any) => [v.id, v.price ?? v.basePrice]));
    if (priceOf.size !== new Set(input.items.map((i) => i.variantId)).size) throw new Error("VARIANT_NOT_FOUND");

    const total = round2(input.items.reduce((acc, i) => acc + (priceOf.get(i.variantId) as number) * i.quantity, 0));

    const [sale] = await tx.insert(sales).values({
      sellerId: input.sellerId,
      cashSessionId: session.id,
      total,
      paymentMethod: input.paymentMethod,
    }).returning();

    for (const item of input.items) {
      await tx.insert(saleItems).values({
        saleId: sale.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: priceOf.get(item.variantId) as number,
      });
      await applyStockMovement(tx, {
        variantId: item.variantId,
        type: "venta",
        quantity: -item.quantity,
        userId: input.sellerId,
        saleId: sale.id,
      });
    }
    return sale;
  });
}

export async function voidSale(db: any, input: { saleId: number; userId: string }): Promise<void> {
  await db.transaction(async (tx: any) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId));
    if (!sale) throw new Error("SALE_NOT_FOUND");
    if (sale.voided) throw new Error("ALREADY_VOIDED");

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, input.saleId));
    for (const item of items) {
      await applyStockMovement(tx, {
        variantId: item.variantId,
        type: "anulacion",
        quantity: item.quantity,
        userId: input.userId,
        saleId: input.saleId,
      });
    }
    await tx.update(sales)
      .set({ voided: true, voidedAt: new Date(), voidedBy: input.userId })
      .where(eq(sales.id, input.saleId));
  });
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npm test`
Expected: todos los tests PASS (schema, stock, cash, sales).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add sale creation and void domain logic"
```

---

### Task 7: Dominio — importación Excel

**Files:**
- Create: `src/domain/import.ts`
- Test: `tests/import.test.ts`

**Interfaces:**
- Consumes: schema, `applyStockMovement`.
- Produces:
  - `type ImportRow = { rowNumber: number; product: string; variant: string; sku: string | null; price: number | null; stock: number }`
  - `type ValidatedRow = ImportRow & { error: string | null; action: "create" | "update" | null }`
  - `validateImportRows(db, rows: ImportRow[]): Promise<ValidatedRow[]>` — marca errores: producto vacío, precio inválido (<0 o NaN cuando no hay SKU existente), stock inválido (<0 o no entero), SKU duplicado dentro del archivo. `action: "update"` si SKU existe en DB, `"create"` si no.
  - `executeImport(db, rows: ValidatedRow[], userId): Promise<{ created: number; updated: number; skipped: number }>` — transacción única; filas con error se saltan; update por SKU actualiza precio y ajusta stock al valor importado (movimiento `ajuste`, motivo "importación"); create agrupa filas del mismo nombre de producto en un producto con N variantes.
  - Parseo del `.xlsx` a `ImportRow[]` queda en la capa de action (Task 10) con exceljs; el dominio trabaja con filas ya extraídas — testeable sin archivos.

- [ ] **Step 1: Test failing**

Create `tests/import.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants, stockMovements } from "@/db/schema";
import { validateImportRows, executeImport, type ImportRow } from "@/domain/import";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;

const row = (n: number, over: Partial<ImportRow> = {}): ImportRow => ({
  rowNumber: n, product: "Remera", variant: "M", sku: null, price: 1000, stock: 5, ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("validateImportRows", () => {
  it("flags invalid rows and duplicate SKUs in file", async () => {
    const out = await validateImportRows(db, [
      row(2),
      row(3, { product: "" }),
      row(4, { price: -5 }),
      row(5, { stock: -1 }),
      row(6, { sku: "A1" }),
      row(7, { sku: "A1" }),
    ]);
    expect(out[0].error).toBeNull();
    expect(out[1].error).toMatch(/producto/i);
    expect(out[2].error).toMatch(/precio/i);
    expect(out[3].error).toMatch(/stock/i);
    expect(out[4].error).toBeNull();
    expect(out[5].error).toMatch(/duplicado/i);
  });

  it("marks update when SKU exists in db", async () => {
    const [p] = await db.insert(products).values({ name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "", sku: "G1", stock: 1 });
    const out = await validateImportRows(db, [row(2, { sku: "G1" }), row(3, { sku: "NEW" })]);
    expect(out[0].action).toBe("update");
    expect(out[1].action).toBe("create");
  });
});

describe("executeImport", () => {
  it("creates products grouping variants, updates existing by sku, skips errors", async () => {
    const [p] = await db.insert(products).values({ name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "", sku: "G1", stock: 1 });

    const validated = await validateImportRows(db, [
      row(2, { product: "Remera", variant: "M", sku: "R-M", stock: 5 }),
      row(3, { product: "Remera", variant: "L", sku: "R-L", stock: 3 }),
      row(4, { sku: "G1", price: 800, stock: 10, product: "Gorra", variant: "" }),
      row(5, { product: "" }),
    ]);
    const res = await executeImport(db, validated, "u1");
    expect(res).toEqual({ created: 2, updated: 1, skipped: 1 });

    const allProducts = await db.select().from(products);
    expect(allProducts).toHaveLength(2); // Gorra + Remera (variantes agrupadas)

    const [g1] = await db.select().from(productVariants).where(eq(productVariants.sku, "G1"));
    expect(g1.stock).toBe(10);
    expect(g1.price).toBe(800);

    const adjustments = await db.select().from(stockMovements).where(eq(stockMovements.type, "ajuste"));
    expect(adjustments.length).toBeGreaterThanOrEqual(3); // R-M, R-L, G1
    expect(adjustments.every((m) => m.reason === "importación")).toBe(true);
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npm test -- import`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

Create `src/domain/import.ts`:

```ts
import { eq, inArray, isNotNull } from "drizzle-orm";
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
    if (r.sku) seenInFile.add(r.sku);
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
  const skipped = rows.filter((r) => r.error).length;
  const valid = rows.filter((r) => !r.error);

  await db.transaction(async (tx: any) => {
    // updates por SKU
    for (const r of valid.filter((r) => r.action === "update")) {
      const [variant] = await tx.select().from(productVariants).where(eq(productVariants.sku, r.sku!));
      if (r.price !== null) {
        await tx.update(productVariants).set({ price: r.price }).where(eq(productVariants.id, variant.id));
      }
      const delta = r.stock - variant.stock;
      if (delta !== 0) {
        await applyStockMovement(tx, {
          variantId: variant.id, type: "ajuste", quantity: delta, userId, reason: "importación",
        });
      } else {
        await applyStockMovement(tx, {
          variantId: variant.id, type: "ajuste", quantity: 0, userId, reason: "importación",
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
      const [product] = await tx.insert(products)
        .values({ name, basePrice: group[0].price! })
        .returning();
      for (const r of group) {
        const [variant] = await tx.insert(productVariants).values({
          productId: product.id,
          name: r.variant.trim(),
          sku: r.sku,
          stock: 0,
          price: group.length > 1 && r.price !== group[0].price ? r.price : null,
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
```

Nota: si el test de "ajuste con delta 0" resulta ruido en la auditoría, simplificar: no registrar movimiento cuando `delta === 0` y ajustar la aserción del test (`>= 3` ya lo tolera si G1 pasa de 1 a 10).

- [ ] **Step 4: Correr — debe pasar**

Run: `npm test -- import`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add excel import validation and execution domain logic"
```

---

### Task 8: Layout autenticado + pantalla Productos

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/productos/page.tsx`, `src/app/(app)/productos/actions.ts`, `src/app/(app)/productos/product-form.tsx`
- Modify: `src/app/page.tsx` (redirect a `/vender`)

**Interfaces:**
- Consumes: `requireUser`/`requireOwner`, schema, `applyStockMovement`.
- Produces: layout con nav (Vender, Productos, Ventas, Caja — todos; Importar, Reportes, Usuarios — solo owner visible) + logout. Server actions: `saveProduct`, `saveVariant`, `restock`, `adjustStock`, `toggleProductActive`, `toggleVariantActive`.

- [ ] **Step 1: Redirect raíz y layout**

Replace `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/vender"); }
```

Create `src/app/(app)/layout.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const links = [
    { href: "/vender", label: "Vender" },
    { href: "/productos", label: "Productos" },
    { href: "/ventas", label: "Ventas" },
    { href: "/caja", label: "Caja" },
    ...(user.role === "owner" ? [
      { href: "/importar", label: "Importar" },
      { href: "/reportes", label: "Reportes" },
      { href: "/usuarios", label: "Usuarios" },
    ] : []),
  ];
  return (
    <div className="min-h-screen">
      <nav className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm font-medium hover:underline">{l.label}</Link>
        ))}
        <span className="ml-auto text-sm text-gray-500">{user.name}</span>
        <LogoutButton />
      </nav>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

Create `src/app/(app)/logout-button.tsx`:

```tsx
"use client";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button className="text-sm text-red-600" onClick={async () => { await authClient.signOut(); router.push("/login"); }}>
      Salir
    </button>
  );
}
```

- [ ] **Step 2: Server actions de productos**

Create `src/app/(app)/productos/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { applyStockMovement } from "@/domain/stock";

export async function saveProduct(input: { id?: number; name: string; basePrice: number; lowStockThreshold: number }) {
  await requireOwner();
  if (!input.name.trim() || input.basePrice < 0) return { error: "Datos inválidos" };
  if (input.id) {
    await db.update(products).set({
      name: input.name.trim(), basePrice: input.basePrice, lowStockThreshold: input.lowStockThreshold,
    }).where(eq(products.id, input.id));
  } else {
    const [p] = await db.insert(products).values({
      name: input.name.trim(), basePrice: input.basePrice, lowStockThreshold: input.lowStockThreshold,
    }).returning();
    // variante default para producto sin variantes reales
    await db.insert(productVariants).values({ productId: p.id, name: "" });
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function saveVariant(input: { id?: number; productId: number; name: string; sku: string | null; price: number | null }) {
  await requireOwner();
  const values = { name: input.name.trim(), sku: input.sku?.trim() || null, price: input.price };
  try {
    if (input.id) await db.update(productVariants).set(values).where(eq(productVariants.id, input.id));
    else await db.insert(productVariants).values({ ...values, productId: input.productId });
  } catch {
    return { error: "SKU ya existe" };
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function restock(variantId: number, quantity: number) {
  const user = await requireOwner();
  if (!Number.isInteger(quantity) || quantity <= 0) return { error: "Cantidad inválida" };
  await db.transaction(async (tx) => {
    await applyStockMovement(tx, { variantId, type: "reposicion", quantity, userId: user.id });
  });
  revalidatePath("/productos");
  return { ok: true };
}

export async function adjustStock(variantId: number, newStock: number, reason: string) {
  const user = await requireOwner();
  if (!Number.isInteger(newStock) || newStock < 0 || !reason.trim()) return { error: "Datos inválidos" };
  await db.transaction(async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId));
    const delta = newStock - v.stock;
    if (delta !== 0) {
      await applyStockMovement(tx, { variantId, type: "ajuste", quantity: delta, userId: user.id, reason: reason.trim() });
    }
  });
  revalidatePath("/productos");
  return { ok: true };
}

export async function toggleProductActive(productId: number, active: boolean) {
  await requireOwner();
  await db.update(products).set({ active }).where(eq(products.id, productId));
  revalidatePath("/productos");
  return { ok: true };
}

export async function toggleVariantActive(variantId: number, active: boolean) {
  await requireOwner();
  await db.update(productVariants).set({ active }).where(eq(productVariants.id, variantId));
  revalidatePath("/productos");
  return { ok: true };
}
```

- [ ] **Step 3: Página y formulario**

Create `src/app/(app)/productos/page.tsx` (server component): lista productos con sus variantes vía `db.query.products.findMany()` + variantes (o join manual), muestra: nombre, variante, SKU, precio efectivo (`price ?? basePrice`), stock (resaltar en rojo si `stock <= lowStockThreshold`), activo. Owner ve botones editar / reponer / ajustar / desactivar que abren `product-form.tsx` (client component con `useState` para modal simple). Employee ve solo lectura.

Create `src/app/(app)/productos/product-form.tsx` (client): formulario controlado para producto (nombre, precio base, umbral) y variantes (nombre, SKU, precio opcional), inputs para reponer (+N) y ajustar (nuevo stock + motivo). Llama a las server actions de Step 2 y muestra `error` si vuelve.

Implementación libre en estilos; comportamiento fijado por las actions. Mantener componentes < 200 líneas; si crece, separar `variant-row.tsx`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK. Verificación funcional manual queda para Task 12 (necesita DB real).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add authenticated layout and products management screen"
```

---

### Task 9: Pantallas Vender, Caja y Ventas

**Files:**
- Create: `src/app/(app)/vender/page.tsx`, `src/app/(app)/vender/actions.ts`, `src/app/(app)/vender/sale-form.tsx`, `src/app/(app)/caja/page.tsx`, `src/app/(app)/caja/actions.ts`, `src/app/(app)/ventas/page.tsx`, `src/app/(app)/ventas/actions.ts`

**Interfaces:**
- Consumes: `createSale`, `voidSale`, `openCashSession`, `closeCashSession`, `getOpenSession`, `requireUser`, `requireOwner`.
- Produces: flujo completo de venta y caja en UI.

- [ ] **Step 1: Actions de vender**

Create `src/app/(app)/vender/actions.ts`:

```ts
"use server";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { createSale } from "@/domain/sales";

export async function searchVariants(term: string) {
  await requireUser();
  if (term.trim().length < 2) return [];
  const t = `%${term.trim()}%`;
  return db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      stock: productVariants.stock,
      price: productVariants.price,
      basePrice: products.basePrice,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.active, true), eq(productVariants.active, true),
      or(ilike(products.name, t), ilike(productVariants.sku, t))
    ))
    .limit(20);
}

const ERROR_MESSAGES: Record<string, string> = {
  NO_OPEN_SESSION: "No hay caja abierta. Abrí la caja antes de vender.",
  INSUFFICIENT_STOCK: "Stock insuficiente para uno de los productos.",
  EMPTY_SALE: "El carrito está vacío.",
};

export async function submitSale(input: {
  paymentMethod: "efectivo" | "transferencia" | "tarjeta";
  items: { variantId: number; quantity: number }[];
}) {
  const user = await requireUser();
  try {
    const sale = await createSale(db, { sellerId: user.id, ...input });
    return { ok: true as const, saleId: sale.id, total: sale.total };
  } catch (e) {
    const msg = e instanceof Error ? ERROR_MESSAGES[e.message] : undefined;
    return { error: msg ?? "Error al registrar la venta" };
  }
}
```

- [ ] **Step 2: UI de vender**

Create `src/app/(app)/vender/page.tsx` (server): obtiene `getOpenSession(db)`; si no hay, muestra aviso con link a `/caja`. Si hay, renderiza `<SaleForm />`.

Create `src/app/(app)/vender/sale-form.tsx` (client): input de búsqueda con debounce 300ms llamando `searchVariants`, lista de resultados ("Remera Roja — M · $1.200 · stock 3"; si `variantName === ""` mostrar solo nombre de producto), click agrega al carrito (o incrementa cantidad). Carrito: filas con cantidad editable, subtotal, quitar. Total abajo. Selector de medio de pago (3 botones: Efectivo/Transferencia/Tarjeta). Botón "Confirmar venta" llama `submitSale`; en éxito limpia carrito y muestra "Venta #N registrada — $total"; en error muestra el mensaje devuelto. Deshabilitar botón mientras envía.

- [ ] **Step 3: Caja**

Create `src/app/(app)/caja/actions.ts`:

```ts
"use server";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { openCashSession, closeCashSession, getOpenSession } from "@/domain/cash";
import { revalidatePath } from "next/cache";

export async function openSession(openingCash: number) {
  const user = await requireUser();
  if (openingCash < 0) return { error: "Monto inválido" };
  try {
    await openCashSession(db, { userId: user.id, openingCash });
  } catch {
    return { error: "Ya hay una caja abierta" };
  }
  revalidatePath("/caja"); revalidatePath("/vender");
  return { ok: true };
}

export async function closeSession(countedCash: number, notes: string) {
  const user = await requireUser();
  if (countedCash < 0) return { error: "Monto inválido" };
  const open = await getOpenSession(db);
  if (!open) return { error: "No hay caja abierta" };
  const closed = await closeCashSession(db, { sessionId: open.id, userId: user.id, countedCash, notes: notes || undefined });
  revalidatePath("/caja"); revalidatePath("/vender");
  return { ok: true as const, expectedCash: closed.expectedCash, difference: closed.difference };
}
```

Create `src/app/(app)/caja/page.tsx` (server + client form): si no hay sesión abierta → formulario "Abrir caja" (monto inicial). Si hay → panel con hora de apertura, quién abrió, ventas de la sesión (cantidad y total por medio de pago, query en el server component), formulario de cierre: efectivo contado + notas. Al cerrar muestra esperado vs contado y diferencia (verde si 0, rojo si no).

- [ ] **Step 4: Ventas + anulación**

Create `src/app/(app)/ventas/actions.ts`:

```ts
"use server";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { voidSale } from "@/domain/sales";
import { revalidatePath } from "next/cache";

export async function voidSaleAction(saleId: number) {
  const user = await requireOwner();
  try {
    await voidSale(db, { saleId, userId: user.id });
  } catch (e) {
    return { error: e instanceof Error && e.message === "ALREADY_VOIDED" ? "La venta ya está anulada" : "No se pudo anular" };
  }
  revalidatePath("/ventas");
  return { ok: true };
}
```

Create `src/app/(app)/ventas/page.tsx` (server): tabla de ventas (fecha, N°, vendedor, medio de pago, total, estado) con filtros por rango de fecha y vendedor vía searchParams (`?from=&to=&seller=`). Employee ve solo sus ventas (`where sellerId = user.id`); owner ve todas + filtro por vendedor + botón "Anular" (con `confirm()` en client component chico) que llama `voidSaleAction`. Fila expandible o link a detalle con items (producto, variante, cantidad, precio unitario). Ventas anuladas en gris tachado.

- [ ] **Step 5: Verificar + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: OK.

```bash
git add -A && git commit -m "feat: add sell, cash session and sales history screens"
```

---

### Task 10: Pantalla Importar (Excel)

**Files:**
- Create: `src/app/(app)/importar/page.tsx`, `src/app/(app)/importar/actions.ts`, `src/app/(app)/importar/import-form.tsx`, `src/app/(app)/importar/template/route.ts`

**Interfaces:**
- Consumes: `validateImportRows`, `executeImport` (Task 7).
- Produces: flujo subir → preview validado → confirmar → resultado. Endpoint GET `/importar/template` descarga `plantilla-productos.xlsx`.

- [ ] **Step 1: Parseo + actions**

Create `src/app/(app)/importar/actions.ts`:

```ts
"use server";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { validateImportRows, executeImport, type ImportRow, type ValidatedRow } from "@/domain/import";
import { revalidatePath } from "next/cache";

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text);
  return String(v);
}

export async function parseAndValidate(formData: FormData): Promise<{ rows?: ValidatedRow[]; error?: string }> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Subí un archivo .xlsx" };
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { error: "El archivo no es un .xlsx válido" };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { error: "El archivo no tiene hojas" };

  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const product = cellText(row.getCell(1).value).trim();
    const variant = cellText(row.getCell(2).value).trim();
    const sku = cellText(row.getCell(3).value).trim() || null;
    const priceRaw = cellText(row.getCell(4).value).trim();
    const stockRaw = cellText(row.getCell(5).value).trim();
    if (!product && !variant && !sku && !priceRaw && !stockRaw) return; // fila vacía
    rows.push({
      rowNumber, product, variant, sku,
      price: priceRaw === "" ? null : Number(priceRaw.replace(",", ".")),
      stock: stockRaw === "" ? 0 : Number(stockRaw),
    });
  });
  if (rows.length === 0) return { error: "El archivo no tiene filas de datos" };
  return { rows: await validateImportRows(db, rows) };
}

export async function confirmImport(rows: ValidatedRow[]) {
  const user = await requireOwner();
  const result = await executeImport(db, rows, user.id);
  revalidatePath("/productos");
  return { ok: true as const, ...result };
}
```

- [ ] **Step 2: Plantilla descargable**

Create `src/app/(app)/importar/template/route.ts`:

```ts
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Productos");
  ws.addRow(["Producto", "Variante", "SKU", "Precio", "Stock"]);
  ws.addRow(["Remera Roja", "M", "REM-R-M", 12000, 5]);
  ws.addRow(["Remera Roja", "L", "REM-R-L", 12000, 3]);
  ws.addRow(["Gorra Negra", "", "GOR-N", 8000, 10]);
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
    },
  });
}
```

- [ ] **Step 3: UI**

Create `src/app/(app)/importar/page.tsx` (server): `await requireOwner()` (además del guard de action) — si tira FORBIDDEN, Next mostrará error; envolver en try/redirect a `/vender`. Renderiza link "Descargar plantilla" (`/importar/template`) y `<ImportForm />`.

Create `src/app/(app)/importar/import-form.tsx` (client): `<input type="file" accept=".xlsx">` + submit a `parseAndValidate` (FormData). Muestra tabla preview: fila, producto, variante, SKU, precio, stock, estado — filas con `error` en rojo con el mensaje, válidas con badge "crear"/"actualizar". Botón "Confirmar importación (N válidas, M con error se omiten)" llama `confirmImport(rows)`. Al terminar muestra `{created} creados, {updated} actualizados, {skipped} omitidos`.

- [ ] **Step 4: Verificar + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: OK.

```bash
git add -A && git commit -m "feat: add excel import screen with template download and preview"
```

---

### Task 11: Reportes + Usuarios

**Files:**
- Create: `src/domain/reports.ts`, `src/app/(app)/reportes/page.tsx`, `src/app/(app)/usuarios/page.tsx`, `src/app/(app)/usuarios/actions.ts`, `src/app/(app)/usuarios/user-form.tsx`

**Interfaces:**
- Consumes: schema, `requireOwner`, better-auth admin API.
- Produces: `getSalesReport(db, { from, to })`, `getTopProducts(db, { from, to, limit })`, `getLowStock(db)`, `getCashSessionHistory(db, { limit })`. Actions: `createEmployee`, `setUserActive`.

- [ ] **Step 1: Queries de reportes**

Create `src/domain/reports.ts`:

```ts
import { and, between, desc, eq, isNotNull, sql } from "drizzle-orm";
import { cashSessions, products, productVariants, sales, saleItems } from "@/db/schema";

export async function getSalesReport(db: any, range: { from: Date; to: Date }) {
  const notVoided = and(eq(sales.voided, false), between(sales.createdAt, range.from, range.to));
  const byDay = await db
    .select({
      day: sql<string>`to_char(${sales.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`sum(${sales.total})`.mapWith(Number),
    })
    .from(sales).where(notVoided)
    .groupBy(sql`to_char(${sales.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${sales.createdAt}, 'YYYY-MM-DD')`);
  const byMethod = await db
    .select({
      method: sales.paymentMethod,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`sum(${sales.total})`.mapWith(Number),
    })
    .from(sales).where(notVoided).groupBy(sales.paymentMethod);
  return { byDay, byMethod };
}

export async function getTopProducts(db: any, opts: { from: Date; to: Date; limit?: number }) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      unitsSold: sql<number>`sum(${saleItems.quantity})`.mapWith(Number),
      revenue: sql<number>`sum(${saleItems.quantity} * ${saleItems.unitPrice})`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(sales.voided, false), between(sales.createdAt, opts.from, opts.to)))
    .groupBy(products.name, productVariants.name)
    .orderBy(desc(sql`sum(${saleItems.quantity})`))
    .limit(opts.limit ?? 10);
}

export async function getLowStock(db: any) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      stock: productVariants.stock,
      threshold: products.lowStockThreshold,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.active, true), eq(productVariants.active, true),
      sql`${productVariants.stock} <= ${products.lowStockThreshold}`
    ))
    .orderBy(productVariants.stock);
}

export async function getCashSessionHistory(db: any, opts: { limit?: number } = {}) {
  return db.select().from(cashSessions)
    .where(isNotNull(cashSessions.closedAt))
    .orderBy(desc(cashSessions.closedAt))
    .limit(opts.limit ?? 30);
}
```

- [ ] **Step 2: Página de reportes**

Create `src/app/(app)/reportes/page.tsx` (server): `requireOwner()`. searchParams `?from=&to=` (default: últimos 30 días). Secciones: Ventas por día (tabla fecha/cantidad/total), Totales por medio de pago, Top 10 productos, Stock bajo (rojo), Cierres de caja (fecha, esperado, contado, diferencia — diferencia ≠ 0 en rojo). Sin gráficos en MVP — tablas.

- [ ] **Step 3: Usuarios**

Create `src/app/(app)/usuarios/actions.ts`:

```ts
"use server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function createEmployee(input: { name: string; email: string; password: string }) {
  await requireOwner();
  if (input.password.length < 8) return { error: "Contraseña mínimo 8 caracteres" };
  try {
    await auth.api.createUser({
      headers: await headers(),
      body: { name: input.name, email: input.email, password: input.password, role: "employee" },
    });
  } catch {
    return { error: "No se pudo crear (¿email ya usado?)" };
  }
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean) {
  await requireOwner();
  const h = await headers();
  if (active) await auth.api.unbanUser({ headers: h, body: { userId } });
  else await auth.api.banUser({ headers: h, body: { userId, banReason: "Desactivado" } });
  revalidatePath("/usuarios");
  return { ok: true };
}
```

(`auth.api.createUser`/`banUser`/`unbanUser` vienen del plugin admin de better-auth; verificar firmas en docs si el tipo no cierra.)

Create `src/app/(app)/usuarios/page.tsx` (server): `requireOwner()`, lista `user` (nombre, email, rol, estado activo/desactivado) + `<UserForm />`.
Create `src/app/(app)/usuarios/user-form.tsx` (client): form nombre/email/contraseña → `createEmployee`; botón activar/desactivar por fila → `setUserActive`. No permitir desactivar al propio owner logueado (comparar id en server action: si `userId === user.id` devolver error "No podés desactivarte a vos mismo" — agregar esa verificación en `setUserActive`).

- [ ] **Step 4: Verificar + commit**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo OK.

```bash
git add -A && git commit -m "feat: add reports and user management screens"
```

---

### Task 12: Neon + deploy Vercel + verificación end-to-end

**Files:**
- Modify: `.env.local` (DATABASE_URL real), README.md

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: app deployada y verificada con flujo completo real.

- [ ] **Step 1: Crear DB en Neon**

Con el usuario: crear proyecto en https://neon.tech (free tier) o vía integración Vercel Marketplace (`vercel marketplace` / dashboard). Obtener `DATABASE_URL` (pooled). Pegarla en `.env.local`.

- [ ] **Step 2: Migrar y seedear**

```bash
npx drizzle-kit migrate
OWNER_EMAIL=... OWNER_PASSWORD=... npm run seed:owner
```

Expected: tablas creadas, owner creado.

- [ ] **Step 3: Verificación end-to-end local**

Run: `npm run dev`. Flujo completo a mano (o con Playwright MCP si disponible):

1. Login con owner. 2. Crear producto con 2 variantes. 3. Intentar vender sin caja → bloquea con aviso. 4. Abrir caja con $1000. 5. Vender 2 unidades efectivo → stock baja. 6. Intentar vender más que el stock → error. 7. Anular la venta → stock vuelve. 8. Nueva venta tarjeta. 9. Cerrar caja: verificar esperado/diferencia. 10. Importar plantilla descargada → preview → confirmar → productos aparecen. 11. Crear empleado, login en incógnito: no ve Reportes/Usuarios/Importar, puede vender. 12. Reportes muestran datos coherentes.

Cualquier falla: fix + commit antes de seguir.

- [ ] **Step 4: Deploy**

```bash
npx vercel link
npx vercel env add DATABASE_URL production
npx vercel env add BETTER_AUTH_SECRET production
npx vercel env add BETTER_AUTH_URL production   # https://<dominio>.vercel.app
npx vercel --prod
```

Verificar login + una venta en producción. Actualizar `BETTER_AUTH_URL` si el dominio final difiere, y agregar `baseURL` en `auth.ts` / `auth-client.ts` si better-auth lo requiere en prod.

- [ ] **Step 5: README + commit final**

Escribir `README.md`: qué es, stack, cómo correr local (env vars, migrate, seed), cómo deployar, cómo crear usuarios.

```bash
git add -A && git commit -m "docs: add README with setup and deploy instructions"
```

---

## Self-Review (hecho al escribir el plan)

- **Cobertura de spec:** variantes (T2/T8), venta descuenta stock transaccional (T4/T6/T9), caja por sesión (T5/T9), import Excel con preview/upsert/plantilla (T7/T10), reportes + stock bajo + historial cierres (T11), usuarios/roles (T3/T11), casos borde (stock insuficiente T4, venta sin caja T6/T9, anulación T6/T9, desactivar en vez de borrar T8, concurrencia vía UPDATE condicional T4, import con errores T7/T10). Tests de spec: los 5 puntos cubiertos en T4–T7.
- **Tipos:** `applyStockMovement` consumido igual en T6/T7/T8; nombres de schema consistentes.
- **Riesgo conocido:** firmas exactas de better-auth (adapter, admin plugin, createUser/banUser) pueden variar por versión — los pasos lo señalan y mandan a docs (context7) como fuente de verdad.
