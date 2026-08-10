import { config } from "dotenv";
config({ path: ".env.e2e" });

/**
 * Prepara la base de los tests de navegador: migraciones + una tienda
 * gastronómica y una de retail, cada una con su dueño, su carta y sus mesas.
 *
 * Corre contra el Postgres de Docker, NUNCA contra Neon. La guarda de abajo es
 * en serio: este script borra tablas enteras, y apuntarlo por accidente a
 * producción vaciaría los dos locales que venden todos los días.
 */

const CREDENCIALES = {
  gastro: { email: "resto@test.local", password: "test1234", slug: "resto-test" },
  retail: { email: "cartas@test.local", password: "test1234", slug: "cartas-test" },
};

function verificarQueEsBaseDeTest(url: string) {
  const esLocal = /(@|\/\/)(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  if (!esLocal) {
    throw new Error(
      `DATABASE_URL no parece una base local: ${url.replace(/:[^:@]*@/, ":***@")}\n` +
      "El seed de E2E borra tablas enteras. Solo corre contra el Postgres de Docker.",
    );
  }
  if (process.env.DB_DRIVER !== "pg") {
    throw new Error("Falta DB_DRIVER=pg. Sin eso la app hablaría por el driver de Neon.");
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL. ¿Existe .env.e2e?");
  verificarQueEsBaseDeTest(url);

  // Dynamic imports: los static imports se hoistean y evaluarían src/db/index.ts
  // (que lee process.env) antes de que dotenv haya cargado nada.
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { eq, sql } = await import("drizzle-orm");

  // drizzle-kit es devDependency y no está en el runtime del contenedor de CI;
  // el migrador de drizzle-orm lee el mismo _journal.json y hace la misma
  // contabilidad, incluidas las migraciones escritas a mano.
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  console.log("Migraciones aplicadas.");

  // Vaciado en orden inverso de dependencias. TRUNCATE ... CASCADE reinicia
  // además las secuencias, para que los ids sean estables entre corridas y un
  // test pueda afirmar "venta #1" sin depender de cuántas veces se corrió.
  await db.execute(sql`
    truncate table
      ${schema.orderItems}, ${schema.orders}, ${schema.diningTables},
      ${schema.comprobantes}, ${schema.saleItems}, ${schema.stockMovements},
      ${schema.clientAccountMovements}, ${schema.sales}, ${schema.cashMovements},
      ${schema.cashSessions}, ${schema.notifications}, ${schema.commissions},
      ${schema.importBatches}, ${schema.productVariants}, ${schema.products},
      ${schema.clients}, ${schema.storeFiscalConfig}, ${schema.arcaCredentials},
      ${schema.arcaAccessTickets}, ${schema.session}, ${schema.account},
      ${schema.user}, ${schema.stores}
    restart identity cascade
  `);
  console.log("Base vaciada.");

  const ctx = await auth.$context;

  async function crearTienda(opts: {
    nombre: string; slug: string; rubro: "retail" | "gastronomia";
    email: string; password: string;
  }) {
    const [store] = await db.insert(schema.stores)
      .values({ name: opts.nombre, slug: opts.slug, businessType: opts.rubro })
      .returning();

    await ctx.internalAdapter.createUser({ email: opts.email, name: "Dueño", emailVerified: true });
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, opts.email));
    await ctx.internalAdapter.linkAccount({
      userId: u.id, providerId: "credential", accountId: u.id,
      password: await ctx.password.hash(opts.password),
    });
    await db.update(schema.user).set({ role: "owner", storeId: store.id })
      .where(eq(schema.user.id, u.id));

    return store;
  }

  // ---- restaurante ----
  const resto = await crearTienda({
    nombre: "Resto de Prueba", slug: CREDENCIALES.gastro.slug, rubro: "gastronomia",
    email: CREDENCIALES.gastro.email, password: CREDENCIALES.gastro.password,
  });

  // Platos: sin control de stock, que es el default del rubro.
  const carta = [
    { nombre: "Milanesa napolitana", precio: 8000 },
    { nombre: "Ensalada César", precio: 6500 },
    { nombre: "Flan casero", precio: 3000 },
  ];
  for (const p of carta) {
    const [prod] = await db.insert(schema.products)
      .values({ storeId: resto.id, name: p.nombre, basePrice: p.precio, tracksStock: false })
      .returning();
    await db.insert(schema.productVariants)
      .values({ storeId: resto.id, productId: prod.id, name: "", stock: 0 });
  }

  // La bebida SÍ lleva stock: es lo que permite testear el carrito mixto y que
  // el descuento de stock siga andando en un restaurante.
  const [vino] = await db.insert(schema.products)
    .values({ storeId: resto.id, name: "Vino", basePrice: 12000, tracksStock: true })
    .returning();
  await db.insert(schema.productVariants)
    .values({ storeId: resto.id, productId: vino.id, name: "Malbec", stock: 24 });

  for (const sector of ["Salón", "Terraza"]) {
    for (const n of [1, 2, 3]) {
      await db.insert(schema.diningTables)
        .values({ storeId: resto.id, name: String(n), sector, capacity: 4 });
    }
  }

  await db.insert(schema.clients)
    .values({ storeId: resto.id, name: "Cliente Fiado", active: true });

  // ---- comercio de cartas, para el camino de mostrador con stock ----
  const cartas = await crearTienda({
    nombre: "Cartas de Prueba", slug: CREDENCIALES.retail.slug, rubro: "retail",
    email: CREDENCIALES.retail.email, password: CREDENCIALES.retail.password,
  });
  const [remera] = await db.insert(schema.products)
    .values({ storeId: cartas.id, name: "Sobre Pokémon", basePrice: 5000, lowStockThreshold: 3 })
    .returning();
  await db.insert(schema.productVariants)
    .values({ storeId: cartas.id, productId: remera.id, name: "", sku: "SOBRE-1", stock: 10 });

  await sembrarCatalogoDeCartas(db, schema, cartas.id);

  console.log("\nListo. Tiendas de prueba:");
  console.table([
    { rubro: "gastronomía", ...CREDENCIALES.gastro },
    { rubro: "retail", ...CREDENCIALES.retail },
  ]);
}

