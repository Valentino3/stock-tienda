"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { StoreFiscalConfig } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { ALICUOTA_LABEL, formatearCuit, normalizarDoc, validarCuit } from "@/domain/fiscal-catalogs";
import { saveFiscalConfigAction } from "./actions";


const ALICUOTAS_ELEGIBLES = [5, 4, 3, 6, 8, 9];

export function FiscalConfigForm({ config }: { config: StoreFiscalConfig | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [cuit, setCuit] = useState(config?.cuit ?? "");

  // Se valida del lado del cliente para dar feedback inmediato, y del lado del
  // server porque el cliente no es una barrera de seguridad.
  const cuitNormalizado = normalizarDoc(cuit);
  const cuitOk = validarCuit(cuit);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);

    const umbralRaw = String(form.get("umbral") ?? "").trim();

    startTransition(async () => {
      const res = await saveFiscalConfigAction({
        cuit: String(form.get("cuit") ?? ""),
        razonSocial: String(form.get("razonSocial") ?? ""),
        domicilio: String(form.get("domicilio") ?? ""),
        nombreFantasia: String(form.get("nombreFantasia") ?? ""),
        ingresosBrutos: String(form.get("ingresosBrutos") ?? ""),
        logoUrl: String(form.get("logoUrl") ?? ""),
        inicioActividades: String(form.get("inicioActividades") ?? ""),
        puntoVenta: Number(form.get("puntoVenta")),
        defaultIvaId: Number(form.get("defaultIvaId")),
        umbralConsumidorFinal: umbralRaw === "" ? null : Number(umbralRaw),
        empleadosPuedenEmitir: form.get("empleadosPuedenEmitir") === "on",
        enabled: form.get("enabled") === "on",
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success("Datos del emisor guardados");
    });
  }

  return (
    <section className="space-y-3">
      <p className="ledger-label">Datos del emisor</p>
      <form
        onSubmit={onSubmit}
        className="space-y-5 rounded-xl border border-border bg-card p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cuit">CUIT</Label>
            <Input
              id="cuit" name="cuit" required inputMode="numeric" placeholder="30-70742953-0"
              value={cuit} onChange={(e) => setCuit(e.target.value)}
              aria-invalid={cuit.length > 0 && !cuitOk}
            />
            <p className="text-xs text-muted-foreground">
              {cuit.length === 0
                ? "El CUIT del comercio, tal como figura en ARCA."
                : cuitOk
                  ? `Válido: ${formatearCuit(cuitNormalizado)}`
                  : "El dígito verificador no cierra. Revisá el número."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="puntoVenta">Punto de venta</Label>
            <Input
              id="puntoVenta" name="puntoVenta" type="number" min={1} max={99999} required
              defaultValue={config?.puntoVenta ?? 1}
            />
            <p className="text-xs text-muted-foreground">
              El que habilitaste en ARCA para web services. Se muestra como 0001.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="razonSocial">Razón social</Label>
            <Input id="razonSocial" name="razonSocial" required defaultValue={config?.razonSocial ?? ""} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nombreFantasia">Nombre de fantasía</Label>
            <Input id="nombreFantasia" name="nombreFantasia" defaultValue={config?.nombreFantasia ?? ""} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="domicilio">Domicilio comercial</Label>
            <Input id="domicilio" name="domicilio" required defaultValue={config?.domicilio ?? ""} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ingresosBrutos">Ingresos Brutos</Label>
            <Input
              id="ingresosBrutos" name="ingresosBrutos" placeholder="901-123456-7 o Exento"
              defaultValue={config?.ingresosBrutos ?? ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inicioActividades">Inicio de actividades</Label>
            <Input
              id="inicioActividades" name="inicioActividades" type="date"
              defaultValue={config?.inicioActividades ?? ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="defaultIvaId">Alícuota de IVA</Label>
            <Select
              id="defaultIvaId" name="defaultIvaId"
              defaultValue={config?.defaultIvaId ?? 5}
            >
              {ALICUOTAS_ELEGIBLES.map((id) => (
                <option key={id} value={id}>{ALICUOTA_LABEL[id]}</option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Se aplica a todos los productos. Tus precios ya la incluyen.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="umbral">Monto que exige identificar al comprador</Label>
            <Input
              id="umbral" name="umbral" type="number" min={0} step="0.01" placeholder="Sin límite"
              defaultValue={config?.umbralConsumidorFinal ?? ""}
            />
            <p className="text-xs text-muted-foreground">
              Vacío = nunca se exige. El monto lo fija ARCA y cambia con el tiempo: consultalo con tu contador.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="logoUrl">Logo para el remito (opcional)</Label>
            <Input
              id="logoUrl" name="logoUrl" type="url" placeholder="https://…/logo.png"
              defaultValue={config?.logoUrl ?? ""}
            />
            <p className="text-xs text-muted-foreground">
              La dirección de una imagen ya publicada. Sale centrada en el remito. Si el
              enlace deja de funcionar, el remito sale sin logo — nunca se traba la
              impresión.
            </p>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox name="enabled" defaultChecked={config?.enabled ?? false} className="mt-0.5" />
            <span>
              <span className="font-medium">Facturación activada</span>
              <span className="block text-xs text-muted-foreground">
                Sin esto, el botón de emitir factura no aparece en Ventas.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              name="empleadosPuedenEmitir"
              defaultChecked={config?.empleadosPuedenEmitir ?? false}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Los empleados pueden emitir facturas</span>
              <span className="block text-xs text-muted-foreground">
                Un comprobante autorizado no se puede borrar, solo anular con nota de crédito.
                Dejalo desactivado salvo que confíes en que lo van a usar bien.
              </span>
            </span>
          </label>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar datos del emisor"}
          </Button>
        </div>
      </form>
    </section>
  );
}
