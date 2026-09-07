import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Cobrar una venta con dos medios a la vez.
 *
 * El pago dividido se juzga cerrando la caja, no mirando la pantalla de venta:
 * lo que importa es que al cajón entre SOLO la parte en efectivo. Si el arqueo
 * sumara el total de la venta, el turno cerraría con un sobrante que nadie
 * puede explicar — y ese es exactamente el bug que esta feature podía
 * introducir.
 *
 * Abre y cierra su propia caja, y usa una carta del catálogo: no toca el
 * "Sobre Pokémon" ni los montos que afirman venta-mostrador y cuenta-dividida.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

const SKU = "PKM-PIK-JU-NM-EN";
const TOTAL = 12000;
const EN_EFECTIVO = 5000;

test("una venta cobrada en dos medios suma al arqueo solo la parte en efectivo", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill(SKU);
  await page.getByRole("button", { name: /pikachu/i }).first().click();
  await expect(page.getByText("$ 12.000,00").first()).toBeVisible();

  await page.getByRole("button", { name: /dividir pago/i }).click();

  // Al abrir, el reparto arranca con el medio ya elegido y el total completo:
  // el estado inicial equivale a la venta simple.
  const efectivo = page.getByLabel(/monto en efectivo/i);
  await expect(efectivo).toHaveValue(String(TOTAL));

  await efectivo.fill(String(EN_EFECTIVO));
  // Con el reparto incompleto no se puede cobrar.
  await expect(page.getByRole("button", { name: /falta repartir/i })).toBeDisabled();

  // El boton "resto" completa la otra parte con lo que falta.
  const filaTarjeta = page.locator("div").filter({ has: page.getByLabel(/monto en tarjeta/i) }).last();
  await filaTarjeta.getByRole("button", { name: /^resto$/i }).click();
  await expect(page.getByLabel(/monto en tarjeta/i)).toHaveValue(String(TOTAL - EN_EFECTIVO));

  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  // Lo que importa: al cajón entró solo lo cobrado en efectivo.
  const arqueo = await cerrarCaja(page, EN_EFECTIVO);
  expect(arqueo.esperado).toBe(EN_EFECTIVO);
  expect(arqueo.cuadra).toBe(true);
});
