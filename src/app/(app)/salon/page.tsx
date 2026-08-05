import Link from "next/link";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { getOpenSession } from "@/domain/cash";
import { listarMesas, listarOrdenesAbiertas } from "@/domain/orders";
import { getPlano, hayPlano } from "@/domain/floor-plan";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SalonClient } from "./salon-client";
import { PlanoSalon } from "./plano-salon";

/**
 * Salón: el estado de las mesas de un vistazo.
 *
 * Dos vistas del mismo dato. En pantalla grande, el plano que armó el dueño en
 * /mesas, que es donde el mozo reconoce el salón real. En el teléfono, una
 * grilla de tarjetas ordenada por tiempo de espera: apuntar una cajita del 12%
 * del ancho en cinco pulgadas es peor que tocar una fila de una lista.
 *
 * Si todavía nadie acomodó el plano, manda la grilla en las dos.
 */
export default async function SalonPage() {
  const { storeId } = await requireStore();

  const [mesas, sueltas, caja, plano, conPlano] = await Promise.all([
    listarMesas(db, storeId),
    listarOrdenesAbiertas(db, storeId),
    getOpenSession(db, storeId),
    getPlano(db, storeId),
    hayPlano(db, storeId),
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
        <>
          {/* El plano solo en pantalla grande: en el teléfono, apuntar una
              cajita del 12% del ancho es peor que tocar una tarjeta de una
              lista. La grilla no es un respaldo, es la vista móvil. */}
          {conPlano && (
            <div className="hidden lg:block">
              <PlanoSalon plano={plano} ordenes={sueltas} />
            </div>
          )}
          <div className={conPlano ? "lg:hidden" : undefined}>
            <SalonClient mesas={mesas} deMostrador={deMostrador} soloMesas />
          </div>
          {/* Los pedidos sin mesa no entran en un plano: se muestran igual en
              las dos vistas, y una sola vez. */}
          <SalonClient mesas={[]} deMostrador={deMostrador} soloMostrador />
        </>
      )}
    </div>
  );
}
