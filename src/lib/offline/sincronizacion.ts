/**
 * Lógica de sincronización de la cola offline, sin tocar el navegador ni la
 * red. Vive aparte de db.ts justamente para poder testearla en Node.
 */

export type EstadoVenta = "aplicada" | "duplicada" | "error";

export type ResultadoVentaRemoto = {
  uid: string;
  estado: EstadoVenta;
  saleId?: number;
  total?: number;
  error?: string;
  avisos?: string[];
};

export type ResultadoClienteRemoto = {
  uid: string;
  estado: "aplicado" | "duplicado" | "error";
  clientId?: number;
  error?: string;
};

export type RespuestaLote = {
  clientes?: ResultadoClienteRemoto[];
  ventas?: ResultadoVentaRemoto[];
};

/** El servidor acepta 200 por request; se manda de a menos para acortar el reintento. */
export const TAM_LOTE = 50;

export function partirEnLotes<T>(items: T[], tam = TAM_LOTE): T[][] {
  if (tam <= 0) throw new Error("TAM_LOTE_INVALIDO");
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tam) lotes.push(items.slice(i, i + tam));
  return lotes;
}

export type PlanDeLimpieza = {
  /** Ventas que el servidor ya tiene: salen de la cola. */
  uidsResueltos: string[];
  /** Clientes offline ya creados: salen de la cola. */
  clienteUidsResueltos: string[];
  /**
   * Ventas rechazadas. Salen de la cola igual, porque NINGÚN error que
   * devuelve el replay se arregla reintentando: variante o caja inexistente,
   * cliente que no se pudo crear, cantidades inválidas. Dejarlas adentro sería
   * un reintento infinito que además tapa la cola real. Se devuelven para que
   * la UI las muestre — una venta cobrada que no entró es un problema de plata
   * y tiene que verlo una persona.
   */
  rechazadas: { uid: string; error: string }[];
  /** Avisos del servidor (stock negativo, precio distinto, caja cerrada). */
  avisos: { uid: string; saleId?: number; avisos: string[] }[];
};

export function planificarLimpieza(respuesta: RespuestaLote): PlanDeLimpieza {
  const ventas = respuesta.ventas ?? [];
  const clientes = respuesta.clientes ?? [];

  return {
    uidsResueltos: ventas
      .filter((v) => v.estado === "aplicada" || v.estado === "duplicada")
      .map((v) => v.uid),
    clienteUidsResueltos: clientes
      .filter((c) => c.estado === "aplicado" || c.estado === "duplicado")
      .map((c) => c.uid),
    rechazadas: ventas
      .filter((v) => v.estado === "error")
      .map((v) => ({ uid: v.uid, error: v.error ?? "ERROR_DESCONOCIDO" })),
    avisos: ventas
      .filter((v) => (v.avisos?.length ?? 0) > 0)
      .map((v) => ({ uid: v.uid, saleId: v.saleId, avisos: v.avisos ?? [] })),
  };
}

/**
 * Mensaje para el vendedor. Los códigos del dominio no se muestran crudos: el
 * que está atendiendo no puede hacer nada con "CASH_SESSION_NOT_FOUND".
 */
const MENSAJES: Record<string, string> = {
  VARIANT_NOT_FOUND: "Un producto de la venta ya no existe en el catálogo.",
  CASH_SESSION_NOT_FOUND: "La caja donde se hizo la venta no existe en el servidor.",
  CLIENT_NOT_FOUND: "No se pudo resolver el cliente de la venta.",
  CLIENT_REQUIRED: "La venta a cuenta quedó sin cliente.",
  EMPTY_SALE: "La venta no tenía productos.",
  INVALID_QUANTITY: "La venta tenía una cantidad inválida.",
  INVALID_PRICE: "La venta tenía un precio inválido.",
  UID_REQUERIDO: "La venta quedó sin identificador.",
};

export const mensajeDeRechazo = (codigo: string): string =>
  MENSAJES[codigo] ?? "No se pudo registrar la venta en el servidor.";

/** Resumen de una tanda de sincronización, para el toast y el banner. */
export function resumirSincronizacion(planes: PlanDeLimpieza[]) {
  return planes.reduce(
    (acc, p) => ({
      sincronizadas: acc.sincronizadas + p.uidsResueltos.length,
      rechazadas: acc.rechazadas + p.rechazadas.length,
      conAvisos: acc.conAvisos + p.avisos.length,
    }),
    { sincronizadas: 0, rechazadas: 0, conAvisos: 0 },
  );
}
