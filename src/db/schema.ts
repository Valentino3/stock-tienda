import {
  pgTable, text, timestamp, boolean, integer, numeric, pgEnum, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  role: text("role"), // 'owner' | 'employee' (default "employee" aplicado por better-auth)
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
  setName: text("set_name"),
  condition: text("condition"),
  foil: boolean("foil").notNull().default(false),
  language: text("language"),
});

// NOTA: existe además un índice único parcial `cash_sessions_one_open_idx`
// (migración 0002_cash_sessions_one_open_idx.sql) que garantiza a nivel de DB
// que como máximo una fila tenga `closed_at IS NULL`. No se modela con
// drizzle-kit porque requiere un índice sobre una expresión constante
// `(1) WHERE closed_at IS NULL` (un índice único sobre la columna
// `closed_at` filtrado por `IS NULL` NO sirve: Postgres trata cada NULL como
// distinto en un índice único, así que no bloquearía duplicados). Ver
// `src/domain/cash.ts` (openCashSession) para el manejo del error de
// violación de unicidad.
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
