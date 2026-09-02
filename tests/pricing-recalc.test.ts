import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { savePricingConfig, getPricingConfig } from "@/domain/pricing-config";
import {
  crearLoteRecalculo, confirmarLoteRecalculo, revertirLoteRecalculo, getUltimoLoteConfirmado,
} from "@/domain/pricing-recalc";
import { resolverPrecio } from "@/domain/sales";
import { eq } from "drizzle-orm";

/**
 * Recálculo de precios contra el dólar.
 *
 * Lo que protege esta suite, en orden de gravedad:
 *   1. Recalcular dos veces con la misma cotización no mueve un peso.
 *   2. Las listas que la tienda no configuró NO se tocan, y nunca se inauguran
 *      —prenderlas cambiaría lo que el cajero puede cobrar.
 *   3. Se aplica entero o no se aplica.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otra: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otra = await seedTestStore(db, "otra");
  await seedTestUser(db, "u1", "owner", store);
});

async function configurar(extra: Record<string, unknown> = {}) {
  await savePricingConfig(db, {
    storeId: store, userId: "u1", usdRate: 1480,
    roundingMode: "nearest", roundingStep: 100, ...extra,
  } as any);
}

/** Producto con una variante. Devuelve los dos ids. */
async function sembrar(opts: {
  storeId?: number;
  basePrice?: number; basePriceUsd?: number | null;
  price?: number | null; priceUsd?: number | null;
  priceCash?: number | null; priceWholesale?: number | null;
  nombre?: string;
}) {
  const sid = opts.storeId ?? store;
  const [p] = await db.insert(products).values({
    storeId: sid, name: opts.nombre ?? "Sobre", basePrice: opts.basePrice ?? 10000,
    basePriceUsd: opts.basePriceUsd ?? null,
  }).returning();
  const [v] = await db.insert(productVariants).values({
    storeId: sid, productId: p.id, name: "",
    price: opts.price ?? null, priceUsd: opts.priceUsd ?? null,
    priceCash: opts.priceCash ?? null, priceWholesale: opts.priceWholesale ?? null,
  }).returning();
  return { productId: p.id, variantId: v.id };
}

const recalcular = async () => {
  const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
  await confirmarLoteRecalculo(db, store, lote.batchId);
  return lote;
};

const leerVariante = async (id: number) =>
  (await db.select().from(productVariants).where(eq(productVariants.id, id)))[0];
const leerProducto = async (id: number) =>
  (await db.select().from(products).where(eq(products.id, id)))[0];

describe("dónde se escribe el precio", () => {
  it("con el dólar en el producto se escribe base_price y las variantes siguen heredando", async () => {
    await configurar();
    const { productId, variantId } = await sembrar({ basePriceUsd: 10, basePrice: 5000 });
    await recalcular();

    expect((await leerProducto(productId)).basePrice).toBe(14800);
    // La herencia no se rompe: si el recálculo materializara el precio en la
    // variante, editar el producto dejaría de tener efecto para siempre.
    expect((await leerVariante(variantId)).price).toBeNull();
  });

  it("con el dólar en la variante se escribe su propio precio", async () => {
    await configurar();
    const { productId, variantId } = await sembrar({ priceUsd: 12, price: 5000, basePrice: 999 });
    await recalcular();

    expect((await leerVariante(variantId)).price).toBe(17800);
    expect((await leerProducto(productId)).basePrice).toBe(999);
  });

  it("sin precio en dólares no se toca nada y se cuenta aparte", async () => {
    await configurar();
    const { variantId } = await sembrar({ price: 5000 });
    const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });

    expect(lote.skipped).toBe(1);
    expect(lote.changed).toBe(0);
    await confirmarLoteRecalculo(db, store, lote.batchId);
    expect((await leerVariante(variantId)).price).toBe(5000);
  });

  it("la variante con precio propio en pesos no se mueve, y el lote lo dice", async () => {
    // La trampa: el producto sube, esta variante no, y el mostrador sigue
    // cobrando lo mismo. Es correcto —el precio propio pisa al del padre— pero
    // sin el contador nadie lo entiende.
    await configurar();
    const { productId, variantId } = await sembrar({ basePriceUsd: 10, basePrice: 5000, price: 7777 });
    const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });

    expect(lote.overridden).toBe(1);
    await confirmarLoteRecalculo(db, store, lote.batchId);
    expect((await leerProducto(productId)).basePrice).toBe(14800);
    expect((await leerVariante(variantId)).price).toBe(7777);
  });
});

