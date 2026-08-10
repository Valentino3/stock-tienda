import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stores } from "@/db/schema";
import { requireStoreOwner } from "@/lib/session";
import { APP_NAME } from "@/lib/config";
import { money, moneyDiff, number } from "@/lib/format";
import { getCashSessionClose } from "@/domain/cash-close";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RemitoImprimible } from "@/components/remito/remito-imprimible";
import { PrintButton } from "@/app/(app)/comprobantes/[id]/print-button";

/**
 * El cierre de caja, para imprimir o guardar como PDF: la hoja de arqueo más
 * el remito de cada venta del turno.
 *
 * Es una vista imprimible y no un PDF del servidor, igual que el comprobante
 * fiscal: el navegador ya sabe imprimir y ofrece "Guardar como PDF", y esta
 * app no tiene almacenamiento de archivos. Meter un generador de PDF sería una
 * dependencia pesada para resolver algo que el navegador resuelve gratis.
 *
 * ⚠️ NO usa el mecanismo `ticket-overlay`: `body.imprimiendo-ticket *` fuerza
 * un re-estilado de TODO el árbol, y sobre 300 remitos (~900 filas) es donde
 * el navegador se arrastra. Esta es una ruta dedicada, así que le alcanza con
 * las reglas `@media print` que ya esconden la barra lateral.
 *
 * Maqueta A4 y no 80 mm: 300 remitos térmicos son 300 páginas y nadie quiere
 * eso. Es el inverso del default de /comprobantes/[id], y con razón — allá el
 * cliente espera en el mostrador, acá el dueño archiva el día.
 */

/** Arriba de esto la hoja no se imprime: se ofrece el Excel. */
const MAX_REMITOS = 500;

const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cuenta: "Cuenta",
};

