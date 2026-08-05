import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.e2e" });

/**
 * Tests de navegador.
 *
 * Cubren lo único que los 572 tests de dominio no pueden ver: que la interfaz
 * conecte bien con el dominio. Por eso son pocos y van a los caminos de plata
 * —cobrar, arquear, facturar— en vez de a cada pantalla. Un E2E que falla por
 * una etiqueta que cambió es un E2E que en dos meses nadie mira.
 *
 * Corren contra el Postgres de Docker, nunca contra Neon. Ver docker-compose.yml.
 */

const PUERTO = 3100;
export const BASE_URL = `http://localhost:${PUERTO}`;

export default defineConfig({
  testDir: "./e2e",
  // Siembra la base en cada corrida. Ver e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  // Cada spec siembra y consume la MISMA base. En paralelo se pisarían el
  // stock, la caja abierta y la numeración de comprobantes. Serial es más
  // lento y es el único modo en que los números significan algo.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Se loguea una vez y deja la sesión en disco. Ver e2e/auth.setup.ts.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],

  webServer: {
    // `build && start` y no `dev`: en dev, Next compila cada ruta en el primer
    // acceso y el primer clic de cada pantalla tarda segundos. Además es el
    // build que se despliega, que es lo que interesa probar.
    command: `npm run build && npx next start -p ${PUERTO}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      DB_DRIVER: "pg",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
      BETTER_AUTH_URL: BASE_URL,
      ARCA_MASTER_KEY: process.env.ARCA_MASTER_KEY!,
      ARCA_MASTER_KEY_ID: process.env.ARCA_MASTER_KEY_ID ?? "e2e",
      ARCA_ALLOW_PRODUCCION: "",
    },
  },
});
