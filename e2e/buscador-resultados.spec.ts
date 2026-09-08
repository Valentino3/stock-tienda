import { test, expect } from "@playwright/test";
import { ESTADO_AUTH, asegurarCajaAbierta } from "./helpers";

/**
 * El dropdown del buscador tiene que dejar llegar al último resultado.
 *
 * La lista de resultados es `absolute` y vive adentro de una Card, que trae
 * `overflow-hidden` por defecto: con eso puesto, todo lo que caía por debajo
 * del borde de la card no se dibujaba ni se podía clickear. Desde el mostrador
 * se reportó como "no deja scrollear para ver todos los resultados", pero la
 * lista sí scrollea: lo que no se ve es lo que la card recorta.
 *
 * Ningún test lo detectaba porque todos los demás buscan un término angosto y
 * hacen `.first()`, que siempre cae en la franja de arriba que sí se ve.
 */

test.describe.configure({ mode: "serial" });
test.use({
  // Sesión ya iniciada por el proyecto `setup`.
  storageState: ESTADO_AUTH.cartas,
  // Pantalla baja a propósito: `max-h-[40dvh]` acá son ~240px, así que la
  // lista pasa de largo el borde de la card y hay que scrollearla de verdad.
  viewport: { width: 1280, height: 600 },
});

test("se puede clickear el último resultado de la búsqueda", async ({ page }) => {
  await asegurarCajaAbierta(page);
  await page.goto("/vender");

  // "nm" matchea el nombre de las variantes Near Mint del catálogo de cartas
  // (scripts/seed-e2e.ts): siete resultados, más alto que lo que entra en la
  // card. Con menos, el bug no se manifiesta y el test no probaría nada.
  await page.getByPlaceholder(/buscar producto o sku/i).fill("nm");
  const opciones = page.getByRole("button", { name: /·\s*NM\s*·/i });
  await expect(opciones.first()).toBeVisible();
  expect(await opciones.count()).toBeGreaterThanOrEqual(6);

  // El último es el que quedaba tapado. La consulta ordena por nombre de
  // producto, así que es la Pikachu.
  const ultima = opciones.last();
  await expect(ultima).toContainText("Pikachu");

  /*
   * Acá está el bug, y hay que medirlo a mano: scrollear la lista hasta el
   * fondo —lo único que el vendedor puede hacer— y preguntar quién ocupa el
   * centro del último resultado. Con la card recortando, ese punto lo devuelve
   * otro elemento y el click del vendedor nunca llega.
   *
   * `ultima.click()` NO sirve para esto: Playwright scrollea todos los
   * ancestros, incluida la card, que aunque tenga overflow-hidden se puede
   * scrollear por protocolo. Con eso el click pasa aun con el bug puesto.
   */
  const lista = page.locator("ul").filter({ has: ultima }).first();
  const alcanzable = await lista.evaluate((ul) => {
    ul.scrollTop = ul.scrollHeight;
    const ultimo = ul.querySelector("li:last-child");
    if (!ultimo) return false;
    const r = ultimo.getBoundingClientRect();
    const enElCentro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return enElCentro !== null && ultimo.contains(enElCentro);
  });
  expect(alcanzable).toBe(true);

  await ultima.click();

  await expect(page.getByText(/el carrito está vacío/i)).toBeHidden();
  await expect(page.getByRole("button", { name: /quitar/i })).toBeVisible();
});

test("la card del buscador no recorta lo que se dibuja afuera", async ({ page }) => {
  await page.goto("/vender");

  // Guarda barata contra la reintroducción: `Card` trae `overflow-hidden` en el
  // primitivo y hay que apagarlo en el call site (ver el comentario en
  // sale-form.tsx). Esto falla apenas alguien saque ese `overflow-visible`,
  // sin depender de cuántos resultados tenga el seed.
  const card = page.locator('[data-slot="card"]').first();
  await expect(card).toBeVisible();
  const overflow = await card.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflow).not.toBe("hidden");
});
