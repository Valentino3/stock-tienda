"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activarMesa, editarMesaDelLocal, eliminarMesa, nuevaMesa } from "../salon/actions";

type MesaEditable = { id: number; name: string; sector: string; capacity: number | null };

/** Alta y edición de una mesa: el mismo formulario. */
export function MesaForm({ mesa }: { mesa?: MesaEditable }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(mesa?.name ?? "");
  const [sector, setSector] = useState(mesa?.sector ?? "");
  const [capacity, setCapacity] = useState(mesa?.capacity != null ? String(mesa.capacity) : "");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const lugares = capacity ? Number(capacity) : undefined;
      const res = mesa
        ? await editarMesaDelLocal(mesa.id, { name, sector: sector || undefined, capacity: lugares ?? null })
        : await nuevaMesa(name, sector || undefined, lugares);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setError("");
      if (!mesa) {
        setName("");
        setCapacity("");
        // El sector se conserva: cargar ocho mesas de la misma terraza es el
        // caso normal, y volver a tipearlo cada vez es fricción tonta.
      }
      setOpen(false);
      toast.success(mesa ? "Mesa actualizada" : "Mesa creada");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mesa
          ? <Button size="sm" variant="ghost" aria-label={`Editar mesa ${mesa.name}`}>Editar</Button>
          : <Button size="sm">+ Nueva mesa</Button>}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mesa ? `Mesa ${mesa.name}` : "Nueva mesa"}</DialogTitle>
            <DialogDescription>
              El nombre es el que usa el mozo: «1», «12», «Barra 3».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mesa-nombre">Nombre</Label>
            <Input id="mesa-nombre" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mesa-sector">Sector</Label>
              <Input
                id="mesa-sector" value={sector} onChange={(e) => setSector(e.target.value)}
                placeholder="Salón"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mesa-capacidad">Lugares (opcional)</Label>
              <Input
                id="mesa-capacidad" inputMode="numeric" value={capacity}
                onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))} placeholder="4"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : mesa ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Se conserva el nombre viejo: la pantalla de Mesas lo importa así. */
export const NuevaMesaForm = () => <MesaForm />;

/**
 * Desactivar o borrar. Una mesa que ya tuvo ventas no se borra, se desactiva:
 * borrarla dejaría esas ventas apuntando a una mesa que no existe.
 */
export function AccionesMesa({
  mesa, activa, usada, ocupada,
}: {
  mesa: MesaEditable; activa: boolean; usada: boolean; ocupada: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function correr(fn: () => Promise<{ ok: true } | { error: string }>, ok: string) {
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(ok);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      <MesaForm mesa={mesa} />
      <Button
        type="button" size="sm" variant="ghost" disabled={pending || (activa && ocupada)}
        title={activa && ocupada ? "Tiene una comanda abierta" : undefined}
        onClick={() => correr(
          () => activarMesa(mesa.id, !activa),
          activa ? `Mesa ${mesa.name} desactivada` : `Mesa ${mesa.name} activada`,
        )}
      >
        {activa ? "Desactivar" : "Activar"}
      </Button>
      {!usada && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending}>
              Borrar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Borrar la mesa {mesa.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Nunca tuvo una comanda, así que no se pierde nada.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => correr(() => eliminarMesa(mesa.id), `Mesa ${mesa.name} borrada`)}>
                Borrar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
