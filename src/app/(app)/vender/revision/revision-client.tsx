"use client";
import { useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Notice } from "@/components/ui/notice";
import { Section } from "@/components/ui/section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, number } from "@/lib/format";
import {
  iniciarOffline, mensajeDeRechazo, resolverRechazada, useEstadoOffline,
} from "@/lib/offline/estado";

const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cuenta: "Cuenta",
};

/**
 * Revisión de lo que quedó pendiente o falló al sincronizar.
 *
 * Existe porque un aviso en una barra que alguien puede no leer no alcanza para
 * plata cobrada que no quedó registrada. Acá la venta sobrevive a la recarga,
 * se ve completa (qué se cobró, cuánto, cuándo) y solo desaparece cuando una
 * persona confirma que la cargó a mano.
 */
export function RevisionClient() {
  const { rechazadas, pendientes, conectado } = useEstadoOffline();

  useEffect(() => { void iniciarOffline(); }, []);

  async function resolver(uid: string) {
    await resolverRechazada(uid);
    toast.success("Venta marcada como resuelta.");
  }

  return (
    <div className="space-y-8">
      {pendientes > 0 && (
        <Notice tone={conectado ? "warn" : "info"}>
          Hay <strong>{number(pendientes)}</strong> venta(s) esperando sincronizar.{" "}
          {conectado ? "Se están mandando al servidor." : "Se mandan solas cuando vuelva internet."}
        </Notice>
      )}

      <Section label={`Ventas rechazadas (${number(rechazadas.length)})`}>
        {rechazadas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            No hay ventas rechazadas. Todo lo que se cobró sin conexión entró al servidor.
          </p>
        ) : (
          <div className="space-y-4">
            <Notice tone="danger">
              Estas ventas se cobraron pero <strong>no quedaron registradas</strong>. Reintentar no
              sirve: el motivo no se arregla solo. Hay que cargarlas a mano desde{" "}
              <Link href="/vender" className="font-semibold underline underline-offset-4">Vender</Link>{" "}
              y después marcarlas como resueltas acá.
            </Notice>

            <Panel flush>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cobrada</TableHead>
                    <TableHead>Productos</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rechazadas.map((r) => (
                    <TableRow key={r.uid}>
                      <TableCell className="whitespace-nowrap figure text-muted-foreground">
                        {new Date(r.capturadoEn).toLocaleString("es-AR")}
                      </TableCell>
                      <TableCell>
                        <ul>
                          {r.items.map((i) => (
                            <li key={i.variantId}>
                              {i.quantity} × {i.productName}
                              {i.variantName ? ` — ${i.variantName}` : ""} ({money(i.unitPrice)})
                            </li>
                          ))}
                        </ul>
                        <span className="text-xs text-muted-foreground">{METODO[r.paymentMethod] ?? r.paymentMethod}</span>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">{money(r.total)}</TableCell>
                      <TableCell className="text-destructive">{mensajeDeRechazo(r.error)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => resolver(r.uid)}>
                          Ya la cargué
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </div>
        )}
      </Section>

      <p className="text-xs text-muted-foreground">
        Los avisos de stock negativo y de precios que cambiaron quedan en{" "}
        <Link href="/avisos" className="underline underline-offset-4">Avisos</Link>, porque los
        registra el servidor al sincronizar.
      </p>
    </div>
  );
}
