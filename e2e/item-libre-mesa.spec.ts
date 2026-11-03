import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Lo que no está en la carta, cargado en la mesa con nombre, precio y cantidad
 * escritos por el mozo. Se cobra con ese precio y queda en el listado de ítems
 * libres de Reportes.
 *
 * Abre una caja propia y la deja cerrada. Usa la mesa 1 de la Terraza y la
 * deja libre.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

test("se carga un ítem libre en la mesa y se cobra", async ({ page }) => {
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 0);

  await page.goto("/salon");
  await page.getByRole("button", { name: /^1/ }).last().click();
  await page.waitForURL(/\/salon\/\d+/);

  await page.getByRole("button", { name: /ítem libre/i }).click();
  const form = page.getByRole("form", { name: "Ítem libre" });
  await form.getByLabel("Qué se vende").fill("Descorche");
  await form.getByLabel("Precio").fill("3500");
  await form.getByLabel("Cantidad").fill("2");
  await form.getByRole("button", { name: "Agregar" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: "Descorche" })).toHaveCount(1);
  await expect(page.getByText("$ 7.000,00").first()).toBeVisible();

  await page.getByRole("button", { name: /^cobrar todo$/i }).click();
  await page.waitForURL(/\/salon$/);
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  await page.goto("/reportes");
  await expect(page.getByRole("table", { name: "Ítems libres" })).toContainText("Descorche");

  const arqueo = await cerrarCaja(page, 7000);
  expect(arqueo.esperado).toBe(7000);
});
