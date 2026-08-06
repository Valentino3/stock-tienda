import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { comandasPendientes, estacionesDelMenu } from "@/domain/kitchen";
import { PageHeader } from "@/components/ui/page-header";
import { CocinaClient } from "./cocina-client";

/**
 * Pantalla de cocina.
 *
 * Se abre en una tablet o una PC de la cocina y se deja abierta todo el
 * servicio. Muestra lo que hay para preparar y, si se activa, lo imprime solo.
 *
 * Por qué imprime el navegador y no el servidor: una función de Vercel no
 * puede alcanzar una impresora en la LAN del restaurante. Las opciones eran un
 * agente instalado en una máquina del local o esto. Con Chrome en
 * `--kiosk-printing` y la térmica de cocina como impresora predeterminada de
 * ESA máquina, `window.print()` sale directo sin diálogo. Cero instalación, y
 * ya hay precedente: los tickets del mostrador se imprimen igual.
 *
 * Si el hardware del local no se lleva bien con eso, el plan B es un agente
 * en Node que consulte un endpoint y mande ESC/POS por socket. No se
 * construyó porque todavía no sabemos qué impresora tienen.
 */
export const dynamic = "force-dynamic";

export default async function CocinaPage({
  searchParams,
}: {
  searchParams: Promise<{ estacion?: string }>;
}) {
  const { storeId } = await requireStore();
  const estacion = (await searchParams).estacion ?? null;

  const [comandas, estaciones] = await Promise.all([
    comandasPendientes(db, storeId, { estacion }),
    estacionesDelMenu(db, storeId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cocina"
        description={estacion ? `Estación: ${estacion}` : "Todo lo que hay para preparar."}
      />
      <CocinaClient inicial={comandas} estaciones={estaciones} estacion={estacion} />
    </div>
  );
}
