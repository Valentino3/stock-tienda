import {
  pgTable, text, timestamp, boolean, integer, smallint, numeric, jsonb, date, pgEnum, index,
  uniqueIndex, primaryKey, type AnyPgColumn,
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
  // Rubro del comercio. Decide qué muestra la app: navegación, etiquetas y qué
  // atributos de catálogo existen. NUNCA decide cómo se cobra — ver la nota en
  // src/lib/verticals/index.ts.
  //
  // Va acá y no en una tabla aparte como store_fiscal_config: resolveActiveStore
  // ya hace un SELECT sobre stores en CADA request, y el rubro se necesita en
  // el 100% de ellos para armar el shell. La config fiscal se necesita en el 1%.
  //
  // `text` y no pgEnum: agregar un rubro tiene que ser un deploy, no una
  // migración con ALTER TYPE. El conjunto válido lo valida el registro, que
  // ante un valor desconocido cae a 'retail' en vez de romper la pantalla.
  businessType: text("business_type").notNull().default("retail"),
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
// Movimientos de cuenta corriente de un cliente.
//   cargo     — venta a cuenta: suma deuda.
//   pago      — el cliente cancela: resta deuda.
//   anulacion — se anuló la venta que originó un cargo: lo revierte. Es un
//               movimiento propio y no un pago, para que el historial muestre
//               por qué bajó la deuda sin inventar plata que nunca entró.
export const clientMovementTypeEnum = pgEnum("client_movement_type", ["cargo", "pago", "anulacion"]);
export const movementTypeEnum = pgEnum("movement_type", ["venta", "reposicion", "ajuste", "anulacion"]);
// Movimientos de efectivo que SALEN de la caja (restan del esperado al cerrar):
// gasto = compra/pago operativo (empleado); egreso = retiro de efectivo (dueño).
export const cashMovementKindEnum = pgEnum("cash_movement_kind", ["gasto", "egreso"]);

export const products = pgTable("products", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Identidad de un producto dado de alta sin conexión (típicamente en una
  // feria, con mercadería que no estaba en el catálogo). Mismo criterio que
  // sales.uid y clients.uid.
  uid: text("uid"),
  storeId: integer("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  category: text("category"), // texto libre, opcional (agrupar/filtrar catálogo)
  basePrice: numeric("base_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  /**
   * Si es false, vender este producto NO mueve stock: no descuenta, no lo
   * frena el guard de existencias y no aparece en los avisos de stock bajo.
   *
   * Es lo que permite vender algo que no se cuenta por unidades: un plato, una
   * hora de trabajo, un recargo por delivery, el cubierto. La alternativa
   * —hacer `sale_items.variantId` nullable— convertía seis innerJoin en
   * leftJoin y volvía normal el descarte silencioso de líneas que hoy es
   * imposible. Un menú ES un catálogo: el plato necesita precio, búsqueda,
   * reportes y descripción en la factura.
   *
   * `stock` y `lowStockThreshold` siguen existiendo en la fila con sus
   * defaults; simplemente nadie los mira.
   */
  tracksStock: boolean("tracks_stock").notNull().default(true),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("products_store_idx").on(t.storeId),
  // Filtro por categoría en el inventario.
  index("products_store_category_idx").on(t.storeId, t.category),
  // Reenviar el mismo lote de sincronización no puede crear el producto dos veces.
  uniqueIndex("products_store_uid_idx").on(t.storeId, t.uid),
]);

export const productVariants = pgTable("product_variants", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Ver products.uid. Las ventas offline de un producto nuevo referencian la
  // variante por acá, porque su id lo asigna el servidor al sincronizar.
  uid: text("uid"),
  storeId: integer("store_id").notNull().references(() => stores.id),
  productId: integer("product_id").notNull().references(() => products.id),
  // '' para la variante default de productos sin variantes reales (UI la oculta)
  name: text("name").notNull().default(""),
  sku: text("sku"),
  stock: integer("stock").notNull().default(0),
  price: numeric("price", { precision: 12, scale: 2, mode: "number" }), // null => hereda basePrice
  // Listas de precio alternativas. Solo informativas: la venta siempre usa el
  // precio de venta (price ?? basePrice). Sirven para consultar al revisar el
  // inventario, que es como las usa el comercio.
  priceCash: numeric("price_cash", { precision: 12, scale: 2, mode: "number" }), // "efectivo menor"
  priceWholesale: numeric("price_wholesale", { precision: 12, scale: 2, mode: "number" }),
  // Costos de reposición. Se guardan tal cual los carga el comercio: costArs NO
  // se recalcula desde costUsd, porque cada compra se cerró a una cotización
  // distinta y recalcular pisaría el dato real.
  costUsd: numeric("cost_usd", { precision: 12, scale: 2, mode: "number" }),
  costArs: numeric("cost_ars", { precision: 12, scale: 2, mode: "number" }),
  supplier: text("supplier"),
  supplierSku: text("supplier_sku"),
  active: boolean("active").notNull().default(true),
  setName: text("set_name"),
  condition: text("condition"),
  foil: boolean("foil").notNull().default(false),
  language: text("language"),
  // SKU único POR TIENDA (no global): dos tiendas pueden reusar el mismo SKU.
  // sku null se permite repetido (Postgres trata NULL como distinto).
}, (t) => [
  uniqueIndex("product_variants_store_sku_idx").on(t.storeId, t.sku),
  // El join de la tabla de inventario entra por acá: sin este índice, cada
  // consulta con filtros escanea product_variants entera.
  index("product_variants_product_id_idx").on(t.productId),
  // Filtros del inventario. Todos arrancan por store_id porque toda consulta
  // está scopeada por tienda.
  index("product_variants_store_active_idx").on(t.storeId, t.active),
  index("product_variants_store_stock_idx").on(t.storeId, t.stock),
  index("product_variants_store_supplier_idx").on(t.storeId, t.supplier),
  uniqueIndex("product_variants_store_uid_idx").on(t.storeId, t.uid),
]);

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
  // Clave de idempotencia generada por el navegador (crypto.randomUUID) al
  // armar el carrito. Si la respuesta de submitSale se pierde por un corte de
  // red, el vendedor reintenta con el MISMO uid y createSale devuelve la venta
  // que ya había entrado en vez de cobrar dos veces. null para las ventas
  // anteriores a esta columna y para cualquier alta que no venga del mostrador.
  uid: text("uid"),
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
}, (t) => [
  index("sales_store_idx").on(t.storeId),
  // Backstop en DB de la idempotencia: dos submits con el mismo uid no pueden
  // producir dos ventas ni aunque corran en paralelo. No necesita cláusula
  // WHERE porque Postgres trata cada NULL como distinto, así que las ventas
  // sin uid conviven sin chocar (mismo criterio que product_variants.sku).
  uniqueIndex("sales_store_uid_idx").on(t.storeId, t.uid),
]);

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
//
// Los campos fiscales son TODOS nullable y sin default a propósito: `null`
// significa "sin datos fiscales cargados", que es un estado distinto de
// "declaró ser Consumidor Final" aunque los dos terminen en Factura B. Poner
// default 5 en condicionIva fabricaría una declaración que el comercio nunca
// hizo. Ver src/domain/fiscal-comprobante.ts (resolverReceptor).
export const clients = pgTable("clients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  // Identidad estable de un cliente dado de alta sin conexión: el dispositivo
  // no puede conocer el id que va a asignar la secuencia, así que las ventas
  // offline lo referencian por uid y el replay lo resuelve al sincronizar.
  // Mismo criterio que sales.uid.
  uid: text("uid"),
  name: text("name").notNull(),
  phone: text("phone"),
  // Para mandarle el comprobante. Opcional: el teléfono ya alcanza para
  // WhatsApp, y pedir el mail en el mostrador es fricción que casi nadie paga.
  email: text("email"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Códigos de ARCA. Ver src/domain/fiscal-catalogs.ts.
  docTipo: smallint("doc_tipo"), // 80 CUIT | 86 CUIL | 96 DNI | 99 Consumidor Final
  // text, no numérico: preserva ceros a la izquierda y tolera carga parcial.
  // La validación (mod-11 del CUIT) vive en el dominio, para que un dato malo
  // sea un error legible en castellano y no un 23514 de Postgres.
  docNro: text("doc_nro"),
  condicionIva: smallint("condicion_iva"), // CondicionIVAReceptorId: 1 RI | 4 Exento | 5 CF | 6 Monotributo
  razonSocial: text("razon_social"), // null => se usa `name`
  domicilio: text("domicilio"),
}, (t) => [
  index("clients_store_idx").on(t.storeId),
  // Buscar cliente por CUIT/DNI al facturar. NO único: los duplicados de carga
  // son reales y una restricción única rompería createClient.
  index("clients_store_doc_idx").on(t.storeId, t.docNro),
  // Sí único, a diferencia del índice de documento: reenviar el mismo lote de
  // sincronización no puede crear dos veces el mismo cliente. Los NULL no
  // chocan entre sí, así que las altas normales no se ven afectadas.
  uniqueIndex("clients_store_uid_idx").on(t.storeId, t.uid),
]);

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

