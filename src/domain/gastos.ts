import { and, asc, between, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { cashMovements, cashSessions, compras, gastos, rubros, sales, type Gasto, type Rubro } from "@/db/schema";
import { MOTIVO_MIN } from "@/domain/clients";
import { RUBROS_INICIALES, esMedioDeGasto, type MedioDeGasto } from "@/domain/gastos-medios";
import { finDelDiaAR, inicioDelDiaAR } from "@/lib/dates";

/**
 * Gastos del local por rubro.
 *
 * Tres fuentes, a propósito separadas:
 *   - `gastos`: lo que NO sale de la caja (sueldos, alquiler, transferencias).
 *     Es historial: no toca ningún arqueo.
 *   - `cash_movements` de tipo gasto: lo que se pagó con efectivo del cajón.
 *     Ya resta del arqueo; acá solo se suma para saber en qué se gastó.
 *   - `compras`: las facturas de proveedores, por la fecha de la factura. Los
 *     pagos a proveedores NO entran: son la misma plata que la factura.
 *
 * El resumen las junta por rubro y las compara contra las ventas del mismo
 * período: (gastos del rubro ÷ ventas) × 100. Con "Sueldos y jornales" es el
 * índice de sueldos sobre ventas; con "Mercadería", el costo de mercadería.
 */

const PG_UNIQUE_VIOLATION = "23505";
const codigoDe = (err: unknown) =>
  (err as { code?: string; cause?: { code?: string } })?.code
  ?? (err as { cause?: { code?: string } })?.cause?.code;
const round2 = (n: number) => Math.round(n * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ---- rubros ----

/**
 * Los rubros de la tienda. La primera vez que un local entra a Gastos se le
 * cargan los iniciales: arrancar con la lista vacía es arrancar sin poder
 * cargar nada.
 */
export async function listarRubros(
  db: any,
  storeId: number,
  opts: { incluirInactivos?: boolean } = {},
): Promise<Rubro[]> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(rubros).where(eq(rubros.storeId, storeId));
  if (n === 0) {
    await db.insert(rubros)
      .values(RUBROS_INICIALES.map((nombre) => ({ storeId, nombre })))
      .onConflictDoNothing();
  }
  const condiciones = [eq(rubros.storeId, storeId)];
  if (!opts.incluirInactivos) condiciones.push(eq(rubros.activo, true));
  return db.select().from(rubros).where(and(...condiciones)).orderBy(asc(rubros.nombre));
}

export async function crearRubro(db: any, input: { storeId: number; nombre: string }): Promise<Rubro> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("EMPTY_NAME");
  try {
    const [rubro] = await db.insert(rubros).values({ storeId: input.storeId, nombre }).returning();
    return rubro;
  } catch (err) {
    if (codigoDe(err) === PG_UNIQUE_VIOLATION) throw new Error("RUBRO_DUPLICADO");
    throw err;
  }
}

export async function editarRubro(
  db: any,
  input: { storeId: number; rubroId: number; nombre?: string; activo?: boolean },
): Promise<Rubro> {
  const cambios: Partial<Rubro> = {};
  if (input.nombre !== undefined) {
    const nombre = input.nombre.trim();
    if (!nombre) throw new Error("EMPTY_NAME");
    cambios.nombre = nombre;
  }
  if (input.activo !== undefined) cambios.activo = input.activo;
  try {
    const [rubro] = await db.update(rubros).set(cambios)
      .where(and(eq(rubros.id, input.rubroId), eq(rubros.storeId, input.storeId)))
      .returning();
    if (!rubro) throw new Error("RUBRO_NO_ENCONTRADO");
    return rubro;
  } catch (err) {
    if (codigoDe(err) === PG_UNIQUE_VIOLATION) throw new Error("RUBRO_DUPLICADO");
    throw err;
  }
}

/** El rubro existe, es de esta tienda y está activo. Para cargar un gasto. */
export async function validarRubro(db: any, storeId: number, rubroId: number): Promise<void> {
  const [rubro] = await db.select({ activo: rubros.activo }).from(rubros)
    .where(and(eq(rubros.id, rubroId), eq(rubros.storeId, storeId)));
  if (!rubro) throw new Error("RUBRO_NO_ENCONTRADO");
  if (!rubro.activo) throw new Error("RUBRO_INACTIVO");
}

// ---- gastos fuera de caja ----

export async function registrarGasto(
  db: any,
  input: {
    storeId: number; userId: string; rubroId: number; fecha: string; monto: number;
    medio: MedioDeGasto; detalle?: string | null;
  },
): Promise<Gasto> {
  if (!Number.isFinite(input.monto) || input.monto <= 0) throw new Error("INVALID_AMOUNT");
  if (!FECHA.test(input.fecha) || Number.isNaN(inicioDelDiaAR(input.fecha).getTime())) {
    throw new Error("FECHA_INVALIDA");
  }
  if (!esMedioDeGasto(input.medio)) throw new Error("MEDIO_INVALIDO");
  await validarRubro(db, input.storeId, input.rubroId);
  const [gasto] = await db.insert(gastos).values({
    storeId: input.storeId,
    rubroId: input.rubroId,
    fecha: input.fecha,
    monto: round2(input.monto),
    medio: input.medio,
    detalle: input.detalle?.trim() || null,
    createdBy: input.userId,
  }).returning();
  return gasto;
}

