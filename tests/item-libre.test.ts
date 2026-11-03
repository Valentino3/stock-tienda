import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { products, productVariants, saleItems, stockMovements } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { searchVariants } from "@/domain/catalog";
import { getSalesHistory } from "@/domain/sales-history";
import { getItemsLibres } from "@/domain/reports";
import { varianteItemLibre } from "@/domain/item-libre";

/**
 * El ítem libre: nombre, precio y cantidad escritos a mano. El precio lo pone
 * quien vende, así que la regla que importa es que eso solo pase en la
 * variante del ítem libre, nunca en un producto del catálogo.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let remera: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  remera = (await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 5 }).returning())[0].id;
  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const vender = (items: Parameters<typeof createSale>[1]["items"]) =>
  createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items });

describe("variante del ítem libre", () => {
  it("se crea una sola vez por tienda y no aparece en el buscador", async () => {
    const a = await varianteItemLibre(db, store);
    const b = await varianteItemLibre(db, store);
    expect(a).toBe(b);
    expect(await searchVariants(db, store, "Ítem")).toHaveLength(0);

    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    expect(await varianteItemLibre(db, store2)).not.toBe(a);
  });
});

describe("vender un ítem libre", () => {
  it("cobra el precio escrito, guarda el nombre y no mueve stock", async () => {
    const libre = await varianteItemLibre(db, store);
    const venta = await vender([
      { variantId: libre, quantity: 2, libre: { nombre: "  Torta por encargo ", precio: 9000 } },
      { variantId: remera, quantity: 1 },
    ]);
    expect(venta.total).toBe(19000);

    const lineas = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    const torta = lineas.find((l) => l.variantId === libre)!;
    expect(torta).toMatchObject({ descripcion: "Torta por encargo", unitPrice: 9000, quantity: 2 });
    expect(lineas.find((l) => l.variantId === remera)!.descripcion).toBeNull();

    const movimientos = await db.select().from(stockMovements).where(eq(stockMovements.variantId, libre));
    expect(movimientos).toHaveLength(0);
  });

  it("dos ítems libres distintos en la misma venta son dos líneas", async () => {
    const libre = await varianteItemLibre(db, store);
    const venta = await vender([
      { variantId: libre, quantity: 1, libre: { nombre: "Descorche", precio: 3000 } },
      { variantId: libre, quantity: 1, libre: { nombre: "Velitas", precio: 500 } },
    ]);
    expect(venta.total).toBe(3500);
    const lineas = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(lineas.map((l) => l.descripcion).sort()).toEqual(["Descorche", "Velitas"]);
  });

  it("un precio escrito no entra en un producto del catálogo", async () => {
    await expect(vender([{ variantId: remera, quantity: 1, libre: { nombre: "Gratis", precio: 1 } }]))
      .rejects.toThrow("ITEM_LIBRE_INVALIDO");
  });

  it("la variante del ítem libre no se vende sin nombre y precio, ni con datos raros", async () => {
    const libre = await varianteItemLibre(db, store);
    await expect(vender([{ variantId: libre, quantity: 1 }])).rejects.toThrow("ITEM_LIBRE_INVALIDO");
    for (const datos of [
      { nombre: "  ", precio: 100 },
      { nombre: "x".repeat(121), precio: 100 },
      { nombre: "Algo", precio: 0 },
      { nombre: "Algo", precio: -5 },
      { nombre: "Algo", precio: Number.NaN },
    ]) {
      await expect(vender([{ variantId: libre, quantity: 1, libre: datos }])).rejects.toThrow("ITEM_LIBRE_INVALIDO");
    }
    await expect(vender([{ variantId: libre, quantity: 1, priceList: "mayorista", libre: { nombre: "A", precio: 1 } }]))
      .rejects.toThrow("ITEM_LIBRE_INVALIDO");
  });

  it("se ve con su nombre en el historial y en el listado de ítems libres", async () => {
    const libre = await varianteItemLibre(db, store);
    const venta = await vender([{ variantId: libre, quantity: 1, libre: { nombre: "Descorche", precio: 3000 } }]);

    const { itemRows } = await getSalesHistory(db, { storeId: store, page: 1 });
    expect(itemRows.find((r: { saleId: number }) => r.saleId === venta.id)).toMatchObject({
      productName: "Descorche", variantName: "",
    });

    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hasta = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [fila] = await getItemsLibres(db, store, { from: desde, to: hasta });
    expect(fila).toMatchObject({ saleId: venta.id, descripcion: "Descorche", neto: 3000, cargadoPor: "Test" });
  });
});
