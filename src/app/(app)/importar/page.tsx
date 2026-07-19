import { redirect, unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { ImportForm } from "./import-form";

export default async function ImportarPage() {
  try {
    await requireOwner();
  } catch (err) {
    // requireOwner() -> requireUser() can itself throw Next's internal
    // redirect("/login") error when there's no session at all; that must
    // propagate untouched. Only a genuine FORBIDDEN (logged in, not owner)
    // should be redirected to /vender here.
    unstable_rethrow(err);
    redirect("/vender");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Importar productos</h1>
        <a href="/importar/template" className="text-sm text-blue-600 hover:underline">
          Descargar plantilla
        </a>
      </div>
      <p className="text-sm text-gray-500">
        Subí un archivo .xlsx con columnas Producto, Variante, SKU, Precio y Stock.
      </p>
      <ImportForm />
    </div>
  );
}
