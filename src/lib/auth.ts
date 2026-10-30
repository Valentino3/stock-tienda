import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { db } from "@/db";
import * as schema from "@/db/schema";

// La versión instalada de better-auth (1.6.23) valida `adminRoles` contra las
// claves de `roles` (o los roles por defecto "admin"/"user" si no se pasa
// `roles`), así que declaramos explícitamente los tres roles de la app.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [
    admin({
      defaultRole: "employee",
      // superadmin = plataforma (todas las tiendas); owner = dueño de su tienda.
      // Solo superadmin tiene permisos admin del plugin. El plugin no conoce
      // tiendas: con adminAc, un dueño podía pegarle directo a
      // /api/auth/admin/set-role y hacerse superadmin, o listar, cambiar la
      // contraseña e impersonar usuarios de otros locales. La gestión de
      // empleados del dueño va por server actions propias, scopeadas por
      // tienda (src/app/(app)/usuarios/actions.ts).
      adminRoles: ["superadmin"],
      roles: { superadmin: adminAc, owner: userAc, employee: userAc },
    }),
  ],
});
