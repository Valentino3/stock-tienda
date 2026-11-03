"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { money } from "@/lib/format";
import { MEDIOS_DE_GASTO, type MedioDeGasto } from "@/domain/gastos-medios";
import { anularGastoAction, crearRubroAction, editarRubroAction, registrarGastoAction } from "./actions";

type RubroOpcion = { id: number; nombre: string; activo: boolean };

/** Alta de un gasto fuera de la caja. */
export function NuevoGasto({ rubros, hoy }: { rubros: RubroOpcion[]; hoy: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const activos = rubros.filter((r) => r.activo);
  const [rubroId, setRubroId] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<MedioDeGasto>("transferencia");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState("");

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await registrarGastoAction({
        rubroId: Number(rubroId), fecha, monto: Number(monto.replace(",", ".")), medio, detalle,
      });
      if (!("ok" in res)) {
        setError(res.error);
        return;
      }
      toast.success(`Gasto de ${money(Number(monto.replace(",", ".")))} registrado`);
      setMonto("");
      setDetalle("");
      // Rubro, fecha y medio se conservan: cargar los sueldos del mes es
      // varias filas seguidas del mismo rubro.
      router.refresh();
    });
  }

  return (
    <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      <div className="space-y-1">
        <Label htmlFor="g-fecha">Fecha</Label>
        <Input id="g-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="g-rubro">Rubro</Label>
        <Select id="g-rubro" value={rubroId} onChange={(e) => setRubroId(e.target.value)} required>
          <option value="">Elegí…</option>
          {activos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="g-monto">Monto</Label>
        <Input
          id="g-monto" inputMode="decimal" value={monto} placeholder="0"
          onChange={(e) => setMonto(e.target.value)} required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="g-medio">Cómo se pagó</Label>
        <Select id="g-medio" value={medio} onChange={(e) => setMedio(e.target.value as MedioDeGasto)}>
          {MEDIOS_DE_GASTO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1 lg:col-span-1">
        <Label htmlFor="g-detalle">Detalle</Label>
        <Input
          id="g-detalle" value={detalle} placeholder="Sueldo octubre — Juan"
          onChange={(e) => setDetalle(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Registrar gasto"}</Button>
      {error && <div className="sm:col-span-2 lg:col-span-6" role="alert"><Notice tone="danger">{error}</Notice></div>}
    </form>
  );
}

/** Igual que MOTIVO_MIN en src/domain/clients.ts. El dominio es el que manda. */
const MOTIVO_MIN = 3;

/** Anular un gasto mal cargado: queda en el historial, deja de sumar. */
export function AnularGasto({ gastoId, monto, rubro }: { gastoId: number; monto: number; rubro: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  function confirmar() {
    startTransition(async () => {
      const res = await anularGastoAction(gastoId, motivo);
      if (!("ok" in res)) {
        toast.error(res.error);
        return;
      }
      setAbierto(false);
      setMotivo("");
      toast.success("Gasto anulado");
      router.refresh();
    });
  }

  return (
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-destructive">Anular</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular el gasto de {money(monto)}?</AlertDialogTitle>
          <AlertDialogDescription>
            {rubro}. Queda en el historial como anulado y deja de sumar en los totales.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <Label htmlFor={`motivo-${gastoId}`}>Motivo</Label>
          <Input
            id={`motivo-${gastoId}`} value={motivo} autoFocus
            placeholder="Cargado dos veces, monto equivocado…"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <Button
            type="button" variant="destructive"
            disabled={pending || motivo.trim().length < MOTIVO_MIN}
            onClick={confirmar}
          >
            {pending ? "Anulando…" : "Anular"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Los rubros del local: agregar, renombrar, desactivar. */
export function Rubros({ rubros }: { rubros: RubroOpcion[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nuevo, setNuevo] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");

  function correr(fn: () => Promise<{ ok: true } | { error: string }>, alOk?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!("ok" in res)) {
        toast.error(res.error);
        return;
      }
      alOk?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          correr(() => crearRubroAction(nuevo), () => setNuevo(""));
        }}
      >
        <Input
          value={nuevo} onChange={(e) => setNuevo(e.target.value)}
          placeholder="Nuevo rubro" aria-label="Nombre del rubro nuevo" className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={pending || !nuevo.trim()}>Agregar</Button>
      </form>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rubros.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            {editando === r.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  correr(() => editarRubroAction(r.id, { nombre }), () => setEditando(null));
                }}
              >
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus aria-label="Nombre del rubro" />
                <Button type="submit" size="sm" disabled={pending}>Guardar</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
              </form>
            ) : (
              <>
                <span className={r.activo ? "flex-1" : "flex-1 text-muted-foreground line-through"}>{r.nombre}</span>
                <Button
                  type="button" size="sm" variant="ghost"
                  onClick={() => { setEditando(r.id); setNombre(r.nombre); }}
                >
                  Renombrar
                </Button>
                <Button
                  type="button" size="sm" variant="ghost" disabled={pending}
                  onClick={() => correr(() => editarRubroAction(r.id, { activo: !r.activo }))}
                >
                  {r.activo ? "Desactivar" : "Activar"}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
