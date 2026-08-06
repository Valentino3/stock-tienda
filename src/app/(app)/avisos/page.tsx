import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { number } from "@/lib/format";
import { listNotifications } from "@/domain/notifications";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResolveButton } from "./avisos-client";

type Row = {
  notification: {
    id: number; message: string; note: string | null; stockAtCreate: number | null;
    createdAt: Date; status: string;
  };
  createdByName: string;
};

export default async function AvisosPage() {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const [open, resolved] = await Promise.all([
    listNotifications(db, storeId, { status: "open" }) as Promise<Row[]>,
    listNotifications(db, storeId, { status: "resolved" }) as Promise<Row[]>,
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Avisos"
        description="Stock bajo reportado por los empleados y problemas detectados al sincronizar ventas hechas sin conexión."
      />

      <Section label={`Pendientes (${number(open.length)})`}>
        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            No hay avisos pendientes.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aviso</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>De</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((r) => (
                  <TableRow key={r.notification.id}>
                    <TableCell className="font-medium">{r.notification.message}</TableCell>
                    <TableCell className="text-muted-foreground">{r.notification.note ?? "—"}</TableCell>
                    <TableCell>{r.createdByName}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{r.notification.createdAt.toLocaleString("es-AR")}</TableCell>
                    <TableCell className="text-right"><ResolveButton id={r.notification.id} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {resolved.length > 0 && (
        <Section label="Resueltos (últimos)">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aviso</TableHead>
                  <TableHead>De</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resolved.slice(0, 20).map((r) => (
                  <TableRow key={r.notification.id} className="text-muted-foreground">
                    <TableCell className="line-through">{r.notification.message}</TableCell>
                    <TableCell>{r.createdByName}</TableCell>
                    <TableCell className="font-mono">{r.notification.createdAt.toLocaleString("es-AR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}
    </div>
  );
}
