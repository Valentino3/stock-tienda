import { test, expect, type Page } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta } from "./helpers";

/**
 * La cocina saca lo que preparó y marca lo que se acabó; el salón se entera.
 *
 * El plato sale de la pantalla de cocina cuando la cocina toca «Listo», no
 * cuando la mesa paga, y el mozo lo ve listo para retirar. Lo agotado sigue
 * apareciendo en el buscador del mozo, tachado, y no se puede pedir.
 *
 * Usa la mesa 3 de la Terraza, que ningún otro spec toca, y la deja libre.
 * Desmarca el agotado al final: «Ensalada César» la piden otros specs.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

let urlDeLaMesa = "";

const tarjeta = (page: Page) =>
  page.locator("article").filter({ hasText: "Mesa 3" }).filter({ hasText: "Terraza" });

test("lo que la cocina marca listo sale de la pantalla y el mozo lo ve listo", async ({ page }) => {
  await asegurarCajaAbierta(page);
  await page.goto("/salon");
  await page.getByRole("button", { name: /^3/ }).last().click();
  await page.waitForURL(/\/salon\/\d+/);
  urlDeLaMesa = page.url();

  await page.getByPlaceholder(/buscar plato o producto/i).fill("Milanesa");
  await page.getByRole("button", { name: /milanesa/i }).first().click();
  const linea = page.getByRole("listitem").filter({ hasText: "Milanesa napolitana" });
  await expect(linea).toHaveCount(1);
  await page.getByRole("button", { name: /mandar a cocina/i }).click();
  await expect(linea.getByText(/en cocina/)).toBeVisible();

  await page.goto("/cocina");
  await expect(tarjeta(page).getByText("Milanesa napolitana")).toBeVisible();
  await tarjeta(page).getByRole("button", { name: "Listo: Milanesa napolitana" }).click();
  await expect(tarjeta(page)).toHaveCount(0);

  await page.goto(urlDeLaMesa);
  await expect(linea.getByText(/listo/)).toBeVisible();
});

test("lo agotado en la cocina no se puede pedir en el salón", async ({ page }) => {
  await page.goto("/cocina");
  await page.getByRole("button", { name: /^agotados/i }).click();
  const ensalada = page.getByRole("region", { name: "Agotados" }).getByRole("button", { name: "Ensalada César" });
  await ensalada.click();
  await expect(ensalada).toHaveAttribute("aria-pressed", "true");

  await page.goto(urlDeLaMesa);
  await page.getByPlaceholder(/buscar plato o producto/i).fill("Ensalada");
  const opcion = page.getByRole("button", { name: /ensalada/i }).first();
  await expect(opcion).toContainText("Agotado");
  await expect(opcion).toBeDisabled();

  // Se desmarca: otros specs piden ensalada.
  await page.goto("/cocina");
  await page.getByRole("button", { name: /^agotados/i }).click();
  const deNuevo = page.getByRole("region", { name: "Agotados" }).getByRole("button", { name: "Ensalada César" });
  await deNuevo.click();
  await expect(deNuevo).toHaveAttribute("aria-pressed", "false");
});

test("se libera la mesa", async ({ page }) => {
  await page.goto(urlDeLaMesa);
  await page.getByRole("button", { name: /cancelar comanda/i }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: "Error de carga" }).click();
  await dialogo.getByRole("button", { name: /cancelar la mesa/i }).click();
  await page.waitForURL(/\/salon$/);

  // La cocina recibe la cancelación aunque el plato ya hubiera salido.
  await page.goto("/cocina");
  await tarjeta(page).getByRole("button", { name: /entendido/i }).click();
  await expect(tarjeta(page)).toHaveCount(0);
});
