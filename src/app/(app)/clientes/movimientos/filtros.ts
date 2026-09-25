import {
  FILTROS_TIPO_MOVIMIENTO, type EstadoMovimiento, type FiltroTipoMovimiento,
} from "@/domain/clients";

/**
 * Los filtros del registro de movimientos, leídos del querystring.
 *
 * Un solo parser para la página y el Excel: si cada uno leyera los parámetros
 * a su manera, el Excel bajaría otra cosa que la que está en pantalla.
 */
export type ParamsMovimientos = {
  from?: string;
  to?: string;
  tipo?: string;
  cliente?: string;
  usuario?: string;
  estado?: string;
  page?: string;
};

export function leerFiltros(p: ParamsMovimientos) {
  const tipo = FILTROS_TIPO_MOVIMIENTO.some((t) => t.value === p.tipo) ? (p.tipo as FiltroTipoMovimiento) : undefined;
  const estado: EstadoMovimiento = p.estado === "vigentes" || p.estado === "anulados" ? p.estado : "todos";
  const clientId = Number(p.cliente);
  return {
    // Mismo criterio que /ventas: el día entero, `to` inclusive.
    from: p.from ? new Date(`${p.from}T00:00:00`) : undefined,
    to: p.to ? new Date(new Date(`${p.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) : undefined,
    tipo,
    clientId: Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
    userId: p.usuario || undefined,
    estado,
  };
}

/** El querystring de vuelta, sin los vacíos: `URLSearchParams` serializaría "undefined". */
export function querystring(p: ParamsMovimientos, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams();
  for (const k of ["from", "to", "tipo", "cliente", "usuario", "estado"] as const) {
    if (p[k]) sp.set(k, p[k]!);
  }
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
