"use client";
import { useSyncExternalStore } from "react";
import { hayConexion, invalidarCacheDeConexion } from "./conexion";
import {
  archivarRechazadas, descartarRechazada, encolarVenta, guardarClienteNuevo, guardarProductoNuevo,
  guardarSnapshot, hayIndexedDB, leerCatalogo, leerClientes, leerClientesNuevos, leerCola, leerMeta,
  leerProductosNuevos, leerRechazadas, marcarIntento, quitarDeLaCola, quitarProductosNuevos,
  restaurarEnCola,
  type ClienteLocal, type ClienteNuevoLocal, type MetaSnapshot, type ProductoNuevoLocal,
  type VentaEnCola, type VentaRechazada,
} from "./db";
import { armarRespaldo, nombreDeArchivo, validarRespaldo, ventasAFaltantes } from "./respaldo";
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
  productosNuevos: ProductoNuevoLocal[];
  meta: MetaSnapshot | null;
  /**
   * Ventas cobradas que el servidor rechazó. Persisten en el dispositivo, no
   * solo en memoria: es plata sin registrar y no puede desaparecer con una
   * recarga.
   */
  rechazadas: VentaRechazada[];
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
  productosNuevos: [],
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
    const [meta, variantes, clientes, clientesNuevos, cola, rechazadas, productosNuevos] =
      await Promise.all([
        leerMeta(), leerCatalogo(), leerClientes(), leerClientesNuevos(), leerCola(),
        leerRechazadas(), leerProductosNuevos(),
      ]);

    // Los productos cargados sin conexión entran al MISMO índice de búsqueda
    // que el catálogo: si no, el vendedor los carga y después no los encuentra.
    const todas = [...variantes, ...productosNuevos.map(aVarianteLocal)];
    set({
      meta,
      catalogo: todas.length > 0 ? indexarCatalogo(todas) : null,
      clientes,
      clientesNuevos,
      productosNuevos,
      pendientes: cola.length,
      rechazadas,
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

/** Un producto local se ve como cualquier otra fila del catálogo. */
function aVarianteLocal(p: ProductoNuevoLocal): VarianteCatalogo {
  return {
    variantId: p.localVariantId,
    productName: p.name,
    variantName: null,
    sku: p.sku ?? null,
    stock: p.stock,
    price: null,
    basePrice: p.basePrice,
    setName: null,
    condition: null,
    foil: false,
    language: null,
  };
}

/**
 * Alta de producto sin conexión. Devuelve el id local (negativo) para que quien
 * llama lo pueda meter al carrito enseguida — es el caso de uso real: se carga
 * el producto porque lo están comprando en ese momento.
 */
export async function altaProductoOffline(input: {
  name: string; basePrice: number; stock: number; sku?: string | null;
}): Promise<number> {
  const existentes = await leerProductosNuevos();
  const producto: ProductoNuevoLocal = {
    uid: crypto.randomUUID(),
    variantUid: crypto.randomUUID(),
    // Menor que todos los locales que ya hay: negativo, estable y persistido.
    localVariantId: Math.min(0, ...existentes.map((p) => p.localVariantId)) - 1,
    name: input.name.trim(),
    basePrice: input.basePrice,
    stock: input.stock,
    sku: input.sku?.trim() || null,
  };
  await guardarProductoNuevo(producto);
  await recargarDesdeDisco();
  return producto.localVariantId;
}

/**
 * Drena la cola contra /ventas/replay.
 *
 * Los lotes van de a uno y en orden: mandarlos en paralelo puede hacer que dos
 * ventas de la misma variante compitan por el stock y produzcan avisos que
 * dependen del orden de llegada. Con la cola de un solo dispositivo, la
 * secuencia es barata y el resultado es reproducible.
 */
export type ResumenSincronizacion = {
  sincronizadas: number;
  rechazadas: number;
  conAvisos: number;
  /** El servidor contestó y rechazó el lote. No es falta de conexión. */
  errorDelServidor?: string;
};

export async function sincronizarCola(): Promise<ResumenSincronizacion | null> {
  if (estado.sincronizando || !hayIndexedDB()) return null;

  const cola = await leerCola();
  if (cola.length === 0) return null;
  if (!(await hayConexion(true))) return null;

  set({ sincronizando: true });
  const planes: PlanDeLimpieza[] = [];
  let errorDelServidor: string | undefined;

  try {
    // Productos y clientes viajan en TODOS los lotes, no solo en el primero.
    // El servidor resuelve los uid de cada request contra lo que ese request
    // trae: si se mandaran una sola vez, una venta del lote 2 que referencia un
    // producto creado en el lote 1 no encontraría su uid y se rechazaría. Son
    // pocos e idempotentes por uid, así que repetirlos es gratis.
    const clientesPendientes = await leerClientesNuevos();
    const productosPendientes = await leerProductosNuevos();

    for (const lote of partirEnLotes(cola)) {
      let respuesta: Response;
      try {
        respuesta = await fetch("/ventas/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productos: productosPendientes.map(aPayloadProducto),
            clientes: clientesPendientes,
            ventas: lote.map((v) => aPayload(v, productosPendientes)),
          }),
        });
      } catch {
        // Se cortó a mitad: lo ya confirmado quedó limpio, el resto sigue en
        // la cola. Reintentar el lote entero es inocuo — el servidor deduplica.
        break;
      }
      if (!respuesta.ok && respuesta.status !== 207) {
        // El servidor contestó y dijo que no. Es distinto de "no hay red", y
        // reintentar solo no lo va a arreglar: el caso típico es un 403 porque
        // hay un producto en la cola y quien sincroniza no es el dueño. Se
        // muestra el motivo en vez de dejarlo reintentando en silencio.
        const motivo = await respuesta.json()
          .then((b: { error?: string }) => b?.error)
          .catch(() => undefined);
        for (const v of lote) await marcarIntento(v.uid, motivo ?? `HTTP ${respuesta.status}`);
        errorDelServidor = motivo ?? `El servidor rechazó la sincronización (HTTP ${respuesta.status}).`;
        break;
      }

      const plan = planificarLimpieza(await respuesta.json());

      // Las rechazadas se ARCHIVAN antes de sacarlas de la cola: si se borraran
      // sin dejar rastro, una venta cobrada desaparecería del sistema.
      const porUid = new Map(lote.map((v) => [v.uid, v]));
      const rechazadaEn = new Date().toISOString();
      await archivarRechazadas(
        plan.rechazadas.flatMap((r) => {
          const venta = porUid.get(r.uid);
          return venta ? [{ ...venta, error: r.error, rechazadaEn }] : [];
        }),
      );
      await quitarDeLaCola(plan.uidsResueltos, plan.clienteUidsResueltos);
      planes.push(plan);
    }

    // Productos y clientes locales se dan de baja DESPUÉS del último lote: los
    // lotes intermedios todavía los necesitaban en el payload. Y solo si la
    // cola quedó vacía — si algo sigue pendiente, esas ventas pueden
    // referenciarlos en el próximo intento.
    if ((await leerCola()).length === 0) {
      await quitarProductosNuevos([...new Set(planes.flatMap((p) => p.productoUidsResueltos))]);
    }

    const resumen = resumirSincronizacion(planes);
    // Se relee todo del disco en vez de parchear campo por campo: los productos
    // locales que se sincronizaron tienen que salir TAMBIÉN del índice de
    // búsqueda. Si quedaran, una venta nueva los referenciaría por un uid que
    // ya no está en el dispositivo y el servidor la rechazaría.
    await recargarDesdeDisco();
    set({ avisos: [...estado.avisos, ...planes.flatMap((p) => p.avisos)] });
    return { ...resumen, errorDelServidor };
  } finally {
    set({ sincronizando: false });
  }
}

