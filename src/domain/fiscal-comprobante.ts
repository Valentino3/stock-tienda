import { randomBytes } from "node:crypto";
import type { Comprobante, ComprobanteLinea, NuevoComprobante, StoreFiscalConfig } from "@/db/schema";
import type { FeCaeRequest } from "@/lib/arca/types";
import {
  CBTE_FACTURA_A, CBTE_FACTURA_B, DOC_CONSUMIDOR_FINAL, DOC_CUIT, DOC_DNI, DOC_CUIL,
  IVA_CONSUMIDOR_FINAL, alicuotaDe, esInscripto, esNotaCredito, formatearNumeroComprobante,
  ncPara, normalizarDoc, validarCuit,
  type CbteTipoFactura,
} from "@/domain/fiscal-catalogs";
import { calcularImportes, fechaArca, fechaArcaIso, type LineaFiscal } from "@/domain/fiscal-importes";

/**
 * Construcción del comprobante a partir de una venta. Módulo PURO: sin DB, sin
 * red. Todo lo que decide QUÉ se le manda a ARCA vive acá y se testea sin
 * levantar nada.
 */

/** Datos fiscales del cliente, tal como salen de la tabla `clients`. */
export type ClienteFiscal = {
  id: number;
  name: string;
  docTipo: number | null;
  docNro: string | null;
  condicionIva: number | null;
  razonSocial: string | null;
  domicilio: string | null;
};

/** Receptor ya resuelto y validado, listo para el payload. */
export type DatosReceptor = {
  docTipo: number;
  docNro: string;
  condicionIva: number;
  nombre: string;
  domicilio: string | null;
  clientId: number | null;
};

export type ItemVenta = {
  descripcion: string;
  cantidad: number;
  unitPrice: number;
  discountAmount: number;
};

/**
 * Decide el receptor del comprobante.
 *
 * `null` como cliente es el caso NORMAL de este POS, no un borde: toda venta en
 * efectivo va sin cliente y sale Factura B a Consumidor Final, sin diálogos ni
 * clics extra.
 */
export function resolverReceptor(input: {
  cliente: ClienteFiscal | null;
  impTotal: number;
  umbralConsumidorFinal: number | null;
}): DatosReceptor {
  const { cliente, impTotal, umbralConsumidorFinal } = input;
  const doc = normalizarDoc(cliente?.docNro);
  const condicionIva = cliente?.condicionIva ?? null;

  // Sin cliente, o con cliente pero sin condición frente al IVA o sin documento.
  // `null` acá significa "sin datos fiscales cargados", que es distinto de
  // "declaró ser Consumidor Final" aunque los dos terminen en Factura B.
  if (!cliente || condicionIva == null || !doc) {
    // Por encima del umbral que fije el comercio, ARCA exige identificar al
    // comprador. Si el umbral está sin configurar (null) no se exige nada: el
    // monto de la RG se mueve y una constante vieja bloquearía ventas legítimas.
    if (umbralConsumidorFinal != null && impTotal > umbralConsumidorFinal) {
      throw new Error("IDENTIFICACION_REQUERIDA");
    }
    return {
      docTipo: DOC_CONSUMIDOR_FINAL,
      docNro: "0",
      condicionIva: IVA_CONSUMIDOR_FINAL,
      nombre: cliente?.razonSocial?.trim() || cliente?.name?.trim() || "Consumidor Final",
      domicilio: cliente?.domicilio ?? null,
      clientId: cliente?.id ?? null,
    };
  }

  const docTipo = cliente.docTipo ?? inferirDocTipo(doc);

  // ⚠️ La Factura A se decide por la condición frente al IVA, no por tener CUIT.
  // Un Responsable Inscripto SIEMPRE necesita CUIT válido; sin él no hay A.
  if (esInscripto(condicionIva)) {
    if (docTipo !== DOC_CUIT) throw new Error("CUIT_REQUERIDO_FACTURA_A");
    if (!validarCuit(doc)) throw new Error("CUIT_INVALIDO");
  } else if (docTipo === DOC_CUIT || docTipo === DOC_CUIL) {
    if (!validarCuit(doc)) throw new Error("CUIT_INVALIDO");
  }

  return {
    docTipo,
    docNro: doc,
    condicionIva,
    nombre: cliente.razonSocial?.trim() || cliente.name.trim(),
    domicilio: cliente.domicilio,
    clientId: cliente.id,
  };
}

function inferirDocTipo(doc: string): number {
  return doc.length === 11 ? DOC_CUIT : DOC_DNI;
}

/**
 * Token del link público del comprobante (`/c/<token>`).
 *
 * 32 bytes de `randomBytes`, no `Math.random` ni un uuid derivado del id: el
 * link se manda por WhatsApp y por mail, así que tiene que ser impredecible
 * incluso conociendo otros links del mismo comercio.
 */
