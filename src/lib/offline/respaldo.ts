import type { ClienteNuevoLocal, VentaEnCola } from "./db";

/**
 * Respaldo a archivo de las ventas pendientes de sincronizar.
 *
 * Existe por un agujero concreto: la cola vive en IndexedDB, y "borrar datos de
 * navegación" —o un perfil que se limpia solo, o un modo privado que se
 * cierra— la borra. Eso es plata ya cobrada que deja de existir, sin registro
 * en ningún lado y sin forma de recuperarla.
 *
 * Un archivo en el disco (o mandado por WhatsApp a uno mismo) es la red de
 * seguridad. No es elegante; es lo que hace que el peor caso sea recuperable.
 */

export const VERSION_RESPALDO = 1;

export type Respaldo = {
  version: number;
  exportadoEn: string;
  storeId: number;
  ventas: VentaEnCola[];
  clientesNuevos: ClienteNuevoLocal[];
};

export function armarRespaldo(input: {
  storeId: number;
  ventas: VentaEnCola[];
  clientesNuevos: ClienteNuevoLocal[];
}): Respaldo {
  return {
    version: VERSION_RESPALDO,
    exportadoEn: new Date().toISOString(),
    storeId: input.storeId,
    ventas: input.ventas,
    clientesNuevos: input.clientesNuevos,
  };
}

export const nombreDeArchivo = (r: Respaldo): string =>
  `ventas-pendientes-${r.exportadoEn.slice(0, 19).replace(/[:T]/g, "-")}.json`;

export type ResultadoValidacion =
  | { ok: true; respaldo: Respaldo }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esNumeroFinito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function ventaValida(v: unknown): v is VentaEnCola {
  if (typeof v !== "object" || v === null) return false;
  const x = v as Record<string, unknown>;
  if (typeof x.uid !== "string" || !UUID_RE.test(x.uid)) return false;
  if (typeof x.capturadoEn !== "string" || Number.isNaN(Date.parse(x.capturadoEn))) return false;
  if (!Number.isInteger(x.cashSessionId)) return false;
  if (!["efectivo", "transferencia", "tarjeta", "cuenta"].includes(x.paymentMethod as string)) return false;
  if (!esNumeroFinito(x.total)) return false;
  if (!Array.isArray(x.items) || x.items.length === 0) return false;
  return x.items.every((i) => {
    if (typeof i !== "object" || i === null) return false;
    const it = i as Record<string, unknown>;
    return (
      Number.isInteger(it.variantId) &&
      Number.isInteger(it.quantity) && (it.quantity as number) > 0 &&
      esNumeroFinito(it.unitPrice) && (it.unitPrice as number) >= 0
    );
  });
}

function clienteValido(c: unknown): c is ClienteNuevoLocal {
  if (typeof c !== "object" || c === null) return false;
  const x = c as Record<string, unknown>;
  return typeof x.uid === "string" && UUID_RE.test(x.uid)
    && typeof x.name === "string" && x.name.trim().length > 0;
}

/**
 * Valida un archivo antes de tocar la base local.
 *
 * `storeIdEsperado` es la guarda importante: restaurar el respaldo de otra
 * tienda metería ventas con ids de variantes y de caja que no existen acá.
 * Todas fallarían al sincronizar, pero recién después de haber ensuciado la
 * cola y confundido al que está atendiendo.
 */
export function validarRespaldo(texto: string, storeIdEsperado?: number): ResultadoValidacion {
  let data: unknown;
  try {
    data = JSON.parse(texto);
  } catch {
    return { ok: false, error: "El archivo no es un respaldo válido." };
  }

  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "El archivo no es un respaldo válido." };
  }
  const r = data as Record<string, unknown>;

  if (r.version !== VERSION_RESPALDO) {
    return { ok: false, error: `El respaldo es de otra versión (${String(r.version)}).` };
  }
  if (!Number.isInteger(r.storeId)) {
    return { ok: false, error: "El respaldo no dice de qué tienda es." };
  }
  if (storeIdEsperado != null && r.storeId !== storeIdEsperado) {
    return { ok: false, error: "El respaldo es de otra tienda. No se puede restaurar acá." };
  }

  const ventas = Array.isArray(r.ventas) ? r.ventas : [];
  const clientes = Array.isArray(r.clientesNuevos) ? r.clientesNuevos : [];

  // Todo o nada: media cola restaurada es peor que ninguna, porque nadie sabe
  // qué mitad quedó afuera.
  if (!ventas.every(ventaValida)) return { ok: false, error: "El respaldo tiene ventas con datos inválidos." };
  if (!clientes.every(clienteValido)) return { ok: false, error: "El respaldo tiene clientes con datos inválidos." };

  return {
    ok: true,
    respaldo: {
      version: VERSION_RESPALDO,
      exportadoEn: typeof r.exportadoEn === "string" ? r.exportadoEn : new Date().toISOString(),
      storeId: r.storeId as number,
      ventas: ventas as VentaEnCola[],
      clientesNuevos: clientes as ClienteNuevoLocal[],
    },
  };
}

/**
 * Qué del respaldo hay que escribir. Lo que ya está en la cola se deja como
 * está: el archivo puede ser más viejo y traer una versión anterior de la misma
 * venta. De todos modos el uid la deduplica del lado del servidor.
 */
export function ventasAFaltantes(respaldo: Respaldo, uidsEnCola: string[]): {
  ventas: VentaEnCola[];
  clientesNuevos: ClienteNuevoLocal[];
  yaEstaban: number;
} {
  const presentes = new Set(uidsEnCola);
  const ventas = respaldo.ventas.filter((v) => !presentes.has(v.uid));
  return {
    ventas,
    clientesNuevos: respaldo.clientesNuevos,
    yaEstaban: respaldo.ventas.length - ventas.length,
  };
}
