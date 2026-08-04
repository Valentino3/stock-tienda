import { db } from "@/db";
import { assertSameOrigin, requireStore } from "@/lib/session";
import {
  puedeSincronizar, replayLote, uidsYaSincronizados,
  type ClienteOffline, type ProductoOffline, type VentaOffline,
} from "@/domain/sales-replay";

/**
 * Sincronización de ventas cobradas sin conexión.
 *
 * Route handler y no server action, por las mismas razones que
 * ventas/facturar/route.ts: un lote grande necesita su propio `maxDuration`
 * sin dárselo a toda la página, y Next serializa las server actions por
 * cliente — un lote lento congelaría el resto de la pantalla de venta.
 *
 * Es idempotente de punta a punta: cada venta se resuelve por `uid`, así que
 * reenviar el mismo lote (porque se cortó la respuesta, que es exactamente el
 * escenario para el que existe) no duplica nada. El cliente puede reintentar
 * sin pensar.
 */

export const maxDuration = 60;

// Tope por request. Vercel rechaza cuerpos de más de 4.5 MB antes de que corra
// este código; 200 ventas son unos pocos cientos de KB, así que el límite real
// que importa es el tiempo de transacción, no el tamaño. El cliente parte la
// cola en lotes.
const MAX_VENTAS_POR_LOTE = 200;
const MAX_CLIENTES_POR_LOTE = 200;

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  let storeId: number;
  let sellerId: string;
  let esDueno: boolean;
  try {
    await assertSameOrigin();
    const u = await requireStore();
    storeId = u.storeId;
    sellerId = u.id;
    esDueno = u.role === "owner";
  } catch {
    return fail(403, "No tenés permiso para hacer esto.");
  }

  let body: { ventas?: VentaOffline[]; clientes?: ClienteOffline[]; productos?: ProductoOffline[] };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Pedido inválido.");
  }

  const ventas = Array.isArray(body.ventas) ? body.ventas : [];
  const clientes = Array.isArray(body.clientes) ? body.clientes : [];
  const productos = Array.isArray(body.productos) ? body.productos : [];
  if (ventas.length === 0 && clientes.length === 0 && productos.length === 0) {
    return fail(400, "El lote está vacío.");
  }
  if (
    ventas.length > MAX_VENTAS_POR_LOTE ||
    clientes.length > MAX_CLIENTES_POR_LOTE ||
    productos.length > MAX_CLIENTES_POR_LOTE
  ) {
    return fail(413, `Mandá de a ${MAX_VENTAS_POR_LOTE} ventas como máximo.`);
  }

  // Guarda por CONTENIDO, no sobre todo el endpoint. Ver puedeSincronizar.
  const permiso = puedeSincronizar({ esDueno, cantidadProductos: productos.length });
  if (!permiso.ok) return fail(403, permiso.error);

  // El vendedor de la venta offline es quien sincroniza: es el único usuario que
  // el servidor puede acreditar. Que el dispositivo mande otro id sería confiar
  // en el cliente para atribuir ventas.
  const resultado = await replayLote(db, { storeId, sellerId, productos, clientes, ventas });

  // 207: el lote se procesó pero no todo entró. El cliente tiene que mirar
  // venta por venta, no asumir éxito global.
  const status = resultado.resumen.errores > 0 ? 207 : 200;
  return Response.json({ ok: resultado.resumen.errores === 0, ...resultado }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Reconciliación de la cola del cliente: de estos uids, ¿cuáles ya están?
 *
 * Sirve para el caso feo — el lote entró pero la respuesta se perdió. Sin esto
 * el dispositivo no puede distinguir "no entró" de "entró y no me enteré", y
 * la única salida sería reenviar a ciegas.
 */
export async function GET(req: Request) {
  let storeId: number;
  try {
    const u = await requireStore();
    storeId = u.storeId;
  } catch {
    return fail(403, "No tenés permiso para hacer esto.");
  }

  const uids = new URL(req.url).searchParams.get("uids")?.split(",").filter(Boolean) ?? [];
  if (uids.length === 0) return Response.json({ sincronizados: [] }, { headers: { "Cache-Control": "no-store" } });
  if (uids.length > MAX_VENTAS_POR_LOTE) return fail(413, "Demasiados uids.");

  const sincronizados = await uidsYaSincronizados(db, storeId, uids);
  return Response.json({ sincronizados }, { headers: { "Cache-Control": "no-store" } });
}
