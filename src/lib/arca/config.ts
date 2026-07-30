import type { ArcaAmbiente } from "@/lib/arca/types";

/**
 * Endpoints de ARCA y la resolución de ambiente. Módulo PURO (lee env, no hace
 * red).
 *
 * Las URLs son una ALLOWLIST HARDCODEADA de dos entradas. Nunca una URL de texto
 * libre venida de la DB o de un formulario: "que el dueño escriba el endpoint"
 * es un atajo tentador y es un SSRF servido en bandeja, con el certificado
 * fiscal de la tienda como carga útil.
 */

export const WSAA_URL: Record<ArcaAmbiente, string> = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

export const WSFE_URL: Record<ArcaAmbiente, string> = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

/** Namespace del servicio, usado en el SOAPAction y en el body. */
export const WSFE_NS = "http://ar.gov.afip.dif.FEV1/";

export const AMBIENTE_LABEL: Record<ArcaAmbiente, string> = {
  homologacion: "Homologación (pruebas)",
  produccion: "Producción",
};

/** ¿Está habilitado emitir comprobantes fiscales REALES en este deploy? */
export function produccionHabilitada(): boolean {
  return process.env.ARCA_ALLOW_PRODUCCION === "true";
}

/**
 * Resuelve los endpoints del ambiente pedido.
 *
 * El kill switch `ARCA_ALLOW_PRODUCCION` existe porque los previews de Vercel
 * comparten la base de datos de producción (ver docs/DEPLOY.md): sin él, un
 * preview con la fila de config en `produccion` emitiría comprobantes fiscales
 * reales e irreversibles.
 *
 * Falla RUIDOSO y nunca cae en silencio a homologación: un fallback silencioso
 * dejaría al dueño creyendo que facturó cuando no facturó nada.
 */
export function resolveEndpoints(ambiente: ArcaAmbiente): { wsaa: string; wsfe: string } {
  if (ambiente === "produccion" && !produccionHabilitada()) {
    throw new Error("ARCA_PRODUCCION_BLOQUEADA");
  }

  // Escape hatch para apuntar a un mock local. Solo se honra fuera de
  // producción, así que nunca puede redirigir tráfico fiscal real.
  if (!produccionHabilitada()) {
    const wsaa = process.env.ARCA_WSAA_URL?.trim();
    const wsfe = process.env.ARCA_WSFE_URL?.trim();
    if (wsaa || wsfe) {
      return { wsaa: wsaa || WSAA_URL[ambiente], wsfe: wsfe || WSFE_URL[ambiente] };
    }
  }

  return { wsaa: WSAA_URL[ambiente], wsfe: WSFE_URL[ambiente] };
}

/** URL base del microsite de ARCA donde resuelve el QR (RG 4892). */
export const QR_BASE_URL = "https://www.afip.gob.ar/fe/qr/";
