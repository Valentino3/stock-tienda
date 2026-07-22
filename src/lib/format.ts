// Formato de cifras — español (Argentina). Fuente única para plata y números,
// para que toda la app muestre los importes igual (ej: "$ 1.234,50").

const currency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat("es-AR");

/** Importe en pesos, formato es-AR. Tolera null/undefined. */
export function money(n: number | null | undefined): string {
  return currency.format(n ?? 0);
}

/** Entero/decimal con separador de miles es-AR (cantidades, unidades, stock). */
export function number(n: number | null | undefined): string {
  return decimal.format(n ?? 0);
}
