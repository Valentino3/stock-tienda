import { test, expect } from "@playwright/test";
import { ESTADO_AUTH } from "./helpers";

/**
 * Las mesas se editan, se desactivan y se borran; y una mesa nueva pregunta
 * cuántos son al abrirla.
 *
 * Usa una mesa propia en un sector propio ("Patio") con un nombre que no
 * empieza con número: los demás specs eligen mesas por `/^1/`, `/^2/`. La deja
 * desactivada, así que no aparece en el salón de los que vienen después.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

// La tarjeta de la lista, no la del plano, que dibuja la misma mesa.
const tarjeta = (page: import("@playwright/test").Page, nombre: string) =>
  page.getByRole("article", { name: `Mesa ${nombre}` });

test("una mesa cargada por error se borra", async ({ page }) => {
  await page.goto("/mesas");
  await page.getByRole("button", { name: "+ Nueva mesa" }).click();
  await page.getByLabel("Nombre").fill("Errónea");
  await page.getByLabel("Sector").fill("Patio");
  await page.getByRole("button", { name: /^crear$/i }).click();
  await expect(tarjeta(page, "Errónea")).toBeVisible();

  await tarjeta(page, "Errónea").getByRole("button", { name: "Borrar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByText("Errónea", { exact: true })).toHaveCount(0);
});

test("se edita, pregunta comensales al abrirla y, ya usada, se desactiva en vez de borrarse", async ({ page }) => {
  await page.goto("/mesas");
  await page.getByRole("button", { name: "+ Nueva mesa" }).click();
  await page.getByLabel("Nombre").fill("Parra");
  await page.getByLabel("Sector").fill("Patio");
  await page.getByRole("button", { name: /^crear$/i }).click();

  await tarjeta(page, "Parra").getByRole("button", { name: "Editar mesa Parra" }).click();
  await page.getByLabel("Nombre").fill("Parrita");
  await page.getByLabel(/lugares/i).fill("6");
  await page.getByRole("button", { name: /^guardar$/i }).click();
  await expect(tarjeta(page, "Parrita")).toContainText("6 lugares");

  // Al abrirla, la comanda vacía pregunta cuántos son.
  await page.goto("/salon");
  await page.getByRole("button", { name: /^Parrita/ }).click();
  await page.waitForURL(/\/salon\/\d+/);
  await expect(page.getByText("¿Cuántos son?")).toBeVisible();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await expect(page.getByText("¿Cuántos son?")).toHaveCount(0);
  await expect(page.getByLabel("Cantidad de comensales")).toHaveValue("4");

  // Ya se usó: no se puede borrar, se desactiva. Primero hay que liberarla.
  await page.getByRole("button", { name: /cancelar comanda/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /cancelar la mesa/i }).click();
  await page.waitForURL(/\/salon$/);

  await page.goto("/mesas");
  const parrita = tarjeta(page, "Parrita");
  await expect(parrita.getByRole("button", { name: "Borrar" })).toHaveCount(0);
  await parrita.getByRole("button", { name: "Desactivar" }).click();
  await expect(parrita).toContainText("desactivada");

  await page.goto("/salon");
  await expect(page.getByRole("button", { name: /^Parrita/ })).toHaveCount(0);
});
