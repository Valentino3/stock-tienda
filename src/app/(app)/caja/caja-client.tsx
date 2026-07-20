"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openSession, closeSession } from "./actions";

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type SessionInfo = { id: number; openedAt: Date; openingCash: number };
type MethodTotal = { method: string; count: number; total: number };
type ClosedResult = { expectedCash: number; countedCash: number; difference: number };

type Props = {
  session: SessionInfo | null;
  openedByName: string | null;
  totals: MethodTotal[];
};

export function CajaClient({ session, openedByName, totals }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [openingCash, setOpeningCash] = useState("");
  const [openError, setOpenError] = useState("");

  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [closeError, setCloseError] = useState("");
  const [closedResult, setClosedResult] = useState<ClosedResult | null>(null);

  function submitOpen(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await openSession(Number(openingCash));
      if ("error" in res && res.error) {
        setOpenError(res.error);
        return;
      }
      setOpenError("");
      setOpeningCash("");
      router.refresh();
    });
  }

  function submitClose(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await closeSession(Number(countedCash), notes);
      if ("error" in res && res.error) {
        setCloseError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        setCloseError("");
        setClosedResult({
          expectedCash: res.expectedCash ?? 0,
          countedCash: Number(countedCash),
          difference: res.difference ?? 0,
        });
        router.refresh();
      }
    });
  }

  if (closedResult) {
    const matches = closedResult.difference === 0;
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Caja cerrada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Esperado: ${closedResult.expectedCash.toFixed(2)}</p>
          <p>Contado: ${closedResult.countedCash.toFixed(2)}</p>
          <p className={`text-lg font-semibold ${matches ? "text-green-600" : "text-destructive"}`}>
            Diferencia: ${closedResult.difference.toFixed(2)}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="max-w-xs">
        <CardHeader>
          <CardTitle className="text-base">Abrir caja</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitOpen} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="opening-cash">Monto inicial</Label>
              <Input
                id="opening-cash"
                type="number"
                step="0.01"
                min="0"
                required
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
            {openError && <p className="text-sm text-destructive">{openError}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Abriendo…" : "Abrir caja"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <Card className="border-l-4 border-l-green-500">
        <CardHeader>
          <CardTitle className="text-base">Caja abierta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Abierta el {session.openedAt.toLocaleString("es-AR")} por {openedByName ?? "—"}</p>
          <p>Monto inicial: ${session.openingCash.toFixed(2)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ventas de la sesión</CardTitle>
        </CardHeader>
        <CardContent>
          {totals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {totals.map((t) => (
                <li key={t.method}>
                  {METHOD_LABEL[t.method] ?? t.method}: {t.count} venta(s) — ${t.total.toFixed(2)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cerrar caja</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitClose} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="counted-cash">Efectivo contado</Label>
              <Input
                id="counted-cash"
                type="number"
                step="0.01"
                min="0"
                required
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {closeError && <p className="text-sm text-destructive">{closeError}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Cerrando…" : "Cerrar caja"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
