import { test, expect, type Page } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Cuenta dividida en varias tandas con métodos distintos.
 *
 * Es el caso donde el arqueo se puede desarmar: tres cobros contra la misma
 * mesa, dos de ellos en efectivo y uno con tarjeta, y el cierre de caja tiene
 * que esperar SOLO el efectivo. Un test de dominio verifica los totales; este
 * verifica que la pantalla los junte bien y que la caja cierre.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

async function pedir(page: Page, texto: string, veces = 1) {
  const lineas = page.getByRole("listitem").filter({ hasText: texto });
  for (let i = 0; i < veces; i++) {
    const antes = await lineas.count();
    const buscador = page.getByPlaceholder(/buscar plato o producto/i);
    await expect(buscador).toHaveValue("");
    await buscador.fill(texto);
    await page.getByRole("button", { name: new RegExp(texto, "i") }).first().click();
    await expect(lineas).toHaveCount(antes + 1);
  }
}

test("tres personas pagan por separado y la caja cuadra", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/salon");
  await page.getByRole("button", { name: /^1/ }).first().click();
  await page.waitForURL(/\/salon\/\d+/);

  // Dos milanesas en UNA línea, más una ensalada.
  await pedir(page, "Milanesa");
  await page.getByRole("listitem").filter({ hasText: "Milanesa" })
    .getByRole("button", { name: /sumar uno/i }).click();
  await pedir(page, "Ensalada");

  // Separar una milanesa: sin esto la línea de dos es atómica y no se puede
  // repartir entre dos comensales.
  await page.getByRole("button", { name: /separar una unidad de milanesa/i }).first().click();
  await expect(page.getByRole("listitem").filter({ hasText: "Milanesa" })).toHaveCount(2);

  // Primera tanda: una milanesa en efectivo.
  await page.getByRole("checkbox", { name: /cobrar milanesa/i }).first().check();
  await page.getByRole("button", { name: /cobrar lo elegido/i }).click();
  await expect(page.getByText(/quedan ítems sin cobrar/i)).toBeVisible();
  await expect(page.getByText(/ya cobrado/i)).toBeVisible();

  // Segunda: la otra milanesa con tarjeta.
  await page.getByRole("checkbox", { name: /cobrar milanesa/i }).first().check();
  await page.getByRole("button", { name: /^tarjeta$/i }).click();
  await page.getByRole("button", { name: /cobrar lo elegido/i }).click();
  await expect(page.getByText(/quedan ítems sin cobrar/i)).toBeVisible();

  // Tercera: la ensalada en efectivo, y cierra la mesa.
  await page.getByRole("button", { name: /^efectivo$/i }).click();
  await page.getByRole("button", { name: /^cobrar todo$/i }).click();
  await page.waitForURL(/\/salon$/);
});

test("el arqueo espera solo el efectivo de las tandas", async ({ page }) => {
  // 8000 (milanesa efectivo) + 6500 (ensalada efectivo) = 14500.
  // Los 8000 de tarjeta NO entran al esperado en efectivo.
  const arqueo = await cerrarCaja(page, 14500);
  expect(arqueo.esperado).toBe(14500);
  expect(arqueo.cuadra).toBe(true);
});

test("las tres ventas quedaron registradas por separado", async ({ page }) => {
  await page.goto("/ventas");
  // Dos de 8000 y una de 6500: cada tanda es su propia venta, con su propio
  // comprobante posible.
  await expect(page.getByText("$ 8.000,00").first()).toBeVisible();
  await expect(page.getByText("$ 6.500,00").first()).toBeVisible();
});
