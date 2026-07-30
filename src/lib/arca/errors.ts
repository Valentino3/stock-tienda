import type { ArcaMensaje } from "@/lib/arca/types";

/**
 * Taxonomía de errores de ARCA y su traducción a mensajes accionables en
 * castellano. Módulo PURO.
 *
 * Sigue la convención de src/app/(app)/importar/extract/route.ts: el error crudo
 * del proveedor NUNCA llega al cliente; se clasifica en un cubo accionable y se
 * devuelve un mensaje que le dice al comerciante qué hacer.
 *
 * Excepción DELIBERADA: cuando ARCA rechaza un comprobante (Resultado = "R") o
 * lo aprueba con observaciones, SÍ se muestra su texto. Es el error fiscal del
 * propio contribuyente, escrito en castellano por ARCA para contribuyentes, y
 * ocultarlo vuelve el problema irresoluble.
 */

export type ArcaErrorCode =
  | "ARCA_PRODUCCION_BLOQUEADA"
  | "ARCA_SIN_CONFIGURAR"
  | "ARCA_CERT_VENCIDO"
  | "ARCA_CERT_INVALIDO"
  | "ARCA_CERT_SIN_DELEGACION"
  | "ARCA_TA_EN_RENOVACION"
  | "ARCA_AUTENTICACION"
  | "ARCA_TIMEOUT"
  | "ARCA_MANTENIMIENTO"
  | "ARCA_RESPUESTA_INVALIDA"
  | "ARCA_SOAP_FAULT"
  | "CMS_SIGN_FAILED";

export class ArcaError extends Error {
  constructor(readonly code: ArcaErrorCode, readonly detalle?: string) {
    super(code);
    this.name = "ArcaError";
  }
}

/** Códigos de WSFE que necesitan tratamiento propio en el flujo de emisión. */
export const WSFE_ERR_TOKEN_INVALIDO = 600;
export const WSFE_ERR_FECHA_FUERA_DE_RANGO = 10016;
export const WSFE_ERR_COND_IVA_RECEPTOR = [10242, 10246];
export const WSFE_ERR_NO_EXISTE = 602;

/**
 * ¿Este fallo se resuelve renovando el ticket de acceso y reintentando una vez?
 *
 * Se matchea por código Y por substring del mensaje: los códigos exactos de
 * WSFE cambian entre versiones del manual, y construir control de flujo solo
 * sobre un número recordado es frágil.
 */
export function esTokenInvalido(errores: ArcaMensaje[]): boolean {
  return errores.some((e) =>
    e.code === WSFE_ERR_TOKEN_INVALIDO || /token|ticket.*(invalid|vencid|expirad)/i.test(e.msg));
}

/** ¿ARCA dice que la numeración no es correlativa? Se re-siembra y se reintenta. */
export function esNumeracionDesfasada(errores: ArcaMensaje[]): boolean {
  return errores.some((e) => /correlativ|consecutiv|numeracion|ultimo.*autorizado/i.test(e.msg));
}

export function esFechaFueraDeRango(msgs: ArcaMensaje[]): boolean {
  return msgs.some((e) => e.code === WSFE_ERR_FECHA_FUERA_DE_RANGO || /fecha.*(rango|invalid)/i.test(e.msg));
}

export function esCondicionIvaReceptor(msgs: ArcaMensaje[]): boolean {
  return msgs.some((e) => WSFE_ERR_COND_IVA_RECEPTOR.includes(e.code) || /condicion.*iva.*receptor/i.test(e.msg));
}

/**
 * WSAA responde "El CEE ya posee un TA valido para el acceso al WSN solicitado"
 * cuando se pide un ticket habiendo uno vigente.
 *
 * Se trata como error BLANDO: significa que otra invocación ganó la carrera y
 * acaba de escribir el ticket. Sin este manejo, una sola carrera de vencimiento
 * de lease deja a la tienda sin poder facturar hasta 12 horas.
 */
export function esTaYaVigente(mensaje: string): boolean {
  return /ya posee un TA valido|alreadyAuthenticated/i.test(mensaje);
}

/** El certificado no tiene delegado el servicio wsfe en Administrador de Relaciones. */
export function esCertSinDelegacion(mensaje: string): boolean {
  return /computador no autorizado|notAuthorized|no autorizado a acceder/i.test(mensaje);
}

/** El certificado no es válido para ARCA (CSR en vez de .crt, AC desconocida, firma rota). */
export function esCertInvalido(mensaje: string): boolean {
  return /cms\.(sign|cert)\.(invalid|notFound)|AC de confianza|certificado.*(invalid|no encontrado)/i.test(mensaje);
}

export type MensajeUsuario = { status: number; message: string };

