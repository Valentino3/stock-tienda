import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  // Dynamic imports: ES module static imports are hoisted and evaluated
  // before this file's own top-level code, which would read
  // process.env.DATABASE_URL (in src/db/index.ts) before dotenv.config()
  // above has run. Deferring the imports keeps env loading first.
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { user } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const email = process.env.OWNER_EMAIL!;
  const password = process.env.OWNER_PASSWORD!;
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
  await db.update(user).set({ role: "owner" }).where(eq(user.id, u.id));
  console.log("Owner created:", email);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