describe("idempotencia", () => {
  it("recalcular de nuevo con la misma cotización no mueve ningún precio", async () => {
    await configurar({ cashPct: 15, wholesalePct: 30 });
    const a = await sembrar({ basePriceUsd: 10, basePrice: 1 });
    const b = await sembrar({ priceUsd: 58.9, price: 1, priceCash: 1, priceWholesale: 1, nombre: "Caja" });
    await recalcular();

    const productoTras1 = await leerProducto(a.productId);
    const varianteTras1 = await leerVariante(b.variantId);

    const segundo = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
    expect(segundo.changed).toBe(0);
    await confirmarLoteRecalculo(db, store, segundo.batchId);

    expect((await leerProducto(a.productId)).basePrice).toBe(productoTras1.basePrice);
    const varianteTras2 = await leerVariante(b.variantId);
    expect(varianteTras2.price).toBe(varianteTras1.price);
    expect(varianteTras2.priceCash).toBe(varianteTras1.priceCash);
    expect(varianteTras2.priceWholesale).toBe(varianteTras1.priceWholesale);
  });

  it("también con redondeo hacia arriba", async () => {
    // El modo donde una implementación mal hecha empuja un escalón en cada
    // corrida y solo se nota a la tercera.
    await configurar({ roundingMode: "up" });
    const { variantId } = await sembrar({ priceUsd: 58.9, price: 1 });

    await recalcular();
    const uno = (await leerVariante(variantId)).price;
    await recalcular();
    await recalcular();
    expect((await leerVariante(variantId)).price).toBe(uno);
  });
});

describe("listas de precio", () => {
  it("sin porcentaje configurado no se tocan", async () => {
    await configurar();
    const { variantId } = await sembrar({ priceUsd: 10, priceCash: 4000, priceWholesale: 3000 });
    await recalcular();

    const v = await leerVariante(variantId);
    expect(v.price).toBe(14800);
    expect(v.priceCash).toBe(4000);
    expect(v.priceWholesale).toBe(3000);
  });

  it("con porcentaje recalcula solo las listas que la variante YA tenía", async () => {
    await configurar({ cashPct: 15 });
    const conLista = await sembrar({ priceUsd: 10, priceCash: 4000 });
    const sinLista = await sembrar({ priceUsd: 10, nombre: "Otro" });
    await recalcular();

    // 10 × 1480 × 0,85 = 12.580
    expect((await leerVariante(conLista.variantId)).priceCash).toBe(12600);
    // Inaugurar la lista prendería "efectivo" en un artículo que hoy la
    // rechaza con PRICE_LIST_NOT_SET: eso cambia lo que se puede cobrar.
    expect((await leerVariante(sinLista.variantId)).priceCash).toBeNull();
  });

  it("un precio de lista en 0 sin dólar sobrevive intacto", async () => {
    // El artículo regalado. Cualquier implementación con `||` lo pisaría.
    await configurar({ cashPct: 15 });
    const { variantId } = await sembrar({ price: 5000, priceCash: 0 });
    await recalcular();

    const v = await leerVariante(variantId);
    expect(v.priceCash).toBe(0);
    expect(v.price).toBe(5000);
  });
});

describe("el pasado y el presente", () => {
  it("después de recalcular, la venta nueva cobra el precio nuevo", async () => {
    await configurar();
    const { productId, variantId } = await sembrar({ basePriceUsd: 10, basePrice: 5000 });
    await recalcular();

    const v = await leerVariante(variantId);
    const p = await leerProducto(productId);
    expect(resolverPrecio({ ...v, basePrice: p.basePrice } as any, "venta")).toBe(14800);
  });
});

