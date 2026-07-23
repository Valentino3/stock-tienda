import { config } from "dotenv";
config({ path: ".env.local" });

// Crea una tienda + su dueño. Útil para bootstrap/dev antes de tener el panel
// super-admin. Env: STORE_NAME, STORE_SLUG, OWNER_EMAIL, OWNER_PASSWORD.
async function main() {
  // Dynamic imports: los static imports se hoistean y evaluarían
  // src/db/index.ts (que lee process.env.DATABASE_URL) antes de dotenv.config().
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { user, stores } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const storeName = process.env.STORE_NAME ?? "Mi Comercio";
  const storeSlug = process.env.STORE_SLUG ?? "mi-comercio";
  const email = process.env.OWNER_EMAIL!;
  const password = process.env.OWNER_PASSWORD!;

  let [store] = await db.select().from(stores).where(eq(stores.slug, storeSlug));
  if (!store) {
    [store] = await db.insert(stores).values({ name: storeName, slug: storeSlug }).returning();
    console.log("Store created:", store.name, `(#${store.id})`);
  } else {
    console.log("Store already exists:", store.slug);
  }

  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) {
    console.log("Owner already exists, skipping:", email);
    return;
  }
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(password);
  await ctx.internalAdapter.createUser({ email, name: "Dueño", emailVerified: true });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hashed });
  await db.update(user).set({ role: "owner", storeId: store.id }).where(eq(user.id, u.id));
  console.log("Owner created:", email, "→ store", store.slug);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
