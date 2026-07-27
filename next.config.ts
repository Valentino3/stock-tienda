import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
