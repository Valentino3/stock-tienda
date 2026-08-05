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

  console.log("\nListo. Tiendas de prueba:");
  console.table([
    { rubro: "gastronomía", ...CREDENCIALES.gastro },
    { rubro: "retail", ...CREDENCIALES.retail },
  ]);
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