/**
 * Catálogo de cartas para que las pantallas se vean como en un local de verdad.
 *
 * Existe para las capturas del manual de usuario: con un solo producto,
 * /productos sale con una fila y no deja ver ni las columnas de atributos ni
 * los filtros ni la franja alterna, y /reportes no muestra nada.
 *
 * ⚠️ SOLO PRODUCTOS. Ni una venta, ni un movimiento de caja, ni un cliente con
 * saldo. Los specs de plata afirman montos exactos de arqueo —por ejemplo
 * `expect(arqueo.esperado).toBe(14500)` en cuenta-dividida.spec.ts— así que
 * una venta de más acá rompe tres tests, y el fallo aparece como "la caja no
 * cuadra": exactamente el síntoma que esos tests existen para detectar.
 *
 * Tampoco se toca "Sobre Pokémon": venta-mostrador.spec.ts lo busca por
 * `/sobre pok/i` y le pone el stock en cero. Ningún nombre de acá matchea eso.
 */
// `db` y `schema` entran por parámetro y no por import: los imports de este
// archivo son dinámicos a propósito, para que dotenv cargue antes de que
// src/db/index.ts lea process.env (ver el comentario en main).
async function sembrarCatalogoDeCartas(db: any, schema: any, storeId: number) {
  // stock 0 y 2 a propósito: dan las tres columnas de estado (sin stock,
  // stock bajo, con stock) y hacen que /reportes tenga algo que mostrar.
  const CARTAS: {
    nombre: string;
    categoria: string;
    precio: number;
    umbral?: number;
    promo?: boolean;
    variantes: {
      nombre: string; sku: string; stock: number;
      precio?: number; costo?: number; efectivo?: number; mayorista?: number;
      set?: string; cond?: string; idioma?: string; foil?: boolean;
      proveedor?: string;
    }[];
  }[] = [
    {
      nombre: "Charizard", categoria: "Pokémon", precio: 185000, umbral: 2,
      variantes: [
        { nombre: "Base Set · NM · Inglés", sku: "PKM-CHA-BS-NM-EN", stock: 1, precio: 240000, costo: 150000, set: "Base Set", cond: "Near Mint", idioma: "Inglés", foil: true, proveedor: "Distribuidora Norte" },
        { nombre: "Base Set · Played · Español", sku: "PKM-CHA-BS-PL-ES", stock: 3, precio: 96000, costo: 60000, set: "Base Set", cond: "Played", idioma: "Español", proveedor: "Distribuidora Norte" },
      ],
    },
    {
      nombre: "Pikachu", categoria: "Pokémon", precio: 12000,
      variantes: [
        { nombre: "Jungle · NM · Inglés", sku: "PKM-PIK-JU-NM-EN", stock: 14, costo: 7000, set: "Jungle", cond: "Near Mint", idioma: "Inglés", proveedor: "Distribuidora Norte" },
        { nombre: "Jungle · LP · Japonés", sku: "PKM-PIK-JU-LP-JP", stock: 2, precio: 9500, costo: 5200, set: "Jungle", cond: "Lightly Played", idioma: "Japonés" },
      ],
    },
    {
      nombre: "Blastoise", categoria: "Pokémon", precio: 74000,
      variantes: [{ nombre: "Base Set · NM · Inglés", sku: "PKM-BLA-BS-NM-EN", stock: 4, costo: 46000, set: "Base Set", cond: "Near Mint", idioma: "Inglés", foil: true }],
    },
    {
      nombre: "Black Lotus", categoria: "Magic", precio: 980000, umbral: 1,
      variantes: [{ nombre: "Unlimited · MP · Inglés", sku: "MTG-BLO-UN-MP-EN", stock: 1, costo: 720000, set: "Unlimited", cond: "Moderately Played", idioma: "Inglés", proveedor: "Cardhaus" }],
    },
    {
      nombre: "Lightning Bolt", categoria: "Magic", precio: 4500,
      variantes: [
        { nombre: "Revised · NM · Inglés", sku: "MTG-LBO-RE-NM-EN", stock: 32, costo: 2400, efectivo: 4200, mayorista: 3400, set: "Revised", cond: "Near Mint", idioma: "Inglés", proveedor: "Cardhaus" },
        { nombre: "Revised · NM · Italiano", sku: "MTG-LBO-RE-NM-IT", stock: 0, precio: 5200, costo: 2900, set: "Revised", cond: "Near Mint", idioma: "Italiano" },
      ],
    },
    {
      nombre: "Counterspell", categoria: "Magic", precio: 3200,
      variantes: [{ nombre: "Ice Age · LP · Inglés", sku: "MTG-CSP-IA-LP-EN", stock: 18, costo: 1500, set: "Ice Age", cond: "Lightly Played", idioma: "Inglés", proveedor: "Cardhaus" }],
    },
    {
      nombre: "Dark Magician", categoria: "Yu-Gi-Oh!", precio: 28000,
      variantes: [{ nombre: "LOB · NM · Inglés", sku: "YGO-DMA-LOB-NM-EN", stock: 6, costo: 16000, set: "Legend of Blue Eyes", cond: "Near Mint", idioma: "Inglés", foil: true }],
    },
    {
      nombre: "Blue-Eyes White Dragon", categoria: "Yu-Gi-Oh!", precio: 42000, umbral: 2,
      variantes: [{ nombre: "LOB · NM · Español", sku: "YGO-BEW-LOB-NM-ES", stock: 2, costo: 25000, set: "Legend of Blue Eyes", cond: "Near Mint", idioma: "Español" }],
    },
    {
      // En promo y con las tres listas: es el producto que deja ver el
      // selector del carrito y el badge de la tabla sin cargar nada a mano.
      nombre: "Caja de sobres Scarlet & Violet", categoria: "Pokémon", precio: 145000, promo: true,
      variantes: [{ nombre: "", sku: "PKM-BOX-SV", stock: 7, costo: 98000, efectivo: 138000, mayorista: 125000, proveedor: "Distribuidora Norte" }],
    },
    {
      nombre: "Fundas Dragon Shield (100u)", categoria: "Accesorios", precio: 18500,
      variantes: [
        { nombre: "Negro mate", sku: "ACC-DS-NEG", stock: 24, costo: 11000, proveedor: "Mundo Cartas" },
        { nombre: "Rojo mate", sku: "ACC-DS-ROJ", stock: 3, costo: 11000, proveedor: "Mundo Cartas" },
      ],
    },
    {
      nombre: "Carpeta 9 bolsillos", categoria: "Accesorios", precio: 32000,
      variantes: [{ nombre: "", sku: "ACC-CAR-9B", stock: 11, costo: 19000, proveedor: "Mundo Cartas" }],
    },
    {
      // Sin control de stock: es lo que muestra el guion en la columna Stock y
      // deja explicar en el manual para qué sirve destildar esa casilla.
      nombre: "Torneo — inscripción", categoria: "Servicios", precio: 8000,
      variantes: [{ nombre: "", sku: "SRV-TORNEO", stock: 0 }],
    },
  ];

  for (const c of CARTAS) {
    const [prod] = await db.insert(schema.products)
      .values({
        storeId, name: c.nombre, category: c.categoria, basePrice: c.precio,
        lowStockThreshold: c.umbral ?? 3,
        isPromo: c.promo === true,
        tracksStock: c.nombre !== "Torneo — inscripción",
      })
      .returning();

    await db.insert(schema.productVariants).values(
      c.variantes.map((v) => ({
        storeId, productId: prod.id,
        name: v.nombre, sku: v.sku, stock: v.stock,
        price: v.precio ?? null, costArs: v.costo ?? null,
        priceCash: v.efectivo ?? null, priceWholesale: v.mayorista ?? null,
        setName: v.set ?? null, condition: v.cond ?? null,
        language: v.idioma ?? null, foil: v.foil ?? false,
        supplier: v.proveedor ?? null,
      })),
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
