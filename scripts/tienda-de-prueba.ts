import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Crea (o refresca) una tienda de PRUEBA en la misma base que las reales.
 *
 * Para qué: verificar un deploy contra la infraestructura de verdad —Neon, el
 * navegador del mostrador, la impresora, el lector de códigos— sin ensuciar los
 * datos de un local que vende todos los días. Es lo que hasta ahora se hacía
 * vendiendo en ZTG y después acordándose de anular.
 *
 * Por qué es seguro compartir la base:
 *   - La app es multi-tienda por `storeId` y toda consulta de dominio está
 *     scopeada. Los tests de aislamiento lo cubren desde hace meses.
 *   - La tienda queda marcada con `es_prueba`, que además BLOQUEA emitir en
 *     ambiente producción (ver requireFiscalConfig). Homologación sí: es donde
 *     conviene probar el camino fiscal.
 *   - El dueño de prueba es un usuario aparte, con su propio mail. Nadie entra
 *     a la tienda de prueba desde la sesión de su local.
 *
 * ⚠️ Este script NO borra nada. Es idempotente: si la tienda ya existe, la
 * reusa y completa lo que falte. Para vaciarla está `reset:prueba`.
 *
 * Uso:
 *   OWNER_PASSWORD=... npm run seed:prueba
 *   OWNER_PASSWORD=... RUBRO=gastronomia STORE_SLUG=prueba-resto npm run seed:prueba
 */

const SLUG = process.env.STORE_SLUG ?? "prueba";
const RUBRO = process.env.RUBRO ?? "retail";
const EMAIL = process.env.OWNER_EMAIL ?? `duenio@${SLUG}.test`;

/** Catálogo chico pero realista: alcanza para probar búsqueda, listas y stock. */
const CATALOGO = [
  { nombre: "Sobre Booster", sku: "PRB-SOBRE", precio: 9500, usd: 6.5, stock: 40, efectivo: 8600 },
  { nombre: "Caja Display", sku: "PRB-CAJA", precio: 162800, usd: 110, stock: 6, efectivo: 148000 },
  { nombre: "Fundas x100", sku: "PRB-FUNDA", precio: 6200, usd: 4.2, stock: 25, efectivo: 5600 },
  { nombre: "Carta suelta", sku: "PRB-CARTA", precio: 3000, usd: null, stock: 100, efectivo: null },
  // Sin stock a propósito: es el caso que hay que poder reproducir a mano.
  { nombre: "Agotado de prueba", sku: "PRB-CERO", precio: 1000, usd: null, stock: 0, efectivo: null },
];

const PLATOS = [
  { nombre: "Milanesa con papas", precio: 12000 },
  { nombre: "Café", precio: 2500 },
  { nombre: "Gaseosa", precio: 3000 },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(2);
  }
  const password = process.env.OWNER_PASSWORD;
  if (!password || password.length < 8) {
    console.error("Falta OWNER_PASSWORD (mínimo 8 caracteres).");
    process.exit(2);
  }

  // Dynamic imports: los estáticos se hoistean y evaluarían src/db antes de
  // que dotenv haya cargado DATABASE_URL. Mismo motivo que en seed-store.ts.
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { user, stores, products, productVariants, clients, diningTables } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");

  // ---- la tienda ----
  let [store] = await db.select().from(stores).where(eq(stores.slug, SLUG));
  if (store && !store.esPrueba) {
    // Guarda dura: si el slug ya lo usa una tienda REAL, no se toca nada. Es la
    // diferencia entre poblar una tienda de prueba y meterle productos falsos
    // al catálogo de un local que vende.
    console.error(
      `La tienda "${SLUG}" ya existe y NO está marcada como de prueba.\n` +
      `No se tocó nada. Usá otro STORE_SLUG.`
    );
    process.exit(1);
  }
  if (!store) {
    [store] = await db.insert(stores)
      .values({ name: `PRUEBA — ${RUBRO}`, slug: SLUG, businessType: RUBRO, esPrueba: true })
      .returning();
    console.log(`Tienda creada: ${store.name} (#${store.id}, ${SLUG})`);
  } else {
    console.log(`Tienda ya existente: ${store.slug} (#${store.id})`);
  }

  // ---- el dueño ----
  const [existente] = await db.select().from(user).where(eq(user.email, EMAIL));
  if (existente) {
    console.log(`Dueño ya existente: ${EMAIL}`);
  } else {
    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(password);
    await ctx.internalAdapter.createUser({ email: EMAIL, name: "Dueño de prueba", emailVerified: true });
    const [u] = await db.select().from(user).where(eq(user.email, EMAIL));
    await ctx.internalAdapter.linkAccount({
      userId: u.id, providerId: "credential", accountId: u.id, password: hashed,
    });
    await db.update(user).set({ role: "owner", storeId: store.id }).where(eq(user.id, u.id));
    console.log(`Dueño creado: ${EMAIL}`);
  }

  // ---- catálogo ----
  // Idempotente por SKU: correrlo de nuevo no duplica ni pisa precios que
  // hayas cambiado a mano probando.
  const gastro = RUBRO === "gastronomia";
  let creados = 0;

  for (const p of gastro ? [] : CATALOGO) {
    const [ya] = await db.select().from(productVariants)
      .where(and(eq(productVariants.storeId, store.id), eq(productVariants.sku, p.sku)));
    if (ya) continue;
    const [prod] = await db.insert(products)
      .values({ storeId: store.id, name: p.nombre, basePrice: p.precio, basePriceUsd: p.usd })
      .returning();
    await db.insert(productVariants).values({
      storeId: store.id, productId: prod.id, name: "", sku: p.sku,
      stock: p.stock, priceCash: p.efectivo,
    });
    creados++;
  }

  for (const p of gastro ? PLATOS : []) {
    const [ya] = await db.select().from(products)
      .where(and(eq(products.storeId, store.id), eq(products.name, p.nombre)));
    if (ya) continue;
    const [prod] = await db.insert(products)
      .values({ storeId: store.id, name: p.nombre, basePrice: p.precio, tracksStock: false })
      .returning();
    await db.insert(productVariants)
      .values({ storeId: store.id, productId: prod.id, name: "", stock: 0 });
    creados++;
  }
  if (creados) console.log(`${creados} producto(s) cargado(s).`);

  // ---- un cliente, para probar fiado y saldo a favor ----
  const [hayCliente] = await db.select().from(clients).where(eq(clients.storeId, store.id));
  if (!hayCliente) {
    await db.insert(clients).values({ storeId: store.id, name: "Cliente de prueba" });
    console.log("Cliente de prueba creado.");
  }

  // ---- mesas, solo gastronomía ----
  if (gastro) {
    const [hayMesa] = await db.select().from(diningTables).where(eq(diningTables.storeId, store.id));
    if (!hayMesa) {
      await db.insert(diningTables).values(
        [1, 2, 3, 4].map((n) => ({ storeId: store.id, name: String(n), sector: "Salón", capacity: 4 }))
      );
      console.log("4 mesas creadas.");
    }
  }

  console.log(`\nListo. Entrá con ${EMAIL} y vas a ver la banda de TIENDA DE PRUEBA.`);
  console.log("Facturar en producción está bloqueado para esta tienda; homologación funciona.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
