import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { diningTables, floorPlanMarkers } from "@/db/schema";
import { crearMesa } from "@/domain/orders";
import {
  MESA_ALTO, MESA_ANCHO, acomodarMesasSinUbicar, acotarGeometria, borrarMarcador,
  crearMarcador, getPlano, hayPlano, moverMarcador, moverMesa,
} from "@/domain/floor-plan";

/**
 * Plano del salón.
 *
 * El grueso de los tests es sobre `acotarGeometria`, y no por prolijidad: el
 * editor original acotaba la posición contra un ancho sin validar, y con un
 * ancho mayor a 100 el máximo daba negativo y la mesa terminaba dibujada
 * fuera de la pantalla, sin forma de agarrarla para traerla de vuelta.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let mesa: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  mesa = (await crearMesa(db, { storeId: store, name: "1" })).id;
});

describe("acotarGeometria", () => {
  it("deja pasar una geometría razonable", () => {
    expect(acotarGeometria({ floorX: 10, floorY: 20, floorWidth: 12, floorHeight: 14 }))
      .toEqual({ floorX: 10, floorY: 20, floorWidth: 12, floorHeight: 14 });
  });

  it("mete adentro del lienzo lo que se pasa por derecha o abajo", () => {
    const g = acotarGeometria({ floorX: 95, floorY: 99, floorWidth: 12, floorHeight: 14 });
    expect(g.floorX).toBe(88); // 100 - 12
    expect(g.floorY).toBe(86); // 100 - 14
  });

  it("no deja coordenadas negativas", () => {
    const g = acotarGeometria({ floorX: -30, floorY: -5, floorWidth: 12, floorHeight: 14 });
    expect(g.floorX).toBe(0);
    expect(g.floorY).toBe(0);
  });

  it("un ancho mayor al lienzo NO produce una posición negativa", () => {
    // El bug del editor original: clamp(x, 0, 100 - 150) = clamp(x, 0, -50),
    // y Math.min(Math.max(x,0), -50) devuelve -50. La mesa quedaba fuera.
    const g = acotarGeometria({ floorX: 10, floorY: 10, floorWidth: 150, floorHeight: 300 });
    expect(g.floorWidth).toBe(100);
    expect(g.floorHeight).toBe(100);
    expect(g.floorX).toBe(0);
    expect(g.floorY).toBe(0);
  });

  it("impone un lado mínimo para que se pueda tocar con el dedo", () => {
    const g = acotarGeometria({ floorX: 0, floorY: 0, floorWidth: 0.1, floorHeight: -5 });
    expect(g.floorWidth).toBeGreaterThanOrEqual(4);
    expect(g.floorHeight).toBeGreaterThanOrEqual(4);
  });

  it("tolera NaN e infinitos sin propagarlos a la base", () => {
    const g = acotarGeometria({ floorX: NaN, floorY: Infinity, floorWidth: NaN, floorHeight: -Infinity });
    for (const v of Object.values(g)) expect(Number.isFinite(v)).toBe(true);
  });

  it("redondea a dos decimales, que es lo que aguanta numeric(5,2)", () => {
    const g = acotarGeometria({ floorX: 10.987654, floorY: 3.333333, floorWidth: 12, floorHeight: 14 });
    expect(g.floorX).toBe(10.99);
    expect(g.floorY).toBe(3.33);
  });
});

describe("moverMesa", () => {
  it("guarda la posición acotada", async () => {
    await moverMesa(db, { storeId: store, tableId: mesa, floorX: 40, floorY: 50 });
    const [m] = await db.select().from(diningTables).where(eq(diningTables.id, mesa));
    expect(m.floorX).toBe(40);
    expect(m.floorY).toBe(50);
  });

  it("mover no cambia el tamaño", async () => {
    await moverMesa(db, {
      storeId: store, tableId: mesa, floorX: 0, floorY: 0, floorWidth: 30, floorHeight: 25,
    });
    await moverMesa(db, { storeId: store, tableId: mesa, floorX: 10, floorY: 10 });

    const [m] = await db.select().from(diningTables).where(eq(diningTables.id, mesa));
    expect(m.floorWidth).toBe(30);
    expect(m.floorHeight).toBe(25);
  });

  it("redimensionar no cambia la posición", async () => {
    await moverMesa(db, { storeId: store, tableId: mesa, floorX: 20, floorY: 30 });
    await moverMesa(db, { storeId: store, tableId: mesa, floorWidth: 20, floorHeight: 20 });

    const [m] = await db.select().from(diningTables).where(eq(diningTables.id, mesa));
    expect(m.floorX).toBe(20);
    expect(m.floorY).toBe(30);
  });

  it("agrandar una mesa pegada al borde la vuelve a meter adentro", async () => {
    await moverMesa(db, { storeId: store, tableId: mesa, floorX: 88, floorY: 10, floorWidth: 12 });
    await moverMesa(db, { storeId: store, tableId: mesa, floorWidth: 40 });

    const [m] = await db.select().from(diningTables).where(eq(diningTables.id, mesa));
    expect(m.floorX).toBe(60); // 100 - 40
  });

  it("no mueve una mesa de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await expect(
      moverMesa(db, { storeId: store2, tableId: mesa, floorX: 1, floorY: 1 }),
    ).rejects.toThrow("MESA_NO_ENCONTRADA");
  });
});

describe("marcadores", () => {
  it("cada tipo nace con su tamaño típico", async () => {
    const puerta = await crearMarcador(db, { storeId: store, type: "puerta", sector: "Salón" });
    const barra = await crearMarcador(db, { storeId: store, type: "barra", sector: "Salón" });
    expect(puerta.floorWidth).toBeLessThan(barra.floorWidth);
    expect(puerta.type).toBe("puerta");
  });

  it("se mueven y se borran", async () => {
    const m = await crearMarcador(db, { storeId: store, type: "pared", sector: "Salón" });
    await moverMarcador(db, { storeId: store, markerId: m.id, floorX: 55, floorY: 5 });

    const [movido] = await db.select().from(floorPlanMarkers).where(eq(floorPlanMarkers.id, m.id));
    expect(movido.floorX).toBe(55);

    await borrarMarcador(db, { storeId: store, markerId: m.id });
    expect(await db.select().from(floorPlanMarkers).where(eq(floorPlanMarkers.id, m.id))).toHaveLength(0);
  });

  it("no se tocan los de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const m = await crearMarcador(db, { storeId: store, type: "puerta", sector: "Salón" });

    await expect(
      moverMarcador(db, { storeId: store2, markerId: m.id, floorX: 1 }),
    ).rejects.toThrow("MARCADOR_NO_ENCONTRADO");
    await expect(
      borrarMarcador(db, { storeId: store2, markerId: m.id }),
    ).rejects.toThrow("MARCADOR_NO_ENCONTRADO");
  });

  it("un sector vacío cae a Salón", async () => {
    const m = await crearMarcador(db, { storeId: store, type: "puerta", sector: "   " });
    expect(m.sector).toBe("Salón");
  });
});

describe("getPlano", () => {
  it("agrupa mesas y marcadores por sector", async () => {
    await crearMesa(db, { storeId: store, name: "5", sector: "Terraza" });
    await crearMarcador(db, { storeId: store, type: "puerta", sector: "Terraza" });

    const plano = await getPlano(db, store);
    expect(plano.map((p) => p.sector)).toEqual(["Salón", "Terraza"]);
    expect(plano.find((p) => p.sector === "Terraza")?.mesas).toHaveLength(1);
    expect(plano.find((p) => p.sector === "Terraza")?.marcadores).toHaveLength(1);
  });

  it("incluye un sector que solo tiene marcadores", async () => {
    // Alguien está armando la terraza y todavía no le puso mesas.
    await crearMarcador(db, { storeId: store, type: "barra", sector: "Patio" });
    const plano = await getPlano(db, store);
    expect(plano.map((p) => p.sector)).toContain("Patio");
  });

  it("no cruza tiendas", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    expect(await getPlano(db, store2)).toEqual([]);
  });
});

describe("acomodarMesasSinUbicar", () => {
  it("reparte en grilla las que no tienen posición y no toca las ubicadas", async () => {
    const m2 = await crearMesa(db, { storeId: store, name: "2" });
    await crearMesa(db, { storeId: store, name: "3" });
    // La 2 ya está puesta a mano donde el dueño la quiere.
    await moverMesa(db, { storeId: store, tableId: m2.id, floorX: 70, floorY: 70 });

    const acomodadas = await acomodarMesasSinUbicar(db, store);
    expect(acomodadas).toBe(2); // la 1 y la 3

    const [dos] = await db.select().from(diningTables).where(eq(diningTables.id, m2.id));
    expect(dos.floorX).toBe(70);

    // Ninguna queda encima de otra ni fuera del lienzo.
    const todas = await db.select().from(diningTables).where(eq(diningTables.storeId, store));
    const posiciones = todas.map((m) => `${m.floorX},${m.floorY}`);
    expect(new Set(posiciones).size).toBe(todas.length);
    for (const m of todas) {
      expect(m.floorX! + m.floorWidth!).toBeLessThanOrEqual(100);
      expect(m.floorY! + m.floorHeight!).toBeLessThanOrEqual(100);
    }
  });

  it("correrlo dos veces no mueve nada la segunda", async () => {
    await acomodarMesasSinUbicar(db, store);
    expect(await acomodarMesasSinUbicar(db, store)).toBe(0);
  });
});

describe("hayPlano", () => {
  it("es falso hasta que se ubica la primera mesa", async () => {
    expect(await hayPlano(db, store)).toBe(false);
    await moverMesa(db, { storeId: store, tableId: mesa, floorX: 10, floorY: 10 });
    expect(await hayPlano(db, store)).toBe(true);
  });
});
