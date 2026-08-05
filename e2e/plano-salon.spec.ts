import { test, expect, type Locator, type Page } from "@playwright/test";
import { ESTADO_AUTH } from "./helpers";

/**
 * Plano del salón.
 *
 * Lo único que no puede verificar un test de dominio: que arrastrar con el
 * mouse termine guardando la posición, y que el salón después dibuje la mesa
 * donde quedó. Toda la aritmética de coordenadas vive en `acotarGeometria` y
 * ya tiene sus tests; acá se prueba el cable entre el puntero y la base.
 *
 * Los selectores van por `data-mesa` / `data-marcador` / `data-lienzo`. En un
 * lienzo de divs posicionados en absoluto no hay rol ni texto que identifique
 * al elemento que TIENE la posición —el texto vive en un span adentro— y
 * colgarse de clases de Tailwind se rompe al primer retoque de estilo.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.resto });

const lienzo = (page: Page) => page.locator("[data-lienzo]").first();
const primeraMesa = (page: Page) => page.locator("[data-lienzo] [data-mesa]").first();

/** Arrastra un elemento hasta un punto del lienzo, dado en % del lienzo. */
async function arrastrar(page: Page, origen: Locator, destino: { x: number; y: number }) {
  const caja = await lienzo(page).boundingBox();
  const desde = await origen.boundingBox();
  if (!caja || !desde) throw new Error("No se pudo medir el lienzo");

  await page.mouse.move(desde.x + desde.width / 2, desde.y + desde.height / 2);
  await page.mouse.down();
  // Con pasos intermedios: sin pointermove previo al soltar, el arrastre no se
  // registra.
  await page.mouse.move(
    caja.x + caja.width * (destino.x / 100),
    caja.y + caja.height * (destino.y / 100),
    { steps: 10 },
  );
  await page.mouse.up();

  // El guardado es una acción de servidor: recargar antes de que termine la
  // cancela y el test compara contra la posición vieja. `data-guardando`
  // marca el elemento mientras la acción está en vuelo.
  await expect(page.locator("[data-guardando]")).toHaveCount(0);
}

async function posicion(el: Locator) {
  const style = (await el.getAttribute("style")) ?? "";
  return {
    left: Number(/left:\s*([\d.]+)%/.exec(style)?.[1]),
    top: Number(/top:\s*([\d.]+)%/.exec(style)?.[1]),
  };
}

test("acomodar reparte las mesas y queda guardado", async ({ page }) => {
  await page.goto("/mesas");

  // Las mesas del seed nacen sin posición: sin acomodar se apilarían todas en
  // la esquina, una encima de la otra.
  await page.getByRole("button", { name: /acomodar sin ubicar/i }).click();

  // Acomodar dispara una acción de servidor y después un refresh. Sin esperar
  // a que el dato llegue, se lee la posición vieja (0,0) y el test compara
  // contra sí mismo.
  await expect.poll(async () => (await posicion(primeraMesa(page))).left).toBeGreaterThan(0);

  const antes = await posicion(primeraMesa(page));

  // Recargar tiene que mostrar lo mismo: si no se guardó, vuelve a cero.
  await page.reload();
  expect(await posicion(primeraMesa(page))).toEqual(antes);
});

test("arrastrar una mesa guarda la posición nueva", async ({ page }) => {
  await page.goto("/mesas");
  const antes = await posicion(primeraMesa(page));

  await arrastrar(page, primeraMesa(page), { x: 60, y: 60 });
  const movida = await posicion(primeraMesa(page));
  expect(movida.left).not.toBe(antes.left);

  await page.reload();
  const persistida = await posicion(primeraMesa(page));
  // Tolerancia chica: el redondeo a dos decimales de numeric(5,2) y el centro
  // del elemento no dan exactamente el punto de destino.
  expect(Math.abs(persistida.left - movida.left)).toBeLessThan(2);
  expect(Math.abs(persistida.top - movida.top)).toBeLessThan(2);
});

test("no se puede sacar una mesa del lienzo", async ({ page }) => {
  await page.goto("/mesas");
  // Muy afuera, abajo a la derecha.
  await arrastrar(page, primeraMesa(page), { x: 400, y: 400 });
  await page.reload();

  const p = await posicion(primeraMesa(page));
  expect(p.left).toBeGreaterThanOrEqual(0);
  expect(p.top).toBeGreaterThanOrEqual(0);
  expect(p.left).toBeLessThanOrEqual(100);
  expect(p.top).toBeLessThanOrEqual(100);
});

test("se puede agregar y quitar una referencia", async ({ page }) => {
  await page.goto("/mesas");
  const marcadores = page.locator("[data-marcador]");
  const antes = await marcadores.count();

  await page.getByRole("button", { name: /^\+ Puerta$/ }).click();
  await expect(marcadores).toHaveCount(antes + 1);

  await page.getByRole("button", { name: /quitar puerta/i }).first().click();
  await expect(marcadores).toHaveCount(antes);
});

test("el salón dibuja el plano y desde ahí se abre la mesa", async ({ page }) => {
  await page.goto("/salon");
  const mesa = primeraMesa(page);
  await expect(mesa).toBeVisible();

  await mesa.click();
  await page.waitForURL(/\/salon\/\d+/);
});

test("en pantalla chica manda la grilla, no el plano", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/salon");

  // El lienzo está en el DOM pero oculto por `hidden lg:block`.
  await expect(lienzo(page)).toBeHidden();
  await expect(page.getByText(/mostrador y para llevar/i)).toBeVisible();
});
