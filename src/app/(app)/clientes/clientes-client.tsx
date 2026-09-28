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

/** Igual que MOTIVO_MIN en src/domain/clients.ts. El dominio es el que manda. */
const MOTIVO_MIN = 3;


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

type Kind = "pago" | "credito" | "cargo" | "ajuste";

/**
 * Los cuatro movimientos, en dos grupos: los que meten plata y los que solo
 * mueven la deuda. La separación está en pantalla y no solo en el código
 * porque es la pregunta que importa al cerrar la caja: ¿esto está en el cajón?
 */
const GRUPOS: { titulo: string; opciones: { value: Kind; label: string }[] }[] = [
  {
    titulo: "Entra plata",
    opciones: [
      { value: "pago", label: "Cobro de deuda" },
      { value: "credito", label: "Cargar crédito" },
    ],
  },
  {
    titulo: "Sin plata",
    opciones: [
      { value: "cargo", label: "Cargo manual" },
      { value: "ajuste", label: "Ajuste / descuento" },
    ],
  },
];

const AYUDA: Record<Kind, string> = {
  pago: "El cliente cancela lo que debe.",
  credito: "El cliente deja plata a cuenta para usar después: una inscripción, una seña.",
  cargo: "Suma a lo que debe sin una venta: una deuda de la libreta, algo que se llevó sin pasar por la caja.",
  ajuste: "Baja lo que debe sin que entre plata: un descuento, una deuda que se perdona, un error de carga.",
};

/**
 * Cobrar, cargar crédito, o sumar y restar deuda a mano.
 *
 * ⚠️ El botón ya NO se deshabilita con saldo cero. Ese `disabled={balance <= 0}`
 * era el único motivo por el que no se podía cargarle crédito a un cliente
 * nuevo — el caso del torneo, que es justamente cuando el saldo es cero.
 *
 * El signo del saldo elige el modo por defecto, pero todos siempre son
 * alcanzables: el default es una sugerencia, no un candado. Descartado el
 * "monto con signo": nadie tipea −20.000, y un signo mal puesto es plata mal
 * registrada. Por eso sumar y restar son dos botones con nombre.
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
  const sinPlata = kind === "cargo" || kind === "ajuste";
  const resultante = kind === "cargo" ? balance + monto : balance - monto;
  const motivoOk = !sinPlata || note.trim().length >= MOTIVO_MIN;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordClientAccountMovement({
        clientId, kind, amount: monto, method: sinPlata ? undefined : method, note,
      });
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
          {/* 2×2 y no cuatro en fila: en un teléfono de 390 px cuatro
              botones con estos nombres no entran. */}
          <div className="grid grid-cols-2 gap-3">
            {GRUPOS.map((g) => (
              <div key={g.titulo} className="space-y-1">
                <p className="ledger-label">{g.titulo}</p>
                <div className="flex flex-col overflow-hidden rounded-lg border border-border">
                  {g.opciones.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setKind(o.value)}
                      aria-pressed={kind === o.value}
                      className={
                        kind === o.value
                          ? "bg-brand px-3 py-1.5 text-left text-sm text-brand-foreground"
                          : "px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{AYUDA[kind]}</p>

          <div className="space-y-2">
            <Label htmlFor={`mov-amount-${clientId}`}>Monto</Label>
            <Input id={`mov-amount-${clientId}`} type="number" step="0.01" min="0" required placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {sinPlata ? (
            <p className="text-xs text-muted-foreground">
              No toca la caja: no entra ni sale plata del cajón.
            </p>
          ) : (
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
          )}
          <div className="space-y-2">
            {/* Sin plata de por medio, el motivo es lo único que explica el
                cambio en la deuda: obligatorio. Con plata, la nota es opcional. */}
            <Label htmlFor={`mov-note-${clientId}`}>{sinPlata ? "Motivo" : "Nota (opcional)"}</Label>
            <Input
              id={`mov-note-${clientId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={sinPlata}
              placeholder={
                kind === "cargo" ? "Deuda de la libreta, fiado de antes…"
                  : kind === "ajuste" ? "Descuento acordado, error de carga…"
                  : "Inscripción torneo, seña…"
              }
            />
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
            <Button type="submit" disabled={pending || !motivoOk}>Registrar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
