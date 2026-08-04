"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { RUBROS } from "@/lib/verticals";
import { createStore, createStoreOwner, toggleStoreActive } from "./actions";

export function NewStoreForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("retail");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createStore(name, businessType);
      if ("error" in res && res.error) return setError(res.error);
      setError("");
      setName("");
      toast.success("Tienda creada");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
      <label className="flex min-w-56 flex-1 flex-col gap-1.5">
        <span className="ledger-label">Nueva tienda</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del comercio" required />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="ledger-label">Rubro</span>
        {/* Decide navegación, etiquetas y qué campos de catálogo ve la tienda.
            Se elige al crearla porque cambiarlo después reordena toda la app. */}
        <select
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value)}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {RUBROS.map((r) => (
            <option key={r.key} value={r.key}>{r.nombre}</option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creando…" : "Crear tienda"}
      </Button>
      {error && <p className="w-full text-sm text-destructive" role="alert">{error}</p>}
    </form>
  );
}

export function NewOwnerButton({ storeId, storeName }: { storeId: number; storeName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createStoreOwner({ storeId, name, email, password });
      if ("error" in res && res.error) return setError(res.error);
      setError("");
      setName(""); setEmail(""); setPassword("");
      setOpen(false);
      toast.success("Dueño creado");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">+ Dueño</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo dueño</DialogTitle>
          <DialogDescription>Crea la cuenta de dueño para {storeName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`o-name-${storeId}`}>Nombre</Label>
            <Input id={`o-name-${storeId}`} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`o-email-${storeId}`}>Email</Label>
            <Input id={`o-email-${storeId}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`o-pass-${storeId}`}>Contraseña (mínimo 8)</Label>
            <Input id={`o-pass-${storeId}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>Crear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ToggleStoreButton({ storeId, active }: { storeId: number; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={active ? "text-destructive" : "text-success"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleStoreActive(storeId, !active);
          router.refresh();
        })
      }
    >
      {pending ? "…" : active ? "Desactivar" : "Activar"}
    </Button>
  );
}
