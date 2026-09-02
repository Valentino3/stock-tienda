/**
 * Precios atados al dólar.
 *
 * Este módulo es puro: sin base, sin React, sin sesión. Se importa desde el
 * servidor y desde el cliente, igual que `src/lib/verticals` e
 * `import-columns`, para que el ejemplo en vivo de la pantalla y el número que
 * se escribe en la base salgan de la misma función.
 *
 * ⚠️ Esto NO cambia cómo se LEE un precio. `resolverPrecio` sigue siendo
 * `price ?? basePrice` y nadie deriva nada en vivo desde el dólar. Lo único que
 * hay acá es cómo se CALCULA el número que después se materializa en las
 * mismas columnas que ya escriben `saveVariant` y `executeImport`.
 */

/** Mismo redondeo a dos decimales que usa domain/sales.ts. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export type RoundingMode = "nearest" | "up";

/**
 * Múltiplos ofrecidos. No hay opción "sin redondeo": nadie vende en pesos con
 * centavos, y ofrecerlo sería una rama más de tests para cero valor.
 */
export const PASOS_REDONDEO = [1, 10, 50, 100, 500, 1000] as const;
export type PasoRedondeo = (typeof PASOS_REDONDEO)[number];

export type ReglaRedondeo = { mode: RoundingMode; step: number };

export const REGLA_POR_DEFECTO: ReglaRedondeo = { mode: "nearest", step: 100 };

export function esPasoValido(n: unknown): n is PasoRedondeo {
  return typeof n === "number" && (PASOS_REDONDEO as readonly number[]).includes(n);
}

export function esModoValido(s: unknown): s is RoundingMode {
  return s === "nearest" || s === "up";
}

/** Porcentaje de descuento de una lista. `null` significa "no tocar la lista". */
export function esPorcentajeValido(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100;
}

export function esCotizacionValida(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Precio en pesos a partir del precio en dólares y la cotización.
 *
 * ⚠️ LA ENTRADA ES SIEMPRE `(usd, cotización)` Y NUNCA EL PRECIO EN PESOS
 * ANTERIOR. De ahí sale la idempotencia: recalcular N veces con la misma
 * cotización da exactamente lo mismo que recalcular una, porque la segunda
 * corrida rehace la cuenta desde cero en vez de operar sobre su propio
 * resultado.
 *
 * NO cambiar esto por "aplicá el porcentaje de variación del dólar sobre el
 * precio actual". Es la simplificación que parece equivalente y no lo es: esa
 * forma compone error de redondeo en cada corrida y deja de ser determinista a
 * la tercera.
 */
export function precioDesdeUsd(usd: number, cotizacion: number, regla: ReglaRedondeo): number {
  if (!esCotizacionValida(cotizacion)) throw new Error("INVALID_USD_RATE");
  if (!(typeof usd === "number" && Number.isFinite(usd) && usd >= 0)) throw new Error("INVALID_USD_PRICE");
  if (!esPasoValido(regla.step)) throw new Error("INVALID_ROUNDING_STEP");

  // `round2` primero para matar el ruido de coma flotante ANTES de dividir por
  // el paso: sin él, 30.000000000000004 / 10 puede saltar de escalón.
  const bruto = round2(usd * cotizacion);
  const escalones = bruto / regla.step;
  // `Math.round` empata para arriba, que además de determinista es lo
  // comercialmente correcto.
  const redondeado = regla.mode === "up" ? Math.ceil(escalones) : Math.round(escalones);
  return round2(redondeado * regla.step);
}

/**
 * Precio de una lista alternativa: el mismo dólar con su descuento aplicado
 * ANTES de redondear, para que el resultado también caiga en un múltiplo.
 *
 * `null` cuando la tienda no configuró el porcentaje, y es la señal de "no
 * tocar esta lista". Nunca se devuelve 0 por omisión: `priceCash = 0` es un
 * precio válido (un artículo regalado) y confundirlo con "sin configurar"
 * cobraría de más.
 */
export function precioDeLista(
  usd: number,
  cotizacion: number,
  pct: number | null,
  regla: ReglaRedondeo
): number | null {
  if (pct == null) return null;
  if (!esPorcentajeValido(pct)) throw new Error("INVALID_PCT");
  return precioDesdeUsd(round2(usd * (1 - pct / 100)), cotizacion, regla);
}

/**
 * Precio en dólares efectivo de una variante: el propio pisa al del producto,
 * espejo exacto de `price ?? basePrice`.
 *
 * `!= null` y nunca `||`: un producto con precio en dólares 0 es válido —una
 * promoción, un artículo de regalo— y con `||` heredaría el del padre.
 */
export function usdEfectivo(
  variante: { priceUsd: number | null },
  producto: { basePriceUsd: number | null }
): number | null {
  return variante.priceUsd != null ? variante.priceUsd : producto.basePriceUsd;
}
