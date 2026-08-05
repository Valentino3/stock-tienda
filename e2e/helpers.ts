import { expect, type Page } from "@playwright/test";

/**
 * Helpers de los tests de navegador.
 *
 * Las credenciales son las que siembra scripts/seed-e2e.ts.
 */

export const CUENTAS = {
  resto: { email: "resto@test.local", password: "test1234" },
  cartas: { email: "cartas@test.local", password: "test1234" },
};

/** Sesiones guardadas por e2e/auth.setup.ts. */
export const ESTADO_AUTH = {
  resto: "playwright/.auth/resto.json",
  cartas: "playwright/.auth/cartas.json",
} as const;

/**
 * Deja la caja abierta. Es precondición de cualquier cobro, y los tests no
 * pueden asumir en qué estado la dejó el anterior.
 */
export async function asegurarCajaAbierta(page: Page, montoInicial = 0) {
  await page.goto("/caja");
  const abrir = page.getByRole("button", { name: /abrir caja/i });
  if (await abrir.isVisible().catch(() => false)) {
    await page.getByLabel(/efectivo inicial|monto inicial/i).fill(String(montoInicial));
    await abrir.click();
    await expect(page.getByRole("button", { name: /cerrar caja/i })).toBeVisible();
  }
}

/**
 * Cierra la caja y devuelve el arqueo que muestra la pantalla.
 *
 * Devolver los números en vez de solo cerrar es el punto: lo que interesa
 * verificar no es que el botón ande, sino que lo esperado coincida con lo
 * cobrado. Un arqueo que no cuadra es el peor síntoma de este sistema.
 */
export async function cerrarCaja(page: Page, efectivoContado: number) {
  await page.goto("/caja");
  await page.getByLabel(/efectivo contado/i).fill(String(efectivoContado));
  await page.getByRole("button", { name: /^cerrar caja$/i }).click();

  const resumen = page.getByText("Caja cerrada");
  await expect(resumen).toBeVisible();

  const leer = async (etiqueta: string) => {
    const dt = page.getByText(etiqueta, { exact: true });
    await expect(dt).toBeVisible();
    return aNumero((await dt.locator("xpath=following-sibling::dd[1]").textContent()) ?? "");
  };

  return {
    esperado: await leer("Esperado"),
    contado: await leer("Contado"),
    cuadra: await page.getByText(/la caja cuadra/i).isVisible(),
  };
}

/** Convierte "$ 21.000,00" en 21000. */
export function aNumero(texto: string): number {
  const limpio = texto.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(limpio);
}

export async function totalVisible(page: Page, etiqueta: RegExp): Promise<number> {
  const fila = page.getByText(etiqueta).first();
  await expect(fila).toBeVisible();
  return aNumero((await fila.textContent()) ?? "");
}
