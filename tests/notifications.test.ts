import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import {
  createLowStockNotification, listNotifications, countOpenNotifications, resolveNotification,
} from "@/domain/notifications";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "owner", "owner", store);
  await seedTestUser(db, "emp", "employee", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Charizard ex", basePrice: 45000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "NM", stock: 1 }).returning();
  variantId = v.id;
});

describe("notifications (avisos de stock bajo)", () => {
  it("crea un aviso y lo cuenta como abierto", async () => {
    await createLowStockNotification(db, { storeId: store, variantId, userId: "emp" });
    expect(await countOpenNotifications(db, store)).toBe(1);
    const list = await listNotifications(db, store, { status: "open" });
    expect(list).toHaveLength(1);
    expect(list[0].notification.message).toMatch(/Charizard/);
    expect(list[0].createdByName).toBe("Test");
  });

  it("dedupe: no crea un segundo aviso abierto para la misma variante", async () => {
    await createLowStockNotification(db, { storeId: store, variantId, userId: "emp" });
    await createLowStockNotification(db, { storeId: store, variantId, userId: "emp" });
    expect(await countOpenNotifications(db, store)).toBe(1);
  });

  it("resolver baja el conteo de abiertos", async () => {
    const n = await createLowStockNotification(db, { storeId: store, variantId, userId: "emp" });
    await resolveNotification(db, store, n.id, "owner");
    expect(await countOpenNotifications(db, store)).toBe(0);
    expect(await listNotifications(db, store, { status: "resolved" })).toHaveLength(1);
  });

  it("aislado por tienda: no avisa sobre variante de otra tienda ni la resuelve", async () => {
    const store2 = await seedTestStore(db, "t2");
    await seedTestUser(db, "u2", "owner", store2);
    await expect(
      createLowStockNotification(db, { storeId: store2, variantId, userId: "u2" })
    ).rejects.toThrow("VARIANT_NOT_FOUND");

    const n = await createLowStockNotification(db, { storeId: store, variantId, userId: "emp" });
    // Resolver desde la tienda 2 no toca el aviso de la tienda 1.
    await resolveNotification(db, store2, n.id, "u2");
    expect(await countOpenNotifications(db, store)).toBe(1);
  });
});