export default async function CierrePage({ params }: { params: Promise<{ sessionId: string }> }) {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    // El documento tiene todas las ventas del turno con precios, los nombres de
    // los vendedores y la diferencia de arqueo. Hoy un empleado no ve las
    // ventas de otro: abrir esta ruta sin la guarda sería una escalada de
    // privilegio por la puerta de atrás.
    unstable_rethrow(err);
    redirect("/caja");
  }

  const { sessionId } = await params;
  const id = Number(sessionId);
  if (!Number.isInteger(id)) notFound();

  const cierre = await getCashSessionClose(db, storeId, id);
  if (!cierre) notFound();

  const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId));
  const nombreTienda = store?.name ?? APP_NAME;

  const s = cierre.session;
  const abierta = s.closedAt == null;
  const descuadre = !abierta && s.expectedCash != null && cierre.efectivoEsperado !== s.expectedCash;

  return (
    <div className="space-y-4">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/caja">← Volver a Caja</Link>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/caja/${id}/export`}>Exportar Excel</a>
          </Button>
          <PrintButton />
        </div>
      </div>

      {abierta && (
        <div className="no-imprimir">
          <Notice tone="warn">
            <strong>Provisorio:</strong> la caja sigue abierta, así que el esperado, el
            contado y la diferencia todavía no existen. Sirve para revisar el turno en
            curso, no para archivar.
          </Notice>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 text-sm text-foreground print:border-0 print:p-0">
        {/* Hoja de arqueo. Salto de página después: los remitos empiezan limpios. */}
        <section className="break-after-page">
          <header className="flex items-baseline justify-between border-b border-border-strong pb-2">
            <div>
              <h1 className="text-lg font-bold">{nombreTienda}</h1>
              <p className="ledger-label">Cierre de caja #{s.id}</p>
            </div>
            {abierta && <span className="text-xs font-bold">PROVISORIO — LA CAJA SIGUE ABIERTA</span>}
          </header>

          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <Dato label="Abierta" valor={`${s.openedAt.toLocaleString("es-AR")}${cierre.abiertaPor ? ` · ${cierre.abiertaPor}` : ""}`} />
            <Dato label="Cerrada" valor={s.closedAt ? `${s.closedAt.toLocaleString("es-AR")}${cierre.cerradaPor ? ` · ${cierre.cerradaPor}` : ""}` : "—"} />
            <Dato label="Monto inicial" valor={money(s.openingCash)} figure />
            <Dato label="Salidas (gastos y egresos)" valor={money(cierre.totalSalidas)} figure />
          </dl>

          <h2 className="ledger-label mt-5">Ventas por medio de pago</h2>
          {cierre.porMedio.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas en este turno.</p>
          ) : (
            <table className="mt-1 w-full text-sm">
              <tbody>
                {cierre.porMedio.map((m) => (
                  <tr key={m.method} className="border-b border-border">
                    <td className="py-1">{METODO[m.method] ?? m.method}</td>
                    <td className="figure py-1 text-right text-muted-foreground">{number(m.count)} venta(s)</td>
                    <td className="figure py-1 text-right font-medium">{money(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {cierre.movimientos.length > 0 && (
            <>
              <h2 className="ledger-label mt-5">Gastos y egresos</h2>
              <table className="mt-1 w-full text-sm">
                <tbody>
                  {cierre.movimientos.map((m, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-1 capitalize">{m.kind}</td>
                      <td className="py-1 text-muted-foreground">{m.description}</td>
                      <td className="figure py-1 text-right">−{money(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* La línea que hace que la hoja se auto-verifique. */}
          <h2 className="ledger-label mt-5">Arqueo</h2>
          <table className="mt-1 w-full text-sm">
            <tbody>
              <tr className="border-b border-border">
                <td className="py-1">
                  Efectivo esperado
                  <span className="block text-xs text-muted-foreground">
                    inicial {money(s.openingCash)} + efectivo cobrado − salidas {money(cierre.totalSalidas)}
                  </span>
                </td>
                <td className="figure py-1 text-right font-medium">{money(cierre.efectivoEsperado)}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-1">Efectivo contado</td>
                <td className="figure py-1 text-right">{abierta ? "—" : money(s.countedCash)}</td>
              </tr>
              <tr className="border-t border-border-strong">
                <td className="py-1 font-semibold">Diferencia</td>
                <td className={`figure py-1 text-right font-bold ${s.difference ? "text-destructive" : ""}`}>
                  {abierta ? "—" : moneyDiff(s.difference)}
                </td>
              </tr>
            </tbody>
          </table>

          {s.notes && <p className="mt-2 text-xs"><span className="ledger-label">Notas</span> {s.notes}</p>}

          <div className="mt-5 space-y-1 text-xs">
            {cierre.anuladas.count > 0 && (
              <p>
                <strong>{number(cierre.anuladas.count)} venta(s) anulada(s)</strong> por{" "}
                {money(cierre.anuladas.total)}. Están en el paquete de remitos, selladas,
                y <strong>fuera</strong> de los totales de arriba.
              </p>
            )}
            {cierre.tardias.count > 0 && (
              <p className="border border-destructive/40 bg-destructive/10 px-2 py-1">
                <strong>{number(cierre.tardias.count)} venta(s) por {money(cierre.tardias.total)} se
                sincronizaron DESPUÉS del cierre.</strong> Se cobraron sin conexión contra
                esta caja y llegaron tarde, así que el arqueo que se guardó al cerrar no
                las contempla.
                {descuadre && ` Por eso el esperado de esta hoja (${money(cierre.efectivoEsperado)}) no coincide con el que quedó guardado (${money(s.expectedCash)}).`}
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="ledger-label">
            Remitos del turno ({number(cierre.remitos.length)})
          </h2>
          {cierre.remitos.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No hubo ventas en este turno.</p>
          ) : cierre.remitos.length > MAX_REMITOS ? (
            // Tope honesto: una sesión de mil ventas no puede colgar el
            // navegador del dueño en silencio.
            <Notice tone="warn" className="mt-2">
              Este turno tiene {number(cierre.remitos.length)} ventas: son demasiadas para
              imprimir de una. Usá <strong>Exportar Excel</strong>, que las trae todas.
            </Notice>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {cierre.remitos.map((r) => (
                <RemitoImprimible key={r.saleId} remito={r} nombreTienda={nombreTienda} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Dato({ label, valor, figure }: { label: string; valor: string; figure?: boolean }) {
  return (
    <div>
      <dt className="ledger-label">{label}</dt>
      <dd className={figure ? "figure" : ""}>{valor}</dd>
    </div>
  );
}
