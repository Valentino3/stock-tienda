import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Cargar un producto a mano y venderlo.
 *
 * Es el bug que reportó el local: el alta manual creaba la variante sin stock
 * y sin SKU, así que el producto aparecía en Productos pero el carrito lo
 * rechazaba con "Sin stock". Ningún test de dominio lo veía porque el alta
 * vivía entera en un server action.
 *
 * ⚠️ Este archivo ordena ANTES de venta-mostrador.spec.ts (alfabético, un solo
 * worker, base compartida) y usa la misma tienda. Por eso abre y CIERRA su
 * propia caja: si la dejara abierta con una venta adentro, el
 * `expect(arqueo.esperado).toBe(10000)` del otro spec pasaría a dar otra cosa
 * y el fallo aparecería como "la caja no cuadra", que es justo el síntoma que
 * esa suite existe para detectar.
 *
 * Tampoco toca scripts/seed-e2e.ts: el producto lo crea el test desde la UI,
 * que es exactamente el camino bajo prueba.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

// No matchea /sobre pok/i: ese es el producto del seed y los otros specs lo
// seleccionan por ese texto.
const PRODUCTO = "Deck Duelo Manual";
const SKU = "DECK-MANUAL";
const PRECIO = 7000;

async function abrirAltaDeProducto(page: import("@playwright/test").Page) {
  await page.goto("/productos");
  await page.getByRole("button", { name: /nuevo producto/i }).click();
  return page.getByRole("dialog");
}

test("un producto cargado a mano con stock se puede buscar y vender", async ({ page }) => {
  await asegurarCajaAbierta(page);

  const dialogo = await abrirAltaDeProducto(page);
  await dialogo.getByLabel(/^nombre$/i).fill(PRODUCTO);
  await dialogo.getByLabel(/precio base/i).fill(String(PRECIO));
  await dialogo.getByLabel(/c[óo]digo \/ sku/i).fill(SKU);
  await dialogo.getByLabel(/stock inicial/i).fill("3");
  await dialogo.getByRole("button", { name: /guardar/i }).click();
  await expect(dialogo).toBeHidden();

  await expect(page.getByRole("row", { name: new RegExp(PRODUCTO, "i") })).toBeVisible();

  // Por SKU: sin el campo en el alta esto era imposible, y es lo que hace
  // servible un lector de código de barras.
  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill(SKU);
  await expect(page.getByRole("button", { name: new RegExp(PRODUCTO, "i") }).first()).toBeVisible();

  // Y por nombre, que es el camino que el dueño usa en el mostrador.
  await page.getByPlaceholder(/buscar producto o sku/i).fill(PRODUCTO);
  await page.getByRole("button", { name: new RegExp(PRODUCTO, "i") }).first().click();

  // Entra al carrito: no aparece el cartel que antes lo frenaba.
  await expect(page.getByText(/sin stock/i)).toBeHidden();
  await expect(page.getByText("$ 7.000,00").first()).toBeVisible();

  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  await page.goto("/productos");
  // `exact` para no matchear un digito suelto dentro del SKU o del precio.
  await expect(page.getByRole("row", { name: new RegExp(PRODUCTO, "i") })
    .getByText("2", { exact: true })).toBeVisible();

  const arqueo = await cerrarCaja(page, PRECIO);
  expect(arqueo.esperado).toBe(PRECIO);
  expect(arqueo.cuadra).toBe(true);
});

test("cargado sin stock, el aviso se ve al lado del buscador", async ({ page }) => {
  // /vender no se dibuja sin caja abierta, y el test anterior cerro la suya.
  await asegurarCajaAbierta(page);

  const dialogo = await abrirAltaDeProducto(page);
  await dialogo.getByLabel(/^nombre$/i).fill("Deck Sin Stock");
  await dialogo.getByLabel(/precio base/i).fill("1000");

  // El aviso preventivo, mientras se completa el formulario.
  await expect(dialogo.getByText(/no vas a poder agregarlo al carrito/i)).toBeVisible();
  await dialogo.getByRole("button", { name: /guardar/i }).click();
  await expect(dialogo).toBeHidden();

  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill("Deck Sin Stock");
  await page.getByRole("button", { name: /deck sin stock/i }).first().click();

  // El cartel vive junto al buscador y no en la tarjeta de Cobro, que en
  // escritorio es la otra columna: ahí abajo, el clic parecía no hacer nada.
  const aviso = page.getByText(/sin stock: deck sin stock/i);
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(/carg[áa] stock desde productos/i);

  // No hubo ninguna venta, pero la caja se cierra igual: dejarla abierta le
  // pasaria una sesion compartida al spec siguiente.
  const arqueo = await cerrarCaja(page, 0);
  expect(arqueo.esperado).toBe(0);
});
