import { test, expect } from "@playwright/test";
import { ESTADO_AUTH } from "./helpers";

/**
 * Un proveedor con dos facturas y un pago a cuenta: el pago cubre primero la
 * que vence antes, lo que queda vencido se ve en la lista, y la compra suma
 * en Gastos en su rubro.
 *
 * Nada de esto toca la caja.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

test("facturas, un pago a cuenta y lo que queda vencido", async ({ page }) => {
  await page.goto("/proveedores");
  await page.getByRole("button", { name: "+ Nuevo proveedor" }).click();
  await page.getByLabel("Nombre").fill("Carnicería Don Pedro");
  await page.getByLabel("Rubro").selectOption({ label: "Mercadería" });
  await page.getByLabel(/plazo de pago/i).fill("30");
  await page.getByRole("button", { name: /^guardar$/i }).click();
  await page.waitForURL(/\/proveedores\/\d+/);
  await expect(page.getByRole("heading", { name: "Carnicería Don Pedro" })).toBeVisible();

  // Una de hoy (vence en 30 días) y una vieja ya vencida.
  await page.getByLabel("Número de factura").fill("0001-00000100");
  await page.getByLabel("Total").fill("100000");
  await page.getByRole("button", { name: "Cargar factura" }).click();
  await expect(page.getByText("Factura 0001-00000100 cargada")).toBeVisible();

  await page.getByLabel("Número de factura").fill("0001-00000050");
  await page.getByLabel("Fecha", { exact: true }).first().fill("2026-10-01");
  await page.getByLabel("Vence").fill("2026-10-15");
  await page.getByLabel("Total").fill("50000");
  await page.getByRole("button", { name: "Cargar factura" }).click();
  await expect(page.getByText("Factura 0001-00000050 cargada")).toBeVisible();

  // Pago a cuenta: cubre primero la que vence antes.
  await page.getByLabel("Monto").fill("30000");
  await page.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText("Pago registrado")).toBeVisible();

  const facturas = page.getByRole("table", { name: "Facturas" });
  await expect(facturas.getByRole("row").filter({ hasText: "0001-00000050" })).toContainText(/20\.000,00 · vencida/);
  await expect(facturas.getByRole("row").filter({ hasText: "0001-00000100" })).toContainText("100.000,00");

  await page.goto("/proveedores?ver=vencidas");
  const fila = page.getByRole("table", { name: "Proveedores" }).getByRole("row").filter({ hasText: "Carnicería Don Pedro" });
  await expect(fila).toContainText("120.000,00");
  await expect(fila).toContainText("20.000,00");

  // La factura de este mes suma en Gastos, en su rubro, como compra.
  await page.goto("/gastos");
  const mercaderia = page.getByRole("table", { name: "Gastos por rubro" }).getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Mercadería", exact: true }) });
  await expect(mercaderia).toContainText("100.000,00");
});

test("la misma factura no se carga dos veces", async ({ page }) => {
  await page.goto("/proveedores");
  await page.getByRole("link", { name: "Carnicería Don Pedro" }).click();
  await page.getByLabel("Número de factura").fill("0001-00000100");
  await page.getByLabel("Total").fill("100000");
  await page.getByRole("button", { name: "Cargar factura" }).click();
  await expect(page.getByText(/esa factura de ese proveedor ya está cargada/i)).toBeVisible();
});
