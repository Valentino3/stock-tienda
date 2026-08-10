"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  CONDICIONES_IVA_RECEPTOR, CONDICION_IVA_LABEL, DOC_CUIT, DOC_DNI, DOC_LABEL,
  IVA_RESPONSABLE_INSCRIPTO, formatearCuit, normalizarDoc, validarCuit,
  type CondicionIva, type DocTipo,
} from "@/domain/fiscal-catalogs";
import { saveDatosFiscalesAction } from "../actions";


const DOCS_ELEGIBLES: DocTipo[] = [DOC_CUIT, DOC_DNI];

export function DatosFiscalesCard({
  cliente,
}: {
  cliente: {
    id: number;
    name: string;
    docTipo: number | null;
    docNro: string | null;
    condicionIva: number | null;
    razonSocial: string | null;
    domicilio: string | null;
    email: string | null;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [docTipo, setDocTipo] = useState<number>(cliente.docTipo ?? DOC_DNI);
  const [docNro, setDocNro] = useState(cliente.docNro ?? "");
  const [condicionIva, setCondicionIva] = useState<number | "">(cliente.condicionIva ?? "");

  const doc = normalizarDoc(docNro);
  const cuitInvalido = docTipo === DOC_CUIT && doc != null && !validarCuit(doc);
  // La Factura A se decide por la condición frente al IVA, no por tener CUIT.
  const daFacturaA = condicionIva === IVA_RESPONSABLE_INSCRIPTO;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await saveDatosFiscalesAction({
        clientId: cliente.id,
        docTipo: doc ? docTipo : null,
        docNro,
        condicionIva: condicionIva === "" ? null : Number(condicionIva),
        razonSocial: String(form.get("razonSocial") ?? ""),
        domicilio: String(form.get("domicilio") ?? ""),
        email: String(form.get("email") ?? ""),
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success("Datos fiscales guardados");
    });
  }

  return (
    <section className="space-y-3">
      <p className="ledger-label">Datos fiscales</p>
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Solo hacen falta para facturar. Sin estos datos, las ventas de este cliente salen como{" "}
          <strong>Factura B a Consumidor Final</strong>.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="docTipo">Tipo de documento</Label>
            <Select
              id="docTipo"
              value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value))}
            >
              {DOCS_ELEGIBLES.map((t) => (
                <option key={t} value={t}>{DOC_LABEL[t]}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="docNro">Número</Label>
            <Input
              id="docNro" inputMode="numeric" value={docNro}
              onChange={(e) => setDocNro(e.target.value)}
              aria-invalid={cuitInvalido}
              placeholder={docTipo === DOC_CUIT ? "30-70742953-0" : "30111222"}
            />
            {cuitInvalido && (
              <p className="text-sm text-destructive" role="alert">El dígito verificador no cierra.</p>
            )}
            {!cuitInvalido && docTipo === DOC_CUIT && doc && (
              <p className="text-xs text-muted-foreground">{formatearCuit(doc)}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="condicionIva">Condición frente al IVA</Label>
            <Select
              id="condicionIva"
              value={condicionIva}
              onChange={(e) => setCondicionIva(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Sin cargar</option>
              {CONDICIONES_IVA_RECEPTOR.map((c) => (
                <option key={c} value={c}>{CONDICION_IVA_LABEL[c as CondicionIva]}</option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {daFacturaA
                ? "Este cliente recibe Factura A. Necesita CUIT válido."
                : "Este cliente recibe Factura B. Solo un Responsable Inscripto recibe Factura A."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="razonSocial">Razón social</Label>
            <Input
              id="razonSocial" name="razonSocial" defaultValue={cliente.razonSocial ?? ""}
              placeholder={cliente.name}
            />
            <p className="text-xs text-muted-foreground">Si la dejás vacía se usa el nombre del cliente.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="domicilio">Domicilio</Label>
            <Input id="domicilio" name="domicilio" defaultValue={cliente.domicilio ?? ""} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input id="email" name="email" type="email" defaultValue={cliente.email ?? ""} />
            <p className="text-xs text-muted-foreground">
              Para mandarle el comprobante. Por WhatsApp alcanza con el teléfono.
            </p>
          </div>
        </div>

        {daFacturaA && docTipo !== DOC_CUIT && (
          <Notice tone="warn">
            Un Responsable Inscripto necesita CUIT. Con DNI, ARCA rechaza la Factura A.
          </Notice>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending || cuitInvalido}>
            {pending ? "Guardando…" : "Guardar datos fiscales"}
          </Button>
        </div>
      </form>
    </section>
  );
}
