import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getOpenSession } from "@/domain/cash";
import { requireStore } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SaleForm } from "./sale-form";

export default async function VenderPage() {
  const { storeId } = await requireStore();
  const session = await getOpenSession(db, storeId);

  if (!session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Vender" description="Punto de venta del mostrador." />
        <Notice tone="warn">
          No hay caja abierta.{" "}
          <Link href="/caja" className="font-semibold text-brand underline underline-offset-4">
            Abrí la caja
          </Link>{" "}
          antes de vender.
        </Notice>
      </div>
    );
  }

  const clientList = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.storeId, storeId), eq(clients.active, true)))
    .orderBy(clients.name);

  return (
    <div className="space-y-6">
      <PageHeader title="Vender" description="Buscá un producto, armá el carrito y cobrá." />
      <SaleForm clients={clientList} storeId={storeId} />
    </div>
  );
}
