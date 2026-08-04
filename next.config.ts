import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-forge (firma CMS del pedido a ARCA) y qrcode (QR del comprobante) son
  // CJS con `require` dinámico — qrcode además tiene un `pngjs` opcional — y el
  // bundler de Next los maneja de forma inconsistente. Externalizarlos es gratis,
  // achica el bundle de la función y adelanta la clase de fallos "anda en dev,
  // rompe en producción". fast-xml-parser bundlea bien y se deja adentro.
  serverExternalPackages: ["node-forge", "qrcode"],
  experimental: {
    // El default de Next para Server Actions es 1 MB. Lo subimos, pero NO más
    // allá de 4 MB: el techo real es de la plataforma, no de Next. Vercel corta
    // cualquier request con body mayor a 4.5 MB con 413 antes de que el código
    // se ejecute, en todos los planes.
    // https://vercel.com/docs/functions/limitations#request-body-size
    // Las subidas del import van por route handler y se validan contra
    // MAX_UPLOAD_BYTES en src/lib/import-limits.ts.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      {
        // El service worker no se cachea nunca: si el navegador sirviera una
        // copia vieja de /sw.js, la app quedaría clavada en una versión
        // anterior sin forma de actualizarse. Ver public/sw.js.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
