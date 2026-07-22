import { redirect, unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Importar productos"
        description="Cargá una planilla .xlsx, o leé una factura (foto/PDF) con IA."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/importar/template">Descargar plantilla</a>
          </Button>
        }
      />
      <ImportForm />
    </div>
  );
}
