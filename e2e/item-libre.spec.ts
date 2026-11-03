import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Vender algo que no está en el catálogo, con nombre, precio y cantidad
 * escritos a mano. Aparece con su nombre en Ventas y en el listado de ítems
 * libres de Reportes, con quién lo cargó.
 *
 * Abre una caja propia y la deja cerrada: los specs que vienen después
 * afirman arqueos desde una caja vacía.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

test("se vende un ítem libre y queda registrado", async ({ page }) => {
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 0);

  await page.goto("/vender");
  await page.getByRole("button", { name: /ítem libre/i }).click();
  const form = page.getByRole("form", { name: "Ítem libre" });
  await form.getByLabel("Qué se vende").fill("Torta por encargo");
  await form.getByLabel("Precio").fill("9000");
  await form.getByLabel("Cantidad").fill("2");
  await form.getByRole("button", { name: "Agregar" }).click();

  await expect(page.getByText("Torta por encargo")).toBeVisible();
  await expect(page.getByText("$ 18.000,00").first()).toBeVisible();

  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  await page.goto("/ventas");
  await expect(page.getByRole("group").filter({ hasText: /^\d/ }).first()).toContainText("$ 18.000,00");

  await page.goto("/reportes");
  const libres = page.getByRole("table", { name: "Ítems libres" });
  await expect(libres).toContainText("Torta por encargo");
  await expect(libres).toContainText("Dueño");

  const arqueo = await cerrarCaja(page, 18000);
  expect(arqueo.esperado).toBe(18000);
});
