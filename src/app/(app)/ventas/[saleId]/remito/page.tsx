import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { getEmisorRemito, getRemito } from "@/domain/cash-close";
import { Button } from "@/components/ui/button";
import { RemitoImprimible } from "@/components/remito/remito-imprimible";
import { PrintButton } from "@/app/(app)/comprobantes/[id]/print-button";

/**
 * El remito de una venta, para imprimir o guardar como PDF.
 *
 * Es el mismo papel que sale en el paquete del cierre de caja, con el mismo
 * componente: si fueran dos, empezarian a diferir en el primer cambio.
 *
 * Permisos: cualquiera de la tienda, pero un empleado solo puede imprimir SUS
 * ventas. Es la regla que ya rige /ventas y su exportacion — el remito lleva
 * precios y quien vendio, asi que abrirlo mas seria una puerta lateral a las
 * ventas de otro.
 *
 * No lleva numeracion propia: usa el numero de venta. Ver el comentario del
 * componente.
 */
export default async function RemitoPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { storeId, role, id: userId } = await requireStore();
  const { saleId } = await params;
  const id = Number(saleId);
  if (!Number.isInteger(id)) notFound();

  const remito = await getRemito(db, storeId, id, {
    sellerId: role === "owner" ? undefined : userId,
  });
  if (!remito) notFound();

  const emisor = await getEmisorRemito(db, storeId);

  return (
    <div className="space-y-4">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/ventas">← Volver a Ventas</Link>
        </Button>
        <PrintButton />
      </div>

      {/* A4, el mismo formato que el paquete del cierre: un solo diseno de
          remito, para que el papel que se archiva y el que se entrega sean el
          mismo documento. */}
      <div className="mx-auto w-full max-w-[210mm] border border-border print:max-w-none print:border-0">
        <RemitoImprimible remito={remito} emisor={emisor} />
      </div>
    </div>
  );
}
