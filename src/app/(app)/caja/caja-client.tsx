"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { StatTile } from "@/components/ui/stat-tile";
import { money, number } from "@/lib/format";
import { useEstadoOffline } from "@/lib/offline/estado";
import { openSession, closeSession, addGasto, addEgreso } from "./actions";

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta",
};

const MOVEMENT_LABEL: Record<string, string> = { gasto: "Gasto", egreso: "Egreso" };

type SessionInfo = { id: number; openedAt: Date; openingCash: number };
type MethodTotal = { method: string; count: number; total: number };
type MovementInfo = { id: number; kind: "gasto" | "egreso"; amount: number; description: string; createdAt: Date };
type ClosedResult = { sessionId: number; expectedCash: number; countedCash: number; difference: number };

type Props = {
  session: SessionInfo | null;
  openedByName: string | null;
  totals: MethodTotal[];
  movements: MovementInfo[];
  isOwner: boolean;
};

export function CajaClient({ session, openedByName, totals, movements, isOwner }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { pendientes } = useEstadoOffline();

  const [openingCash, setOpeningCash] = useState("");
  const [openError, setOpenError] = useState("");

  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [closeError, setCloseError] = useState("");
  const [closedResult, setClosedResult] = useState<ClosedResult | null>(null);

  const [movKind, setMovKind] = useState<"gasto" | "egreso">("gasto");
  const [movAmount, setMovAmount] = useState("");
  const [movDescription, setMovDescription] = useState("");
  const [movError, setMovError] = useState("");

  function submitMovement(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const action = movKind === "egreso" ? addEgreso : addGasto;
      const res = await action(Number(movAmount), movDescription);
      if ("error" in res && res.error) {
        setMovError(res.error);
        return;
      }
      setMovError("");
      setMovAmount("");
      setMovDescription("");
      router.refresh();
    });
  }

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
    // Cerrar con ventas sin sincronizar deja un arqueo que no cuadra: los
    // totales del cierre se calculan sobre lo que hay en el servidor, y esas
    // ventas todavía no llegaron. Se sincroniza primero. El servidor igual
    // acepta la venta tardía y levanta un aviso (ver sales-replay.ts), pero
    // el número del cierre ya quedó mal.
    if (pendientes > 0) {
      setCloseError(
        `Hay ${pendientes} venta(s) sin sincronizar. Sincronizalas antes de cerrar la caja para que el arqueo cuadre.`,
      );
      return;
    }
    startTransition(async () => {
      const res = await closeSession(Number(countedCash), notes);
      if ("error" in res && res.error) {
        setCloseError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        setCloseError("");
        setClosedResult({
          sessionId: res.sessionId,
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
        <CardContent className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-muted-foreground">Esperado</dt>
              <dd className="figure font-medium">{money(closedResult.expectedCash)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-muted-foreground">Contado</dt>
              <dd className="figure font-medium">{money(closedResult.countedCash)}</dd>
            </div>
          </dl>
          <StatTile
            label="Diferencia"
            value={money(closedResult.difference)}
            tone={matches ? "success" : "destructive"}
            hint={matches ? "La caja cuadra." : "Revisar el conteo."}
          />
          {/* El momento en que se quiere el papel del turno es este, no tres
              pantallas más adelante. */}
          <Button asChild className="w-full">
            <a href={`/caja/${closedResult.sessionId}/cierre`}>Descargar cierre con los remitos</a>
          </Button>
          {/* Sin esto la pantalla de cierre es un callejón: el arqueo queda
              a la vista y no hay forma de volver a abrir sin navegar afuera y
              entrar de nuevo. Pasa cuando se cierra por error, o cuando hay
              dos turnos en el día. */}
          <Button type="button" variant="outline" className="w-full" onClick={() => setClosedResult(null)}>
            Abrir otra caja
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Abrir caja</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitOpen} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="opening-cash">Monto inicial en efectivo</Label>
              <Input
                id="opening-cash"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="0,00"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
            {openError && (
              <Notice tone="danger" role="alert">
                {openError}
              </Notice>
            )}
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? "Abriendo…" : "Abrir caja"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const sessionTotal = totals.reduce((acc, t) => acc + t.total, 0);
  const movementsTotal = movements.reduce((acc, m) => acc + m.amount, 0);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Notice tone="success">
          <div className="flex items-center gap-2 font-medium text-success">
            <span className="size-2 rounded-full bg-success" aria-hidden />
            Caja abierta
          </div>
          <p className="mt-1.5 text-muted-foreground">
            Abierta el {session.openedAt.toLocaleString("es-AR")} por {openedByName ?? "—"}.
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Monto inicial <span className="figure text-foreground">{money(session.openingCash)}</span>
          </p>
        </Notice>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ventas de la sesión</CardTitle>
          </CardHeader>
          <CardContent>
            {totals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {totals.map((t) => (
                  <li key={t.method} className="flex items-baseline justify-between py-2 first:pt-0 last:pb-0">
                    <span>
                      {METHOD_LABEL[t.method] ?? t.method}{" "}
                      <span className="text-muted-foreground">· {number(t.count)} venta(s)</span>
                    </span>
                    <span className="figure font-medium">{money(t.total)}</span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between border-t-2 border-foreground/80 py-2 pb-0">
                  <span className="ledger-label">Total</span>
                  <span className="figure font-semibold">{money(sessionTotal)}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gastos y egresos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin gastos ni egresos en esta caja.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0">
                    <span className="min-w-0">
                      <span className="ledger-label mr-2">{MOVEMENT_LABEL[m.kind]}</span>
                      {m.description}
                    </span>
                    <span className="figure shrink-0 font-medium text-destructive">−{money(m.amount)}</span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between border-t-2 border-foreground/80 py-2 pb-0">
                  <span className="ledger-label">Total salidas</span>
                  <span className="figure font-semibold text-destructive">−{money(movementsTotal)}</span>
                </li>
              </ul>
            )}

            <form onSubmit={submitMovement} className="space-y-3 border-t border-border pt-4">
              {isOwner && (
                <div className="flex gap-2">
                  {(["gasto", "egreso"] as const).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      variant={movKind === k ? "brand" : "outline"}
                      size="sm"
                      onClick={() => setMovKind(k)}
                    >
                      {MOVEMENT_LABEL[k]}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mov-amount" className="ledger-label">Monto</Label>
                  <Input
                    id="mov-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0,00"
                    value={movAmount}
                    onChange={(e) => setMovAmount(e.target.value)}
                    className="w-28"
                  />
                </div>
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label htmlFor="mov-desc" className="ledger-label">Descripción</Label>
                  <Input
                    id="mov-desc"
                    required
                    placeholder={movKind === "egreso" ? "Ej: retiro de efectivo" : "Ej: insumos, envío"}
                    value={movDescription}
                    onChange={(e) => setMovDescription(e.target.value)}
                  />
                </div>
                <Button type="submit" size="sm" disabled={pending}>
                  Registrar
                </Button>
              </div>
              {movError && (
                <Notice tone="danger" role="alert">
                  {movError}
                </Notice>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cerrar caja</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitClose} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="counted-cash">Efectivo contado</Label>
              <Input
                id="counted-cash"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="0,00"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {closeError && (
              <Notice tone="danger" role="alert">
                {closeError}
              </Notice>
            )}
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? "Cerrando…" : "Cerrar caja"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
