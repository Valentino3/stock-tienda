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

const horaAr = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * "14:05", siempre en hora argentina. La zona va explícita porque esto se
 * formatea en el servidor, que corre en UTC: sin ella, una venta de las 14 se
 * mostraría a las 17.
 */
export function hora(d: Date | string | number): string {
  return horaAr.format(new Date(d));
}

const diaHoraAr = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "25/09, 14:05" en hora argentina. Para cuando la hora sola es ambigua. */
export function diaHora(d: Date | string | number): string {
  return diaHoraAr.format(new Date(d));
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
