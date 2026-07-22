import Link from "next/link";
import { db } from "@/db";
import { getOpenSession } from "@/domain/cash";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SaleForm } from "./sale-form";

export default async function VenderPage() {
  await requireUser();
  const session = await getOpenSession(db);

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

  return (
    <div className="space-y-6">
      <PageHeader title="Vender" description="Buscá un producto, armá el carrito y cobrá." />
      <SaleForm />
    </div>
  );
}
