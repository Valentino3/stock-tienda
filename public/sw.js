/**
 * Service worker del punto de venta.
 *
 * Escrito a mano y no con Serwist: ese plugin todavía exige configuración de
 * webpack (lo dice la propia guía de PWA de Next), y este proyecto compila con
 * Turbopack. Lo que hace falta acá es chico y explícito.
 *
 * Estrategia:
 *   - navegaciones (documentos): red primero, caché como respaldo. Online el
 *     vendedor siempre ve lo último; offline abre la última copia buena.
 *   - assets de /_next/static: caché primero. Llevan hash en el nombre, así que
 *     nunca sirven contenido viejo por error.
 *   - todo lo demás (API, server actions, exportaciones, /c/…): sin tocar. Un
 *     POST cacheado sería una venta fantasma.
 *
 * NO llama a skipWaiting a propósito. Cambiar de versión en medio de una venta
 * puede dejar el HTML cacheado hablando con chunks de otra build. La versión
 * nueva entra la próxima vez que la app se abre de cero.
 */

const VERSION = "v1";
const CACHE_DOCS = `stock-tienda-docs-${VERSION}`;
const CACHE_ASSETS = `stock-tienda-assets-${VERSION}`;
const CACHE_SHELL = `stock-tienda-shell-${VERSION}`;

const FALLBACK_OFFLINE = "/offline.html";

// Rutas que tiene sentido abrir sin conexión. El resto necesita servidor y es
// más honesto mostrar el fallback que una pantalla a medias.
const RUTAS_OFFLINE = ["/vender"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll([FALLBACK_OFFLINE, "/icono.svg"]))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((n) => n.startsWith("stock-tienda-") && !n.endsWith(VERSION))
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/** ¿Es una navegación a una pantalla que soportamos sin conexión? */
function esNavegacionOffline(request, url) {
  if (request.mode !== "navigate") return false;
  return RUTAS_OFFLINE.some((r) => url.pathname === r || url.pathname.startsWith(`${r}/`));
}

async function redPrimero(request, cacheName) {
  try {
    const respuesta = await fetch(request);
    // Solo se guarda una respuesta buena y completa. Un 302 al login o un 500
    // cacheados serían peores que no tener nada.
    if (respuesta.ok && respuesta.type === "basic") {
      const cache = await caches.open(cacheName);
      cache.put(request, respuesta.clone());
    }
    return respuesta;
  } catch {
    const cacheada = await caches.match(request, { ignoreSearch: true });
    if (cacheada) return cacheada;
    const fallback = await caches.match(FALLBACK_OFFLINE);
    if (fallback) return fallback;
    throw new Error("offline");
  }
}

async function cachePrimero(request, cacheName) {
  const cacheada = await caches.match(request);
  if (cacheada) return cacheada;
  const respuesta = await fetch(request);
  if (respuesta.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, respuesta.clone());
  }
  return respuesta;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo GET. Las server actions son POST al mismo path que la página: si se
  // cachearan, un reintento podría "responder" una venta que nunca ocurrió.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Los pedidos RSC de la navegación en cliente se dejan pasar sin tocar:
  // servir un payload de RSC viejo rompe el router de formas difíciles de
  // diagnosticar. Sin conexión fallan, y la UI muestra el estado offline.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cachePrimero(request, CACHE_ASSETS));
    return;
  }

  if (url.pathname === "/icono.svg" || url.pathname === "/icono-maskable.svg") {
    event.respondWith(cachePrimero(request, CACHE_SHELL));
    return;
  }

  if (esNavegacionOffline(request, url)) {
    event.respondWith(redPrimero(request, CACHE_DOCS));
  }
});
