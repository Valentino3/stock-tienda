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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/format";
import { setClientActiveAction, updateClientAction } from "../actions";

/**
 * Corregir nombre, teléfono y nota. Los datos fiscales tienen su propia
 * tarjeta, que es del dueño.
 */
export function EditarClienteButton({
  cliente,
}: {
  cliente: { id: number; name: string; phone: string | null; note: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cliente.name);
  const [phone, setPhone] = useState(cliente.phone ?? "");
  const [note, setNote] = useState(cliente.note ?? "");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateClientAction({ clientId: cliente.id, name, phone, note });
      if ("error" in res) return setError(res.error);
      setError("");
      setOpen(false);
      toast.success("Cliente actualizado");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Al reabrir arranca de lo guardado, no de lo que quedó a medio tipear.
        if (v) { setName(cliente.name); setPhone(cliente.phone ?? ""); setNote(cliente.note ?? ""); setError(""); }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Editar</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>El saldo y los movimientos no cambian.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`cli-nombre-${cliente.id}`}>Nombre</Label>
            <Input id={`cli-nombre-${cliente.id}`} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`cli-tel-${cliente.id}`}>Teléfono</Label>
            <Input id={`cli-tel-${cliente.id}`} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`cli-nota-${cliente.id}`}>Nota</Label>
            <Input id={`cli-nota-${cliente.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Desactivar o reactivar. Desactivar solo lo esconde del mostrador: la
 * confirmación lo dice, porque "desactivar" suena a "borrar la deuda" y no lo
 * es.
 */
export function ActivoClienteButton({
  clientId, active, balance,
}: { clientId: number; active: boolean; balance: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function cambiar(nuevo: boolean) {
    startTransition(async () => {
      const res = await setClientActiveAction(clientId, nuevo);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(nuevo ? "Cliente reactivado" : "Cliente desactivado");
      router.refresh();
    });
  }

  if (!active) {
    return (
      <Button variant="outline" size="sm" onClick={() => cambiar(true)} disabled={pending}>
        {pending ? "Reactivando…" : "Reactivar"}
      </Button>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">Desactivar</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desactivar este cliente?</AlertDialogTitle>
          <AlertDialogDescription>
            Deja de aparecer para elegirlo al vender. Su cuenta no cambia
            {balance > 0
              ? `: sigue debiendo ${money(balance)} y eso sigue sumando a la deuda total.`
              : balance < 0
                ? `: sigue teniendo ${money(-balance)} a favor.`
                : "."}{" "}
            Se le puede seguir cobrando, y se puede reactivar cuando quieras.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={() => cambiar(false)} disabled={pending}>
            {pending ? "Desactivando…" : "Desactivar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
