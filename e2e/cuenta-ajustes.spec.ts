import { test, expect, type Page } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Corregir una cuenta corriente desde la pantalla: sumar deuda a mano, restarla
 * sin cobro, y anular un cobro mal cargado.
 *
 * Se juzga igual que el resto de los caminos de plata: cerrando la caja. El
 * cobro anulado era en efectivo, así que si la anulación no llegara al arqueo
 * la caja cerraría esperando plata que no está en el cajón.
 *
 * Arranca de una caja propia y en cero, y usa un cliente propio: no depende de
 * lo que dejaron los specs anteriores ni les deja nada.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

const CLIENTE = "Cliente Libreta E2E";

async function movimiento(page: Page, tipo: RegExp, monto: number, texto: string) {
  const fila = page.getByRole("row", { name: new RegExp(CLIENTE, "i") });
  await fila.getByRole("button", { name: /^cuenta$/i }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: tipo }).click();
  await dialogo.getByLabel(/^monto$/i).fill(String(monto));
  await dialogo.getByLabel(/motivo|nota/i).fill(texto);
  await dialogo.getByRole("button", { name: /registrar/i }).click();
  await expect(dialogo).toBeHidden();
}

test("cargo manual, ajuste y anular un cobro: el saldo y la caja cuadran", async ({ page }) => {
  // Caja nueva en cero: si un spec anterior dejó una abierta, se cierra.
  await page.goto("/caja");
  if (await page.getByRole("button", { name: /^cerrar caja$/i }).isVisible().catch(() => false)) {
    await cerrarCaja(page, 0);
  }
  await asegurarCajaAbierta(page, 0);

  await page.goto("/clientes");
  await page.getByPlaceholder(/nombre del cliente/i).fill(CLIENTE);
  await page.getByRole("button", { name: /agregar cliente/i }).click();
  const fila = page.getByRole("row", { name: new RegExp(CLIENTE, "i") });
  await expect(fila).toBeVisible();

  // Sumar: una deuda de la libreta. Restar: un descuento. Ninguno pide medio.
  await movimiento(page, /cargo manual/i, 10000, "Libreta de papel");
  await expect(fila).toContainText(/10\.000,00/);
  await movimiento(page, /ajuste/i, 2000, "Descuento acordado");
  await expect(fila).toContainText(/8\.000,00/);

  // Un cobro en efectivo que en realidad no pasó.
  await movimiento(page, /cobro de deuda/i, 3000, "Cobro equivocado");
  await expect(fila).toContainText(/5\.000,00/);

  // Anularlo desde la ficha: el más nuevo arriba, así que el primer "Anular"
  // es el del cobro. El título del diálogo lo confirma.
  await fila.getByRole("link", { name: new RegExp(CLIENTE, "i") }).click();
  await page.waitForURL(/\/clientes\/\d+$/);
  await page.getByRole("button", { name: /^anular$/i }).first().click();
  const confirmar = page.getByRole("alertdialog");
  await expect(confirmar).toContainText(/el cobro de \$\s3\.000,00/i);
  await confirmar.getByLabel(/motivo de la anulación/i).fill("Se cobró en el otro local");
  await confirmar.getByRole("button", { name: /anular movimiento/i }).click();
  await expect(confirmar).toBeHidden();

  // Tachado, con el motivo, y fuera del saldo: vuelve a 8.000.
  await expect(page.getByText("No cuenta")).toBeVisible();
  await expect(page.getByText(/se cobró en el otro local/i)).toBeVisible();
  await expect(page.getByText(/\$\s8\.000,00/).first()).toBeVisible();

  // El registro de la tienda lo muestra entre los anulados.
  await page.goto("/clientes/movimientos?estado=anulados");
  const anulado = page.getByRole("row", { name: new RegExp(CLIENTE, "i") });
  await expect(anulado).toHaveCount(1);
  await expect(anulado).toContainText(/se cobró en el otro local/i);

  // Y la caja no espera los 3.000 que nunca entraron.
  const arqueo = await cerrarCaja(page, 0);
  expect(arqueo.esperado).toBe(0);
  expect(arqueo.cuadra).toBe(true);
});