// ---- facturación electrónica ARCA (ex-AFIP) ----
//
// NOTA SOBRE LOS CÓDIGOS DE ARCA (docTipo, cbteTipo, ivaId, condicionIva):
// van como `smallint` con el valor literal de ARCA, NO como pgEnum. Son valores
// de cable de un tercero: un pgEnum obligaría a un `ALTER TYPE ... ADD VALUE`
// en archivo de migración propio cada vez que ARCA agrega un código o sumemos
// Factura C. El módulo src/domain/fiscal-catalogs.ts da la seguridad de tipos
// con uniones de TS y cero costo de migración.
//
// Los enums de acá abajo son estados que inventamos nosotros: conjuntos
// cerrados que controlamos, y por eso sí son pgEnum.

export const arcaAmbienteEnum = pgEnum("arca_ambiente", ["homologacion", "produccion"]);
export const comprobanteClaseEnum = pgEnum("comprobante_clase", ["factura", "nota_credito"]);
// Estado de un comprobante. La semántica es load-bearing para la numeración:
//   pendiente  — número reservado, request en vuelo o resultado no registrado.
//                NÚMERO CONSUMIDO.
//   autorizado — ARCA otorgó CAE. Fila inmutable. NÚMERO CONSUMIDO.
//   rechazado  — ARCA respondió Resultado = R. ARCA NO avanzó su numeración,
//                así que EL NÚMERO QUEDA LIBRE y el reintento lo reusa.
//   error      — falla de transporte / timeout / respuesta ilegible. NO sabemos
//                si ARCA consumió el número: bloquea el reuso hasta que
//                reconciliarComprobante() lo resuelva con FECompConsultar.
export const comprobanteEstadoEnum = pgEnum("comprobante_estado", [
  "pendiente", "autorizado", "rechazado", "error",
]);

