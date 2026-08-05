import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Venta de mostrador en un comercio con stock.
 *
 * Es el camino que ya usan los dos locales en producción todos los días. Vive
 * en la suite para que las fases de gastronomía no lo rompan sin que nadie se
 * entere: es el riesgo real de meterle un rubro nuevo a una app que ya cobra.
 */

test.describe.configure({ mode: "serial" });
// Sesión ya iniciada por el proyecto `setup`.
test.use({ storageState: ESTADO_AUTH.cartas });

test("vender descuenta stock y suma al arqueo", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill("Sobre");
  const opcion = page.getByRole("button", { name: /sobre pok/i }).first();
  await expect(opcion).toBeVisible();
  await opcion.click();

  // Dos sobres a 5000.
  await page.getByRole("button", { name: /sumar uno/i }).click();
  await expect(page.getByText("$ 10.000,00").first()).toBeVisible();

  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  // 10 del seed menos 2.
  await page.goto("/productos");
  await expect(page.getByRole("row", { name: /sobre pok/i }).getByText("8")).toBeVisible();

  // El arqueo tiene que dar exactamente lo cobrado.
  const arqueo = await cerrarCaja(page, 10000);
  expect(arqueo.esperado).toBe(10000);
  expect(arqueo.cuadra).toBe(true);
});

test("no deja vender sin stock", async ({ page }) => {
  await asegurarCajaAbierta(page);
  await page.goto("/productos");

  // Se lleva el stock a cero con un ajuste y se intenta vender igual.
  const fila = page.getByRole("row", { name: /sobre pok/i });
  await fila.getByRole("button", { name: /ajustar/i }).click();

  // El popover y su disparador se llaman los dos "Ajustar": hay que apuntar
  // adentro del popover para no volver a clickear el que lo abre.
  const popover = page.getByRole("dialog");
  await popover.getByLabel(/nuevo stock/i).fill("0");
  await popover.getByLabel(/motivo/i).fill("test e2e");
  await popover.getByRole("button", { name: /^ajustar$/i }).click();
  await expect(popover).toBeHidden();

  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill("Sobre");
  await page.getByRole("button", { name: /sobre pok/i }).first().click();

  // El carrito se niega: es la guarda que impide sobrevender.
  await expect(page.getByText(/sin stock/i)).toBeVisible();
});
