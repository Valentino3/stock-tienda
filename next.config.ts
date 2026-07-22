import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Las facturas (foto/PDF) para el import con IA superan el límite default
    // de 1 MB de Server Actions.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
