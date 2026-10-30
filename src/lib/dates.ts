export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ---- días de Argentina ----
//
// El servidor corre en UTC (Vercel) y la base también. Un `YYYY-MM-DD` que
// llega de un filtro es un día de Argentina, no de UTC: tomarlo como
// medianoche UTC corría todo tres horas, y lo vendido después de las 21 caía
// en el día siguiente. Argentina no tiene horario de verano desde 2009, así
// que el corrimiento es fijo.

const ZONA_AR = "America/Argentina/Buenos_Aires";
const OFFSET_AR = "-03:00";
const DIA_MS = 24 * 60 * 60 * 1000;

/** Hoy en Argentina, como `YYYY-MM-DD`. */
export function hoyAR(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: ZONA_AR });
}

/** El día de Argentina de hace `dias` días, como `YYYY-MM-DD`. */
export function haceDiasAR(dias: number, ahora: Date = new Date()): string {
  return hoyAR(new Date(ahora.getTime() - dias * DIA_MS));
}

/** 00:00 de Argentina de ese día. */
export function inicioDelDiaAR(fecha: string): Date {
  return new Date(`${fecha}T00:00:00${OFFSET_AR}`);
}

/** 00:00 de Argentina del día SIGUIENTE: el tope exclusivo de ese día. */
export function finDelDiaAR(fecha: string): Date {
  return new Date(inicioDelDiaAR(fecha).getTime() + DIA_MS);
}

/**
 * Rango de un filtro `from`/`to` en días de Argentina, con los dos extremos
 * incluidos (`to` es el último milisegundo del día). Sin filtro, los últimos
 * `diasPorDefecto` días hasta hoy.
 */
export function rangoAR(
  params: { from?: string | null; to?: string | null },
  diasPorDefecto = 30,
  ahora: Date = new Date(),
): { from: Date; to: Date; fromValue: string; toValue: string } {
  const fromValue = params.from || haceDiasAR(diasPorDefecto, ahora);
  const toValue = params.to || hoyAR(ahora);
  return {
    from: inicioDelDiaAR(fromValue),
    to: new Date(finDelDiaAR(toValue).getTime() - 1),
    fromValue,
    toValue,
  };
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
