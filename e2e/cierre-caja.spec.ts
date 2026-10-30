import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Lo que el cierre de caja obliga a mirar: las mesas que siguen abiertas y
 * una diferencia grande sin explicar.
 *
 * Abre su propia caja y la deja cerrada. Usa la mesa 2 del Salón y la libera
 * al final.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

test("con una mesa abierta y un faltante grande, el cierre pide confirmar y explicar", async ({ page }) => {
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 2000);

  await page.goto("/salon");
  await page.getByRole("button", { name: /^2/ }).first().click();
  await page.waitForURL(/\/salon\/\d+/);
  const urlDeLaMesa = page.url();

  await page.goto("/caja");
  await expect(page.getByText(/queda una mesa abierta/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Mesa 2" })).toBeVisible();
  const cerrar = page.getByRole("button", { name: /^cerrar caja$/i });
  await expect(cerrar).toBeDisabled();
  await page.getByLabel(/cerrar igual/i).check();

  // Faltan 1.500 de los 2.000 de apertura.
  await page.getByLabel(/efectivo contado/i).fill("500");
  await cerrar.click();
  await expect(page.getByText(/faltante de \$\s*1\.500,00/i)).toBeVisible();

  await page.getByLabel(/^notas/i).fill("Se pagó un proveedor sin cargarlo");
  await cerrar.click();
  await expect(page.getByText("Caja cerrada")).toBeVisible();

  // La mesa queda libre para los specs que siguen.
  await page.goto(urlDeLaMesa);
  await page.getByRole("button", { name: /cancelar comanda/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /cancelar la mesa/i }).click();
  await page.waitForURL(/\/salon$/);
});
