export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Día operativo, como fecha `YYYY-MM-DD` de Argentina.
 *
 * Corta a las 6 de la mañana y no a medianoche: el servicio de la noche
 * termina después de las doce, y algo agotado a las 23:30 tiene que seguir
 * agotado a la 1:00.
 */
export function diaOperativo(ahora: Date = new Date()): string {
  const corrido = new Date(ahora.getTime() - 6 * 60 * 60 * 1000);
  return corrido.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}
