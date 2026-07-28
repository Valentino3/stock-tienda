import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  findHeaderRow, normalizeHeader, mapHeaderRow, type ImportField,
} from "@/domain/import-columns";
import { parseImportWorksheet } from "@/domain/import-xlsx";

/** Atajo: { campo -> título de la columna } para comparar sin pensar en índices. */
function mapped(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, col] of mapHeaderRow(headers)) out[field] = headers[col - 1];
  return out;
}

describe("normalizeHeader", () => {
  it("saca acentos, mayúsculas y puntuación", () => {
    expect(normalizeHeader("COSTO/USD")).toBe("costo usd");
    expect(normalizeHeader("Condición")).toBe("condicion");
    expect(normalizeHeader("  Precio  Venta ")).toBe("precio venta");
    expect(normalizeHeader("P. Unit.")).toBe("p unit");
    expect(normalizeHeader("")).toBe("");
  });
});

describe("mapHeaderRow", () => {
  it("lee la planilla propia del comercio, con su orden y sus títulos", () => {
    // Layout real de un cliente: id interno primero, sin Stock, sin Variante,
    // y dos columnas vacías en el medio.
    const headers = [
      "S", "SKU PROVEEDOR", "PRODUCTO", "COSTO/USD", "COSTO ARS",
      "PRECIO VENTA", "EFECTIVO MENOR", "", "", "PRECIO MAYORISTA", "PROVEEDOR",
    ];
    expect(mapped(headers)).toEqual({
      supplierSku: "SKU PROVEEDOR",
      product: "PRODUCTO",
      costUsd: "COSTO/USD",
      costArs: "COSTO ARS",
      price: "PRECIO VENTA",
      priceCash: "EFECTIVO MENOR",
      priceWholesale: "PRECIO MAYORISTA",
      supplier: "PROVEEDOR",
    });
  });

  it("no adivina: una columna con título ambiguo queda sin mapear", () => {
    // "S" es un id interno del comercio. Mapearlo a SKU por las dudas rompería
    // el matcheo de actualizaciones con datos que no son SKUs.
    const cols = mapHeaderRow(["S", "PRODUCTO", "PRECIO VENTA"]);
    expect(cols.has("sku")).toBe(false);
  });

  it("lee la plantilla que descarga la app", () => {
    const headers = [
      "Producto", "Variante", "SKU", "Precio venta", "Stock",
      "Efectivo menor", "Precio mayorista", "Costo USD", "Costo ARS",
      "Proveedor", "SKU proveedor", "Set", "Condición", "Foil", "Idioma",
    ];
    const cols = mapHeaderRow(headers);
    const expected: ImportField[] = [
      "product", "variant", "sku", "price", "stock", "priceCash", "priceWholesale",
      "costUsd", "costArs", "supplier", "supplierSku", "setName", "condition", "foil", "language",
    ];
    for (const f of expected) expect(cols.get(f), `falta ${f}`).toBe(expected.indexOf(f) + 1);
  });

  it("distingue 'Precio venta' de 'Precio mayorista' y 'SKU' de 'SKU proveedor'", () => {
    // El alias genérico ("precio", "sku") no debe robarle la columna al específico.
    expect(mapped(["Precio mayorista", "Precio venta"])).toEqual({
      priceWholesale: "Precio mayorista",
      price: "Precio venta",
    });
    expect(mapped(["SKU proveedor", "SKU"])).toEqual({
      supplierSku: "SKU proveedor",
      sku: "SKU",
    });
  });

  it("nunca asigna la misma columna a dos campos", () => {
    const headers = ["Producto", "Precio", "Precio", "Stock"];
    const cols = mapHeaderRow(headers);
    const usadas = [...cols.values()];
    expect(new Set(usadas).size).toBe(usadas.length);
  });

  it("acepta sinónimos habituales", () => {
    expect(mapped(["Descripción", "Cantidad", "Contado"])).toEqual({
      product: "Descripción",
      stock: "Cantidad",
      priceCash: "Contado",
    });
  });

  it("sin encabezados reconocibles no inventa un producto", () => {
    // El caller usa la ausencia de `product` para caer al orden posicional.
    expect(mapHeaderRow(["col1", "col2", "col3"]).has("product")).toBe(false);
    expect(mapHeaderRow(["", "", ""]).has("product")).toBe(false);
  });
});

describe("findHeaderRow", () => {
  it("encuentra los encabezados reales debajo de una fila de cotizaciones", () => {
    const rows = [
      ["", "", "", "", "", "", "", "1475", "1540", "", ""],
      [
        "S", "SKU PROVEEDOR", "PRODUCTO", "COSTO/USD", "COSTO ARS",
        "PRECIO VENTA", "EFECTIVO MENOR", "a", "", "PRECIO MAYORISTA", "PROVEEDOR",
      ],
      ["1827", "", "POKEMON ASCENDED HEROES MEGA BOX", "58.90", "90706", "181400", "154200", "", "", "126100", "TCG DYLAN"],
    ];

    const match = findHeaderRow(rows);

    expect(match?.rowNumber).toBe(2);
    expect(match && Object.fromEntries(
      [...match.columns].map(([field, col]) => [field, match.headers[col - 1]])
    )).toEqual({
      priceCash: "EFECTIVO MENOR",
      priceWholesale: "PRECIO MAYORISTA",
      costUsd: "COSTO/USD",
      costArs: "COSTO ARS",
      supplierSku: "SKU PROVEEDOR",
      supplier: "PROVEEDOR",
      price: "PRECIO VENTA",
      product: "PRODUCTO",
    });
  });

  it("elige la fila con más campos reconocidos y conserva la primera en un empate", () => {
    const match = findHeaderRow([
      ["Producto", "Precio"],
      ["Producto", "Precio venta", "Stock"],
      ["Producto", "Precio venta", "SKU"],
    ]);

    expect(match?.rowNumber).toBe(2);
    expect([...match!.columns.keys()]).toEqual(["price", "product", "stock"]);
  });

  it("no confunde una fila de datos posterior cuyo producto se llama Producto", () => {
    expect(findHeaderRow([
      ["Reporte de inventario"],
      ["Producto"],
      ["Remera"],
    ])).toBeNull();
  });
});

describe("parseImportWorksheet", () => {
  it("extrae los valores correctos cuando hay cotizaciones arriba de los encabezados", () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Productos");
    worksheet.addRow(["", "", "", "", "", "", "", 1475, 1540, "", ""]);
    worksheet.addRow([
      "S", "SKU PROVEEDOR", "PRODUCTO", "COSTO/USD", "COSTO ARS",
      "PRECIO VENTA", "EFECTIVO MENOR", "a", "", "PRECIO MAYORISTA", "PROVEEDOR",
    ]);
    worksheet.addRow([
      1827, "", "POKEMON ASCENDED HEROES MEGA BOX", 58.9, 90706,
      181400, 154200, "", "", 126100, "TCG DYLAN",
    ]);

    const parsed = parseImportWorksheet(worksheet);

    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.usedLegacy).toBe(false);
    expect(parsed.hasStock).toBe(false);
    expect(parsed.matchByName).toBe(true);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 3,
      product: "POKEMON ASCENDED HEROES MEGA BOX",
      variant: "",
      sku: null,
      price: 181400,
      stock: null,
      priceCash: 154200,
      priceWholesale: 126100,
      costUsd: 58.9,
      costArs: 90706,
      supplier: "TCG DYLAN",
    });
  });
});
