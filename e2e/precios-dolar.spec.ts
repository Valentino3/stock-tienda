import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Cambiar la cotización del dólar y que el mostrador cobre el precio nuevo.
 *
 * El último paso —vender— es el que importa: sin él, todo lo anterior podría
 * estar escribiendo prolijamente en columnas que nadie lee.
 *
 * ⚠️ Corre contra la tienda de cartas, igual que alta-producto y
 * venta-mostrador, así que abre y CIERRA su propia caja. Y crea su propio
 * producto en vez de dolarizar uno del seed: el recálculo solo toca lo que
 * tiene precio en dólares, y ponerle uno a "Sobre Pokémon" cambiaría el
 * `expect(arqueo.esperado).toBe(10000)` de venta-mostrador.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

const PRODUCTO = "Booster Dolarizado";
const USD = 10;
const COTIZACION = 1480;
// 10 × 1480 = 14.800, ya múltiplo de 100.
const PRECIO_ESPERADO = 14800;

test("cargar la cotización recalcula el precio y la caja cobra el nuevo", async ({ page }) => {
  await asegurarCajaAbierta(page);

  // 1. Un producto con precio en dólares y un precio en pesos deliberadamente
  //    desactualizado, para ver que el recálculo lo mueve.
  await page.goto("/productos");
  await page.getByRole("button", { name: /nuevo producto/i }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel(/^nombre$/i).fill(PRODUCTO);
  await dialogo.getByLabel(/precio base/i).fill("1000");
  await dialogo.getByLabel(/precio en usd/i).fill(String(USD));
  await dialogo.getByLabel(/stock inicial/i).fill("5");
  await dialogo.getByRole("button", { name: /guardar/i }).click();
  await expect(dialogo).toBeHidden();

  // 2. La cotización. Guardarla no cambia ningún precio todavía.
  await page.goto("/precios");
  await page.getByLabel(/cotización del dólar/i).fill(String(COTIZACION));
  await page.getByRole("button", { name: /^guardar$/i }).click();
  await expect(page.getByText(/todavía no se cambió ningún precio/i)).toBeVisible();

  // 3. Previsualizar: tiene que mostrar el salto antes de aplicarlo.
  await page.getByRole("button", { name: /previsualizar cambios/i }).click();
  const fila = page.getByRole("row", { name: new RegExp(PRODUCTO, "i") });
  await expect(fila).toBeVisible();
  await expect(fila).toContainText("$ 14.800,00");

  // 4. Aplicar, con la confirmación de por medio.
  await page.getByRole("button", { name: /aplicar a .* precios/i }).click();
  await page.getByRole("button", { name: /sí, actualizar/i }).click();
  await expect(page.getByText(/precios actualizados/i).first()).toBeVisible();

  // 5. El inventario ya muestra el precio nuevo.
  await page.goto("/productos");
  await expect(page.getByRole("row", { name: new RegExp(PRODUCTO, "i") }))
    .toContainText("$ 14.800,00");

  // 6. Y la caja lo cobra. Este paso es el que prueba que la materialización
  //    llegó hasta donde se cobra de verdad.
  await page.goto("/vender");
  await page.getByPlaceholder(/buscar producto o sku/i).fill(PRODUCTO);
  await page.getByRole("button", { name: new RegExp(PRODUCTO, "i") }).first().click();
  await page.getByRole("button", { name: /confirmar venta/i }).click();
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();

  const arqueo = await cerrarCaja(page, PRECIO_ESPERADO);
  expect(arqueo.esperado).toBe(PRECIO_ESPERADO);
  expect(arqueo.cuadra).toBe(true);
});

test("deshacer devuelve los precios y no toca la venta ya cobrada", async ({ page }) => {
  await page.goto("/precios");
  await page.getByRole("button", { name: /deshacer/i }).click();
  await expect(page.getByText(/precios restaurados/i)).toBeVisible();

  await page.goto("/productos");
  await expect(page.getByRole("row", { name: new RegExp(PRODUCTO, "i") }))
    .toContainText("$ 1.000,00");

  // La venta del test anterior se cobró a 14.800 y sigue diciendo eso: el
  // historial no se reescribe cuando se mueven los precios.
  await page.goto("/ventas");
  await expect(page.getByText("$ 14.800,00").first()).toBeVisible();
});
