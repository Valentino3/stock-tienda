// Cálculo puro de comisión por porcentaje. Módulo sin dependencias para poder
// usarlo tanto en el form (cliente) como en tests.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comisión = base × porcentaje / 100, redondeada a 2 decimales. */
export function commissionFromPercent(base: number, percent: number): number {
  if (!(base > 0) || !(percent > 0)) return 0;
  return round2((base * percent) / 100);
}
