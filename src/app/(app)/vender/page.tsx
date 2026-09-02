import Link from "next/link";
import { db } from "@/db";
import { getOpenSession } from "@/domain/cash";
import { listClientsWithBalance } from "@/domain/clients";
import { getPricingConfig } from "@/domain/pricing-config";
import { requireStore } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SaleForm } from "./sale-form";

export default async function VenderPage() {
  const { storeId, role } = await requireStore();
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

  // Con el saldo: el credito que un cliente dejo por adelantado es invisible
  // desde el mostrador, y peor, solo se consume si el cajero elige el medio
  // "Cuenta". Si elige efectivo, el cliente paga de nuevo algo que ya pago.
  const clientList = (await listClientsWithBalance(db, storeId))
    .filter((c: { active: boolean }) => c.active)
    .map((c: { id: number; name: string; balance: number }) => ({
      id: c.id, name: c.name, balance: c.balance,
    }));

  // Cuándo se recalcularon los precios por última vez. El dispositivo lo compara
  // contra la fecha de su catálogo guardado: si el snapshot es anterior, sigue
  // cobrando los precios de antes y hay que decirlo.
  //
  // Va como prop y no por un endpoint que se sondee: el catálogo offline solo se
  // baja a mano, así que basta con avisar cuando la pantalla se abre CON
  // conexión, que es el único momento en que se puede hacer algo al respecto.
  const pricing = await getPricingConfig(db, storeId);

  return (
    <div className="space-y-6">
      <PageHeader title="Vender" description="Buscá un producto, armá el carrito y cobrá." />
      {/* cashSessionId viaja al cliente porque una venta cobrada sin conexión
          tiene que quedar imputada a ESTA caja, no a la que esté abierta cuando
          se sincronice (ver src/domain/sales-replay.ts). */}
      <SaleForm
        clients={clientList}
        storeId={storeId}
        cashSessionId={session.id}
        esDueno={role === "owner"}
        preciosActualizadosEn={pricing?.pricesUpdatedAt?.toISOString() ?? null}
      />
    </div>
  );
}
