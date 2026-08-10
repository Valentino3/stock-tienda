import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { listarMesas } from "@/domain/orders";
import { getPlano } from "@/domain/floor-plan";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { NuevaMesaForm } from "./mesas-client";
import { PlanoEditor } from "./plano-editor";

/** Configuración del local: qué mesas hay. Del dueño, como el resto del ABM. */
export default async function MesasPage() {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/salon");
  }

  const [mesas, plano] = await Promise.all([listarMesas(db, storeId), getPlano(db, storeId)]);
  const sectores = [...new Set(mesas.map((m) => m.mesa.sector))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mesas"
        description="Las mesas del local, agrupadas por sector."
        actions={<NuevaMesaForm />}
      />

      {mesas.length > 0 && (
        <Section label="Plano">
          <PlanoEditor plano={plano} />
        </Section>
      )}

      {mesas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Todavía no hay mesas. Creá la primera con el botón de arriba.
        </p>
      ) : (
        sectores.map((sector) => (
          <Section key={sector} label={sector}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {mesas
                .filter((m) => m.mesa.sector === sector)
                .map(({ mesa, orden }) => (
                  <div key={mesa.id} className="rounded-xl border border-border bg-card px-4 py-3">
                    <div className="font-semibold">{mesa.name}</div>
                    <div className="ledger-label text-muted-foreground">
                      {mesa.capacity ? `${mesa.capacity} lugares` : "Sin capacidad"}
                      {orden ? " · ocupada" : ""}
                    </div>
                  </div>
                ))}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}