/**
 * Descarta los avisos, que son informativos. Las rechazadas NO se tocan: se dan
 * de baja de a una desde la pantalla de revisión, cuando alguien realmente
 * cargó esa venta a mano.
 */
export function limpiarAvisos() {
  set({ avisos: [] });
}

export async function resolverRechazada(uid: string) {
  await descartarRechazada(uid);
  set({ rechazadas: await leerRechazadas() });
}

// ---- respaldo a archivo ----

/**
 * Baja las ventas pendientes a un archivo. Es la única defensa contra que el
 * navegador borre el almacenamiento del sitio con la cola adentro.
 */
export async function exportarRespaldo(): Promise<{ ok: boolean; ventas: number }> {
  if (!hayIndexedDB()) return { ok: false, ventas: 0 };
  const [ventas, clientesNuevos, meta] = await Promise.all([leerCola(), leerClientesNuevos(), leerMeta()]);
  if (ventas.length === 0) return { ok: false, ventas: 0 };

  const respaldo = armarRespaldo({ storeId: meta?.storeId ?? 0, ventas, clientesNuevos });
  const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreDeArchivo(respaldo);
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, ventas: ventas.length };
}

export async function restaurarRespaldo(texto: string): Promise<
  { ok: true; restauradas: number; yaEstaban: number } | { ok: false; error: string }
> {
  if (!hayIndexedDB()) return { ok: false, error: "Este navegador no permite guardar datos." };

  const meta = await leerMeta();
  const validado = validarRespaldo(texto, meta?.storeId);
  if (!validado.ok) return validado;

  const enCola = await leerCola();
  const { ventas, clientesNuevos, yaEstaban } = ventasAFaltantes(
    validado.respaldo, enCola.map((v) => v.uid),
  );
  await restaurarEnCola(ventas, clientesNuevos);
  await recargarDesdeDisco();
  return { ok: true, restauradas: ventas.length, yaEstaban };
}

export { mensajeDeRechazo };

const aPayloadProducto = (p: ProductoNuevoLocal) => ({
  uid: p.uid,
  variantUid: p.variantUid,
  name: p.name,
  basePrice: p.basePrice,
  stock: p.stock,
  sku: p.sku ?? null,
});

/**
 * La cola guarda nombres para mostrar; el servidor no los necesita. Y traduce
 * los id locales negativos al `variantUid` del producto correspondiente: el
 * servidor no conoce —ni podría conocer— esos id.
 */
function aPayload(v: VentaEnCola, productosLocales: ProductoNuevoLocal[]) {
  const uidPorLocalId = new Map(productosLocales.map((p) => [p.localVariantId, p.variantUid]));
  return {
    uid: v.uid,
    capturadoEn: v.capturadoEn,
    cashSessionId: v.cashSessionId,
    paymentMethod: v.paymentMethod,
    items: v.items.map((i) => (
      i.variantId < 0
        ? {
            variantUid: uidPorLocalId.get(i.variantId),
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
          }
        : {
            variantId: i.variantId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
          }
    )),
    saleDiscount: v.saleDiscount,
    clientId: v.clientId ?? null,
    clientUid: v.clientUid ?? null,
  };
}
