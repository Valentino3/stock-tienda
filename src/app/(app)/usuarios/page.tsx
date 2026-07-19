import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireOwner } from "@/lib/session";
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
        <h1 className="text-xl font-bold">Usuarios</h1>
        <UserForm />
      </div>

      <div className="divide-y rounded border">
        <div className="grid grid-cols-5 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
          <span>Nombre</span>
          <span>Email</span>
          <span>Rol</span>
          <span>Estado</span>
          <span></span>
        </div>
        {users.map((u) => (
          <div key={u.id} className="grid grid-cols-5 items-center gap-2 p-2 text-sm">
            <span>{u.name}</span>
            <span>{u.email}</span>
            <span>{u.role === "owner" ? "Dueño" : "Empleado"}</span>
            <span className={u.banned ? "text-red-600" : "text-green-700"}>
              {u.banned ? "Desactivado" : "Activo"}
            </span>
            <ToggleActiveButton userId={u.id} banned={Boolean(u.banned)} />
          </div>
        ))}
      </div>
    </div>
  );
}