// Config fiscal por tienda. Tabla aparte y no columnas en `stores` porque
// resolveActiveStore() (src/lib/session.ts) hace SELECT sobre stores en CADA
// request: no queremos arrastrar config fiscal ahí, ni serializar caminos no
// relacionados cuando la numeración toma locks. Además es 1:1 opcional: la
// mayoría de las tiendas nunca factura.
export const storeFiscalConfig = pgTable("store_fiscal_config", {
  storeId: integer("store_id").primaryKey().references(() => stores.id),
  cuit: text("cuit").notNull(), // 11 dígitos, sin guiones
  razonSocial: text("razon_social").notNull(),
  nombreFantasia: text("nombre_fantasia"),
  domicilio: text("domicilio").notNull(),
  condicionIva: smallint("condicion_iva").notNull().default(1), // emisor: 1 = Responsable Inscripto
  ingresosBrutos: text("ingresos_brutos"),
  inicioActividades: date("inicio_actividades", { mode: "string" }),
  puntoVenta: integer("punto_venta").notNull(),
  ambiente: arcaAmbienteEnum("ambiente").notNull().default("homologacion"),
  // Alícuota por defecto de toda línea. Es la costura multi-alícuota: cuando se
  // agregue products.ivaId solo cambia ivaIdForLine, no la matemática de
  // importes. Un comercio de una sola alícuota no debe tocar 3000 productos.
  defaultIvaId: smallint("default_iva_id").notNull().default(5), // 5 = 21%
  // Monto a partir del cual ARCA exige identificar al comprador. Queda en NULL
  // (permisivo) a propósito: el número de la RG se mueve y hardcodearlo haría
  // que una constante vieja bloquee facturación legítima. Lo fija el contador.
  umbralConsumidorFinal: numeric("umbral_consumidor_final", { precision: 12, scale: 2, mode: "number" }),
  empleadosPuedenEmitir: boolean("empleados_pueden_emitir").notNull().default(false),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Certificado X.509 + clave privada de ARCA, cifrados (AES-256-GCM, ver
// src/lib/crypto/secret-box.ts). Keyeada por ambiente porque homologación y
// producción son certificados DISTINTOS que tienen que coexistir: cambiar de
// ambiente no puede destruir el otro.
export const arcaCredentials = pgTable("arca_credentials", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  ambiente: arcaAmbienteEnum("ambiente").notNull(),
  certPemEnc: text("cert_pem_enc").notNull(),
  keyPemEnc: text("key_pem_enc").notNull(),
  // Metadatos derivados del cert al subirlo. Son lo ÚNICO que la UI puede leer:
  // getFiscalConfigSummary() no selecciona nunca las columnas *_enc.
  certSubject: text("cert_subject"),
  certCuit: text("cert_cuit"),
  certExpiresAt: timestamp("cert_expires_at"),
  certFingerprint: text("cert_fingerprint"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("arca_credentials_store_ambiente_idx").on(t.storeId, t.ambiente)]);

// Cache del Ticket de Acceso (TA) de WSAA.
//
// WSAA devuelve un ticket que dura 12 h y RECHAZA pedir otro mientras haya uno
// válido ("El CEE ya posee un TA valido para el acceso al WSN solicitado"). En
// serverless no hay memoria compartida entre invocaciones y el filesystem de
// Vercel no persiste, así que el TA TIENE que vivir acá.
//
// La fila ES el recurso, no un log: la regla de ARCA "un TA válido por (CUIT,
// servicio)" es exactamente un slot mutable. Upsert, nunca append.
export const arcaAccessTickets = pgTable("arca_access_tickets", {
  storeId: integer("store_id").notNull().references(() => stores.id),
  ambiente: arcaAmbienteEnum("ambiente").notNull(),
  service: text("service").notNull().default("wsfe"),
  cuit: text("cuit").notNull(),
  // Cifrados: son credenciales bearer de 12 h. Quien los tenga puede emitir
  // comprobantes fiscales a nombre del contribuyente.
  token: text("token").notNull(),
  sign: text("sign").notNull(),
  generatedAt: timestamp("generated_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  // Lease del login WSAA en curso. Es un lease y no un advisory lock porque un
  // advisory lock mantendría una transacción de Postgres abierta durante una
  // llamada HTTP de varios segundos a un endpoint del Estado.
  lockedUntil: timestamp("locked_until"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.storeId, t.ambiente, t.service] })]);

// Una línea del comprobante, congelada al emitir.
export type ComprobanteLinea = {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoLinea: number;
  netoAsignado: number; // bruto de línea ya neto del descuento general prorrateado
  ivaId: number;
  baseImp: number;
  importeIva: number;
};

export type IvaDesgloseItem = { id: number; baseImp: number; importe: number };
export type ComprobanteObservacion = { code: number; msg: string };

// El comprobante fiscal. 1:N con sales: una venta puede tener una factura y
// después una nota de crédito.
export const comprobantes = pgTable("comprobantes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storeId: integer("store_id").notNull().references(() => stores.id),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  // Solo link de reporte. OJO: NO escribir sales.clientId al facturar — esa
  // columna significa "cliente de cuenta corriente" y getClientLedger/voidSale
  // dependen de ella; escribirla en una venta en efectivo inyectaría una compra
  // fantasma en la cuenta corriente sin cargo que la respalde.
  clientId: integer("client_id").references(() => clients.id),
  clase: comprobanteClaseEnum("clase").notNull(),
  cbteTipo: smallint("cbte_tipo").notNull(), // 1 FA A | 6 FA B | 3 NC A | 8 NC B
  // Participa del scope de numeración: homologación y producción son secuencias
  // SEPARADAS en ARCA. Sin esta columna, pasar una tienda a producción
  // calcularía el siguiente número desde filas de homologación y ARCA
  // rechazaría todo por no correlativo.
  ambiente: arcaAmbienteEnum("ambiente").notNull(),
  ptoVta: integer("pto_vta").notNull(),
  numero: integer("numero").notNull(), // CbteDesde = CbteHasta
  estado: comprobanteEstadoEnum("estado").notNull().default("pendiente"),

  // Receptor: SNAPSHOT inmutable. El cliente puede editarse después; un
  // comprobante emitido no puede cambiar.
  docTipo: smallint("doc_tipo").notNull(),
  docNro: text("doc_nro").notNull(), // "0" para Consumidor Final
  condIvaReceptor: smallint("cond_iva_receptor").notNull(),
  receptorNombre: text("receptor_nombre").notNull(),
  receptorDomicilio: text("receptor_domicilio"),

  impTotal: numeric("imp_total", { precision: 12, scale: 2, mode: "number" }).notNull(),
  impNeto: numeric("imp_neto", { precision: 12, scale: 2, mode: "number" }).notNull(),
  impIva: numeric("imp_iva", { precision: 12, scale: 2, mode: "number" }).notNull(),
  impTotConc: numeric("imp_tot_conc", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  impOpEx: numeric("imp_op_ex", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  impTrib: numeric("imp_trib", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  ivaDesglose: jsonb("iva_desglose").$type<IvaDesgloseItem[]>().notNull(),
  // OBLIGATORIA, no un lujo: FECAESolicitar es solo cabecera y NO lleva detalle
  // de ítems, y sale_items no guarda snapshot del nombre del producto. Sin esto,
  // reimprimir una factura de hace 6 meses haría join con products.name vivo y
  // reescribiría en silencio un documento fiscal ya emitido.
  lineas: jsonb("lineas").$type<ComprobanteLinea[]>().notNull(),

  // mode:"string" => 'YYYY-MM-DD' sin corrimiento de UTC al leer. La fecha se
  // calcula UNA vez al emitir, en hora de Argentina (ver fechaArca()).
  cbteFch: date("cbte_fch", { mode: "string" }).notNull(),
  // Token para el link público del comprobante (/c/<token>), el que se le manda
  // al cliente por WhatsApp o por mail.
  //
  // Se guarda en columna y no se deriva por HMAC del id para que se pueda
  // REVOCAR: si un link se filtró, se regenera el token y el viejo deja de
  // servir. 32 bytes al azar en base64url — adivinarlo no es una amenaza real, y
  // lo único que expone es ese comprobante.
  publicToken: text("public_token"),
  cae: text("cae"),
  caeVto: date("cae_vto", { mode: "string" }),
  resultado: text("resultado"), // 'A' | 'P' | 'R' crudo de ARCA
  // Obs Y Errors unificados: un comprobante puede salir APROBADO con
  // observaciones, así que las dos listas importan.
  observaciones: jsonb("observaciones").$type<ComprobanteObservacion[]>(),
  errorMsg: text("error_msg"),
  intentos: integer("intentos").notNull().default(0),
  autorizadoAt: timestamp("autorizado_at"),

  // NC -> factura que anula. Auto-referencia: drizzle exige anotar el tipo de
  // retorno para cortar la inferencia circular.
  cbteAsocId: integer("cbte_asoc_id").references((): AnyPgColumn => comprobantes.id),
  cuitEmisor: text("cuit_emisor").notNull(), // snapshot
  // Payload EXACTO enviado, con Token/Sign REDACTADOS: son credenciales bearer
  // de 12 h y esta columna se exporta y se respalda.
  requestJson: jsonb("request_json"),
  responseJson: jsonb("response_json"),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("comprobantes_sale_idx").on(t.saleId),
  index("comprobantes_store_fch_idx").on(t.storeId, t.cbteFch), // libro IVA ventas
  // Entrada de la ruta pública. Único: dos comprobantes no pueden compartir link.
  uniqueIndex("comprobantes_public_token_idx").on(t.publicToken),
]);

// NOTA: además de los índices de arriba existen tres índices PARCIALES escritos
// a mano en drizzle/0015_comprobantes_indices.sql, que drizzle-kit no modela
// (mismo caso que cash_sessions_one_open_idx, ver el comentario más arriba):
//
//   comprobantes_numero_uq      UNIQUE (store,ambiente,ptoVta,cbteTipo,numero)
//                               WHERE estado <> 'rechazado'
//                               — un número vivo por secuencia; un rechazo lo libera.
//   comprobantes_sale_clase_uq  UNIQUE (saleId, clase)
//                               WHERE estado IN ('pendiente','autorizado')
//                               — backstop de DB contra el doble clic, aunque
//                                 falle el advisory lock. El dominio atrapa el
//                                 23505 igual que openCashSession.
//   comprobantes_reconciliar_idx (storeId) WHERE estado IN ('pendiente','error')
//
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
export type StoreFiscalConfig = typeof storeFiscalConfig.$inferSelect;
export type ArcaCredentials = typeof arcaCredentials.$inferSelect;
export type ArcaAccessTicket = typeof arcaAccessTickets.$inferSelect;
export type Comprobante = typeof comprobantes.$inferSelect;
export type NuevoComprobante = typeof comprobantes.$inferInsert;
export type ArcaAmbiente = (typeof arcaAmbienteEnum.enumValues)[number];
export type ComprobanteClase = (typeof comprobanteClaseEnum.enumValues)[number];
export type ComprobanteEstado = (typeof comprobanteEstadoEnum.enumValues)[number];
