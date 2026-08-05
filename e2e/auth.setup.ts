import { test as setup, expect } from "@playwright/test";
import { CUENTAS, ESTADO_AUTH } from "./helpers";

/**
 * Se loguea una vez por cuenta y guarda la sesión en disco.
 *
 * No es solo velocidad. better-auth limita los intentos de login, y en
 * producción esa limitación está activa: loguearse en el `beforeEach` de cada
 * test hace que a partir del cuarto la app responda "Email o contraseña
 * incorrectos" con credenciales correctas. El test falla por una defensa que
 * funciona bien, que es la peor clase de test rojo.
 */

for (const [nombre, cuenta] of Object.entries(CUENTAS)) {
  setup(`sesión de ${nombre}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(cuenta.email);
    await page.getByLabel(/contraseña/i).fill(cuenta.password);
    await page.getByRole("button", { name: /entrar/i }).click();

    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    // Que la navegación haya ocurrido no alcanza: si el shell no cargó, todos
    // los tests fallarían después con un error que no dice nada.
    await expect(page.getByRole("button", { name: /salir/i })).toBeVisible();

    await page.context().storageState({ path: ESTADO_AUTH[nombre as keyof typeof CUENTAS] });
  });
}
