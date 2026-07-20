import { redirect, unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ImportForm } from "./import-form";

export default async function ImportarPage() {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Importar productos</h1>
        <Button asChild variant="outline" size="sm">
          <a href="/importar/template">Descargar plantilla</a>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Subí un archivo .xlsx con columnas Producto, Variante, SKU, Precio y Stock.
      </p>
      <ImportForm />
    </div>
  );
}
