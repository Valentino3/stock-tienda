import { eq } from "drizzle-orm";
import { storePricingConfig, type StorePricingConfig } from "@/db/schema";
import {
  REGLA_POR_DEFECTO, esCotizacionValida, esModoValido, esPasoValido, esPorcentajeValido,
  type ReglaRedondeo,
} from "@/domain/pricing-usd";

/**
 * Cotización del dólar y reglas de conversión de una tienda.
 *
 * Upsert 1:1 sobre la tienda, mismo patrón que `saveFiscalConfig`. Guardar acá
 * no cambia ningún precio: solo describe cómo se van a calcular cuando alguien
 * pida el recálculo.
 */

export async function getPricingConfig(db: any, storeId: number): Promise<StorePricingConfig | null> {
  const [row] = await db.select().from(storePricingConfig).where(eq(storePricingConfig.storeId, storeId));
  return row ?? null;
}

/** La regla guardada, o la de por defecto si la tienda nunca configuró nada. */
export function reglaDe(cfg: StorePricingConfig | null): ReglaRedondeo {
  if (!cfg || !esModoValido(cfg.roundingMode) || !esPasoValido(cfg.roundingStep)) return REGLA_POR_DEFECTO;
  return { mode: cfg.roundingMode, step: cfg.roundingStep };
}

export type SavePricingConfigInput = {
  storeId: number;
  userId: string;
  usdRate: number | null;
  roundingMode?: string;
  roundingStep?: number;
  cashPct?: number | null;
  wholesalePct?: number | null;
};

export async function savePricingConfig(db: any, input: SavePricingConfigInput): Promise<void> {
  if (input.usdRate != null && !esCotizacionValida(input.usdRate)) throw new Error("INVALID_USD_RATE");
  const mode = input.roundingMode ?? REGLA_POR_DEFECTO.mode;
  const step = input.roundingStep ?? REGLA_POR_DEFECTO.step;
  if (!esModoValido(mode)) throw new Error("INVALID_ROUNDING_MODE");
  if (!esPasoValido(step)) throw new Error("INVALID_ROUNDING_STEP");
  for (const pct of [input.cashPct, input.wholesalePct]) {
    if (pct != null && !esPorcentajeValido(pct)) throw new Error("INVALID_PCT");
  }

  const previa = await getPricingConfig(db, input.storeId);
  // La autoría solo se toca si la cotización realmente cambió: guardar los
  // porcentajes no puede hacer parecer que alguien actualizó el dólar.
  const cambioLaCotizacion = previa?.usdRate !== input.usdRate;

  const valores = {
    usdRate: input.usdRate,
    usdRateUpdatedAt: cambioLaCotizacion ? new Date() : (previa?.usdRateUpdatedAt ?? null),
    usdRateUpdatedBy: cambioLaCotizacion ? input.userId : (previa?.usdRateUpdatedBy ?? null),
    roundingMode: mode,
    roundingStep: step,
    // `?? null` y no `|| null`: 0% es un porcentaje válido (la lista existe y
    // vale lo mismo que el precio de venta) y es distinto de "no configurada".
    cashPct: input.cashPct ?? null,
    wholesalePct: input.wholesalePct ?? null,
    updatedAt: new Date(),
  };

  await db.insert(storePricingConfig)
    .values({ storeId: input.storeId, ...valores })
    .onConflictDoUpdate({ target: storePricingConfig.storeId, set: valores });
}

/**
 * Marca que los precios de esta tienda se movieron.
 *
 * Lo lee el dispositivo para saber si su catálogo guardado quedó viejo: si el
 * snapshot es anterior a esta fecha, sigue cobrando los precios de antes y hay
 * que decírselo al vendedor.
 */
export async function marcarPreciosActualizados(db: any, storeId: number, cuando = new Date()): Promise<void> {
  await db.update(storePricingConfig)
    .set({ pricesUpdatedAt: cuando, updatedAt: new Date() })
    .where(eq(storePricingConfig.storeId, storeId));
}
