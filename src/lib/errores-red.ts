/**
 * Clasificación de fallos de conectividad contra la base.
 *
 * Importa porque los dos casos se ven igual desde el catch de una server
 * action y significan cosas opuestas para el vendedor:
 *
 *   - un error de dominio (stock insuficiente, caja cerrada) => la venta NO
 *     entró, y reintentar tal cual va a fallar de nuevo;
 *   - un corte de red => la venta puede haber entrado o no. Si el corte pasó
 *     después del COMMIT y lo único que se perdió fue la respuesta, ya está
 *     cobrada. Reintentar es lo correcto, pero SOLO con la misma clave de
 *     idempotencia (`sales.uid`), que es lo que evita el doble cobro.
 *
 * Por eso el mensaje al vendedor nunca puede decir "no se registró": no lo
 * sabemos. Dice "reintentá, no se va a duplicar".
 */

// Códigos de error de sistema de Node/undici que emite el driver cuando el
// socket o el DNS se caen. `@neondatabase/serverless` habla por WebSocket, así
// que también aparecen fallos de fetch envueltos en TypeError.
const CODIGOS_DE_RED = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ABORT_ERR",
  // pg / neon: la conexión se cortó con statements en vuelo.
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
]);

const PATRONES_DE_RED = [
  /connection terminated/i,
  /connection closed/i,
  /connection refused/i,
  /socket hang up/i,
  /fetch failed/i,
  /network|websocket/i,
  /timeout/i,
  /getaddrinfo/i,
  /error connecting to database/i,
];

/**
 * Recorre la cadena de `cause` porque drizzle envuelve el error del driver
 * (mismo desenvoltorio que usan openCashSession y createSale para el 23505).
 */
export function esErrorDeRed(err: unknown): boolean {
  let actual: unknown = err;
  for (let profundidad = 0; actual != null && profundidad < 5; profundidad++) {
    const e = actual as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };

    if (typeof e.code === "string" && CODIGOS_DE_RED.has(e.code)) return true;
    if (e.name === "AbortError" || e.name === "TimeoutError") return true;

    const mensaje = typeof e.message === "string" ? e.message : "";
    // El mensaje es el último recurso y es difuso a propósito: los errores de
    // dominio del repo son códigos en mayúsculas sin espacios (NO_OPEN_SESSION,
    // INSUFFICIENT_STOCK), así que no pueden matchear estos patrones.
    if (mensaje && PATRONES_DE_RED.some((p) => p.test(mensaje))) return true;

    actual = e.cause;
  }
  return false;
}
