import { test, expect } from "@playwright/test";
import { ESTADO_AUTH } from "./helpers";

/**
 * El mozo carga el pedido tocando la carta por categorías, junta todo en la
 * bandeja y lo agrega de una vez.
 *
 * Usa la mesa 1 de la Terraza y la deja libre (cobro-mesa la usa después).
 */

test.use({ storageState: ESTADO_AUTH.resto });

test("se elige de la carta, se junta en la bandeja y entra todo junto", async ({ page }) => {
  await page.goto("/salon");
  await page.getByRole("button", { name: /^1/ }).last().click();
  await page.waitForURL(/\/salon\/\d+/);

  await page.getByRole("tab", { name: "Principales" }).click();
  const milanesa = page.getByRole("button", { name: "Elegir Milanesa napolitana" });
  await milanesa.click();
  await milanesa.click();
  await page.getByRole("tab", { name: "Bebidas" }).click();
  await page.getByRole("button", { name: /^Elegir Vino/ }).click();

  // Todavía no entró nada a la comanda: está en la bandeja.
  const bandeja = page.getByLabel("Por agregar");
  await expect(bandeja).toContainText("Milanesa napolitana");
  await expect(page.getByText(/la comanda está vacía/i)).toBeVisible();

  await page.getByRole("button", { name: "Agregar a la comanda (3)" }).click();
  await expect(bandeja).toHaveCount(0);
  const mila = page.getByRole("listitem").filter({ hasText: "Milanesa napolitana" });
  await expect(mila.getByText(/^2 ×/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Vino" })).toHaveCount(1);
  await expect(page.getByText("$ 28.000,00").first()).toBeVisible();

  // Se libera la mesa: nada se mandó a cocina, se cancela sin motivo.
  await page.getByRole("button", { name: /cancelar comanda/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /cancelar la mesa/i }).click();
  await page.waitForURL(/\/salon$/);
});
