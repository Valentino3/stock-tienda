import Link from "next/link";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { getOpenSession } from "@/domain/cash";
import { listarMesas, listarOrdenesAbiertas } from "@/domain/orders";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SalonClient } from "./salon-client";

/**
 * Salón: el estado de las mesas de un vistazo.
 *
 * Es una grilla de tarjetas, no un plano arrastrable. El mozo está en un
 * teléfono y arrastrar cajitas en una pantalla de cinco pulgadas es peor que
 * una lista. El plano visual llega después y esta grilla se queda como vista
 * móvil.
 */
export default async function SalonPage() {
  const { storeId } = await requireStore();

  const [mesas, sueltas, caja] = await Promise.all([
    listarMesas(db, storeId),
    listarOrdenesAbiertas(db, storeId),
    getOpenSession(db, storeId),
  ]);

  // Las de mostrador / para llevar no tienen mesa y se muestran aparte.
  const deMostrador = sueltas.filter((o: { tableId: number | null }) => o.tableId == null);

  return (
    <div className="space-y-6">
      <PageHeader title="Salón" description="Mesas abiertas y comandas en curso." />

      {!caja && (
        <Notice tone="warn">
          No hay caja abierta. Podés tomar pedidos, pero para cobrar hay que{" "}
          <Link href="/caja" className="font-semibold text-brand underline underline-offset-4">
            abrir la caja
          </Link>.
        </Notice>
      )}

      {mesas.length === 0 && deMostrador.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Todavía no hay mesas cargadas.{" "}
          <Link href="/mesas" className="font-semibold text-brand underline underline-offset-4">
            Cargá las mesas del local
          </Link>{" "}
          para empezar.
        </p>
      ) : (
        <SalonClient mesas={mesas} deMostrador={deMostrador} />
      )}
    </div>
  );
}
