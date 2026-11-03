"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import {
  anularCompra, anularPagoProveedor, crearProveedor, editarProveedor, registrarCompra, registrarPagoProveedor,
} from "@/domain/proveedores";
import type { MedioDeGasto } from "@/domain/gastos-medios";

/** Proveedores, facturas de compra y pagos. Del dueño, como Gastos. */

const MENSAJES: Record<string, string> = {
  EMPTY_NAME: "Poné un nombre.",
  PLAZO_INVALIDO: "El plazo va en días, entre 0 y 365.",
  PROVEEDOR_DUPLICADO: "Ya hay un proveedor con ese nombre.",
  PROVEEDOR_NO_ENCONTRADO: "Ese proveedor no existe.",
  PROVEEDOR_INACTIVO: "Ese proveedor está desactivado.",
  RUBRO_NO_ENCONTRADO: "Ese rubro no existe.",
  RUBRO_INACTIVO: "Ese rubro está desactivado.",
  RUBRO_REQUERIDO: "Elegí el rubro de la factura.",
  NUMERO_REQUERIDO: "Poné el número de la factura.",
  FECHA_INVALIDA: "Fecha inválida.",
  VENCE_ANTES: "El vencimiento no puede ser antes de la fecha de la factura.",
  INVALID_AMOUNT: "Poné un monto mayor a cero.",
  COMPRA_DUPLICADA: "Esa factura de ese proveedor ya está cargada.",
  MEDIO_INVALIDO: "Elegí cómo se pagó.",
  MOTIVO_REQUERIDO: "Poné un motivo (al menos 3 letras).",
  YA_ANULADO: "Ya estaba anulado.",
  NO_ENCONTRADO: "No existe.",
};

const traducir = (e: unknown) =>
  (e instanceof Error ? MENSAJES[e.message] : undefined) ?? "No se pudo completar la operación.";

type Datos = {
  nombre: string; cuit?: string; rubroId?: number | null; plazoDias?: number | null;
  telefono?: string; notas?: string;
};

const datos = (d: Datos) => ({
  nombre: String(d.nombre ?? ""),
  cuit: d.cuit == null ? null : String(d.cuit),
  rubroId: d.rubroId ? Number(d.rubroId) : null,
  plazoDias: d.plazoDias == null || d.plazoDias === ("" as never) ? null : Number(d.plazoDias),
  telefono: d.telefono == null ? null : String(d.telefono),
  notas: d.notas == null ? null : String(d.notas),
});

async function correr<T>(fn: (storeId: number, userId: string) => Promise<T>, rutas: string[]) {
  const { storeId, id } = await requireStoreOwner();
  try {
    const r = await fn(storeId, id);
    for (const ruta of rutas) revalidatePath(ruta);
    return { ok: true as const, id: (r as { id?: number })?.id };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function crearProveedorAction(d: Datos) {
  return correr((storeId) => crearProveedor(db, { ...datos(d), storeId }), ["/proveedores"]);
}

export async function editarProveedorAction(proveedorId: number, d: Datos & { activo?: boolean }) {
  return correr((storeId) => editarProveedor(db, {
    ...datos(d),
    activo: d.activo === undefined ? undefined : d.activo === true,
    storeId, proveedorId: Number(proveedorId),
  }), ["/proveedores", `/proveedores/${proveedorId}`]);
}

export async function registrarCompraAction(input: {
  proveedorId: number; numero: string; tipo?: string; fecha: string; vencimiento?: string;
  total: number; rubroId?: number | null; detalle?: string;
}) {
  return correr((storeId, userId) => registrarCompra(db, {
    storeId, userId,
    proveedorId: Number(input.proveedorId),
    numero: String(input.numero ?? ""),
    tipo: input.tipo == null ? null : String(input.tipo),
    fecha: String(input.fecha ?? ""),
    vencimiento: input.vencimiento ? String(input.vencimiento) : null,
    total: Number(input.total),
    rubroId: input.rubroId ? Number(input.rubroId) : null,
    detalle: input.detalle == null ? null : String(input.detalle),
  }), ["/proveedores", `/proveedores/${input.proveedorId}`, "/gastos"]);
}

export async function registrarPagoAction(input: {
  proveedorId: number; fecha: string; monto: number; medio: MedioDeGasto; detalle?: string;
}) {
  return correr((storeId, userId) => registrarPagoProveedor(db, {
    storeId, userId,
    proveedorId: Number(input.proveedorId),
    fecha: String(input.fecha ?? ""),
    monto: Number(input.monto),
    medio: input.medio,
    detalle: input.detalle == null ? null : String(input.detalle),
  }), ["/proveedores", `/proveedores/${input.proveedorId}`]);
}

export async function anularCompraAction(proveedorId: number, compraId: number, motivo: string) {
  return correr((storeId, userId) => anularCompra(db, {
    storeId, userId, compraId: Number(compraId), motivo: String(motivo ?? ""),
  }), ["/proveedores", `/proveedores/${proveedorId}`, "/gastos"]);
}

export async function anularPagoAction(proveedorId: number, pagoId: number, motivo: string) {
  return correr((storeId, userId) => anularPagoProveedor(db, {
    storeId, userId, pagoId: Number(pagoId), motivo: String(motivo ?? ""),
  }), ["/proveedores", `/proveedores/${proveedorId}`]);
}
