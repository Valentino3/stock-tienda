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

/**
 * La cantidad se puede escribir con el teclado.
 *
 * Usa Pikachu y no "Sobre Pokémon" a propósito: el test de arriba deja el
 * sobre en stock 0, y reponerlo cambiaría la foto de /productos que saca
 * visual.spec.ts. Tampoco vende: los montos exactos del arqueo son de los dos
 * tests de arriba y de cuenta-dividida.
 */
test("la cantidad se puede tipear, y se clampea al stock", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/vender");
  // Por SKU exacto: la búsqueda lo rankea primero, así que `.first()` es la
  // variante que se quiere y no la otra edición de Pikachu.
  await page.getByPlaceholder(/buscar producto o sku/i).fill("PKM-PIK-JU-NM-EN");
  const opcion = page.getByRole("button", { name: /pikachu/i }).first();
  await expect(opcion).toBeVisible();
  await opcion.click();

  const cantidad = page.getByLabel(/^cantidad de/i);
  await expect(cantidad).toHaveValue("1");

  // Tres a 12.000: el total se actualiza mientras se tipea.
  await cantidad.fill("3");
  await expect(page.getByText("$ 36.000,00").first()).toBeVisible();

  // Pedir más de lo que hay muestra lo tipeado, avisa, y cobra el stock.
  await cantidad.fill("99");
  await expect(page.getByRole("alert").getByText(/solo hay 14/i)).toBeVisible();
  await expect(page.getByText("$ 168.000,00").first()).toBeVisible();

  // Vaciar el campo no colapsa la línea ni cambia el total: es un campo a
  // medio escribir, no un pedido de vender cero.
  await cantidad.fill("");
  await expect(page.getByText("$ 168.000,00").first()).toBeVisible();
  await cantidad.blur();
  await expect(cantidad).toHaveValue("14");

  // Los botones siguen siendo el camino de un toque: los usa el helper
  // `pedir()` de servicio-gastronomico.spec.ts.
  await page.getByRole("button", { name: /restar uno/i }).click();
  await expect(cantidad).toHaveValue("13");
  await page.getByRole("button", { name: /sumar uno/i }).click();
  await expect(cantidad).toHaveValue("14");

  // Se deja el carrito vacío: la pantalla la fotografía visual.spec.ts.
  await page.getByRole("button", { name: /quitar/i }).click();
  await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
});
