import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Acreditar una venta a un compañero que no está.
 *
 * Es la feature completa vista de punta a punta: elegir el vendedor en el
 * mostrador, que el servidor lo acepte, y que el historial muestre a quién se
 * le acreditó Y quién la anotó. Lo segundo es lo que hace defendible la
 * comisión cuando se discute, así que se verifica igual que lo primero.
 *
 * Abre y cierra su propia caja, y vende una carta del catálogo: no toca el
 * "Sobre Pokémon" ni los montos de arqueo que afirman venta-mostrador y
 * cuenta-dividida.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

// Pikachu Jungle · NM · Inglés: 12.000, stock 14 en el seed.
const SKU = "PKM-PIK-JU-NM-EN";
const PRECIO = 12000;

test("se le acredita la venta a otro vendedor y queda quién la anotó", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill(SKU);
  const opcion = page.getByRole("button", { name: /pikachu/i }).first();
  await expect(opcion).toBeVisible();
  await opcion.click();

  // El selector existe porque la tienda tiene más de un usuario, y arranca en
  // quien está operando.
  const vendedor = page.getByLabel(/^vendedor$/i);
  await expect(vendedor).toBeVisible();
  await expect(vendedor.locator("option").first()).toHaveText(/\(vos\)/);

  await vendedor.selectOption({ label: "Empleado" });
  await expect(page.getByText(/se le acredita a empleado/i)).toBeVisible();

  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  // El historial: acreditada al empleado, anotada por el dueño.
  await page.goto("/ventas");
  // Scopeado a la fila: "Empleado" suelto tambien matchea el <option> del
  // filtro de vendedor, que no es lo que se quiere verificar.
  const fila = page.getByRole("group").filter({ hasText: /^\d/ }).first();
  await expect(fila).toContainText("Empleado");
  await expect(fila).toContainText(/anotada por Dueño/i);

  // Se cierra la caja para no dejarle una sesión abierta al spec siguiente.
  const arqueo = await cerrarCaja(page, PRECIO);
  expect(arqueo.esperado).toBe(PRECIO);
  expect(arqueo.cuadra).toBe(true);
});
