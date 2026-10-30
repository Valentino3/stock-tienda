import { test, expect, type Page } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta } from "./helpers";

/**
 * Lo que ya está en la cocina no se borra: se anula, con motivo, y la cocina
 * se entera.
 *
 * Es el camino completo entre las dos pantallas: el mozo anula una parte de
 * una línea, la cuenta baja, la cocina ve «ANULADO» con el motivo y lo da por
 * leído. Después se cancela la mesa entera, que con algo en la cocina exige
 * motivo y le llega a la cocina como «MESA CANCELADA».
 *
 * Usa la mesa 2 de la Terraza, que ningún otro spec toca, y la deja libre.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

let urlDeLaMesa = "";

const tarjetaEnCocina = (page: Page) =>
  page.locator("article").filter({ hasText: "Mesa 2" }).filter({ hasText: "Terraza" });

test("anular una parte de lo mandado: la cuenta baja y queda el motivo", async ({ page }) => {
  await asegurarCajaAbierta(page);
  await page.goto("/salon");
  await page.getByRole("button", { name: /^2/ }).last().click();
  await page.waitForURL(/\/salon\/\d+/);
  urlDeLaMesa = page.url();

  const buscador = page.getByPlaceholder(/buscar plato o producto/i);
  await buscador.fill("Milanesa");
  await page.getByRole("button", { name: /milanesa/i }).first().click();
  const linea = page.getByRole("listitem").filter({ hasText: "Milanesa napolitana" });
  await expect(linea).toHaveCount(1);
  await linea.getByRole("button", { name: /sumar uno/i }).click();
  await expect(linea.getByText(/^2 ×/)).toBeVisible();

  await page.getByRole("button", { name: /mandar a cocina/i }).click();
  await expect(linea.getByText(/en cocina/)).toBeVisible();
  // Ya en la cocina, no se puede restar ni borrar en el lugar.
  await expect(linea.getByRole("button", { name: /restar uno/i })).toHaveCount(0);
  await expect(linea.getByRole("button", { name: /^quitar$/i })).toHaveCount(0);

  await linea.getByRole("button", { name: /anular milanesa/i }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: /uno menos/i }).click();
  // Sin motivo no se puede confirmar.
  await expect(dialogo.getByRole("button", { name: /^anular$/i })).toBeDisabled();
  await dialogo.getByRole("button", { name: "Error de carga" }).click();
  await dialogo.getByRole("button", { name: /^anular$/i }).click();

  await expect(page.getByText(/1 anulado · Error de carga/)).toBeVisible();
  await expect(page.getByText("$ 8.000,00").first()).toBeVisible();
});

test("la cocina ve ANULADO con el motivo, y lo da por leído", async ({ page }) => {
  await page.goto("/cocina");
  const tarjeta = tarjetaEnCocina(page);
  await expect(tarjeta.getByText("ANULADO")).toBeVisible();
  await expect(tarjeta.getByText("Error de carga")).toBeVisible();

  await tarjeta.getByRole("button", { name: /entendido/i }).click();
  await expect(tarjeta.getByText("ANULADO")).toHaveCount(0);
  // Lo que sigue vivo se sigue viendo.
  await expect(tarjeta.getByText("Milanesa napolitana")).toBeVisible();
});

test("cancelar la mesa con algo en la cocina exige motivo y avisa a la cocina", async ({ page }) => {
  await page.goto(urlDeLaMesa);
  await page.getByRole("button", { name: /cancelar comanda/i }).click();

  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/en la cocina/)).toBeVisible();
  const confirmar = dialogo.getByRole("button", { name: /cancelar la mesa/i });
  await expect(confirmar).toBeDisabled();
  await dialogo.getByRole("button", { name: "Demora" }).click();
  await confirmar.click();
  await page.waitForURL(/\/salon$/);

  await page.goto("/cocina");
  const tarjeta = tarjetaEnCocina(page);
  await expect(tarjeta.getByText(/mesa cancelada/i)).toBeVisible();
  await tarjeta.getByRole("button", { name: /entendido/i }).click();
  await expect(tarjeta).toHaveCount(0);
});