/** No se borra: se anula, y queda en el historial con quién y por qué. */
export async function anularGasto(
  db: any,
  input: { storeId: number; gastoId: number; userId: string; motivo: string },
): Promise<Gasto> {
  const motivo = input.motivo?.trim() ?? "";
  if (motivo.length < MOTIVO_MIN) throw new Error("MOTIVO_REQUERIDO");
  const [gasto] = await db.update(gastos)
    .set({ voidedAt: new Date(), voidedBy: input.userId, voidReason: motivo })
    .where(and(eq(gastos.id, input.gastoId), eq(gastos.storeId, input.storeId), isNull(gastos.voidedAt)))
    .returning();
  if (!gasto) {
    const [existe] = await db.select({ id: gastos.id }).from(gastos)
      .where(and(eq(gastos.id, input.gastoId), eq(gastos.storeId, input.storeId)));
    throw new Error(existe ? "YA_ANULADO" : "GASTO_NO_ENCONTRADO");
  }
  return gasto;
}

export type FilaDeGasto = Gasto & { rubro: string };

export async function listarGastos(
  db: any,
  storeId: number,
  filtro: { desde: string; hasta: string; rubroId?: number | null },
): Promise<FilaDeGasto[]> {
  const condiciones = [eq(gastos.storeId, storeId), between(gastos.fecha, filtro.desde, filtro.hasta)];
  if (filtro.rubroId) condiciones.push(eq(gastos.rubroId, filtro.rubroId));
  const filas = await db.select({ gasto: gastos, rubro: rubros.nombre })
    .from(gastos)
    .innerJoin(rubros, eq(gastos.rubroId, rubros.id))
    .where(and(...condiciones))
    .orderBy(desc(gastos.fecha), desc(gastos.id));
  return filas.map((f: { gasto: Gasto; rubro: string }) => ({ ...f.gasto, rubro: f.rubro }));
}

// ---- resumen por rubro e índices ----

export type ResumenDeRubro = {
  rubroId: number | null;
  /** "Sin rubro" para los gastos de caja viejos, que no lo tienen. */
  nombre: string;
  fueraDeCaja: number;
  enCaja: number;
  /** Facturas de proveedores del rubro. */
  compras: number;
  total: number;
  /** (total ÷ ventas del período) × 100. null si no hubo ventas. */
  sobreVentas: number | null;
};

/**
 * Cuánto se gastó en cada rubro en un período (días de Argentina, los dos
 * extremos incluidos) y qué porcentaje es de lo vendido en ese mismo período.
 */
export async function resumenPorRubro(
  db: any,
  storeId: number,
  periodo: { desde: string; hasta: string },
): Promise<{ ventas: number; total: number; rubros: ResumenDeRubro[] }> {
  const inicio = inicioDelDiaAR(periodo.desde);
  const fin = finDelDiaAR(periodo.hasta);

  const fuera: { rubroId: number; total: number }[] = await db
    .select({ rubroId: gastos.rubroId, total: sql<number>`coalesce(sum(${gastos.monto}), 0)`.mapWith(Number) })
    .from(gastos)
    .where(and(
      eq(gastos.storeId, storeId),
      isNull(gastos.voidedAt),
      between(gastos.fecha, periodo.desde, periodo.hasta),
    ))
    .groupBy(gastos.rubroId);

  // Solo los de tipo gasto: un egreso es el dueño llevándose efectivo, no
  // un gasto del local.
  const enCaja: { rubroId: number | null; total: number }[] = await db
    .select({
      rubroId: cashMovements.rubroId,
      total: sql<number>`coalesce(sum(${cashMovements.amount}), 0)`.mapWith(Number),
    })
    .from(cashMovements)
    .innerJoin(cashSessions, eq(cashMovements.cashSessionId, cashSessions.id))
    .where(and(
      eq(cashSessions.storeId, storeId),
      eq(cashMovements.kind, "gasto"),
      gte(cashMovements.createdAt, inicio),
      lt(cashMovements.createdAt, fin),
    ))
    .groupBy(cashMovements.rubroId);

  const comprado: { rubroId: number; total: number }[] = await db
    .select({ rubroId: compras.rubroId, total: sql<number>`coalesce(sum(${compras.total}), 0)`.mapWith(Number) })
    .from(compras)
    .where(and(
      eq(compras.storeId, storeId),
      isNull(compras.voidedAt),
      between(compras.fecha, periodo.desde, periodo.hasta),
    ))
    .groupBy(compras.rubroId);

  const [{ ventas }] = await db
    .select({ ventas: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number) })
    .from(sales)
    .where(and(
      eq(sales.storeId, storeId),
      eq(sales.voided, false),
      gte(sales.createdAt, inicio),
      lt(sales.createdAt, fin),
    ));

  const nombres = new Map<number, string>(
    (await db.select({ id: rubros.id, nombre: rubros.nombre }).from(rubros).where(eq(rubros.storeId, storeId)))
      .map((r: { id: number; nombre: string }) => [r.id, r.nombre]),
  );

  const porRubro = new Map<number | null, ResumenDeRubro>();
  const fila = (rubroId: number | null) => {
    let f = porRubro.get(rubroId);
    if (!f) {
      f = {
        rubroId, nombre: rubroId == null ? "Sin rubro" : nombres.get(rubroId) ?? "—",
        fueraDeCaja: 0, enCaja: 0, compras: 0, total: 0, sobreVentas: null,
      };
      porRubro.set(rubroId, f);
    }
    return f;
  };
  for (const g of fuera) fila(g.rubroId).fueraDeCaja = round2(g.total);
  for (const g of enCaja) fila(g.rubroId).enCaja = round2(g.total);
  for (const g of comprado) fila(g.rubroId).compras = round2(g.total);

  const filas = [...porRubro.values()].map((f) => {
    const total = round2(f.fueraDeCaja + f.enCaja + f.compras);
    return { ...f, total, sobreVentas: ventas > 0 ? round2((total / ventas) * 100) : null };
  }).sort((a, b) => b.total - a.total);

  return { ventas: round2(ventas), total: round2(filas.reduce((a, f) => a + f.total, 0)), rubros: filas };
}
