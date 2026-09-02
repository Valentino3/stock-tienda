import { redirect, unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireStoreOwner } from "@/lib/session";
import { getPricingConfig } from "@/domain/pricing-config";
import { getUltimoLoteConfirmado } from "@/domain/pricing-recalc";
import { REGLA_POR_DEFECTO } from "@/domain/pricing-usd";
import { money } from "@/lib/format";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { CotizacionForm } from "./cotizacion-form";
import { RecalculoPanel } from "./recalculo-panel";

/**
 * Precios atados al dólar.
 *
 * Dos bloques y en este orden: primero cuánto vale el dólar y cómo se
 * redondea, después el botón que reescribe el catálogo. Guardar la cotización
 * no cambia ningún precio — el único momento en que se toca plata es al
 * confirmar el recálculo.
 */
export default async function PreciosPage() {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const cfg = await getPricingConfig(db, storeId);
  const ultimo = await getUltimoLoteConfirmado(db, storeId);

  // Quién cargó la cotización: importa para poder preguntarle si el número
  // parece raro.
  let autor: string | null = null;
  if (cfg?.usdRateUpdatedBy) {
    const [u] = await db.select({ name: user.name }).from(user)
      .where(eq(user.id, cfg.usdRateUpdatedBy));
    autor = u?.name ?? null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Precios"
        description="Cargá la cotización del dólar y actualizá los precios del catálogo."
      />

      <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
        <StatTile
          label="Cotización vigente"
          value={cfg?.usdRate != null ? money(cfg.usdRate) : "Sin cargar"}
          tone={cfg?.usdRate != null ? "brand" : "default"}
          hint={
            cfg?.usdRateUpdatedAt
              ? `Cargada el ${cfg.usdRateUpdatedAt.toLocaleString("es-AR")}${autor ? ` por ${autor}` : ""}`
              : "Todavía no se cargó"
          }
        />
        <Section label="Cómo se convierte">
          <Panel>
            <CotizacionForm
              inicial={{
                usdRate: cfg?.usdRate ?? null,
                roundingMode: cfg?.roundingMode ?? REGLA_POR_DEFECTO.mode,
                roundingStep: cfg?.roundingStep ?? REGLA_POR_DEFECTO.step,
                cashPct: cfg?.cashPct ?? null,
                wholesalePct: cfg?.wholesalePct ?? null,
              }}
            />
          </Panel>
        </Section>
      </div>

      <Section label="Actualizar precios">
        <Panel className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Recalcula el precio en pesos de todo lo que tenga precio en dólares.
            Las ventas y los comprobantes ya emitidos no se tocan.
          </p>
          <RecalculoPanel
            hayCotizacion={cfg?.usdRate != null}
            ultimoLote={
              ultimo
                ? { id: ultimo.id, confirmadoEn: ultimo.confirmedAt, cambiados: ultimo.changed }
                : null
            }
          />
        </Panel>
      </Section>
    </div>
  );
}
