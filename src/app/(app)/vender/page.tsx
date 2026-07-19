import Link from "next/link";
import { db } from "@/db";
import { getOpenSession } from "@/domain/cash";
import { requireUser } from "@/lib/session";
import { SaleForm } from "./sale-form";

export default async function VenderPage() {
  await requireUser();
  const session = await getOpenSession(db);

  if (!session) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Vender</h1>
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          No hay caja abierta.{" "}
          <Link href="/caja" className="font-medium text-blue-600 hover:underline">
            Abrí la caja
          </Link>{" "}
          antes de vender.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Vender</h1>
      <SaleForm />
    </div>
  );
}
