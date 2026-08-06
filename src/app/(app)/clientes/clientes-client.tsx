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
import { money } from "@/lib/format";
import { saveClient, recordClientPayment } from "./actions";

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function NewClientForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveClient({ name, phone, note });
      if ("error" in res && res.error) return setError(res.error);
      setError("");
      setName(""); setPhone(""); setNote("");
      toast.success("Cliente creado");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <label className="flex min-w-44 flex-1 flex-col gap-1.5">
        <span className="ledger-label">Nombre</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" required />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="ledger-label">Teléfono</span>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-40" />
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1.5">
        <span className="ledger-label">Nota</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creando…" : "Agregar cliente"}
      </Button>
      {error && <p className="w-full text-sm text-destructive" role="alert">{error}</p>}
    </form>
  );
}

export function PaymentButton({ clientId, clientName, balance }: { clientId: number; clientName: string; balance: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordClientPayment({ clientId, amount: Number(amount), method, note });
      if ("error" in res && res.error) return setError(res.error);
      setError("");
      setAmount(""); setNote("");
      setOpen(false);
      toast.success("Pago registrado");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={balance <= 0}>Registrar pago</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pago de {clientName}</DialogTitle>
          <DialogDescription>Saldo actual: {money(balance)}. El pago baja la deuda.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`pay-amount-${clientId}`}>Monto</Label>
            <Input id={`pay-amount-${clientId}`} type="number" step="0.01" min="0" required placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`pay-method-${clientId}`}>Medio</Label>
            <select id={`pay-method-${clientId}`} value={method} onChange={(e) => setMethod(e.target.value)} className={SELECT_CLASS}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`pay-note-${clientId}`}>Nota (opcional)</Label>
            <Input id={`pay-note-${clientId}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>Registrar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
