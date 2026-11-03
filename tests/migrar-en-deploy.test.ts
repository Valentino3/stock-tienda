import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { debeMigrar } from "../scripts/migrar-en-deploy";

/**
 * El deploy de producción migra solo (scripts/migrar-en-deploy.ts). Lo que se
 * fija acá es lo que, si se rompe, no avisa: que un preview o un build local
 * no toquen la base, y que el build siga migrando antes de compilar.
 */

describe("migrar en el deploy", () => {
  it("solo migra el deploy de producción", () => {
    expect(debeMigrar("production")).toBe(true);
    expect(debeMigrar("preview")).toBe(false);
    expect(debeMigrar("development")).toBe(false);
    expect(debeMigrar(undefined)).toBe(false);
  });

  it("el build migra antes de compilar", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    expect(pkg.scripts.build).toMatch(/^tsx scripts\/migrar-en-deploy\.ts && next build$/);
  });
});
