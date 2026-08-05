import { and, eq } from "drizzle-orm";
import {
  diningTables, floorPlanMarkers,
  type DiningTable, type FloorMarkerType, type FloorPlanMarker,
} from "@/db/schema";

/**
 * Plano del salón: dónde está cada mesa dentro del sector.
 *
 * La geometría va en PORCENTAJE del lienzo (0-100), no en píxeles: así el
 * mismo plano sirve en el monitor del mostrador y en el teléfono del mozo sin
 * guardar nada por dispositivo.
 */

/** Tamaños por defecto de algo recién puesto en el plano, en % del lienzo. */
export const MESA_ANCHO = 12;
export const MESA_ALTO = 14;
const MARCADOR_POR_TIPO: Record<FloorMarkerType, { ancho: number; alto: number }> = {
  puerta: { ancho: 8, alto: 4 },
  pared: { ancho: 24, alto: 3 },
  ventana: { ancho: 16, alto: 3 },
  barra: { ancho: 28, alto: 6 },
};

/** Mínimo para que siga siendo tocable con el dedo. */
const MIN_LADO = 4;
const MAX_LADO = 100;

export type Geometria = { floorX: number; floorY: number; floorWidth: number; floorHeight: number };

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Acota la geometría al lienzo. Se aplica SIEMPRE del lado servidor, aunque el
 * cliente ya haya acotado al arrastrar.
 *
 * El orden importa: primero se limita el tamaño y después la posición contra
 * ese tamaño. Al revés queda el bug del original, que hacía
 * `clamp(x, 0, 100 - ancho)` con un ancho mayor a 100: el máximo daba
 * negativo, `Math.min(Math.max(x, 0), -20)` devuelve -20, y la mesa se
 * dibujaba fuera de la pantalla sin forma de agarrarla para traerla de vuelta.
 */
export function acotarGeometria(g: Partial<Geometria>): Geometria {
  const enRango = (n: number | undefined, def: number, min: number, max: number) => {
    const v = typeof n === "number" && Number.isFinite(n) ? n : def;
    return redondear(Math.min(Math.max(v, min), max));
  };

  const floorWidth = enRango(g.floorWidth, MESA_ANCHO, MIN_LADO, MAX_LADO);
  const floorHeight = enRango(g.floorHeight, MESA_ALTO, MIN_LADO, MAX_LADO);
  return {
    floorWidth,
    floorHeight,
    floorX: enRango(g.floorX, 0, 0, 100 - floorWidth),
    floorY: enRango(g.floorY, 0, 0, 100 - floorHeight),
  };
}

export type PlanoDelSector = {
  sector: string;
  mesas: DiningTable[];
  marcadores: FloorPlanMarker[];
};

/**
 * Todo lo que hay que dibujar, agrupado por sector.
 *
 * Incluye los sectores que solo tienen marcadores: alguien puede estar armando
 * la terraza y todavía no haberle puesto mesas.
 */
export async function getPlano(db: any, storeId: number): Promise<PlanoDelSector[]> {
  const [mesas, marcadores] = await Promise.all([
    db.select().from(diningTables)
      .where(and(eq(diningTables.storeId, storeId), eq(diningTables.active, true)))
      .orderBy(diningTables.sector, diningTables.name),
    db.select().from(floorPlanMarkers)
      .where(eq(floorPlanMarkers.storeId, storeId))
      .orderBy(floorPlanMarkers.sector, floorPlanMarkers.id),
  ]) as [DiningTable[], FloorPlanMarker[]];

  const sectores = [...new Set([
    ...mesas.map((m) => m.sector),
    ...marcadores.map((m) => m.sector),
  ])].sort();

  return sectores.map((sector) => ({
    sector,
    mesas: mesas.filter((m) => m.sector === sector),
    marcadores: marcadores.filter((m) => m.sector === sector),
  }));
}

/** ¿Hay al menos una mesa ubicada? Decide si el salón muestra plano o grilla. */
export async function hayPlano(db: any, storeId: number): Promise<boolean> {
  const mesas: DiningTable[] = await db.select({ floorX: diningTables.floorX })
    .from(diningTables)
    .where(and(eq(diningTables.storeId, storeId), eq(diningTables.active, true)));
  return mesas.some((m) => m.floorX != null);
}

