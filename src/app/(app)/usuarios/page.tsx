import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
        <UserForm />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>
                <Badge variant={u.role === "owner" ? "default" : "secondary"}>
                  {u.role === "owner" ? "Dueño" : "Empleado"}
                </Badge>
              </TableCell>
              <TableCell>
                {u.banned ? (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                    Desactivado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">
                    Activo
                  </Badge>
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
  );
}
