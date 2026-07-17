import "dotenv/config";
import { auth } from "../src/lib/auth";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.OWNER_EMAIL!;
  const password = process.env.OWNER_PASSWORD!;
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(password);
  await ctx.internalAdapter.createUser({ email, name: "Dueño", emailVerified: true });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hashed });
  await db.update(user).set({ role: "owner" }).where(eq(user.id, u.id));
  console.log("Owner created:", email);
}
main().then(() => process.exit(0));
