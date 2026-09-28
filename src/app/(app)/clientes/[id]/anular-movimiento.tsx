"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
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
import { money } from "@/lib/format";
import { voidClientAccountMovementAction } from "../actions";

/** Igual que MOTIVO_MIN en src/domain/clients.ts. El dominio es el que manda. */
const MOTIVO_MIN = 3;

/**
 * Anular un movimiento de cuenta corriente mal cargado. Mismo diálogo que
 * anular una venta: motivo obligatorio y cerrado recién cuando el servidor
 * aceptó.
 */
export function AnularMovimientoButton({
  movementId, descripcion, monto, enEfectivo,
}: {
  movementId: number;
  /** "el cobro", "el cargo manual"… para que el título diga qué se anula. */
  descripcion: string;
  monto: number;
  enEfectivo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  const motivoOk = motivo.trim().length >= MOTIVO_MIN;

  function handleConfirm() {
    startTransition(async () => {
      const res = await voidClientAccountMovementAction(movementId, motivo);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setAbierto(false);
      setMotivo("");
      toast.success("Movimiento anulado");
      router.refresh();
    });
  }

  return (
    <AlertDialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) setMotivo("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending}>
          Anular
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular {descripcion} de {money(monto)}?</AlertDialogTitle>
          <AlertDialogDescription>
            Queda en el historial, tachado, y deja de contar en el saldo. Los saldos
            de los movimientos siguientes se recalculan.
            {enEfectivo && " Como entró en efectivo, también sale del esperado de la caja abierta."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={`motivo-mov-${movementId}`}>Motivo de la anulación</Label>
          <Textarea
            id={`motivo-mov-${movementId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: se cargó dos veces, el monto era otro…"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Queda guardado con quién lo anuló. Si el monto estaba mal, anulalo y
            cargalo de nuevo con el correcto.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={handleConfirm} disabled={!motivoOk || pending}>
            {pending ? "Anulando…" : "Anular movimiento"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
