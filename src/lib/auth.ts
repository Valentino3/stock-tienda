import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { db } from "@/db";
import * as schema from "@/db/schema";

// La versión instalada de better-auth (1.6.23) valida `adminRoles` contra las
// claves de `roles` (o los roles por defecto "admin"/"user" si no se pasa
// `roles`), así que declaramos explícitamente los roles "owner" (permisos
// admin completos) y "employee" (sin permisos admin) — ver brief Task 3,
// nota de reconciliación contra la API instalada.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [
    admin({
      defaultRole: "employee",
      // superadmin = plataforma (todas las tiendas); owner = dueño de su tienda.
      // Ambos con permisos admin; employee sin permisos admin.
      adminRoles: ["superadmin", "owner"],
      roles: { superadmin: adminAc, owner: adminAc, employee: userAc },
    }),
  ],
});
