import { describe, it, expect } from "vitest";
import {
  buscarEnCatalogo, indexarCatalogo, normalizar, precioDe, type VarianteCatalogo,
} from "@/lib/offline/busqueda";

const variante = (over: Partial<VarianteCatalogo> & { variantId: number; productName: string }): VarianteCatalogo => ({
  variantName: null, sku: null, stock: 5, price: null, basePrice: 1000,
  setName: null, condition: null, foil: false, language: null, ...over,
});

const CATALOGO = indexarCatalogo([
  variante({ variantId: 1, productName: "Remera lisa", variantName: "M", sku: "REM-M" }),
  variante({ variantId: 2, productName: "Remera lisa", variantName: "L", sku: "REM-L" }),
  variante({ variantId: 3, productName: "Pantalón cargo", variantName: "42", sku: "PAN-42" }),
  variante({ variantId: 4, productName: "Buzo Pokémon", setName: "Edición limitada", sku: "BZ-01" }),
  variante({ variantId: 5, productName: "Gorra", price: 800 }),
]);

describe("normalizar", () => {
  it("saca acentos y pasa a minúsculas", () => {
    expect(normalizar("Pokémon Edición")).toBe("pokemon edicion");
    expect(normalizar("  Pantalón  ")).toBe("pantalón".normalize("NFD").replace(/[̀-ͯ]/g, ""));
  });
});

describe("buscarEnCatalogo", () => {
  it("no busca con menos de 2 caracteres", () => {
    expect(buscarEnCatalogo(CATALOGO, "r")).toEqual([]);
    expect(buscarEnCatalogo(CATALOGO, "")).toEqual([]);
  });

  it("encuentra por nombre de producto", () => {
    const r = buscarEnCatalogo(CATALOGO, "remera");
    expect(r.map((v) => v.variantId).sort()).toEqual([1, 2]);
  });

  it("encuentra por SKU", () => {
    expect(buscarEnCatalogo(CATALOGO, "PAN-42").map((v) => v.variantId)).toEqual([3]);
  });

  it("ignora acentos en los dos sentidos", () => {
    expect(buscarEnCatalogo(CATALOGO, "pokemon").map((v) => v.variantId)).toEqual([4]);
    expect(buscarEnCatalogo(CATALOGO, "pantalon").map((v) => v.variantId)).toEqual([3]);
  });

  it("todos los tokens tienen que aparecer, en cualquier orden", () => {
    expect(buscarEnCatalogo(CATALOGO, "lisa remera").map((v) => v.variantId).sort()).toEqual([1, 2]);
    expect(buscarEnCatalogo(CATALOGO, "remera lisa").map((v) => v.variantId).sort()).toEqual([1, 2]);
    expect(buscarEnCatalogo(CATALOGO, "remera xxl")).toEqual([]);
  });

  it("un token corto matchea ancho: es substring, no palabra completa", () => {
    // "remera l" trae las dos variantes porque la "l" está adentro de "lisa".
    // Es el precio de que "rem" encuentre "Remera": exigir palabra completa
    // rompería la búsqueda por prefijo, que es la que se usa en el mostrador.
    // Con dos resultados el vendedor elige; con cero se queda sin vender.
    expect(buscarEnCatalogo(CATALOGO, "remera l").map((v) => v.variantId).sort()).toEqual([1, 2]);
  });

  it("busca en el nombre del set", () => {
    expect(buscarEnCatalogo(CATALOGO, "edicion").map((v) => v.variantId)).toEqual([4]);
  });

  it("pone primero el SKU exacto", () => {
    const catalogo = indexarCatalogo([
      variante({ variantId: 10, productName: "Algo con rem-m adentro", sku: "OTRO" }),
      variante({ variantId: 11, productName: "Remera", sku: "REM-M" }),
    ]);
    expect(buscarEnCatalogo(catalogo, "rem-m")[0].variantId).toBe(11);
  });

  it("respeta el límite de resultados", () => {
    const muchas = indexarCatalogo(
      Array.from({ length: 50 }, (_, i) => variante({ variantId: i, productName: `Remera ${i}` })),
    );
    expect(buscarEnCatalogo(muchas, "remera")).toHaveLength(20);
    expect(buscarEnCatalogo(muchas, "remera", 5)).toHaveLength(5);
  });

  it("anda sobre un catálogo grande sin colgarse", () => {
    const grande = indexarCatalogo(
      Array.from({ length: 20_000 }, (_, i) => variante({ variantId: i, productName: `Producto ${i}`, sku: `SKU-${i}` })),
    );
    const t0 = Date.now();
    const r = buscarEnCatalogo(grande, "sku-19999");
    expect(r[0].variantId).toBe(19999);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("precioDe", () => {
  it("el precio de la variante pisa al del producto, igual que el servidor", () => {
    expect(precioDe(variante({ variantId: 1, productName: "x", price: 800, basePrice: 1000 }))).toBe(800);
    expect(precioDe(variante({ variantId: 1, productName: "x", price: null, basePrice: 1000 }))).toBe(1000);
  });

  it("un precio de 0 es un precio válido, no un ausente", () => {
    expect(precioDe(variante({ variantId: 1, productName: "x", price: 0, basePrice: 1000 }))).toBe(0);
  });
});
