import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Una mesa que paga con dos medios en la misma tanda: «6 mil en efectivo y el
 * resto con tarjeta». El arqueo tiene que esperar solo el efectivo.
 *
 * Abre una caja propia y la deja cerrada: los specs que vienen después
 * afirman montos de arqueo desde una caja vacía. Usa la mesa 1 de la Terraza,
 * que ningún otro spec toca.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

test("se cobra una mesa con efectivo y tarjeta a la vez", async ({ page }) => {
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 0);

  await page.goto("/salon");
  await page.getByRole("button", { name: /^1/ }).last().click();
  await page.waitForURL(/\/salon\/\d+/);

  await page.getByPlaceholder(/buscar plato o producto/i).fill("Milanesa");
  await page.getByRole("button", { name: /milanesa/i }).first().click();
  const linea = page.getByRole("listitem").filter({ hasText: "Milanesa napolitana" });
  await expect(linea).toHaveCount(1);
  await linea.getByRole("button", { name: /sumar uno/i }).click();
  await expect(page.getByText("$ 16.000,00").first()).toBeVisible();

  // Cuánto le toca a cada uno, solo de referencia.
  await page.getByLabel(/dividir entre cuántas personas/i).fill("2");
  await expect(page.getByText(/8\.000,00 c\/u/)).toBeVisible();

  await page.getByLabel(/dividir el pago entre varios medios/i).check();
  const cobrar = page.getByRole("button", { name: /^cobrar todo$/i });
  await page.getByLabel(/monto en efectivo/i).fill("6000");
  await expect(page.getByText(/falta \$\s*10\.000,00/i)).toBeVisible();
  await expect(cobrar).toBeDisabled();

  await page.getByRole("button", { name: /poner lo que falta en tarjeta/i }).click();
  await expect(page.getByText(/repartido completo/i)).toBeVisible();
  await cobrar.click();
  await page.waitForURL(/\/salon$/);
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();
});

test("el arqueo espera solo la parte en efectivo", async ({ page }) => {
  const arqueo = await cerrarCaja(page, 6000);
  expect(arqueo.esperado).toBe(6000);
  expect(arqueo.cuadra).toBe(true);
});
