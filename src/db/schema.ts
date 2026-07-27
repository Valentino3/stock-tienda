import {
  pgTable, text, timestamp, boolean, integer, numeric, jsonb, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
// Type-only: se borra al compilar, así que no crea ciclo con domain/import.ts
// (que sí importa valores de este archivo).
import type { ValidatedRow } from "@/domain/import";

// ---- multi-tienda (tenancy) ----
// Cada tienda es un tenant aislado. Los usuarios pertenecen a una tienda
// (user.storeId); el super-admin de plataforma tiene storeId null. Toda tabla
// de dominio raíz lleva storeId; las hijas lo heredan por su parent.
export const stores = pgTable("stores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- better-auth ----
// Reconciliado contra `npx @better-auth/cli generate` corrido con la config
// real de Task 3 (src/lib/auth.ts: drizzleAdapter + admin plugin). El
// generador no aplica NOT NULL/DEFAULT a nivel de DB en `role`/`banned`
// (better-auth los resuelve en la capa de aplicación vía `defaultRole`) y
// agrega `$onUpdate` en `updatedAt` + índices; se mantuvo tal cual generó.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  role: text("role"), // 'superadmin' | 'owner' | 'employee' (default "employee" por better-auth)
  // Tienda a la que pertenece el usuario. null = super-admin de plataforma.
  storeId: integer("store_id").references(() => stores.id),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$onUpdate(() => new Date()),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
}, (table) => [index("session_userId_idx").on(table.userId)]);

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
  updatedAt: timestamp("updated_at")
    .notNull()
    .$onUpdate(() => new Date()),
}, (table) => [index("account_userId_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ---- dominio ----
export const paymentMethodEnum = pgEnum("payment_method", ["efectivo", "transferencia", "tarjeta", "cuenta"]);
// Movimientos de cuenta corriente de un cliente: cargo (venta a cuenta) / pago.
export const clientMovementTypeEnum = pgEnum("client_movement_type", ["cargo", "pago"]);
export const movementTypeEnum = pgEnum("movement_type", ["venta", "reposicion", "ajuste", "anulacion"]);
// Movimientos de efectivo que SALEN de la caja (restan del esperado al cerrar):
// gasto = compra/pago operativo (empleado); egreso = retiro de efectivo (dueño).
export const cashMovementKindEnum = pgEnum("cash_movement_kind", ["gasto", "egreso"]);

export const products = pgTable("products", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  category: text("category"), // texto libre, opcional (agrupar/filtrar catálogo)
  basePrice: numeric("base_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("products_store_idx").on(t.storeId)]);

export const productVariants = pgTable("product_variants", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  productId: integer("product_id").notNull().references(() => products.id),
  // '' para la variante default de productos sin variantes reales (UI la oculta)
  name: text("name").notNull().default(""),
  sku: text("sku"),
  stock: integer("stock").notNull().default(0),
  price: numeric("price", { precision: 12, scale: 2, mode: "number" }), // null => hereda basePrice
  active: boolean("active").notNull().default(true),
  setName: text("set_name"),
  condition: text("condition"),
  foil: boolean("foil").notNull().default(false),
  language: text("language"),
  // SKU único POR TIENDA (no global): dos tiendas pueden reusar el mismo SKU.
  // sku null se permite repetido (Postgres trata NULL como distinto).
}, (t) => [uniqueIndex("product_variants_store_sku_idx").on(t.storeId, t.sku)]);

// NOTA: existe además un índice único parcial `cash_sessions_one_open_idx`
// que garantiza a nivel de DB como máximo una caja abierta POR TIENDA. Con
// multi-tienda pasó de `((1)) WHERE closed_at IS NULL` (una global) a
// `(store_id) WHERE closed_at IS NULL` (ver la migración de multi-tienda). No
// se modela con drizzle-kit porque es un índice único parcial sobre expresión.
// Ver `src/domain/cash.ts` (openCashSession) para el manejo del error 23505.
export const cashSessions = pgTable("cash_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
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
  storeId: integer("store_id").notNull().references(() => stores.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sellerId: text("seller_id").notNull().references(() => user.id),
  cashSessionId: integer("cash_session_id").notNull().references(() => cashSessions.id),
  total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull(),
  // Descuento general resuelto ($) sobre el subtotal; `total` ya es el neto final.
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  // Cliente de cuenta corriente (solo cuando paymentMethod = "cuenta").
  clientId: integer("client_id").references(() => clients.id),
  voided: boolean("voided").notNull().default(false),
  voidedAt: timestamp("voided_at"),
  voidedBy: text("voided_by").references(() => user.id),
}, (t) => [index("sales_store_idx").on(t.storeId)]);

export const saleItems = pgTable("sale_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  variantId: integer("variant_id").notNull().references(() => productVariants.id),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  // Descuento resuelto ($) de esta línea; total de línea = quantity*unitPrice − discountAmount.
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
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

// Salidas de efectivo de una caja: gastos (empleado) y egresos (dueño).
export const cashMovements = pgTable("cash_movements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cashSessionId: integer("cash_session_id").notNull().references(() => cashSessions.id),
  kind: cashMovementKindEnum("kind").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(), // positivo
  description: text("description").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("cash_movements_session_idx").on(table.cashSessionId)]);

// Comisiones anotadas a mano por el dueño para un empleado y un período.
export const commissions = pgTable("commissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  employeeId: text("employee_id").notNull().references(() => user.id),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  periodFrom: timestamp("period_from"),
  periodTo: timestamp("period_to"),
  note: text("note"),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("commissions_employee_idx").on(table.employeeId)]);

// Clientes de una tienda (cuenta corriente / fiado).
export const clients = pgTable("clients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  phone: text("phone"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("clients_store_idx").on(t.storeId)]);

// Movimientos de cuenta: cargo (venta a cuenta) suma deuda, pago la baja.
// Saldo del cliente = Σcargo − Σpago.
export const clientAccountMovements = pgTable("client_account_movements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  clientId: integer("client_id").notNull().references(() => clients.id),
  type: clientMovementTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(), // positivo
  saleId: integer("sale_id").references(() => sales.id),
  method: paymentMethodEnum("method"), // medio del pago (null para cargos)
  note: text("note"),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("client_movements_client_idx").on(t.clientId)]);

// Avisos internos de la tienda (ej: stock bajo que el empleado reporta al dueño).
export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  type: text("type").notNull().default("low_stock"),
  variantId: integer("variant_id").references(() => productVariants.id),
  productName: text("product_name").notNull(),
  variantName: text("variant_name"),
  message: text("message").notNull(),
  stockAtCreate: integer("stock_at_create"),
  note: text("note"),
  status: text("status").notNull().default("open"), // open | resolved
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedBy: text("resolved_by").references(() => user.id),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [index("notifications_store_status_idx").on(t.storeId, t.status)]);

// Lote de importación pendiente de confirmar.
//
// Las filas validadas se guardan acá en vez de devolverlas al navegador y
// esperar que las reenvíe: una planilla mediana supera los 4.5 MB que Vercel
// acepta por request, y renderizar miles de filas cuelga el navegador. El
// cliente maneja solo un id y un preview acotado.
export const importBatches = pgTable("import_batches", {
  id: text("id").primaryKey(), // crypto.randomUUID()
  storeId: integer("store_id").notNull().references(() => stores.id),
  createdBy: text("created_by").notNull().references(() => user.id),
  source: text("source").notNull(), // excel | ai
  mode: text("mode").notNull(), // absolute | add
  // Output COMPLETO de validateImportRows, con filas erróneas incluidas:
  // executeImport calcula `skipped` a partir de ellas.
  rows: jsonb("rows").$type<ValidatedRow[]>().notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("import_batches_store_status_idx").on(t.storeId, t.status)]);

export type Store = typeof stores.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type ClientAccountMovement = typeof clientAccountMovements.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type CashSession = typeof cashSessions.$inferSelect;
export type CashMovement = typeof cashMovements.$inferSelect;
export type Commission = typeof commissions.$inferSelect;
