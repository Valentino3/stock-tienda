import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * En una server action, lo que viene de la sesión va DESPUÉS de lo que manda
 * el cliente.
 *
 * El argumento de una server action lo arma el navegador, y el tipo de
 * TypeScript no existe en runtime: cualquiera puede mandar un objeto con
 * campos de más. Con `{ storeId, ...input }`, un `storeId` colado en `input`
 * pisa el de la sesión y la acción opera sobre otra tienda. Con
 * `{ ...input, storeId }` gana siempre la sesión.
 *
 * Pasó dos veces: con el vendedor en /vender, y con cobrar una mesa, editar un
 * cliente y la cotización. Este test no deja que pase una tercera.
 */

const CAMPOS_DE_SESION = ["storeId", "userId", "sellerId", "registeredBy"];

function accionesDe(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return accionesDe(p);
    return /actions\.ts$|route\.ts$/.test(e.name) ? [p] : [];
  });
}

describe("server actions: la sesión gana sobre lo que manda el cliente", () => {
  const archivos = accionesDe(path.resolve(__dirname, "../src/app"));

  it("encuentra las acciones (si esto falla, el test dejó de mirar)", () => {
    expect(archivos.length).toBeGreaterThan(5);
  });

  for (const archivo of archivos) {
    it(path.relative(path.resolve(__dirname, ".."), archivo), () => {
      const codigo = fs.readFileSync(archivo, "utf8");
      // Un literal de objeto que nombra un campo de sesión y DESPUÉS hace un
      // spread: `{ storeId, userId, ...input }`. Los comentarios no cuentan.
      const sinComentarios = codigo.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const malos = [...sinComentarios.matchAll(/\{([^{}]*)\}/g)]
        .map((m) => m[1])
        .filter((cuerpo) => {
          const spread = cuerpo.search(/\.\.\.\w/);
          if (spread < 0) return false;
          const antes = cuerpo.slice(0, spread);
          return CAMPOS_DE_SESION.some((c) => new RegExp(`\\b${c}\\b`).test(antes));
        });
      expect(malos, "poné el spread primero y la sesión al final").toEqual([]);
    });
  }
});
