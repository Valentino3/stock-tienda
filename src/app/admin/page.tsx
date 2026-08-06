import { sql } from "drizzle-orm";
import { db } from "@/db";
import { stores, user } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { number } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewStoreForm, NewOwnerButton, ToggleStoreButton } from "./admin-client";

export default async function AdminPage() {
  await requireSuperAdmin();

  const [storeRows, counts] = await Promise.all([
    db.select().from(stores).orderBy(stores.name),
    db
      .select({ storeId: user.storeId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(user)
      .groupBy(user.storeId),
  ]);
  const countByStore = new Map(counts.map((c) => [c.storeId, c.count]));

  return (
    <div className="space-y-8">
      <PageHeader title="Tiendas" description="Alta y gestión de las tiendas de la plataforma." />

      <NewStoreForm />

      <Section label={`Tiendas (${number(storeRows.length)})`}>
        {storeRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            No hay tiendas. Creá la primera arriba.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tienda</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Usuarios</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeRows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{s.slug}</TableCell>
                    <TableCell>
                      {s.active ? <Badge variant="success">Activa</Badge> : <Badge variant="destructive">Inactiva</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{number(countByStore.get(s.id) ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <NewOwnerButton storeId={s.id} storeName={s.name} />
                        <ToggleStoreButton storeId={s.id} active={s.active} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
