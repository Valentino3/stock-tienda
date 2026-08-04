import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

/**
 * Manifest de la app instalable.
 *
 * Instalarla no es cosmético: en una feria sin conexión, una pestaña común
 * puede cerrarse por accidente o quedar tapada, y con ella se va la cola de
 * ventas pendientes. En modo standalone la app es una ventana propia, sin
 * barra de direcciones que invite a navegar a otro lado.
 *
 * `start_url` apunta a /vender porque es la única pantalla que funciona sin
 * conexión: abrir en la home mostraría un error justo cuando más molesta.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — Punto de venta`,
    short_name: APP_NAME,
    description: "Stock y ventas del mostrador. Vende sin conexión y sincroniza al volver.",
    start_url: "/vender",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "es-AR",
    background_color: "#fafafb",
    theme_color: "#3b5bd6",
    // PNG primero y SVG como extra: varios launchers de Android ignoran el SVG
    // en silencio y muestran un ícono genérico. Los PNG los genera
    // scripts/generar-iconos.ts (sin dependencias: el ícono son rectángulos).
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icono.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
