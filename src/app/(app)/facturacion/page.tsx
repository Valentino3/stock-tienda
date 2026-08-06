import { redirect, unstable_rethrow } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { comprobantes, user } from "@/db/schema";
import { requireStoreOwner } from "@/lib/session";
import { getCredencialesResumen, getFiscalConfig } from "@/domain/fiscal-config";
import { masterKeyStatus } from "@/lib/crypto/secret-box";
import { produccionHabilitada } from "@/lib/arca/config";
import { diasParaVencer } from "@/lib/arca/cert";
import { CBTE_LABEL, formatearNumeroComprobante, type CbteTipo } from "@/domain/fiscal-catalogs";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FiscalConfigForm } from "./fiscal-config-form";
import { CertificadoCard } from "./certificado-card";
import { ProbarConexion } from "./probar-conexion";
import { AmbienteSwitch } from "./ambiente-switch";

const ESTADO_BADGE: Record<string, { variant: "success" | "destructive" | "secondary" | "outline"; label: string }> = {
  autorizado: { variant: "success", label: "Autorizada" },
  rechazado: { variant: "destructive", label: "Rechazada" },
  error: { variant: "destructive", label: "Sin verificar" },
  pendiente: { variant: "secondary", label: "Emitiendo" },
};

export default async function FacturacionPage() {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const config = await getFiscalConfig(db, storeId);
  const ambiente = config?.ambiente ?? "homologacion";
  const credenciales = await getCredencialesResumen(db, storeId, ambiente);
  const claveMaestra = masterKeyStatus();

  // Atribución: quién emitió qué. Importa para poder auditar a un empleado
  // habilitado que quema números de comprobante.
  const ultimas = await db.select({
    id: comprobantes.id,
    clase: comprobantes.clase,
    cbteTipo: comprobantes.cbteTipo,
    ptoVta: comprobantes.ptoVta,
    numero: comprobantes.numero,
    estado: comprobantes.estado,
    ambiente: comprobantes.ambiente,
    createdAt: comprobantes.createdAt,
    saleId: comprobantes.saleId,
    autorName: user.name,
  }).from(comprobantes)
    .innerJoin(user, eq(comprobantes.createdBy, user.id))
    .where(eq(comprobantes.storeId, storeId))
    .orderBy(desc(comprobantes.id))
    .limit(10);

  const [pendientes] = await db.select({ id: comprobantes.id }).from(comprobantes)
    .where(and(eq(comprobantes.storeId, storeId), eq(comprobantes.estado, "error"))).limit(1);

  const diasRestantes = credenciales?.certExpiresAt
    ? diasParaVencer({ notAfter: credenciales.certExpiresAt } as never)
    : null;

  const estado = resolverEstado({
    hayConfig: Boolean(config),
    habilitada: Boolean(config?.enabled),
    hayCert: Boolean(credenciales),
    diasRestantes,
    claveMaestraOk: claveMaestra.configured,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturación electrónica"
        description="Emisión de Facturas A y B ante ARCA (ex-AFIP)."
        actions={
          <Badge variant={ambiente === "produccion" ? "success" : "secondary"}>
            {ambiente === "produccion" ? "Producción" : "Homologación (pruebas)"}
          </Badge>
        }
      />

      {/* Guarda visual innegociable: un comprobante de prueba que parece real va
          a terminar en manos de un cliente. */}
      {ambiente === "homologacion" && (
        <Notice tone="warn">
          <strong>Estás en modo de prueba.</strong> Los comprobantes que emitas no tienen validez
          fiscal y salen marcados como <em>PRUEBA</em>. Cuando termines de probar, pasá a producción
          desde el final de esta página.
        </Notice>
      )}

      <Notice tone={estado.tone}>{estado.mensaje}</Notice>

      {!claveMaestra.configured && (
        <Notice tone="danger">
          Falta configurar <code>ARCA_MASTER_KEY</code> en el servidor. Sin esa clave no se puede
          guardar el certificado de ARCA de forma segura. Avisale a quien administra el sistema.
        </Notice>
      )}

      {pendientes && (
        <Notice tone="danger">
          Hay comprobantes sin verificar con ARCA. Entrá a <strong>Ventas</strong> y tocá
          &laquo;Consultar en ARCA&raquo; en las ventas marcadas.
        </Notice>
      )}

      <FiscalConfigForm config={config} />

      <CertificadoCard
        ambiente={ambiente}
        credenciales={credenciales}
        diasRestantes={diasRestantes}
        cuitConfigurado={config?.cuit ?? null}
      />

      <ProbarConexion listo={Boolean(config?.enabled && credenciales)} />

      <AmbienteSwitch
        ambiente={ambiente}
        cuit={config?.cuit ?? null}
        hayCertProduccion={Boolean(await getCredencialesResumen(db, storeId, "produccion"))}
        produccionHabilitadaEnServidor={produccionHabilitada()}
      />

      <section className="space-y-3">
        <p className="ledger-label">Últimas emisiones</p>
        {ultimas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no emitiste ningún comprobante.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comprobante</TableHead>
                  <TableHead>Venta</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Emitido por</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ultimas.map((c) => {
                  const badge = ESTADO_BADGE[c.estado] ?? ESTADO_BADGE.pendiente;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.ambiente === "homologacion" && (
                          <span className="mr-1 text-xs text-muted-foreground">PRUEBA ·</span>
                        )}
                        {CBTE_LABEL[c.cbteTipo as CbteTipo] ?? `Tipo ${c.cbteTipo}`}{" "}
                        <span className="figure">{formatearNumeroComprobante(c.ptoVta, c.numero)}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">#{c.saleId}</TableCell>
                      <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{c.autorName}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {c.createdAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <p className="ledger-label">Cómo obtener el certificado</p>
        <details className="rounded-xl border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">Pasos en el portal de ARCA</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-muted-foreground">
            <li>
              Generá la clave privada y el pedido de certificado (CSR) en tu computadora:
              <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
{`openssl genrsa -out arca.key 2048
openssl req -new -key arca.key -subj "/C=AR/O=TU RAZON SOCIAL/CN=stock-tienda/serialNumber=CUIT ${config?.cuit ?? "20111111112"}" -out arca.csr`}
              </pre>
              <strong className="text-foreground">Guardá el archivo <code>arca.key</code> en un lugar seguro.</strong>{" "}
              No se puede volver a descargar: si lo perdés hay que generar todo de nuevo.
            </li>
            <li>
              En el portal de ARCA, entrá a <em>Administración de Certificados Digitales</em>, subí el{" "}
              <code>arca.csr</code> y descargá el <code>.crt</code> que te devuelve.
            </li>
            <li>
              <strong className="text-foreground">El paso que todos se saltean:</strong> en{" "}
              <em>Administrador de Relaciones</em> tenés que delegar el servicio{" "}
              <em>Facturación Electrónica</em> (wsfe) al alias del certificado que acabás de crear.
              Sin esto, ARCA responde &laquo;computador no autorizado&raquo;.
            </li>
            <li>
              Homologación y producción son <strong className="text-foreground">dos certificados
              distintos</strong>, cada uno con su propia delegación. Hacé los tres pasos dos veces.
            </li>
            <li>Subí el <code>.crt</code> y el <code>.key</code> más arriba, en esta página.</li>
          </ol>
        </details>
      </section>
    </div>
  );
}

function resolverEstado(input: {
  hayConfig: boolean;
  habilitada: boolean;
  hayCert: boolean;
  diasRestantes: number | null;
  claveMaestraOk: boolean;
}): { tone: "info" | "warn" | "success" | "danger"; mensaje: string } {
  if (!input.hayConfig) {
    return { tone: "info", mensaje: "Empezá cargando los datos del emisor: CUIT, razón social, domicilio y punto de venta." };
  }
  if (!input.hayCert) {
    return { tone: "warn", mensaje: "Falta subir el certificado de ARCA para este ambiente." };
  }
  if (input.diasRestantes != null && input.diasRestantes < 0) {
    return { tone: "danger", mensaje: "El certificado de ARCA está vencido. Generá uno nuevo en el portal y subilo acá." };
  }
  if (input.diasRestantes != null && input.diasRestantes <= 30) {
    return { tone: "warn", mensaje: `El certificado vence en ${input.diasRestantes} días. Conviene renovarlo antes de que te deje sin facturar.` };
  }
  if (!input.habilitada) {
    return { tone: "warn", mensaje: "La facturación está desactivada. Activala en los datos del emisor para poder emitir." };
  }
  return { tone: "success", mensaje: "Todo listo para facturar. Probá la conexión para confirmarlo contra ARCA." };
}
