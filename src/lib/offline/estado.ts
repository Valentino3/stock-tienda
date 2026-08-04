"use client";
import { useSyncExternalStore } from "react";
import { hayConexion, invalidarCacheDeConexion } from "./conexion";
import {
  encolarVenta, guardarClienteNuevo, guardarSnapshot, hayIndexedDB, leerCatalogo, leerClientes,
  leerClientesNuevos, leerCola, leerMeta, marcarIntento, quitarDeLaCola,
  type ClienteLocal, type ClienteNuevoLocal, type MetaSnapshot, type VentaEnCola,
} from "./db";
import { indexarCatalogo, type CatalogoIndexado, type VarianteCatalogo } from "./busqueda";
import {
  partirEnLotes, planificarLimpieza, resumirSincronizacion, mensajeDeRechazo,
  type PlanDeLimpieza,
} from "./sincronizacion";

/**
 * Estado offline compartido.
 *
 * Store externo mínimo en vez de Context: lo consumen dos lugares muy
 * separados del árbol (el banner del layout y la pantalla de venta) y no hace
 * falta que un provider los envuelva. Además sobrevive a las navegaciones del
 * router, que es lo que importa cuando hay una cola pendiente.
 */

export type EstadoOffline = {
  conectado: boolean;
  /** Todavía no se sondeó: no se muestra nada para no parpadear "sin conexión". */
  verificado: boolean;
  sincronizando: boolean;
  pendientes: number;
  catalogo: CatalogoIndexado | null;
  clientes: ClienteLocal[];
  clientesNuevos: ClienteNuevoLocal[];
  meta: MetaSnapshot | null;
  rechazadas: { uid: string; error: string }[];
  avisos: { uid: string; saleId?: number; avisos: string[] }[];
};

let estado: EstadoOffline = {
  conectado: true,
  verificado: false,
  sincronizando: false,
  pendientes: 0,
  catalogo: null,
  clientes: [],
  clientesNuevos: [],
  meta: null,
  rechazadas: [],
  avisos: [],
};

const oyentes = new Set<() => void>();

function set(parcial: Partial<EstadoOffline>) {
  estado = { ...estado, ...parcial };
  for (const o of oyentes) o();
}

const suscribir = (cb: () => void) => {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
};

const leer = () => estado;
// El servidor renderiza siempre el estado inicial: cualquier otra cosa sería
// una discrepancia de hidratación, porque el servidor no sabe si hay cola.
const leerEnServidor = () => estado;

export function useEstadoOffline(): EstadoOffline {
  return useSyncExternalStore(suscribir, leer, leerEnServidor);
}

// ---- carga inicial ----

let iniciado = false;

/** Idempotente: la puede llamar cualquier componente que se monte. */
export async function iniciarOffline() {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;

  window.addEventListener("online", () => { invalidarCacheDeConexion(); void refrescarConexion(); });
  window.addEventListener("offline", () => { invalidarCacheDeConexion(); void refrescarConexion(); });

  await recargarDesdeDisco();
  await refrescarConexion();

  // Sonda periódica: la vuelta de internet no siempre dispara el evento
  // `online` (y cuando lo dispara, suele mentir sobre si hay salida real).
  setInterval(() => { void refrescarConexion(); }, 30_000);
}

export async function recargarDesdeDisco() {
  if (!hayIndexedDB()) return;
  try {
    const [meta, variantes, clientes, clientesNuevos, cola] = await Promise.all([
      leerMeta(), leerCatalogo(), leerClientes(), leerClientesNuevos(), leerCola(),
    ]);
    set({
      meta,
      catalogo: variantes.length > 0 ? indexarCatalogo(variantes) : null,
      clientes,
      clientesNuevos,
      pendientes: cola.length,
    });
  } catch {
    // Navegador en modo privado, storage lleno o permisos denegados. La app
    // sigue funcionando online; lo que se pierde es el modo offline.
  }
}

export async function refrescarConexion(forzar = false) {
  const conectado = await hayConexion(forzar);
  const antes = estado.conectado;
  set({ conectado, verificado: true });
  // Volvió internet con cola pendiente: se drena sola, sin esperar a que
  // alguien toque un botón.
  if (conectado && !antes && estado.pendientes > 0) void sincronizarCola();
}

// ---- snapshot del catálogo ----