describe("seguridad del lote", () => {
  it("sin cotización cargada no deja planificar", async () => {
    await sembrar({ priceUsd: 10 });
    await expect(crearLoteRecalculo(db, { storeId: store, userId: "u1" }))
      .rejects.toThrow("USD_RATE_NOT_SET");
  });

  it("no toca variantes de otra tienda", async () => {
    await configurar();
    await sembrar({ priceUsd: 10 });
    const ajena = await sembrar({ storeId: otra, priceUsd: 10, price: 3000 });
    await recalcular();

    expect((await leerVariante(ajena.variantId)).price).toBe(3000);
  });

  it("un lote de otra tienda no se puede confirmar", async () => {
    await configurar();
    await sembrar({ priceUsd: 10 });
    const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
    await expect(confirmarLoteRecalculo(db, otra, lote.batchId)).rejects.toThrow("BATCH_NOT_FOUND");
  });

  it("el doble clic aplica una sola vez", async () => {
    await configurar();
    const { variantId } = await sembrar({ priceUsd: 10, price: 1 });
    const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });

    await confirmarLoteRecalculo(db, store, lote.batchId);
    await expect(confirmarLoteRecalculo(db, store, lote.batchId)).rejects.toThrow("BATCH_NOT_FOUND");
    expect((await leerVariante(variantId)).price).toBe(14800);
  });

  it("aplica más filas que el tamaño del chunk", async () => {
    await configurar();
    const [p] = await db.insert(products)
      .values({ storeId: store, name: "Masivo", basePrice: 1 }).returning();
    await db.insert(productVariants).values(
      Array.from({ length: 1200 }, (_, i) => ({
        storeId: store, productId: p.id, name: `v${i}`, price: 1, priceUsd: 10,
      }))
    );
    await recalcular();

    const todas = await db.select().from(productVariants).where(eq(productVariants.productId, p.id));
    expect(todas).toHaveLength(1200);
    expect(todas.every((v) => v.price === 14800)).toBe(true);
  });
});

describe("deshacer", () => {
  it("devuelve cada precio a su valor previo, incluidos los null", async () => {
    await configurar();
    const a = await sembrar({ basePriceUsd: 10, basePrice: 5000 });
    const b = await sembrar({ priceUsd: 12, price: null, nombre: "Otro" });
    const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
    await confirmarLoteRecalculo(db, store, lote.batchId);

    await revertirLoteRecalculo(db, store, lote.batchId, "u1");

    expect((await leerProducto(a.productId)).basePrice).toBe(5000);
    expect((await leerVariante(b.variantId)).price).toBeNull();
    expect(await getUltimoLoteConfirmado(db, store)).toBeNull();
  });

  it("no pisa un precio que alguien editó a mano después", async () => {
    await configurar();
    const { variantId } = await sembrar({ priceUsd: 10, price: 1000 });
    const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
    await confirmarLoteRecalculo(db, store, lote.batchId);

    await db.update(productVariants).set({ price: 20000 })
      .where(eq(productVariants.id, variantId));

    const res = await revertirLoteRecalculo(db, store, lote.batchId, "u1");
    expect(res.salteados).toBe(1);
    expect((await leerVariante(variantId)).price).toBe(20000);
  });

  it("solo se puede deshacer el último", async () => {
    await configurar();
    await sembrar({ priceUsd: 10, price: 1 });
    const primero = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
    await confirmarLoteRecalculo(db, store, primero.batchId);

    await savePricingConfig(db, { storeId: store, userId: "u1", usdRate: 1600 });
    const segundo = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
    await confirmarLoteRecalculo(db, store, segundo.batchId);

    // Deshacer el primero resucitaría precios de dos cotizaciones atrás.
    await expect(revertirLoteRecalculo(db, store, primero.batchId, "u1"))
      .rejects.toThrow("BATCH_NOT_REVERTIBLE");
  });
});

describe("config", () => {
  it("upsert y autoría de la cotización", async () => {
    await configurar();
    const uno = await getPricingConfig(db, store);
    expect(uno?.usdRate).toBe(1480);
    expect(uno?.usdRateUpdatedBy).toBe("u1");

    await savePricingConfig(db, { storeId: store, userId: "u1", usdRate: 1600, cashPct: 15 });
    const dos = await getPricingConfig(db, store);
    expect(dos?.usdRate).toBe(1600);
    expect(dos?.cashPct).toBe(15);
  });

  it("guardar solo los porcentajes no simula que se actualizó el dólar", async () => {
    await configurar();
    const antes = (await getPricingConfig(db, store))!.usdRateUpdatedAt;
    await savePricingConfig(db, { storeId: store, userId: "u1", usdRate: 1480, cashPct: 20 });
    expect((await getPricingConfig(db, store))!.usdRateUpdatedAt).toEqual(antes);
  });

  it("una tienda sin configurar devuelve null sin romper", async () => {
    expect(await getPricingConfig(db, otra)).toBeNull();
  });

  it("rechaza cotización, paso y porcentaje inválidos", async () => {
    const base = { storeId: store, userId: "u1", usdRate: 1480 };
    await expect(savePricingConfig(db, { ...base, usdRate: 0 })).rejects.toThrow("INVALID_USD_RATE");
    await expect(savePricingConfig(db, { ...base, roundingStep: 37 })).rejects.toThrow("INVALID_ROUNDING_STEP");
    await expect(savePricingConfig(db, { ...base, cashPct: 120 })).rejects.toThrow("INVALID_PCT");
  });
});