export async function moverMesa(
  db: any,
  input: { storeId: number; tableId: number } & Partial<Geometria>,
): Promise<DiningTable> {
  const [actual] = await db.select().from(diningTables)
    .where(and(eq(diningTables.id, input.tableId), eq(diningTables.storeId, input.storeId)));
  if (!actual) throw new Error("MESA_NO_ENCONTRADA");

  // Se parte de lo que ya tenía: mover no puede cambiar el tamaño ni al revés.
  const g = acotarGeometria({
    floorX: input.floorX ?? actual.floorX ?? 0,
    floorY: input.floorY ?? actual.floorY ?? 0,
    floorWidth: input.floorWidth ?? actual.floorWidth ?? MESA_ANCHO,
    floorHeight: input.floorHeight ?? actual.floorHeight ?? MESA_ALTO,
  });

  const [mesa] = await db.update(diningTables).set(g)
    .where(and(eq(diningTables.id, input.tableId), eq(diningTables.storeId, input.storeId)))
    .returning();
  return mesa;
}

export async function moverMarcador(
  db: any,
  input: { storeId: number; markerId: number } & Partial<Geometria>,
): Promise<FloorPlanMarker> {
  const [actual] = await db.select().from(floorPlanMarkers)
    .where(and(eq(floorPlanMarkers.id, input.markerId), eq(floorPlanMarkers.storeId, input.storeId)));
  if (!actual) throw new Error("MARCADOR_NO_ENCONTRADO");

  const g = acotarGeometria({
    floorX: input.floorX ?? actual.floorX,
    floorY: input.floorY ?? actual.floorY,
    floorWidth: input.floorWidth ?? actual.floorWidth,
    floorHeight: input.floorHeight ?? actual.floorHeight,
  });

  const [marcador] = await db.update(floorPlanMarkers).set(g)
    .where(and(eq(floorPlanMarkers.id, input.markerId), eq(floorPlanMarkers.storeId, input.storeId)))
    .returning();
  return marcador;
}

export async function crearMarcador(
  db: any,
  input: { storeId: number; type: FloorMarkerType; sector: string; label?: string | null },
): Promise<FloorPlanMarker> {
  const tamano = MARCADOR_POR_TIPO[input.type];
  if (!tamano) throw new Error("TIPO_INVALIDO");

  const [marcador] = await db.insert(floorPlanMarkers).values({
    storeId: input.storeId,
    type: input.type,
    sector: input.sector?.trim() || "Salón",
    label: input.label?.trim() || null,
    ...acotarGeometria({ floorX: 10, floorY: 10, floorWidth: tamano.ancho, floorHeight: tamano.alto }),
  }).returning();
  return marcador;
}

export async function borrarMarcador(
  db: any,
  input: { storeId: number; markerId: number },
): Promise<void> {
  const borrados = await db.delete(floorPlanMarkers)
    .where(and(eq(floorPlanMarkers.id, input.markerId), eq(floorPlanMarkers.storeId, input.storeId)))
    .returning({ id: floorPlanMarkers.id });
  if (borrados.length === 0) throw new Error("MARCADOR_NO_ENCONTRADO");
}

/**
 * Ubica en una grilla las mesas que todavía no tienen posición.
 *
 * Es lo que hace usable el plano la primera vez: sin esto, un local con doce
 * mesas cargadas abre el editor y las ve todas apiladas en la esquina
 * superior izquierda, una encima de la otra.
 */
export async function acomodarMesasSinUbicar(db: any, storeId: number): Promise<number> {
  const mesas: DiningTable[] = await db.select().from(diningTables)
    .where(and(eq(diningTables.storeId, storeId), eq(diningTables.active, true)))
    .orderBy(diningTables.sector, diningTables.name);

  const porSector = new Map<string, number>();
  let acomodadas = 0;

  for (const mesa of mesas) {
    const i = porSector.get(mesa.sector) ?? 0;
    porSector.set(mesa.sector, i + 1);
    if (mesa.floorX != null) continue;

    // Cuatro por fila, con aire entre medio.
    const g = acotarGeometria({
      floorX: 6 + (i % 4) * 22,
      floorY: 8 + Math.floor(i / 4) * 20,
      floorWidth: mesa.floorWidth ?? MESA_ANCHO,
      floorHeight: mesa.floorHeight ?? MESA_ALTO,
    });
    await db.update(diningTables).set(g).where(eq(diningTables.id, mesa.id));
    acomodadas++;
  }

  return acomodadas;
}