export function generarPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A o B, a partir del receptor ya resuelto. El emisor es Responsable Inscripto:
 * a otro RI le corresponde A, a todos los demás (consumidor final, monotributo,
 * exento) le corresponde B.
 */
export function determinarCbteTipo(receptor: DatosReceptor): CbteTipoFactura {
  return esInscripto(receptor.condicionIva) ? CBTE_FACTURA_A : CBTE_FACTURA_B;
}

export type ComprobanteArmado = {
  fila: Omit<NuevoComprobante, "numero"> & { numero: number };
  payload: FeCaeRequest;
};

/**
 * Arma la fila de `comprobantes` y el payload de FECAESolicitar para una venta.
 *
 * `ahora` se inyecta para que los tests sean deterministas. La fecha del
 * comprobante es SIEMPRE hoy en hora de Argentina, nunca la fecha de la venta:
 * con Concepto = 1 ARCA solo acepta ±5 días respecto de hoy y exige que no sea
 * anterior al último comprobante autorizado de la secuencia. Usar "hoy"
 * satisface las dos reglas sin lógica extra.
 */
export function construirComprobante(input: {
  saleId: number;
  storeId: number;
  total: number;
  discountAmount: number;
  items: ItemVenta[];
  receptor: DatosReceptor;
  config: StoreFiscalConfig;
  numero: number;
  userId: string;
  ahora?: Date;
}): ComprobanteArmado {
  const { config, receptor, numero, ahora = new Date() } = input;

  const lineas: LineaFiscal[] = input.items.map((i) => ({
    descripcion: i.descripcion,
    cantidad: i.cantidad,
    precioUnitario: i.unitPrice,
    descuentoLinea: i.discountAmount,
    ivaId: ivaIdParaLinea(config),
  }));

  const importes = calcularImportes({
    lineas,
    descuentoGeneral: input.discountAmount,
    totalEsperado: input.total,
  });

  const cbteTipo = determinarCbteTipo(receptor);
  const cbteFchIso = fechaArcaIso(ahora);

  const fila: ComprobanteArmado["fila"] = {
    storeId: input.storeId,
    saleId: input.saleId,
    clientId: receptor.clientId,
    clase: "factura",
    cbteTipo,
    ambiente: config.ambiente,
    ptoVta: config.puntoVenta,
    numero,
    estado: "pendiente",
    docTipo: receptor.docTipo,
    docNro: receptor.docNro,
    condIvaReceptor: receptor.condicionIva,
    receptorNombre: receptor.nombre,
    receptorDomicilio: receptor.domicilio,
    impTotal: importes.impTotal,
    impNeto: importes.impNeto,
    impIva: importes.impIva,
    impTotConc: importes.impTotConc,
    impOpEx: importes.impOpEx,
    impTrib: importes.impTrib,
    ivaDesglose: importes.iva.map((b) => ({ id: b.id, baseImp: b.baseImp, importe: b.importe })),
    lineas: importes.lineas.map(aLineaGuardada),
    cbteFch: cbteFchIso,
    publicToken: generarPublicToken(),
    cuitEmisor: config.cuit,
    createdBy: input.userId,
    intentos: 0,
  };

  return { fila, payload: payloadDesdeFila(fila, ahora) };
}

/**
 * Arma la nota de crédito que anula una factura.
 *
 * Deriva TODO de la fila de la factura almacenada, no de la venta. Así los
 * importes coinciden al centavo por construcción, la NC es inmune a cualquier
 * edición posterior de la venta / cliente / producto, y esta función es pura
 * respecto de una sola fila de DB.
 */
export function construirNotaCredito(input: {
  factura: Comprobante;
  config: StoreFiscalConfig;
  numero: number;
  userId: string;
  ahora?: Date;
}): ComprobanteArmado {
  const { factura, config, numero, ahora = new Date() } = input;

  if (factura.clase !== "factura") throw new Error("CBTE_ASOCIADO_INVALIDO");
  if (factura.estado !== "autorizado") throw new Error("SIN_FACTURA_PARA_ANULAR");

  const cbteTipo = ncPara(factura.cbteTipo as CbteTipoFactura);

  const fila: ComprobanteArmado["fila"] = {
    storeId: factura.storeId,
    saleId: factura.saleId,
    clientId: factura.clientId,
    clase: "nota_credito",
    cbteTipo,
    // Ambiente y punto de venta se toman de la FACTURA, no de la config: si la
    // tienda cambió de ambiente o de punto de venta, la NC tiene que salir en la
    // misma secuencia que el comprobante que anula.
    ambiente: factura.ambiente,
    ptoVta: factura.ptoVta,
    numero,
    estado: "pendiente",
    docTipo: factura.docTipo,
    docNro: factura.docNro,
    condIvaReceptor: factura.condIvaReceptor,
    receptorNombre: factura.receptorNombre,
    receptorDomicilio: factura.receptorDomicilio,
    // Mismos importes que la factura, en POSITIVO: el signo lo da el tipo de
    // comprobante, no el número.
    impTotal: factura.impTotal,
    impNeto: factura.impNeto,
    impIva: factura.impIva,
    impTotConc: factura.impTotConc,
    impOpEx: factura.impOpEx,
    impTrib: factura.impTrib,
    ivaDesglose: factura.ivaDesglose,
    lineas: factura.lineas,
    cbteFch: fechaArcaIso(ahora),
    publicToken: generarPublicToken(),
    cuitEmisor: factura.cuitEmisor,
    cbteAsocId: factura.id,
    createdBy: input.userId,
    intentos: 0,
  };

  const payload = payloadDesdeFila(fila, ahora, {
    Tipo: factura.cbteTipo,
    PtoVta: factura.ptoVta,
    Nro: factura.numero,
    Cuit: config.cuit,
    CbteFch: factura.cbteFch.replace(/-/g, ""),
  });

  return { fila, payload };
}

