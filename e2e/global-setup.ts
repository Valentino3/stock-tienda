import { execFileSync } from "node:child_process";

/**
 * Deja la base en un estado conocido antes de CADA corrida.
 *
 * Va acá y no en un script de npm por una razón concreta: si sembrar fuera un
 * paso aparte, correr `playwright test` a secas —que es lo que uno hace todo
 * el día mientras arregla un test— arrancaría sobre lo que dejó la corrida
 * anterior. Mesas ya ocupadas, stock ya descontado, caja ya cerrada. Los tests
 * fallarían por el estado y no por el código, que es la forma más rápida de
 * que una suite E2E deje de creerse.
 *
 * Se ejecuta como proceso aparte a propósito: el seed carga .env.e2e y evalúa
 * src/db/index.ts, y hacerlo dentro del proceso de Playwright dejaría un pool
 * de conexiones abierto que impide que el runner termine.
 */
export default function globalSetup() {
  execFileSync("npx", ["tsx", "scripts/seed-e2e.ts"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
