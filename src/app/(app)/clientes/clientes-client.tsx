"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { money } from "@/lib/format";
import { saveClient, recordClientAccountMovement } from "./actions";


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

type Kind = "pago" | "credito";

/**
 * Cobrar una deuda o cargarle crédito por adelantado.
 *
 * ⚠️ El botón ya NO se deshabilita con saldo cero. Ese `disabled={balance <= 0}`
 * era el único motivo por el que no se podía cargarle crédito a un cliente
 * nuevo — el caso del torneo, que es justamente cuando el saldo es cero.
 *
 * El signo del saldo elige el modo por defecto, pero los dos siempre son
 * alcanzables: el default es una sugerencia, no un candado. Descartado el
 * "monto con signo": nadie tipea −20.000, y un signo mal puesto es plata mal
 * registrada.
 */
export function MovimientoCuentaButton({
  clientId, clientName, balance,
}: { clientId: number; clientName: string; balance: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(balance > 0 ? "pago" : "credito");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const monto = Number(amount) || 0;
  const resultante = balance - monto;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordClientAccountMovement({ clientId, kind, amount: monto, method, note });
      if ("error" in res) return setError(res.error);
      setError("");
      setAmount(""); setNote("");
      setOpen(false);
      toast.success(
        res.balance < 0
          ? `Listo. ${clientName} queda con ${money(-res.balance)} a favor.`
          : res.balance > 0
            ? `Listo. ${clientName} queda debiendo ${money(res.balance)}.`
            : `Listo. ${clientName} queda al día.`
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Cuenta</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cuenta de {clientName}</DialogTitle>
          <DialogDescription>
            {balance > 0
              ? `Debe ${money(balance)}.`
              : balance < 0
                ? `Tiene ${money(-balance)} a favor.`
                : "Está al día."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {([
              { value: "pago", label: "Cobro de deuda" },
              { value: "credito", label: "Cargar crédito" },
            ] as const).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setKind(o.value)}
                aria-pressed={kind === o.value}
                className={
                  kind === o.value
                    ? "flex-1 bg-brand px-3 py-1.5 text-sm text-brand-foreground"
                    : "flex-1 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {kind === "pago"
              ? "El cliente cancela lo que debe."
              : "El cliente deja plata a cuenta para usar después: una inscripción, una seña."}
          </p>

          <div className="space-y-2">
            <Label htmlFor={`mov-amount-${clientId}`}>Monto</Label>
            <Input id={`mov-amount-${clientId}`} type="number" step="0.01" min="0" required placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`mov-method-${clientId}`}>Medio</Label>
            <Select id={`mov-method-${clientId}`} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </Select>
            {method === "efectivo" && (
              <p className="text-xs text-muted-foreground">
                En efectivo suma al arqueo de la caja abierta, así que necesita
                una caja abierta.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`mov-note-${clientId}`}>Nota (opcional)</Label>
            <Input id={`mov-note-${clientId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Inscripción torneo, seña…" />
          </div>

          {/* Decir a dónde queda el saldo antes de confirmar: cargarle crédito a
              alguien que debe se aplica primero contra esa deuda, y eso
              sorprende si no se dice. */}
          {monto > 0 && (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              Después de esto:{" "}
              <strong>
                {resultante < 0
                  ? `${money(-resultante)} a favor`
                  : resultante > 0
                    ? `debe ${money(resultante)}`
                    : "al día"}
              </strong>
            </p>
          )}
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
