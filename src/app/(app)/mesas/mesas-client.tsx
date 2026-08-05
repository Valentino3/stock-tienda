"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nuevaMesa } from "../salon/actions";

export function NuevaMesaForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await nuevaMesa(name, sector || undefined, capacity ? Number(capacity) : undefined);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setError("");
      setName("");
      setCapacity("");
      // El sector se conserva: cargar ocho mesas de la misma terraza es el caso
      // normal, y volver a tipearlo cada vez es fricción tonta.
      setOpen(false);
      toast.success("Mesa creada");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">+ Nueva mesa</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva mesa</DialogTitle>
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
                onChange={(e) => setCapacity(e.target.value)} placeholder="4"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Creando…" : "Crear"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
