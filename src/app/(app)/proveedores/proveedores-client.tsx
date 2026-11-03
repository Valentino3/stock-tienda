"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { MEDIOS_DE_GASTO, type MedioDeGasto } from "@/domain/gastos-medios";
import {
  anularCompraAction, anularPagoAction, crearProveedorAction, editarProveedorAction, registrarCompraAction,
  registrarPagoAction,
} from "./actions";

type Rubro = { id: number; nombre: string };
type Resultado = { ok: true; id?: number } | { error: string };

export type ProveedorEditable = {
  id: number; nombre: string; cuit: string | null; rubroId: number | null; plazoDias: number | null;
  telefono: string | null; notas: string | null; activo: boolean;
};

/** Alta y edición de un proveedor: el mismo formulario. */
export function ProveedorForm({ rubros, proveedor }: { rubros: Rubro[]; proveedor?: ProveedorEditable }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? "");
  const [cuit, setCuit] = useState(proveedor?.cuit ?? "");
  const [rubroId, setRubroId] = useState(proveedor?.rubroId ? String(proveedor.rubroId) : "");
  const [plazo, setPlazo] = useState(proveedor?.plazoDias != null ? String(proveedor.plazoDias) : "");
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? "");
  const [error, setError] = useState("");

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    const d = {
      nombre, cuit, telefono, notas: proveedor?.notas ?? undefined,
      rubroId: rubroId ? Number(rubroId) : null, plazoDias: plazo === "" ? null : Number(plazo),
    };
    startTransition(async () => {
      const res: Resultado = proveedor ? await editarProveedorAction(proveedor.id, d) : await crearProveedorAction(d);
      if (!("ok" in res)) {
        setError(res.error);
        return;
      }
      setError("");
      setOpen(false);
      toast.success(proveedor ? "Proveedor actualizado" : "Proveedor creado");
      if (!proveedor && res.id) router.push(`/proveedores/${res.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {proveedor ? <Button size="sm" variant="outline">Editar datos</Button> : <Button size="sm">+ Nuevo proveedor</Button>}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={guardar} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{proveedor ? proveedor.nombre : "Nuevo proveedor"}</DialogTitle>
            <DialogDescription>
              El rubro y el plazo se proponen al cargarle una factura; se pueden cambiar en cada una.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="p-nombre">Nombre</Label>
            <Input id="p-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-rubro">Rubro</Label>
              <Select id="p-rubro" value={rubroId} onChange={(e) => setRubroId(e.target.value)}>
                <option value="">Sin rubro</option>
                {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-plazo">Plazo de pago (días)</Label>
              <Input
                id="p-plazo" inputMode="numeric" value={plazo} placeholder="30"
                onChange={(e) => setPlazo(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-cuit">CUIT (opcional)</Label>
              <Input id="p-cuit" value={cuit} onChange={(e) => setCuit(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-tel">Teléfono (opcional)</Label>
              <Input id="p-tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            {proveedor && (
              <Button
                type="button" variant="ghost" className="mr-auto" disabled={pending}
                onClick={() => startTransition(async () => {
                  const res = await editarProveedorAction(proveedor.id, {
                    nombre: proveedor.nombre, cuit: proveedor.cuit ?? undefined, rubroId: proveedor.rubroId,
                    plazoDias: proveedor.plazoDias, telefono: proveedor.telefono ?? undefined,
                    notas: proveedor.notas ?? undefined, activo: !proveedor.activo,
                  });
                  if (!("ok" in res)) { setError(res.error); return; }
                  setOpen(false);
                  router.refresh();
                })}
              >
                {proveedor.activo ? "Desactivar" : "Activar"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cargar una factura de compra. */
export function NuevaFactura({
  proveedorId, rubros, rubroPorDefecto, plazoDias, hoy,
}: {
  proveedorId: number; rubros: Rubro[]; rubroPorDefecto: number | null; plazoDias: number | null; hoy: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [numero, setNumero] = useState("");
  const [tipo, setTipo] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [vencimiento, setVencimiento] = useState("");
  const [total, setTotal] = useState("");
  const [rubroId, setRubroId] = useState(rubroPorDefecto ? String(rubroPorDefecto) : "");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState("");

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await registrarCompraAction({
        proveedorId, numero, tipo, fecha, vencimiento: vencimiento || undefined,
        total: Number(total.replace(",", ".")), rubroId: rubroId ? Number(rubroId) : null, detalle,
      });
      if (!("ok" in res)) {
        setError(res.error);
        return;
      }
      toast.success(`Factura ${numero} cargada`);
      setNumero("");
      setTotal("");
      setDetalle("");
      setVencimiento("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="f-numero">Número de factura</Label>
          <Input id="f-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="0001-00001234" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-tipo">Tipo (opcional)</Label>
          <Select id="f-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">—</option>
            <option value="A">Factura A</option>
            <option value="B">Factura B</option>
            <option value="C">Factura C</option>
            <option value="X">Remito / X</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-fecha">Fecha</Label>
          <Input id="f-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-vence">Vence</Label>
          <Input id="f-vence" type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {plazoDias != null ? `Vacío: a ${plazoDias} días de la fecha.` : "Vacío: el mismo día."}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-total">Total</Label>
          <Input id="f-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-rubro">Rubro</Label>
          <Select id="f-rubro" value={rubroId} onChange={(e) => setRubroId(e.target.value)} required>
            <option value="">Elegí…</option>
            {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="f-detalle">Qué se compró (opcional)</Label>
          <Input id="f-detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Carne, verdura…" />
        </div>
      </div>
      {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Cargar factura"}</Button>
    </form>
  );
}

/** Registrar un pago al proveedor, fuera de la caja. */
export function NuevoPago({ proveedorId, hoy, saldo }: { proveedorId: number; hoy: string; saldo: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<MedioDeGasto>("transferencia");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState("");

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await registrarPagoAction({
        proveedorId, fecha, monto: Number(monto.replace(",", ".")), medio, detalle,
      });
      if (!("ok" in res)) {
        setError(res.error);
        return;
      }
      toast.success("Pago registrado");
      setMonto("");
      setDetalle("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="pg-fecha">Fecha</Label>
          <Input id="pg-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pg-monto">Monto</Label>
          <div className="flex gap-2">
            <Input id="pg-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" required />
            {saldo > 0 && (
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setMonto(String(saldo))}>
                Todo
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pg-medio">Cómo se pagó</Label>
          <Select id="pg-medio" value={medio} onChange={(e) => setMedio(e.target.value as MedioDeGasto)}>
            {MEDIOS_DE_GASTO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pg-detalle">Detalle (opcional)</Label>
          <Input id="pg-detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Transferencia #…" />
        </div>
      </div>
      {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Registrar pago"}</Button>
    </form>
  );
}

/** Igual que MOTIVO_MIN en src/domain/clients.ts. El dominio es el que manda. */
const MOTIVO_MIN = 3;

/** Anular una factura o un pago mal cargado: queda en el historial, deja de contar. */
export function Anular({
  tipo, proveedorId, id, titulo,
}: {
  tipo: "compra" | "pago"; proveedorId: number; id: number; titulo: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  function confirmar() {
    startTransition(async () => {
      const res = tipo === "compra"
        ? await anularCompraAction(proveedorId, id, motivo)
        : await anularPagoAction(proveedorId, id, motivo);
      if (!("ok" in res)) {
        toast.error(res.error);
        return;
      }
      setAbierto(false);
      setMotivo("");
      toast.success("Anulado");
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
          <AlertDialogTitle>¿Anular {titulo}?</AlertDialogTitle>
          <AlertDialogDescription>Queda en el historial como anulado y deja de contar en la deuda.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <Label htmlFor={`anular-${tipo}-${id}`}>Motivo</Label>
          <Input
            id={`anular-${tipo}-${id}`} value={motivo} autoFocus
            onChange={(e) => setMotivo(e.target.value)} placeholder="Cargada dos veces, cheque rechazado…"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <Button
            type="button" variant="destructive"
            disabled={pending || motivo.trim().length < MOTIVO_MIN} onClick={confirmar}
          >
            {pending ? "Anulando…" : "Anular"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
