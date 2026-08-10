"use client";
import { useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { voidSaleAction } from "./actions";

/** Igual que MOTIVO_MIN en src/domain/sales.ts. El dominio es el que manda. */
const MOTIVO_MIN = 3;

export function VoidButton({ saleId, facturada }: { saleId: number; facturada?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  const motivoOk = motivo.trim().length >= MOTIVO_MIN;

  function handleConfirm() {
    startTransition(async () => {
      const res = await voidSaleAction(saleId, motivo);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      setAbierto(false);
      setMotivo("");
      // La anulación funcionó, pero la nota de crédito puede haber quedado
      // pendiente. Es un cabo suelto fiscal: se avisa, no se esconde.
      if ("aviso" in res && res.aviso) toast.warning(res.aviso, { duration: 8000 });
      else toast.success("Venta anulada");
    });
  }

  return (
    <AlertDialog
      open={abierto}
      // Se controla el abierto/cerrado para poder cerrarlo recién cuando la
      // acción vuelve bien: con el diálogo sin control, `AlertDialogAction`
      // cierra al tocar y un motivo rechazado por el servidor dejaría el toast
      // de error sin ningún lugar donde corregirlo.
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) setMotivo("");
      }}
    >
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

        <div className="space-y-1.5">
          <Label htmlFor={`motivo-${saleId}`}>Motivo de la anulación</Label>
          <Textarea
            id={`motivo-${saleId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: devolución del cliente, error de carga…"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Queda guardado con la venta. Es lo que te va a decir, dentro de tres
            meses, por qué falta esa plata.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          {/* No es `AlertDialogAction`: ese cierra el diálogo al tocarlo, y acá
              hay validación que puede rebotar. */}
          <Button variant="destructive" onClick={handleConfirm} disabled={!motivoOk || pending}>
            {pending ? "Anulando…" : "Anular venta"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
