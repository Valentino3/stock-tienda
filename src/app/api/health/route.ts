/**
 * Sonda de conectividad. No toca la base ni la sesión a propósito: responde
 * "el servidor contesta", que es exactamente lo que el cliente necesita saber
 * antes de decidir si sincroniza o encola.
 *
 * `navigator.onLine` no sirve para esto: dice si hay una interfaz de red
 * levantada, no si hay internet. Un wifi conectado a un router sin salida da
 * `true` todo el día.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function HEAD() {
  return new Response(null, { headers: { "Cache-Control": "no-store" } });
}
