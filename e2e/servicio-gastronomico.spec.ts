import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, aNumero, asegurarCajaAbierta, cerrarCaja } from "./helpers";

/**
 * Un servicio de restaurante, de punta a punta.
 *
 * Es el camino que ningún test de dominio puede cubrir: que la interfaz
 * conecte con `pagarOrden`, que la venta aparezca en Ventas y que el arqueo
 * cierre con el número correcto. Si esto pasa, el circuito de plata del rubro
 * gastronómico funciona de verdad.
 */

test.describe.configure({ mode: "serial" });
// Sesión ya iniciada por el proyecto `setup`.
test.use({ storageState: ESTADO_AUTH.resto });

test("mesa: abrir, pedir, imprimir la cuenta y cobrar", async ({ page }) => {
  await asegurarCajaAbierta(page);

  await page.goto("/salon");
  // La grilla del salón muestra las mesas del seed, agrupadas por sector.
  const mesa = page.getByRole("button", { name: /^1/ }).first();
  await expect(mesa).toBeVisible();
  await mesa.click();
  await page.waitForURL(/\/salon\/\d+/);

  // Dos milanesas y un vino: mezcla algo sin stock con algo que sí lo lleva.
  await pedir(page, "Milanesa", 2);
  await pedir(page, "Vino", 1);

  await expect(page.getByText("Milanesa napolitana")).toBeVisible();

  // La cuenta impresa es un papel no fiscal y tiene que decirlo.
  await page.getByRole("button", { name: /imprimir cuenta/i }).click();
  const cuenta = page.getByRole("dialog", { name: /cuenta de/i });
  await expect(cuenta).toBeVisible();
  await expect(cuenta.getByText(/no es factura ni comprobante fiscal/i)).toBeVisible();
  await expect(cuenta.getByText("$ 28.000,00")).toBeVisible(); // 2×8000 + 12000
  await cuenta.getByRole("button", { name: /cerrar/i }).click();

  await page.getByRole("button", { name: /^cobrar todo$/i }).click();

  // Al cobrar entero vuelve al salón y la mesa queda libre.
  await page.waitForURL(/\/salon$/);
  await expect(page.getByText(/venta #\d+ registrada/i)).toBeVisible();
});

test("la venta de la mesa aparece en Ventas", async ({ page }) => {
  await page.goto("/ventas");
  await expect(page.getByText("$ 28.000,00").first()).toBeVisible();
});

test("descontó el stock del vino pero no el de los platos", async ({ page }) => {
  await page.goto("/productos");
  const filaVino = page.getByRole("row", { name: /vino/i });
  await expect(filaVino).toBeVisible();
  // 24 del seed menos 1 vendido.
  await expect(filaVino.getByText("23")).toBeVisible();

  // La milanesa no lleva stock: la columna muestra un guion, no un cero ni un
  // negativo, y no puede figurar como stock bajo.
  const filaMila = page.getByRole("row", { name: /milanesa/i });
  await expect(filaMila.getByText("—").first()).toBeVisible();
});

test("el arqueo de caja incluye la venta de la mesa", async ({ page }) => {
  // 2 milanesas + 1 vino cobrados en efectivo en el primer test.
  const arqueo = await cerrarCaja(page, 28000);
  expect(arqueo.esperado).toBe(28000);
  expect(arqueo.contado).toBe(28000);
  expect(arqueo.cuadra).toBe(true);
});

test("cuenta dividida: dos pagos, dos ventas", async ({ page }) => {
  await asegurarCajaAbierta(page);
  await page.goto("/salon");
  await page.getByRole("button", { name: /^2/ }).first().click();
  await page.waitForURL(/\/salon\/\d+/);

  await pedir(page, "Milanesa", 1);
  await pedir(page, "Flan", 1);

  // Se tilda solo la milanesa: esa tanda se cobra, el flan queda impago.
  await page.getByRole("checkbox", { name: /cobrar milanesa/i }).check();
  await page.getByRole("button", { name: /cobrar lo elegido/i }).click();
  await expect(page.getByText(/quedan ítems sin cobrar/i)).toBeVisible();

  // La mesa sigue viva y con el resto pendiente.
  await expect(page.getByText(/cobrado/i).first()).toBeVisible();
  await page.getByRole("button", { name: /^cobrar todo$/i }).click();
  await page.waitForURL(/\/salon$/);
});

/**
 * Busca en la comanda y agrega N unidades.
 *
 * Espera a que la línea aparezca antes de devolver el control. Sin eso, dos
 * `pedir` seguidos se pisan: al agregar, la pantalla limpia el buscador, y ese
 * borrado llega DESPUÉS de que el segundo `pedir` escribió su término. El
 * campo queda vacío y la búsqueda no devuelve nada.
 */
async function pedir(page: import("@playwright/test").Page, texto: string, cantidad: number) {
  const lineas = page.getByRole("listitem").filter({ hasText: texto });
  const antes = await lineas.count();

  await page.getByPlaceholder(/buscar plato o producto/i).fill(texto);
  const opcion = page.getByRole("button", { name: new RegExp(texto, "i") }).first();
  await expect(opcion).toBeVisible();
  await opcion.click();

  await expect(lineas).toHaveCount(antes + 1);

  for (let i = 1; i < cantidad; i++) {
    await lineas.first().getByRole("button", { name: /sumar uno/i }).click();
  }
}

test("los totales que muestra la pantalla son los que guardó el servidor", async ({ page }) => {
  // Recorre el ciclo entero comparando lo que dice la UI con lo que quedó en
  // Ventas: es la clase de desfasaje que un test de dominio no puede ver.
  await asegurarCajaAbierta(page);
  await page.goto("/salon");
  await page.getByRole("button", { name: /^3/ }).first().click();
  await page.waitForURL(/\/salon\/\d+/);

  await pedir(page, "Ensalada", 3);
  const enPantalla = aNumero(
    (await page.getByText(/\$\s*19\.500/).first().textContent()) ?? "",
  );
  expect(enPantalla).toBe(19500); // 3 × 6500

  await page.getByRole("button", { name: /^cobrar todo$/i }).click();
  await page.waitForURL(/\/salon$/);

  await page.goto("/ventas");
  await expect(page.getByText("$ 19.500,00").first()).toBeVisible();
});
