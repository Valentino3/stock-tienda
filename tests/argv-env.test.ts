import { describe, it, expect, afterEach } from "vitest";
import { leerArgsComoEnv } from "../scripts/argv-env";

/**
 * Variables pasadas como argumento.
 *
 * Existe porque el repo se opera desde PowerShell, donde `FOO=bar comando` no
 * significa nada: npm reenvía eso al script como un argumento suelto y la
 * variable nunca llega. El síntoma es un "falta FOO" que no explica el
 * verdadero problema, y ya costó un intento fallido.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("leerArgsComoEnv", () => {
  it("convierte CLAVE=valor en variable de entorno", () => {
    leerArgsComoEnv(["OWNER_PASSWORD=secreta123", "STORE_SLUG=prueba"]);
    expect(process.env.OWNER_PASSWORD).toBe("secreta123");
    expect(process.env.STORE_SLUG).toBe("prueba");
  });

  it("el argumento gana sobre lo que ya estaba en el entorno", () => {
    // Escribirlo en la línea de comandos es lo más explícito que hay: tiene que
    // pisar a .env.local, que es un default.
    process.env.STORE_SLUG = "del-archivo";
    leerArgsComoEnv(["STORE_SLUG=del-comando"]);
    expect(process.env.STORE_SLUG).toBe("del-comando");
  });

  it("no se come los signos = del valor", () => {
    // Una DATABASE_URL trae `?sslmode=require`, y cortar en el primer `=`
    // dejaría una URL rota y un error de conexión sin relación aparente.
    leerArgsComoEnv(["DATABASE_URL=postgres://u:p@h/db?sslmode=require&x=1"]);
    expect(process.env.DATABASE_URL).toBe("postgres://u:p@h/db?sslmode=require&x=1");
  });

  it("acepta un valor vacío", () => {
    leerArgsComoEnv(["DB_DRIVER="]);
    expect(process.env.DB_DRIVER).toBe("");
  });

  it("ignora lo que no tiene forma de variable, sin romper", () => {
    // Puede venir una flag de otra cosa. Fallar acá sería peor que no hacer nada.
    const antes = { ...process.env };
    leerArgsComoEnv(["--watch", "algo", "minuscula=x", "=sin-clave"]);
    expect(process.env.minuscula).toBeUndefined();
    expect(Object.keys(process.env).sort()).toEqual(Object.keys(antes).sort());
  });

  it("una contraseña con símbolos llega intacta", () => {
    leerArgsComoEnv(["OWNER_PASSWORD=a=b&c#d$e"]);
    expect(process.env.OWNER_PASSWORD).toBe("a=b&c#d$e");
  });
});
