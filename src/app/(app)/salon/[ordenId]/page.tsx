import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { getOrden, ventasDeOrden } from "@/domain/orders";
import { PageHeader } from "@/components/ui/page-header";
import { OrdenClient } from "./orden-client";

export default async function OrdenPage({ params }: { params: Promise<{ ordenId: string }> }) {
  const { storeId } = await requireStore();
  const ordenId = Number((await params).ordenId);
  if (!Number.isInteger(ordenId)) notFound();

  const detalle = await getOrden(db, storeId, ordenId);
  if (!detalle) notFound();

  const [listaClientes, ventas] = await Promise.all([
    db.select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.storeId, storeId), eq(clients.active, true)))
      .orderBy(clients.name),
    ventasDeOrden(db, storeId, ordenId),
  ]);

  const titulo = detalle.mesa ? `Mesa ${detalle.mesa.name}` : `Pedido #${detalle.orden.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={titulo}
        description={detalle.mesa?.sector ?? "Mostrador / para llevar"}
      />
      <OrdenClient
        orden={detalle.orden}
        items={detalle.items}
        clientes={listaClientes}
        ventas={ventas}
        titulo={titulo}
      />
    </div>
  );
}
