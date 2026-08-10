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

/**
 * Diferencia contable: el negativo va entre paréntesis, como en un arqueo en
 * papel. `money(-1300)` da "-$ 1.300,00", que en una columna de números mete
 * un guion que se confunde con un separador; "($ 1.300,00)" no se confunde con
 * nada y es lo que el dueño ya lee en el resumen del banco.
 *
 * Solo para diferencias y saldos, donde el signo ES la información. Un importe
 * común sigue yendo por `money`.
 */
export function moneyDiff(n: number | null | undefined): string {
  const v = n ?? 0;
  return v < 0 ? `(${currency.format(-v)})` : currency.format(v);
}
