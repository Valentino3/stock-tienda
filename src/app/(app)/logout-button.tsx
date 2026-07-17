"use client";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button className="text-sm text-red-600" onClick={async () => { await authClient.signOut(); router.push("/login"); }}>
      Salir
    </button>
  );
}
