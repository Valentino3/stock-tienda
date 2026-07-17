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