export async function descargarSnapshot(): Promise<{ ok: true; variantes: number; truncado: boolean } | { ok: false; error: string }> {
  if (!hayIndexedDB()) return { ok: false, error: "Este navegador no permite guardar datos para usar sin conexión." };
  try {
    const res = await fetch("/vender/snapshot", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "No se pudo descargar el catálogo." };
    const data = await res.json() as {
      generadoEn: string; storeId: number; cashSessionId: number | null;
      variantes: VarianteCatalogo[]; clientes: ClienteLocal[]; truncado: boolean;
    };

    await guardarSnapshot({
      meta: {
        storeId: data.storeId,
        generadoEn: data.generadoEn,
        cashSessionId: data.cashSessionId,
        truncado: data.truncado,
      },
      variantes: data.variantes,
      clientes: data.clientes,
    });
    await recargarDesdeDisco();
    return { ok: true, variantes: data.variantes.length, truncado: data.truncado };
  } catch {
    return { ok: false, error: "No se pudo descargar el catálogo. ¿Hay conexión?" };
  }
}

// ---- cola de ventas ----

export async function encolar(venta: VentaEnCola, clienteNuevo?: ClienteNuevoLocal) {
  await encolarVenta(venta, clienteNuevo);
  const cola = await leerCola();
  const clientesNuevos = await leerClientesNuevos();
  set({ pendientes: cola.length, clientesNuevos });
}

export async function altaClienteOffline(cliente: ClienteNuevoLocal) {
  await guardarClienteNuevo(cliente);
  set({ clientesNuevos: await leerClientesNuevos() });
}

/**
 * Drena la cola contra /ventas/replay.
 *
 * Los lotes van de a uno y en orden: mandarlos en paralelo puede hacer que dos
 * ventas de la misma variante compitan por el stock y produzcan avisos que
 * dependen del orden de llegada. Con la cola de un solo dispositivo, la
 * secuencia es barata y el resultado es reproducible.
 */
export async function sincronizarCola(): Promise<{ sincronizadas: number; rechazadas: number; conAvisos: number } | null> {
  if (estado.sincronizando || !hayIndexedDB()) return null;

  const cola = await leerCola();
  if (cola.length === 0) return null;
  if (!(await hayConexion(true))) return null;

  set({ sincronizando: true });
  const planes: PlanDeLimpieza[] = [];

  try {
    const clientesNuevos = await leerClientesNuevos();
    // Los clientes van completos en el primer lote: son pocos y las ventas los
    // referencian por uid, así que tienen que existir antes.
    let clientesPendientes = clientesNuevos;

    for (const lote of partirEnLotes(cola)) {
      let respuesta: Response;
      try {
        respuesta = await fetch("/ventas/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientes: clientesPendientes, ventas: lote.map(aPayload) }),
        });
      } catch {
        // Se cortó a mitad: lo ya confirmado quedó limpio, el resto sigue en
        // la cola. Reintentar el lote entero es inocuo — el servidor deduplica.
        break;
      }
      if (!respuesta.ok && respuesta.status !== 207) {
        for (const v of lote) await marcarIntento(v.uid, `HTTP ${respuesta.status}`);
        break;
      }

      const plan = planificarLimpieza(await respuesta.json());
      await quitarDeLaCola(
        [...plan.uidsResueltos, ...plan.rechazadas.map((r) => r.uid)],
        plan.clienteUidsResueltos,
      );
      planes.push(plan);
      clientesPendientes = [];
    }

    const resumen = resumirSincronizacion(planes);
    const rechazadas = planes.flatMap((p) => p.rechazadas);
    const avisos = planes.flatMap((p) => p.avisos);
    set({
      pendientes: (await leerCola()).length,
      clientesNuevos: await leerClientesNuevos(),
      rechazadas: [...estado.rechazadas, ...rechazadas],
      avisos: [...estado.avisos, ...avisos],
    });
    return resumen;
  } finally {
    set({ sincronizando: false });
  }
}

export function limpiarReportes() {
  set({ rechazadas: [], avisos: [] });
}

export { mensajeDeRechazo };

/** La cola guarda nombres para mostrar; el servidor no los necesita. */
function aPayload(v: VentaEnCola) {
  return {
    uid: v.uid,
    capturadoEn: v.capturadoEn,
    cashSessionId: v.cashSessionId,
    paymentMethod: v.paymentMethod,
    items: v.items.map((i) => ({
      variantId: i.variantId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
    })),
    saleDiscount: v.saleDiscount,
    clientId: v.clientId ?? null,
    clientUid: v.clientUid ?? null,
  };
}
