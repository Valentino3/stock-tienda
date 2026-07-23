import { config } from "dotenv";
config({ path: ".env.local" });

// Crea 2 tiendas de prueba (ZTG, Ático), cada una con dueño + empleado.
// Password compartido: DEMO_PASSWORD (default "testing1234"). Idempotente.
async function main() {
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { user, stores } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const password = process.env.DEMO_PASSWORD ?? "testing1234";
  const ctx = await auth.$context;

  async function ensureStore(name: string, slug: string) {
    const [existing] = await db.select().from(stores).where(eq(stores.slug, slug));
    if (existing) return existing.id;
    const [s] = await db.insert(stores).values({ name, slug }).returning();
    console.log(`Tienda creada: ${name} (#${s.id})`);
    return s.id;
  }

  async function ensureUser(email: string, name: string, role: "owner" | "employee", storeId: number) {
    const [existing] = await db.select().from(user).where(eq(user.email, email));
    if (existing) {
      // Re-asegura rol y tienda (por si venía de un estado viejo sin storeId).
      await db.update(user).set({ role, storeId }).where(eq(user.id, existing.id));
      console.log(`Usuario ya existía, actualizado: ${email}`);
      return;
    }
    const hashed = await ctx.password.hash(password);
    await ctx.internalAdapter.createUser({ email, name, emailVerified: true });
    const [u] = await db.select().from(user).where(eq(user.email, email));
    await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hashed });
    await db.update(user).set({ role, storeId }).where(eq(user.id, u.id));
    console.log(`Usuario creado: ${email} (${role})`);
  }

  const ztg = await ensureStore("ZTG", "ztg");
  const atico = await ensureStore("Ático", "atico");

  await ensureUser("duenioztg@testing.com", "Dueño ZTG", "owner", ztg);
  await ensureUser("empleadoztg@testing.com", "Empleado ZTG", "employee", ztg);
  await ensureUser("duenioatico@testing.com", "Dueño Ático", "owner", atico);
  await ensureUser("empleadoatico@testing.com", "Empleado Ático", "employee", atico);

  console.log(`\nListo. Password de todas: "${password}"`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
