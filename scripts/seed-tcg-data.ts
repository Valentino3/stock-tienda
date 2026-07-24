import { config } from "dotenv";
config({ path: ".env.local" });

// Data de demostración (placeholder) para las tiendas TCG ZTG y Ático:
// catálogo de cartas + accesorios, clientes, caja, ventas variadas (con
// descuentos y fiado), gastos y comisiones. Re-ejecutable: resetea la data de
// demo de cada tienda antes de sembrar. Usa las funciones de dominio para que
// stock, cargos de cuenta y totales queden consistentes.
async function main() {
  const { db } = await import("../src/db");
  const {
    user, stores, products, productVariants, sales, saleItems, stockMovements,
    cashSessions, cashMovements, clients, clientAccountMovements, commissions,
  } = await import("../src/db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { openCashSession, closeCashSession, createCashMovement } = await import("../src/domain/cash");
  const { createSale } = await import("../src/domain/sales");
  const { createClient, recordPayment } = await import("../src/domain/clients");
  const { createCommission } = await import("../src/domain/commissions");

  type VariantSeed = {
    name: string; sku: string; stock: number; price?: number;
    setName?: string; condition?: string; foil?: boolean; language?: string;
  };
  type ProductSeed = { name: string; basePrice: number; lowStockThreshold?: number; category?: string; variants: VariantSeed[] };
  const withCat = (category: string, arr: ProductSeed[]) => arr.map((p) => ({ ...p, category }));

  const pokemon: ProductSeed[] = [
    { name: "Charizard ex", basePrice: 45000, variants: [
      { name: "Obsidian Flames", sku: "PKM-CHZ-OBF-NM", stock: 6, setName: "Obsidian Flames", condition: "NM", language: "EN" },
      { name: "Obsidian Flames Foil", sku: "PKM-CHZ-OBF-F", stock: 3, price: 78000, setName: "Obsidian Flames", condition: "NM", foil: true, language: "EN" },
    ] },
    { name: "Pikachu VMAX", basePrice: 22000, variants: [
      { name: "Vivid Voltage", sku: "PKM-PIK-VV-NM", stock: 8, setName: "Vivid Voltage", condition: "NM", language: "EN" },
      { name: "Vivid Voltage LP", sku: "PKM-PIK-VV-LP", stock: 4, price: 16000, setName: "Vivid Voltage", condition: "LP", language: "EN" },
    ] },
    { name: "Mewtwo V", basePrice: 18000, variants: [
      { name: "Pokémon GO", sku: "PKM-MEW-GO-NM", stock: 10, setName: "Pokémon GO", condition: "NM", language: "EN" },
    ] },
    { name: "Booster Box Scarlet & Violet 151", basePrice: 240000, lowStockThreshold: 2, variants: [
      { name: "", sku: "PKM-BB-151", stock: 5 },
    ] },
    { name: "Sobre (Booster) 151", basePrice: 9500, variants: [
      { name: "", sku: "PKM-BP-151", stock: 40 },
    ] },
  ];

  const magic: ProductSeed[] = [
    { name: "Ragavan, Nimble Pilferer", basePrice: 62000, variants: [
      { name: "MH2", sku: "MTG-RAG-MH2-NM", stock: 4, setName: "Modern Horizons 2", condition: "NM", language: "EN" },
      { name: "MH2 Foil", sku: "MTG-RAG-MH2-F", stock: 2, price: 95000, setName: "Modern Horizons 2", condition: "NM", foil: true, language: "EN" },
    ] },
    { name: "Sol Ring", basePrice: 4500, variants: [
      { name: "Commander", sku: "MTG-SOL-CMD-NM", stock: 20, setName: "Commander", condition: "NM", language: "EN" },
    ] },
    { name: "Lightning Bolt", basePrice: 3800, variants: [
      { name: "Ravnica Remastered", sku: "MTG-BOLT-RVR-NM", stock: 15, setName: "Ravnica Remastered", condition: "NM", language: "EN" },
      { name: "Ravnica Remastered ES", sku: "MTG-BOLT-RVR-ES", stock: 9, setName: "Ravnica Remastered", condition: "NM", language: "ES" },
    ] },
    { name: "Booster Box Murders at Karlov Manor", basePrice: 210000, lowStockThreshold: 2, variants: [
      { name: "", sku: "MTG-BB-MKM", stock: 4 },
    ] },
  ];

  const accesorios: ProductSeed[] = [
    { name: "Fundas Dragon Shield x100", basePrice: 11000, variants: [
      { name: "Matte Negro", sku: "ACC-DS-BLK", stock: 25 },
      { name: "Matte Rojo", sku: "ACC-DS-RED", stock: 18 },
    ] },
    { name: "Toploader x25", basePrice: 4200, variants: [{ name: "", sku: "ACC-TOP-25", stock: 30 }] },
    { name: "Deck Box Ultra Pro", basePrice: 6800, variants: [{ name: "", sku: "ACC-DBOX", stock: 12 }] },
  ];

  // Borra la data de demo de una tienda en orden de FKs (re-ejecutable).
  async function resetStore(storeId: number) {
    const variantIds = (await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.storeId, storeId))).map((r) => r.id);
    const sessionIds = (await db.select({ id: cashSessions.id }).from(cashSessions).where(eq(cashSessions.storeId, storeId))).map((r) => r.id);
    await db.delete(clientAccountMovements).where(eq(clientAccountMovements.storeId, storeId));
    await db.delete(commissions).where(eq(commissions.storeId, storeId));
    const saleIds = (await db.select({ id: sales.id }).from(sales).where(eq(sales.storeId, storeId))).map((r) => r.id);
    if (saleIds.length) await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
    if (variantIds.length) await db.delete(stockMovements).where(inArray(stockMovements.variantId, variantIds));
    if (sessionIds.length) await db.delete(cashMovements).where(inArray(cashMovements.cashSessionId, sessionIds));
    await db.delete(sales).where(eq(sales.storeId, storeId));
    await db.delete(cashSessions).where(eq(cashSessions.storeId, storeId));
    await db.delete(productVariants).where(eq(productVariants.storeId, storeId));
    await db.delete(products).where(eq(products.storeId, storeId));
    await db.delete(clients).where(eq(clients.storeId, storeId));
  }

  async function seedStore(slug: string, catalog: ProductSeed[], clientNames: string[]) {
    const [store] = await db.select().from(stores).where(eq(stores.slug, slug));
    if (!store) { console.log(`(skip) tienda ${slug} no existe`); return; }
    const storeId = store.id;

    const [owner] = await db.select().from(user).where(and(eq(user.storeId, storeId), eq(user.role, "owner")));
    const [emp] = await db.select().from(user).where(and(eq(user.storeId, storeId), eq(user.role, "employee")));
    const ownerId = owner?.id;
    const empId = emp?.id ?? ownerId;
    if (!ownerId) { console.log(`(skip) ${slug} sin dueño`); return; }

    await resetStore(storeId);

    // Catálogo (skus en orden de inserción).
    const skus: string[] = [];
    const bySku = new Map<string, number>();
    for (const p of catalog) {
      const [prod] = await db.insert(products).values({
        storeId, name: p.name, category: p.category ?? null, basePrice: p.basePrice, lowStockThreshold: p.lowStockThreshold ?? 3,
      }).returning();
      for (const v of p.variants) {
        const [variant] = await db.insert(productVariants).values({
          storeId, productId: prod.id, name: v.name, sku: v.sku, stock: v.stock,
          price: v.price ?? null, setName: v.setName ?? null, condition: v.condition ?? null,
          foil: v.foil ?? false, language: v.language ?? null,
        }).returning();
        bySku.set(v.sku, variant.id);
        skus.push(v.sku);
      }
    }
    console.log(`${slug}: ${catalog.length} productos cargados`);

    // Clientes.
    const clientIds: number[] = [];
    for (const name of clientNames) clientIds.push((await createClient(db, { storeId, name })).id);

    const V = (sku: string) => bySku.get(sku)!;
    const last = skus[skus.length - 1]; // Deck Box (stock amplio)

    // --- Sesión 1: histórica (se cierra) ---
    const s1 = await openCashSession(db, { storeId, userId: ownerId, openingCash: 20000 });
    await createSale(db, { storeId, sellerId: ownerId, paymentMethod: "efectivo", items: [{ variantId: V(skus[0]), quantity: 1 }] });
    await createSale(db, { storeId, sellerId: empId, paymentMethod: "tarjeta", items: [
      { variantId: V(skus[6]), quantity: 2, discount: { kind: "percent", value: 10 } }, // ítem de stock alto
      { variantId: V(last), quantity: 1 },
    ] });
    await createSale(db, { storeId, sellerId: empId, paymentMethod: "transferencia",
      items: [{ variantId: V(skus[2]), quantity: 1 }], saleDiscount: { kind: "amount", value: 1500 } });
    await createCashMovement(db, { storeId, sessionId: s1.id, kind: "gasto", amount: 3500, description: "Insumos de librería", userId: empId });
    await createCashMovement(db, { storeId, sessionId: s1.id, kind: "egreso", amount: 10000, description: "Retiro socio", userId: ownerId });
    await closeCashSession(db, { storeId, sessionId: s1.id, userId: ownerId, countedCash: 30000, notes: "Cierre demo" });

    // --- Sesión 2: abierta (actual), con venta a cuenta (fiado) + pago parcial ---
    const s2 = await openCashSession(db, { storeId, userId: ownerId, openingCash: 15000 });
    await createSale(db, { storeId, sellerId: ownerId, paymentMethod: "efectivo", items: [{ variantId: V(skus[4]), quantity: 1 }] });
    await createSale(db, { storeId, sellerId: empId, paymentMethod: "cuenta", clientId: clientIds[0], items: [
      { variantId: V(skus[2]), quantity: 1 },
      { variantId: V(skus[6]), quantity: 1 },
    ] });
    await recordPayment(db, { storeId, clientId: clientIds[0], amount: 10000, method: "efectivo", note: "Pago parcial", userId: ownerId });

    if (emp) {
      const now = new Date();
      const from = new Date(now); from.setDate(from.getDate() - 30);
      await createCommission(db, { storeId, employeeId: emp.id, amount: 25000, periodFrom: from, periodTo: now, note: "Comisión demo del mes", createdBy: ownerId });
    }

    console.log(`${slug}: clientes, caja, ventas, fiado y comisión listos`);
  }

  await seedStore("ztg", [...withCat("Pokémon", pokemon), ...withCat("Accesorios", accesorios)], ["Juan Pérez", "Comercio Cartas SA", "Lucía Gómez"]);
  await seedStore("atico", [...withCat("Magic", magic), ...withCat("Accesorios", accesorios)], ["Martín López", "Torneos Norte", "Sofía Díaz"]);

  console.log("\nData de demo lista para ZTG y Ático.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
