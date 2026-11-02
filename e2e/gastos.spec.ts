import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Gastos por rubro: un sueldo pagado por transferencia (fuera de la caja) y un
 * gasto de limpieza pagado desde la caja terminan juntos en el resumen por
 * rubro. Un gasto mal cargado se anula con motivo y deja de sumar.
 *
 * Abre una caja propia y la deja cerrada: los specs que vienen después afirman
 * arqueos desde una caja vacía.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

const filaDeRubro = (page: import("@playwright/test").Page, rubro: string) =>
  page.getByRole("table", { name: "Gastos por rubro" }).getByRole("row")
    .filter({ has: page.getByRole("cell", { name: rubro, exact: true }) });

test("un sueldo fuera de caja y un gasto de caja quedan en su rubro", async ({ page }) => {
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 5000);

  // Gasto desde la caja, con rubro.
  await page.getByLabel(/^monto$/i).fill("1200");
  await page.getByLabel(/descripción/i).fill("Lavandina");
  await page.getByLabel(/^rubro$/i).selectOption({ label: "Limpieza" });
  await page.getByRole("button", { name: /^registrar$/i }).click();
  await expect(page.getByText("Lavandina")).toBeVisible();

  // Sueldo por transferencia, fuera de la caja.
  await page.goto("/gastos");
  await page.getByLabel("Rubro", { exact: true }).first().selectOption({ label: "Sueldos y jornales" });
  await page.getByLabel("Monto").fill("250000");
  await page.getByLabel("Detalle").fill("Sueldo — Juan");
  await page.getByRole("button", { name: /registrar gasto/i }).click();
  await expect(page.getByText("Sueldo — Juan")).toBeVisible();

  await expect(filaDeRubro(page, "Sueldos y jornales")).toContainText("$ 250.000,00");
  await expect(filaDeRubro(page, "Limpieza")).toContainText("$ 1.200,00");

  // El sueldo no entra en el arqueo: solo los 1.200 del gasto de caja.
  const arqueo = await cerrarCaja(page, 3800);
  expect(arqueo.esperado).toBe(3800);
});

test("un gasto mal cargado se anula con motivo y deja de sumar", async ({ page }) => {
  await page.goto("/gastos");
  const fila = page.getByRole("row").filter({ hasText: "Sueldo — Juan" });
  await fila.getByRole("button", { name: "Anular" }).click();
  const dialogo = page.getByRole("alertdialog");
  await dialogo.getByLabel("Motivo").fill("Cargado en el mes equivocado");
  await dialogo.getByRole("button", { name: /^anular$/i }).click();

  await expect(fila).toContainText("Anulado: Cargado en el mes equivocado");
  await expect(filaDeRubro(page, "Sueldos y jornales")).toHaveCount(0);
});
