import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

// Rutea por rol: super-admin al panel de plataforma; usuario de tienda al POS.
export default async function Home() {
  const user = await requireUser();
  redirect(user.role === "superadmin" ? "/admin" : "/vender");
}
