import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * La mesa cambia de mozo y de lugar en medio del servicio, y al cobrar la
 * venta se le acredita al mozo, no a quien cobra.
 *
 * Abre una caja propia y la deja cerrada, como cobro-mesa: los specs que
 * vienen después afirman arqueos desde una caja vacía. Arranca en la mesa 1
 * del Salón y termina en la 2 de la Terraza, y las deja libres.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

test("se pasa la mesa a otro mozo y a otra mesa, y la venta es del mozo", async ({ page }) => {
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 0);

  await page.goto("/salon");
  await page.getByRole("button", { name: /^1/ }).first().click();
  await page.waitForURL(/\/salon\/\d+/);
  const urlDeLaOrden = page.url();

  await page.getByPlaceholder(/buscar plato o producto/i).fill("Flan");
  await page.getByRole("button", { name: /flan/i }).first().click();
  await expect(page.getByRole("listitem").filter({ hasText: "Flan casero" })).toHaveCount(1);

  // Arranca siendo de quien la abrió.
  const mozo = page.getByLabel("Mozo de la mesa");
  await expect(mozo.locator("option:checked")).toHaveText("Dueño");
  await mozo.selectOption({ label: "Mozo Prueba" });
  await expect(page.getByText(/la mesa pasó a mozo prueba/i)).toBeVisible();

  await page.getByLabel("Pasar a otra mesa").selectOption({ label: "2 · Terraza" });
  await expect(page.getByRole("heading", { name: "Mesa 2" })).toBeVisible();
  expect(page.url()).toBe(urlDeLaOrden);

  // En el salón, la mesa aparece en su lugar nuevo y con su mozo.
  await page.goto("/salon");
  await expect(page.getByRole("button", { name: /^2.*Mozo/ })).toBeVisible();

  await page.goto(urlDeLaOrden);
  await page.getByRole("button", { name: /^cobrar todo$/i }).click();
  await page.waitForURL(/\/salon$/);

  await page.goto("/ventas");
  const fila = page.getByRole("group").filter({ hasText: /^\d/ }).first();
  await expect(fila).toContainText("Mozo Prueba");
  await expect(fila).toContainText(/anotada por Dueño/i);

  await cerrarCaja(page, 3000);
});
