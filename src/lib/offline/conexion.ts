/**
 * Detección de conexión real contra el servidor.
 *
 * `navigator.onLine` NO alcanza: informa si hay una interfaz de red levantada,
 * no si hay internet. Un wifi conectado a un router sin salida —el caso típico
 * cuando se cae el ISP— devuelve `true` todo el día. Sí sirve como pista
 * barata para el sentido contrario: si dice `false`, seguro no hay red.
 */

const TIMEOUT_MS = 2500;
/** Memo corto: evita una ráfaga de sondas cuando varios componentes preguntan a la vez. */
const VIGENCIA_MS = 10_000;

let ultimo: { valor: boolean; en: number } | null = null;
let enVuelo: Promise<boolean> | null = null;

export function invalidarCacheDeConexion() {
  ultimo = null;
}

export async function hayConexion(forzar = false): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    ultimo = { valor: false, en: Date.now() };
    return false;
  }
  if (!forzar && ultimo && Date.now() - ultimo.en < VIGENCIA_MS) return ultimo.valor;
  if (enVuelo) return enVuelo;

  enVuelo = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      // HEAD y no GET: no hace falta cuerpo, y /api/health no toca la base.
      const res = await fetch("/api/health", {
        method: "HEAD",
        cache: "no-store",
        signal: abort.signal,
      });
      const ok = res.ok;
      ultimo = { valor: ok, en: Date.now() };
      return ok;
    } catch {
      ultimo = { valor: false, en: Date.now() };
      return false;
    } finally {
      clearTimeout(timer);
      enVuelo = null;
    }
  })();

  return enVuelo;
}