/**
 * Payload de FECAESolicitar a partir de la fila ya armada. Que salga de la fila
 * y no de los insumos garantiza que lo enviado y lo guardado no puedan diverger.
 */
export function payloadDesdeFila(
  fila: ComprobanteArmado["fila"],
  ahora: Date = new Date(),
  cbteAsoc?: NonNullable<FeCaeRequest["FeDetReq"][number]["CbtesAsoc"]>[number],
): FeCaeRequest {
  return {
    FeCabReq: { CantReg: 1, PtoVta: fila.ptoVta, CbteTipo: fila.cbteTipo },
    FeDetReq: [{
      Concepto: 1,
      DocTipo: fila.docTipo,
      DocNro: fila.docNro,
      CbteDesde: fila.numero,
      CbteHasta: fila.numero,
      CbteFch: fila.cbteFch ? fila.cbteFch.replace(/-/g, "") : fechaArca(ahora),
      ImpTotal: fila.impTotal,
      ImpTotConc: fila.impTotConc ?? 0,
      ImpNeto: fila.impNeto,
      ImpOpEx: fila.impOpEx ?? 0,
      ImpIVA: fila.impIva,
      ImpTrib: fila.impTrib ?? 0,
      MonId: "PES",
      MonCotiz: 1,
      CondicionIVAReceptorId: fila.condIvaReceptor,
      Iva: (fila.ivaDesglose ?? []).map((b) => ({ Id: b.id, BaseImp: b.baseImp, Importe: b.importe })),
      ...(cbteAsoc ? { CbtesAsoc: [cbteAsoc] } : {}),
    }],
  };
}

function aLineaGuardada(l: {
  descripcion: string; cantidad: number; precioUnitario: number; descuentoLinea: number;
  netoAsignado: number; ivaId: number; baseImp: number; importeIva: number;
}): ComprobanteLinea {
  return {
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    descuentoLinea: l.descuentoLinea,
    netoAsignado: l.netoAsignado,
    ivaId: l.ivaId,
    baseImp: l.baseImp,
    importeIva: l.importeIva,
  };
}

/**
 * Alícuota de una línea. Hoy es la de la tienda para todas: es la costura
 * multi-alícuota. Cuando se agregue `products.ivaId`, solo cambia esta función.
 */
function ivaIdParaLinea(config: StoreFiscalConfig): number {
  alicuotaDe(config.defaultIvaId); // falla temprano si la config quedó con un id inválido
  return config.defaultIvaId;
}

// NOTA: la decisión de "¿hay que reconciliar este comprobante?" NO vive acá.
// Depende de la edad de la fila, y esa comparación tiene que hacerse dentro de
// Postgres: `comprobantes.updatedAt` es un `timestamp` sin zona que el driver
// lee en la hora local del proceso, así que compararlo contra `new Date()` da
// horas de diferencia fantasma en cualquier server que no corra en UTC. Ver
// `hayQueReconciliar` y `columnasConEdad` en src/domain/fiscal-emision.ts.

/** Mensaje legible en castellano a partir de lo que devolvió ARCA. */
export function mensajeDeObservaciones(msgs: { code: number; msg: string }[] | null | undefined): string {
  if (!msgs || msgs.length === 0) return "";
  // Se muestra el texto de ARCA tal cual: es el error fiscal del propio
  // contribuyente, escrito en castellano por ARCA para contribuyentes.
  // Ocultarlo vuelve el problema irresoluble.
  return msgs.map((o) => `${o.msg.trim()} (${o.code})`).join(" · ");
}

/** Etiqueta corta para la UI: "Factura B 0001-00000123". */
export function etiquetaComprobante(
  cbte: Pick<Comprobante, "cbteTipo" | "ptoVta" | "numero">,
  label: (t: number) => string,
): string {
  return `${label(cbte.cbteTipo)} ${formatearNumeroComprobante(cbte.ptoVta, cbte.numero)}`;
}

export { esNotaCredito };
