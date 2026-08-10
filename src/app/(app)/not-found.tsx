import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Ruta que no existe, o fila de otra tienda.
 *
 * El segundo caso es el común y por eso el texto no dice "no existe" a secas:
 * `/ventas/9` de otro local devuelve 404 por diseño —el aislamiento por tienda
 * no confirma ni desmiente que ese id exista en otro lado— y el dueño que llegó
 * ahí por un enlace viejo tiene que entender que no es un error suyo.
 */
export default function NotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      titulo="Esta página no existe"
      detalle="Puede que el enlace esté viejo, o que eso pertenezca a otro local."
      accion={
        <Button asChild size="sm">
          <Link href="/vender">Volver a vender</Link>
        </Button>
      }
    />
  );
}
