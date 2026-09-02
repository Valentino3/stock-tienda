import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Toda migración tiene que estar en el journal, y viceversa.
 *
 * AGENTS.md lo advierte pero nada lo verificaba: `tests/helpers/db.ts` replica
 * TODOS los `.sql` de la carpeta, así que una migración sin entrada en el
 * journal pasa la suite entera en verde y **nunca se aplica en producción**. El
 * daño aparece días después, como una columna que no existe.
 *
 * Es el test más barato del repo y cubre el modo de falla que el propio
 * AGENTS.md señala como el más caro.
 */

const dir = path.resolve(__dirname, "../drizzle");

const archivos = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[];
};

describe("migraciones y journal", () => {
  it("cada .sql tiene su entrada en el journal", () => {
    const tags = new Set(journal.entries.map((e) => e.tag));
    const huerfanas = archivos.filter((a) => !tags.has(a));
    expect(huerfanas, "migraciones que los tests aplican pero producción no").toEqual([]);
  });

  it("cada entrada del journal tiene su .sql", () => {
    const enDisco = new Set(archivos);
    const fantasmas = journal.entries.filter((e) => !enDisco.has(e.tag)).map((e) => e.tag);
    expect(fantasmas, "entradas que apuntan a un archivo que no existe").toEqual([]);
  });

  it("los índices del journal son correlativos y sin repetidos", () => {
    // Un idx repetido hace que el migrador saltee una migración entera.
    const idx = journal.entries.map((e) => e.idx);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(new Set(idx).size).toBe(idx.length);
  });

  it("el orden del journal coincide con el orden alfabético de los archivos", () => {
    // `tests/helpers/db.ts` los aplica ordenados por nombre y el migrador por
    // journal. Si los dos órdenes difieren, los tests prueban un esquema que
    // producción nunca va a tener.
    expect(journal.entries.map((e) => e.tag)).toEqual(archivos);
  });
});
