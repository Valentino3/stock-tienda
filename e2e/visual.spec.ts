import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ESTADO_AUTH } from "./helpers";

/**
 * Arnés de capturas para la pasada de polish visual.
 *
 * NO verifica nada: navega y fotografía. Existe porque restilar una app que
 * cobra plata todos los días no tiene red — ningún test detecta que el botón
 * de cerrar caja quedó del mismo gris que el fondo. Esto convierte "se ve
 * raro" en dos imágenes que se pueden poner al lado.
 *
 * Uso:
 *   CAPTURA=base    npx playwright test    # antes de tocar nada
 *   CAPTURA=fase-a  npx playwright test    # después de cada fase
 *
 * Sin la variable no corre, así que `npx playwright test` a secas sigue siendo
 * los 19 tests de plata y nada más.
 *
 * **Se llama `visual` y no `capturas` para que ordene último.** Playwright
 * corre los archivos por nombre con un solo worker, y el seed deja la base
 * vacía: fotografiar antes que los tests de plata daba 22 pantallas de estado
 * vacío y ninguna tabla con filas. Corriendo al final, las ventas, los
 * clientes, los comprobantes y los cierres que dejaron los otros specs son lo
 * que sale en la foto — que es lo que hay que mirar cuando se restila una
 * tabla.
 *
 * Es de solo lectura salvo la comanda del final, que no existe hasta que
 * alguien abre una mesa.
 */

const ETIQUETA = process.env.CAPTURA;
const DESTINO = path.join("capturas", ETIQUETA ?? "sin-etiqueta");

const ANCHOS = [
  { nombre: "movil", width: 390, height: 844 },
  { nombre: "tablet", width: 834, height: 1112 },
  { nombre: "escritorio", width: 1440, height: 900 },
] as const;

/** Pantallas del comercio de cartas: todo lo de retail y administración. */
const RUTAS_CARTAS = [
  "/vender",
  "/vender/revision",
  "/caja",
  "/clientes",
  "/productos",
  "/ventas",
  "/reportes",
  "/usuarios",
  "/avisos",
  "/comisiones",
  "/importar",
  "/facturacion",
];

/** Pantallas del restaurante. `/vender` y `/caja` van también porque el rubro
 *  les cambia las etiquetas y la navegación. */
const RUTAS_RESTO = ["/salon", "/mesas", "/cocina", "/vender", "/caja"];

/**
 * Resuelve una ruta con id buscando el primer enlace que matchee en la lista.
 * Devuelve null si el seed no dejó ninguna: el arnés se saltea esa pantalla en
 * vez de fallar, porque esto no es un test.
 */
async function primeraRuta(page: Page, lista: string, patron: RegExp) {
  await page.goto(lista, { waitUntil: "networkidle" });
  const hrefs = await page.locator("a[href]").evaluateAll((as) =>
    as.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
  );
  return hrefs.find((h) => patron.test(h)) ?? null;
}

function archivo(rubro: string, ruta: string, ancho: string) {
  // El rubro va en el nombre porque `/vender` y `/caja` se fotografían con las
  // dos cuentas: sin prefijo, el restaurante pisaría la captura del comercio.
  const base = ruta === "/" ? "raiz" : ruta.replace(/^\//, "").replace(/\//g, "-");
  return path.join(DESTINO, `${rubro}--${base}--${ancho}.png`);
}

/**
 * Apaga transiciones y animaciones. Sin esto, una captura puede agarrar un
 * fade a mitad de camino y el diff marca una diferencia que no existe.
 */
async function congelar(page: Page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function capturar(page: Page, rubro: string, ruta: string) {
  await page.goto(ruta, { waitUntil: "networkidle" });
  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho.width, height: ancho.height });
    await congelar(page);
    await page.screenshot({ path: archivo(rubro, ruta, ancho.nombre), fullPage: true });
  }
}

test.describe("capturas", () => {
  test.skip(!ETIQUETA, "Definí CAPTURA=<etiqueta> para correr el arnés.");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    fs.mkdirSync(DESTINO, { recursive: true });
  });

  test.describe("comercio de cartas", () => {
    test.use({ storageState: ESTADO_AUTH.cartas });

    for (const ruta of RUTAS_CARTAS) {
      test(`cartas ${ruta}`, async ({ page }) => {
        await capturar(page, "cartas", ruta);
      });
    }
  });

  test.describe("restaurante", () => {
    test.use({ storageState: ESTADO_AUTH.resto });

    for (const ruta of RUTAS_RESTO) {
      test(`resto ${ruta}`, async ({ page }) => {
        await capturar(page, "resto", ruta);
      });
    }

    // El seed deja "Cliente Fiado" en la tienda del restaurante, no en la de
    // cartas — por eso el detalle de cliente se fotografía con esta cuenta.
    test("resto cliente-detalle", async ({ page }) => {
      const destino = await primeraRuta(page, "/clientes", /^\/clientes\/\d+$/);
      test.skip(!destino, "El seed no dejó ningún cliente.");
      await capturar(page, "resto", destino!);
    });

    /**
     * Esta pantalla no existe hasta que alguien abre una mesa, así que el arnés
     * la abre. Es la única excepción a la regla de solo lectura: sin fixture no
     * hay captura, y la pantalla de comanda es de las que más se restilan.
     * Cada corrida re-siembra la base (global-setup), así que no se acumula.
     */
    test("resto orden-detalle", async ({ page }) => {
      let destino = await primeraRuta(page, "/salon", /^\/salon\/\d+$/);
      if (!destino) {
        await page.getByRole("button", { name: /^1/ }).first().click();
        await page.waitForURL(/\/salon\/\d+$/);
        destino = new URL(page.url()).pathname;
      }
      await capturar(page, "resto", destino);
    });
  });

  test.describe("sin sesión", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("login", async ({ page }) => {
      await capturar(page, "publico", "/login");
    });
  });
});
