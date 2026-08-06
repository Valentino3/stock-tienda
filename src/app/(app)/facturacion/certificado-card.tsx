"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import type { ArcaAmbiente } from "@/db/schema";
import type { CredencialesResumen } from "@/domain/fiscal-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatearCuit } from "@/domain/fiscal-catalogs";
import { deleteCredentialsAction } from "./actions";

export function CertificadoCard({
  ambiente,
  credenciales,
  diasRestantes,
  cuitConfigurado,
}: {
  ambiente: ArcaAmbiente;
  credenciales: CredencialesResumen | null;
  diasRestantes: number | null;
  cuitConfigurado: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const certRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const cert = certRef.current?.files?.[0];
    const key = keyRef.current?.files?.[0];
    if (!cert || !key) {
      setError("Elegí los dos archivos: el certificado (.crt) y la clave privada (.key).");
      return;
    }

    const body = new FormData();
    body.set("cert", cert);
    body.set("key", key);
    body.set("ambiente", ambiente);

    startTransition(async () => {
      try {
        const res = await fetch("/facturacion/credenciales", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo subir el certificado.");
          return;
        }
        // La respuesta trae SOLO metadatos: los PEM nunca vuelven al navegador.
        toast.success("Certificado cargado");
        if (certRef.current) certRef.current.value = "";
        if (keyRef.current) keyRef.current.value = "";
        router.refresh();
      } catch {
        // Este catch existe porque un 413 sin manejar rompía la pantalla en el
        // import; mismo patrón acá.
        setError("No se pudo subir el archivo. Probá de nuevo.");
      }
    });
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteCredentialsAction(ambiente);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success("Certificado eliminado");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <p className="ledger-label">
        Certificado de ARCA — {ambiente === "produccion" ? "producción" : "homologación"}
      </p>

      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        {credenciales ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-4 text-success" />
              <span className="text-sm font-medium">Certificado cargado</span>
              {diasRestantes != null && (
                <Badge variant={diasRestantes < 0 ? "destructive" : diasRestantes <= 30 ? "outline" : "success"}>
                  {diasRestantes < 0 ? "Vencido" : `Vence en ${diasRestantes} días`}
                </Badge>
              )}
            </div>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">CUIT del certificado</dt>
              <dd className="figure">{credenciales.certCuit ? formatearCuit(credenciales.certCuit) : "—"}</dd>
              <dt className="text-muted-foreground">Vencimiento</dt>
              <dd>{credenciales.certExpiresAt?.toLocaleDateString("es-AR") ?? "—"}</dd>
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="break-all text-muted-foreground">{credenciales.certSubject ?? "—"}</dd>
              <dt className="text-muted-foreground">Huella SHA-256</dt>
              <dd className="figure break-all text-xs text-muted-foreground">{credenciales.certFingerprint ?? "—"}</dd>
            </dl>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>Quitar certificado</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Quitar el certificado?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Vas a dejar de poder facturar en este ambiente hasta que subas uno nuevo.
                    Los comprobantes ya emitidos no se tocan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Quitar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Todavía no cargaste el certificado de este ambiente.
            {cuitConfigurado && <> Tiene que ser el del CUIT {formatearCuit(cuitConfigurado)}.</>}
          </p>
        )}

        <form onSubmit={onSubmit} className="space-y-4 border-t pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cert">Certificado (.crt)</Label>
              <Input id="cert" ref={certRef} type="file" accept=".crt,.pem,.cer" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key">Clave privada (.key)</Label>
              <Input id="key" ref={keyRef} type="file" accept=".key,.pem" />
            </div>
          </div>

          <Notice tone="info">
            La clave privada se guarda cifrada y nunca vuelve a salir del servidor.
            <strong> Guardá igual tu archivo <code>.key</code> en un lugar seguro:</strong> si se
            pierde la clave de cifrado del sistema, hay que volver a subirlo.
          </Notice>

          {error && <Notice tone="danger">{error}</Notice>}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Subiendo…" : credenciales ? "Reemplazar certificado" : "Subir certificado"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
