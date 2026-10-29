import { test, expect } from "@playwright/test";
import { ESTADO_AUTH } from "./helpers";

/**
 * El dueño no tiene permisos admin del plugin de better-auth.
 *
 * El plugin no conoce tiendas: con esos permisos, un dueño podía pegarle
 * directo a /api/auth/admin/* y hacerse superadmin, o listar, cambiar la
 * contraseña e impersonar usuarios de otros locales. Ninguna pantalla llama a
 * esas rutas, así que la única forma de ver que están cerradas es pegarles.
 *
 * Se afirma el código de error y no solo el status: un 403 por falta de
 * Origin pasaría el test sin probar nada.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: ESTADO_AUTH.cartas });

const NO_PERMITIDO = /NOT_ALLOWED/;

test("el dueño no puede cambiarse el rol a superadmin", async ({ page, baseURL }) => {
  await page.goto("/");
  const sesion = await (await page.request.get("/api/auth/get-session")).json();
  expect(sesion.user.role).toBe("owner");

  const res = await page.request.post("/api/auth/admin/set-role", {
    headers: { Origin: baseURL! },
    data: { userId: sesion.user.id, role: "superadmin" },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toMatch(NO_PERMITIDO);

  const despues = await (await page.request.get("/api/auth/get-session")).json();
  expect(despues.user.role).toBe("owner");
});

test("el dueño no puede listar los usuarios de la plataforma", async ({ page }) => {
  const res = await page.request.get("/api/auth/admin/list-users");
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toMatch(NO_PERMITIDO);
});

test("el dueño no puede impersonar ni cambiar contraseñas", async ({ page, baseURL }) => {
  for (const [ruta, data] of [
    ["/api/auth/admin/impersonate-user", { userId: "cualquiera" }],
    ["/api/auth/admin/set-user-password", { userId: "cualquiera", newPassword: "otra12345" }],
  ] as const) {
    const res = await page.request.post(ruta, { headers: { Origin: baseURL! }, data });
    expect(res.status(), ruta).toBe(403);
    expect((await res.json()).code, ruta).toMatch(NO_PERMITIDO);
  }
});

test("el dueño sigue pudiendo dar de alta, desactivar y reactivar empleados", async ({ page }) => {
  const nombre = `Empleado ${Date.now()}`;
  await page.goto("/usuarios");
  await page.getByRole("button", { name: /nuevo empleado/i }).click();
  await page.getByLabel("Nombre").fill(nombre);
  await page.getByLabel("Email").fill(`e${Date.now()}@test.local`);
  await page.getByLabel(/contraseña/i).fill("test12345");
  await page.getByRole("button", { name: /^crear$/i }).click();

  const fila = page.getByRole("row").filter({ hasText: nombre });
  await expect(fila.getByText("Activo")).toBeVisible();

  await fila.getByRole("button", { name: /desactivar/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /desactivar/i }).click();
  await expect(fila.getByText("Desactivado")).toBeVisible();

  await fila.getByRole("button", { name: /^activar$/i }).click();
  await expect(fila.getByText("Activo")).toBeVisible();
});
