import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  compras, pagosProveedor, proveedores, rubros,
  type Compra, type PagoProveedor, type Proveedor,
} from "@/db/schema";
import { MOTIVO_MIN } from "@/domain/clients";
import { validarRubro } from "@/domain/gastos";
import { esMedioDeGasto, type MedioDeGasto } from "@/domain/gastos-medios";
import { hoyAR, inicioDelDiaAR } from "@/lib/dates";

/**
 * Proveedores, sus facturas de compra y los pagos.
 *
 * La deuda con un proveedor es Σ facturas − Σ pagos, sin contar lo anulado.
 * Los pagos se aplican a las facturas en orden de vencimiento (la que vence
 * primero, primero): no hay que elegir a qué factura va cada pago, y con eso
 * se sabe qué queda pendiente de cada una y qué está vencido. Es lo que hace
 * un proveedor cuando le pagás "a cuenta".
 *
 * Todo es historial fuera de la caja: nada de esto toca un arqueo.
 */

const PG_UNIQUE_VIOLATION = "23505";
const codigoDe = (err: unknown) =>
  (err as { code?: string; cause?: { code?: string } })?.code
  ?? (err as { cause?: { code?: string } })?.cause?.code;
const round2 = (n: number) => Math.round(n * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (f: string) => FECHA.test(f) && !Number.isNaN(inicioDelDiaAR(f).getTime());

/** `fecha` + `dias`, como `YYYY-MM-DD`. Sin horario de verano, la cuenta es exacta. */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(inicioDelDiaAR(fecha).getTime() + dias * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
}

// ---- proveedores ----

type DatosProveedor = {
  nombre: string; cuit?: string | null; rubroId?: number | null; plazoDias?: number | null;
  telefono?: string | null; notas?: string | null;
};

async function validarDatos(db: any, storeId: number, d: DatosProveedor) {
  if (!d.nombre?.trim()) throw new Error("EMPTY_NAME");
  if (d.plazoDias != null && (!Number.isInteger(d.plazoDias) || d.plazoDias < 0 || d.plazoDias > 365)) {
    throw new Error("PLAZO_INVALIDO");
  }
  if (d.rubroId != null) await validarRubro(db, storeId, d.rubroId);
}

const limpio = (d: DatosProveedor) => ({
  nombre: d.nombre.trim(),
  cuit: d.cuit?.trim() || null,
  rubroId: d.rubroId ?? null,
  plazoDias: d.plazoDias ?? null,
  telefono: d.telefono?.trim() || null,
  notas: d.notas?.trim() || null,
});

export async function crearProveedor(db: any, input: { storeId: number } & DatosProveedor): Promise<Proveedor> {
  await validarDatos(db, input.storeId, input);
  try {
    const [p] = await db.insert(proveedores).values({ storeId: input.storeId, ...limpio(input) }).returning();
    return p;
  } catch (err) {
    if (codigoDe(err) === PG_UNIQUE_VIOLATION) throw new Error("PROVEEDOR_DUPLICADO");
    throw err;
  }
}

export async function editarProveedor(
  db: any,
  input: { storeId: number; proveedorId: number; activo?: boolean } & DatosProveedor,
): Promise<Proveedor> {
  await validarDatos(db, input.storeId, input);
  try {
    const [p] = await db.update(proveedores)
      .set({ ...limpio(input), ...(input.activo === undefined ? {} : { activo: input.activo }) })
      .where(and(eq(proveedores.id, input.proveedorId), eq(proveedores.storeId, input.storeId)))
      .returning();
    if (!p) throw new Error("PROVEEDOR_NO_ENCONTRADO");
    return p;
  } catch (err) {
    if (codigoDe(err) === PG_UNIQUE_VIOLATION) throw new Error("PROVEEDOR_DUPLICADO");
    throw err;
  }
}

async function traerProveedor(db: any, storeId: number, proveedorId: number): Promise<Proveedor> {
  const [p] = await db.select().from(proveedores)
    .where(and(eq(proveedores.id, proveedorId), eq(proveedores.storeId, storeId)));
  if (!p) throw new Error("PROVEEDOR_NO_ENCONTRADO");
  return p;
}

// ---- facturas de compra ----

export async function registrarCompra(
  db: any,
  input: {
    storeId: number; userId: string; proveedorId: number;
    numero: string; fecha: string; total: number;
    /** Si falta, el del proveedor. */
    rubroId?: number | null;
    /** Si falta, la fecha más el plazo del proveedor (o la misma fecha). */
    vencimiento?: string | null;
    tipo?: string | null; detalle?: string | null;
  },
): Promise<Compra> {
  const numero = input.numero?.trim() ?? "";
  if (!numero) throw new Error("NUMERO_REQUERIDO");
  if (!fechaValida(input.fecha)) throw new Error("FECHA_INVALIDA");
  if (!Number.isFinite(input.total) || input.total <= 0) throw new Error("INVALID_AMOUNT");

  return db.transaction(async (tx: any) => {
    const proveedor = await traerProveedor(tx, input.storeId, input.proveedorId);
    if (!proveedor.activo) throw new Error("PROVEEDOR_INACTIVO");

    const rubroId = input.rubroId ?? proveedor.rubroId;
    if (rubroId == null) throw new Error("RUBRO_REQUERIDO");
    await validarRubro(tx, input.storeId, rubroId);

    const vencimiento = input.vencimiento || sumarDias(input.fecha, proveedor.plazoDias ?? 0);
    if (!fechaValida(vencimiento)) throw new Error("FECHA_INVALIDA");
    if (vencimiento < input.fecha) throw new Error("VENCE_ANTES");

    // La misma factura dos veces es la forma más común de inflar una deuda.
    // Una anulada no cuenta: se puede volver a cargar bien.
    const [repetida] = await tx.select({ id: compras.id }).from(compras)
      .where(and(
        eq(compras.storeId, input.storeId),
        eq(compras.proveedorId, input.proveedorId),
        eq(compras.numero, numero),
        isNull(compras.voidedAt),
      ))
      .limit(1);
    if (repetida) throw new Error("COMPRA_DUPLICADA");

    const [compra] = await tx.insert(compras).values({
      storeId: input.storeId,
      proveedorId: input.proveedorId,
      rubroId,
      tipo: input.tipo?.trim() || null,
      numero,
      fecha: input.fecha,
      vencimiento,
      total: round2(input.total),
      detalle: input.detalle?.trim() || null,
      createdBy: input.userId,
    }).returning();
    return compra;
  });
}

// ---- pagos ----

export async function registrarPagoProveedor(
  db: any,
  input: {
    storeId: number; userId: string; proveedorId: number; fecha: string; monto: number;
    medio: MedioDeGasto; detalle?: string | null;
  },
): Promise<PagoProveedor> {
  if (!fechaValida(input.fecha)) throw new Error("FECHA_INVALIDA");
  if (!Number.isFinite(input.monto) || input.monto <= 0) throw new Error("INVALID_AMOUNT");
  if (!esMedioDeGasto(input.medio)) throw new Error("MEDIO_INVALIDO");
  await traerProveedor(db, input.storeId, input.proveedorId);
  const [pago] = await db.insert(pagosProveedor).values({
    storeId: input.storeId,
    proveedorId: input.proveedorId,
    fecha: input.fecha,
    monto: round2(input.monto),
    medio: input.medio,
    detalle: input.detalle?.trim() || null,
    createdBy: input.userId,
  }).returning();
  return pago;
}

// ---- anulaciones ----

async function anular(db: any, tabla: typeof compras | typeof pagosProveedor, input: {
  storeId: number; id: number; userId: string; motivo: string;
}) {
  const motivo = input.motivo?.trim() ?? "";
  if (motivo.length < MOTIVO_MIN) throw new Error("MOTIVO_REQUERIDO");
  const [fila] = await db.update(tabla)
    .set({ voidedAt: new Date(), voidedBy: input.userId, voidReason: motivo })
    .where(and(eq(tabla.id, input.id), eq(tabla.storeId, input.storeId), isNull(tabla.voidedAt)))
    .returning();
  if (!fila) {
    const [existe] = await db.select({ id: tabla.id }).from(tabla)
      .where(and(eq(tabla.id, input.id), eq(tabla.storeId, input.storeId)));
    throw new Error(existe ? "YA_ANULADO" : "NO_ENCONTRADO");
  }
  return fila;
}

export const anularCompra = (db: any, input: { storeId: number; compraId: number; userId: string; motivo: string }) =>
  anular(db, compras, { ...input, id: input.compraId }) as Promise<Compra>;

export const anularPagoProveedor = (db: any, input: { storeId: number; pagoId: number; userId: string; motivo: string }) =>
  anular(db, pagosProveedor, { ...input, id: input.pagoId }) as Promise<PagoProveedor>;

// ---- estado de cuenta ----

export type FacturaConSaldo = Compra & {
  rubro: string;
  /** Lo que todavía no cubren los pagos. 0 = pagada. */
  pendiente: number;
  vencida: boolean;
};

export type EstadoDeCuenta = {
  proveedor: Proveedor;
  /** Positivo: se le debe. Negativo: pagos de más, a favor del local. */
  saldo: number;
  vencido: number;
  proximoVencimiento: string | null;
  facturas: FacturaConSaldo[];
  pagos: PagoProveedor[];
};

/**
 * Aplica los pagos a las facturas en orden de vencimiento. Puro, para poder
 * probarlo aparte: la regla de qué factura se considera paga vive acá.
 */
export function aplicarPagos<T extends { id: number; total: number; vencimiento: string; fecha: string }>(
  facturas: T[],
  totalPagado: number,
  hoy: string,
): (T & { pendiente: number; vencida: boolean })[] {
  let disponible = round2(totalPagado);
  const ordenadas = [...facturas].sort((a, b) =>
    a.vencimiento.localeCompare(b.vencimiento) || a.fecha.localeCompare(b.fecha) || a.id - b.id);
  const pendientes = new Map<number, number>();
  for (const f of ordenadas) {
    const cubre = Math.min(disponible, f.total);
    disponible = round2(disponible - cubre);
    pendientes.set(f.id, round2(f.total - cubre));
  }
  return facturas.map((f) => {
    const pendiente = pendientes.get(f.id) ?? f.total;
    return { ...f, pendiente, vencida: pendiente > 0 && f.vencimiento < hoy };
  });
}

export async function estadoDeCuenta(
  db: any,
  storeId: number,
  proveedorId: number,
  hoy: string = hoyAR(),
): Promise<EstadoDeCuenta> {
  const proveedor = await traerProveedor(db, storeId, proveedorId);
  const filas: { compra: Compra; rubro: string }[] = await db
    .select({ compra: compras, rubro: rubros.nombre })
    .from(compras)
    .innerJoin(rubros, eq(compras.rubroId, rubros.id))
    .where(and(eq(compras.storeId, storeId), eq(compras.proveedorId, proveedorId)))
    .orderBy(asc(compras.fecha), asc(compras.id));
  const pagos: PagoProveedor[] = await db.select().from(pagosProveedor)
    .where(and(eq(pagosProveedor.storeId, storeId), eq(pagosProveedor.proveedorId, proveedorId)))
    .orderBy(asc(pagosProveedor.fecha), asc(pagosProveedor.id));

  const vigentes = filas.filter((f) => f.compra.voidedAt == null).map((f) => ({ ...f.compra, rubro: f.rubro }));
  const pagado = pagos.filter((p) => p.voidedAt == null).reduce((a, p) => a + p.monto, 0);
  const aplicadas = aplicarPagos(vigentes, pagado, hoy);
  const porId = new Map(aplicadas.map((f) => [f.id, f]));

  const facturas: FacturaConSaldo[] = filas.map((f) => porId.get(f.compra.id)
    ?? { ...f.compra, rubro: f.rubro, pendiente: 0, vencida: false });
  const totalFacturado = vigentes.reduce((a, f) => a + f.total, 0);
  const conPendiente = aplicadas.filter((f) => f.pendiente > 0);

  return {
    proveedor,
    saldo: round2(totalFacturado - pagado),
    vencido: round2(conPendiente.filter((f) => f.vencida).reduce((a, f) => a + f.pendiente, 0)),
    proximoVencimiento: conPendiente.filter((f) => !f.vencida).map((f) => f.vencimiento).sort()[0] ?? null,
    facturas,
    pagos,
  };
}

export type DeudaDeProveedor = {
  proveedor: Proveedor;
  rubro: string | null;
  saldo: number;
  vencido: number;
  proximoVencimiento: string | null;
};

/**
 * Todos los proveedores con lo que se les debe. Para la lista: "a quién le
 * debo y qué está vencido".
 */
export async function deudaPorProveedor(
  db: any,
  storeId: number,
  opts: { hoy?: string; incluirInactivos?: boolean } = {},
): Promise<DeudaDeProveedor[]> {
  const hoy = opts.hoy ?? hoyAR();
  const condiciones = [eq(proveedores.storeId, storeId)];
  if (!opts.incluirInactivos) condiciones.push(eq(proveedores.activo, true));
  const lista: { proveedor: Proveedor; rubro: string | null }[] = await db
    .select({ proveedor: proveedores, rubro: rubros.nombre })
    .from(proveedores)
    .leftJoin(rubros, eq(proveedores.rubroId, rubros.id))
    .where(and(...condiciones))
    .orderBy(asc(proveedores.nombre));
  if (lista.length === 0) return [];

  const facturas: Compra[] = await db.select().from(compras)
    .where(and(eq(compras.storeId, storeId), isNull(compras.voidedAt)));
  const pagos: { proveedorId: number; total: number }[] = await db
    .select({
      proveedorId: pagosProveedor.proveedorId,
      total: sql<number>`coalesce(sum(${pagosProveedor.monto}), 0)`.mapWith(Number),
    })
    .from(pagosProveedor)
    .where(and(eq(pagosProveedor.storeId, storeId), isNull(pagosProveedor.voidedAt)))
    .groupBy(pagosProveedor.proveedorId);
  const pagadoPor = new Map(pagos.map((p) => [p.proveedorId, p.total]));

  return lista.map(({ proveedor, rubro }) => {
    const suyas = facturas.filter((f) => f.proveedorId === proveedor.id);
    const pagado = pagadoPor.get(proveedor.id) ?? 0;
    const aplicadas = aplicarPagos(suyas, pagado, hoy).filter((f) => f.pendiente > 0);
    return {
      proveedor,
      rubro,
      saldo: round2(suyas.reduce((a, f) => a + f.total, 0) - pagado),
      vencido: round2(aplicadas.filter((f) => f.vencida).reduce((a, f) => a + f.pendiente, 0)),
      proximoVencimiento: aplicadas.filter((f) => !f.vencida).map((f) => f.vencimiento).sort()[0] ?? null,
    };
  });
}