const MENSAJES: Record<ArcaErrorCode, MensajeUsuario> = {
  ARCA_PRODUCCION_BLOQUEADA: {
    status: 503,
    message: "La facturación en producción no está habilitada en este entorno. Avisale a quien administra el sistema.",
  },
  ARCA_SIN_CONFIGURAR: {
    status: 400,
    message: "Todavía no configuraste la facturación electrónica. Andá a Facturación y cargá tu CUIT, punto de venta y certificado.",
  },
  ARCA_CERT_VENCIDO: {
    status: 400,
    message: "El certificado de ARCA está vencido. Generá uno nuevo desde el portal de ARCA y subilo en Facturación.",
  },
  ARCA_CERT_INVALIDO: {
    status: 400,
    message: "ARCA no acepta el certificado. Verificá que subiste el .crt que descargaste del portal (no el CSR) y que la clave privada es la que usaste para generarlo.",
  },
  ARCA_CERT_SIN_DELEGACION: {
    status: 502,
    message: "ARCA no reconoce el certificado para facturar. En 'Administrador de Relaciones' de ARCA tenés que delegar el servicio 'Facturación Electrónica' (wsfe) a este certificado.",
  },
  ARCA_TA_EN_RENOVACION: {
    status: 503,
    message: "Estamos renovando la sesión con ARCA. Esperá unos segundos y reintentá.",
  },
  ARCA_AUTENTICACION: {
    status: 502,
    message: "No se pudo autenticar con ARCA. Probá de nuevo en un minuto.",
  },
  ARCA_TIMEOUT: {
    status: 504,
    message: "ARCA no responde en este momento. La venta quedó registrada; probá emitir la factura más tarde.",
  },
  ARCA_MANTENIMIENTO: {
    status: 503,
    message: "El servicio de ARCA está en mantenimiento. Reintentá más tarde.",
  },
  ARCA_RESPUESTA_INVALIDA: {
    status: 502,
    message: "ARCA devolvió una respuesta que no se pudo interpretar. Reintentá en unos minutos.",
  },
  ARCA_SOAP_FAULT: {
    status: 502,
    message: "ARCA rechazó la consulta. Reintentá; si sigue, avisale a quien administra el sistema.",
  },
  CMS_SIGN_FAILED: {
    status: 400,
    message: "No se pudo firmar el pedido a ARCA con tu certificado. Volvé a subir el certificado y la clave privada en Facturación.",
  },
};

/** Errores del dominio fiscal (no del protocolo). */
const MENSAJES_DOMINIO: Record<string, MensajeUsuario> = {
  FISCAL_NO_CONFIGURADO: MENSAJES.ARCA_SIN_CONFIGURAR,
  VENTA_NO_ENCONTRADA: { status: 404, message: "Venta no encontrada." },
  VENTA_ANULADA: { status: 400, message: "No se puede facturar una venta anulada." },
  EMISION_EN_CURSO: { status: 409, message: "Hay otra factura emitiéndose. Probá en unos segundos." },
  RECONCILIACION_PENDIENTE: {
    status: 409,
    message: "Hay un comprobante sin verificar. Tocá 'Consultar en ARCA' antes de reintentar.",
  },
  YA_FACTURADA: { status: 409, message: "Esta venta ya tiene una factura autorizada." },
  IDENTIFICACION_REQUERIDA: {
    status: 400,
    message: "Por el monto, ARCA exige identificar al comprador. Cargá el CUIT o DNI del cliente.",
  },
  CUIT_REQUERIDO_FACTURA_A: {
    status: 400,
    message: "Para una Factura A el cliente tiene que tener CUIT y condición 'Responsable Inscripto'.",
  },
  CUIT_INVALIDO: { status: 400, message: "El CUIT o CUIL del cliente no es válido. Corregilo en la ficha del cliente." },
  IMPORTE_CERO: { status: 400, message: "No se puede facturar una venta de $0." },
  IMPORTES_INCONSISTENTES: { status: 400, message: "Los importes de la venta no cierran. Revisá la venta." },
  ALICUOTA_DESCONOCIDA: { status: 400, message: "La alícuota de IVA configurada no es válida. Revisala en Facturación." },
  SIN_LINEAS: { status: 400, message: "La venta no tiene items para facturar." },
  SIN_FACTURA_PARA_ANULAR: { status: 400, message: "Esta venta no tiene factura autorizada: no corresponde nota de crédito." },
  CBTE_ASOCIADO_INVALIDO: { status: 400, message: "El comprobante asociado no es válido." },
  NUMERO_YA_USADO: {
    status: 409,
    message: "Ese número ya fue usado por otro comprobante en ARCA. Contactá a tu contador.",
  },
  MASTER_KEY_FALTANTE: {
    status: 500,
    message: "Falta configurar la clave de cifrado del sistema. Avisale a quien administra el sistema.",
  },
  MASTER_KEY_INVALIDA: {
    status: 500,
    message: "La clave de cifrado del sistema no es válida. Avisale a quien administra el sistema.",
  },
  SECRET_DECRYPT_FAILED: {
    status: 500,
    message: "No se pueden leer las credenciales de ARCA. Volvé a subir el certificado en Facturación.",
  },
  FORBIDDEN: { status: 403, message: "No tenés permiso para hacer esto." },
};

const GENERICO: MensajeUsuario = {
  status: 500,
  message: "No se pudo completar la operación con ARCA. Avisale a quien administra el sistema.",
};

/** Traduce cualquier error a { status, message } listo para responder. */
export function arcaUserMessage(err: unknown): MensajeUsuario {
  if (err instanceof ArcaError) return MENSAJES[err.code] ?? GENERICO;

  const code = err instanceof Error ? err.message : String(err);
  if (MENSAJES_DOMINIO[code]) return MENSAJES_DOMINIO[code];
  if (code in MENSAJES) return MENSAJES[code as ArcaErrorCode];

  // Errores de red que no alcanzaron a clasificarse antes.
  if (err instanceof Error && /abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(err.message)) {
    return MENSAJES.ARCA_TIMEOUT;
  }
  return GENERICO;
}

/**
 * Mensaje para un comprobante RECHAZADO por ARCA. Acá sí se muestra el texto
 * original: es lo único que le permite al comerciante corregir el problema.
 */
export function mensajeRechazo(msgs: ArcaMensaje[]): string {
  const primero = msgs[0];
  if (!primero) return "ARCA rechazó el comprobante sin dar un motivo.";
  return `ARCA rechazó el comprobante: ${primero.msg.trim()} (${primero.code})`;
}
