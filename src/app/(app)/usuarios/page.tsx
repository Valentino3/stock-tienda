import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserForm, ToggleActiveButton } from "./user-form";

export default async function UsuariosPage() {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
    })
    .from(user)
    .orderBy(user.name);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Cuentas del comercio y sus permisos."
        actions={<UserForm />}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "owner" ? "default" : "secondary"}>
                    {u.role === "owner" ? "Dueño" : "Empleado"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.banned ? (
                    <Badge variant="destructive">Desactivado</Badge>
                  ) : (
                    <Badge variant="success">Activo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <ToggleActiveButton userId={u.id} banned={Boolean(u.banned)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
