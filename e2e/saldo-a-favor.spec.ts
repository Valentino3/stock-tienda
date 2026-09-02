import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * El circuito del torneo: cobrar la inscripción por adelantado y que el jugador
 * la consuma comprando.
 *
 * El paso que importa es el último: que el efectivo de la inscripción sume al
 * arqueo. Antes no sumaba, y el cajón terminaba el turno con plata que el
 * cierre no explicaba.
 *
 * ⚠️ Tienda de cartas, igual que alta-producto, precios-dolar y
 * venta-mostrador. Dos cosas que este archivo tiene que respetar:
 *   - abre y CIERRA su propia caja;
 *   - vende un producto PROPIO y no el del seed. Venderle una unidad a "Sobre
 *     Pokémon" hace que el `getByText("8")` de venta-mostrador —que espera
 *     10 − 2— pase a encontrar un 7.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

const JUGADOR = "Jugador Torneo E2E";
const PRODUCTO = "Entrada Torneo E2E";
const INSCRIPCION = 20000;

test("cargar crédito, consumirlo vendiendo, y que cuadre la caja", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/productos");
  await page.getByRole("button", { name: /nuevo producto/i }).click();
  const alta = page.getByRole("dialog");
  await alta.getByLabel(/^nombre$/i).fill(PRODUCTO);
  await alta.getByLabel(/precio base/i).fill("5000");
  await alta.getByLabel(/stock inicial/i).fill("4");
  await alta.getByRole("button", { name: /guardar/i }).click();
  await expect(alta).toBeHidden();

  // 1. Cliente nuevo. Acá estaba el bloqueo: con saldo cero el botón de cuenta
  //    estaba deshabilitado y no había forma de cargarle nada.
  await page.goto("/clientes");
  await page.getByPlaceholder(/nombre del cliente/i).fill(JUGADOR);
  await page.getByRole("button", { name: /agregar cliente/i }).click();
  const fila = page.getByRole("row", { name: new RegExp(JUGADOR, "i") });
  await expect(fila).toBeVisible();

  // 2. La inscripción, en efectivo.
  await fila.getByRole("button", { name: /^cuenta$/i }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: /cargar crédito/i }).click();
  await dialogo.getByLabel(/^monto$/i).fill(String(INSCRIPCION));
  await dialogo.getByLabel(/nota/i).fill("Inscripción torneo");
  await dialogo.getByRole("button", { name: /registrar/i }).click();
  await expect(dialogo).toBeHidden();

  // 3. Queda a favor, y se ve como tal — no como "Al día".
  await expect(fila.getByText(/a favor/i)).toBeVisible();
  await expect(fila).toContainText("$ 20.000,00");

  // 4. Compra a cuenta: el crédito se consume solo.
  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill(PRODUCTO);
  await page.getByRole("button", { name: new RegExp(PRODUCTO, "i") }).first().click();
  await page.getByRole("button", { name: /^cuenta$/i }).click();
  // Por valor y no por label: la opción ahora incluye el saldo a favor en el
  // texto, así que un match exacto de label ya no sirve — y ese texto es
  // justamente lo que hace que el cajero encuentre a los inscriptos.
  const selector = page.getByLabel(/cliente/i);
  const opcion = selector.locator("option", { hasText: JUGADOR });
  await expect(opcion).toContainText(/a favor/i);
  await selector.selectOption((await opcion.getAttribute("value"))!);
  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  // 5. El arqueo: entró efectivo por la inscripción, la venta fue a cuenta.
  const arqueo = await cerrarCaja(page, INSCRIPCION);
  expect(arqueo.esperado).toBe(INSCRIPCION);
  expect(arqueo.cuadra).toBe(true);
});
