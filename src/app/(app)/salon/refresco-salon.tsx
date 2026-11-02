"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_MS = 10_000;

/**
 * Vuelve a pedir el salón cada diez segundos mientras la pestaña está a la
 * vista. Sin esto, un mozo veía libre una mesa que otro acababa de abrir, o no
 * se enteraba de un pago parcial que hizo el cajero, hasta que recargaba.
 *
 * Mismo criterio que la pantalla de cocina: un intervalo y no una conexión
 * viva, que es una pieza menos que se puede romper un viernes a la noche.
 */
export function RefrescoSalon() {
  const router = useRouter();
  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(refrescar, INTERVALO_MS);
    // Al volver a la pestaña se refresca enseguida, no a los diez segundos.
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router]);
  return null;
}
