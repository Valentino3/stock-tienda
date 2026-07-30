import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Los tests de dominio levantan una PGlite nueva por caso y le replayan
    // TODAS las migraciones de drizzle/ (ver tests/helpers/db.ts). Con 16
    // migraciones y varios workers en paralelo eso supera los 5 s por defecto,
    // y el fallo aparece como un timeout confuso en un test cualquiera.
    testTimeout: 30_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
