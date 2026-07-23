import { config } from "dotenv";
config({ path: ".env.local" });

// Crea el super-admin de plataforma (rol "superadmin", sin tienda). Gestiona
// todas las tiendas. Env: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD.
async function main() {
  // Dynamic imports: ver nota en seed-store.ts (env primero).
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { user } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const email = process.env.SUPERADMIN_EMAIL!;
  const password = process.env.SUPERADMIN_PASSWORD!;
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) {
    console.log("Superadmin already exists, skipping:", email);
    return;
  }
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(password);
  await ctx.internalAdapter.createUser({ email, name: "Plataforma", emailVerified: true });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hashed });
  await db.update(user).set({ role: "superadmin", storeId: null }).where(eq(user.id, u.id));
  console.log("Superadmin created:", email);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
