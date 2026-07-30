"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { voidSaleAction } from "./actions";

export function VoidButton({ saleId, facturada }: { saleId: number; facturada?: boolean }) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await voidSaleAction(saleId);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      // La anulación funcionó, pero la nota de crédito puede haber quedado
      // pendiente. Es un cabo suelto fiscal: se avisa, no se esconde.
      if ("aviso" in res && res.aviso) toast.warning(res.aviso, { duration: 8000 });
      else toast.success("Venta anulada");
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending}>
          {pending ? "Anulando…" : "Anular"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular esta venta?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Se devuelve el stock
            {facturada && " y se emite la nota de crédito ante ARCA"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Anular venta</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
