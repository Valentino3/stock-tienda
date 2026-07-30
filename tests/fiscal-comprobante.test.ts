import { describe, it, expect } from "vitest";
import {
  resolverReceptor, determinarCbteTipo, construirComprobante, construirNotaCredito,
  mensajeDeObservaciones,
  type ClienteFiscal, type DatosReceptor,
} from "@/domain/fiscal-comprobante";
import {
  CBTE_FACTURA_A, CBTE_FACTURA_B, CBTE_NOTA_CREDITO_A, CBTE_NOTA_CREDITO_B,
  DOC_CONSUMIDOR_FINAL, DOC_CUIT, DOC_DNI,
  IVA_CONSUMIDOR_FINAL, IVA_MONOTRIBUTO, IVA_RESPONSABLE_INSCRIPTO, IVA_SUJETO_EXENTO,
  validarCuit, formatearCuit, formatearNumeroComprobante, normalizarDoc, ncPara,
} from "@/domain/fiscal-catalogs";
import type { Comprobante, StoreFiscalConfig } from "@/db/schema";

// CUIT reales en forma (dígito verificador válido), no de un contribuyente concreto.
const CUIT_VALIDO = "20111111112";
const CUIT_VALIDO_2 = "30707429530";

const AHORA = new Date("2026-07-30T14:00:00Z");

const config = (over: Partial<StoreFiscalConfig> = {}): StoreFiscalConfig => ({
  storeId: 1, cuit: CUIT_VALIDO_2, razonSocial: "Mi Comercio SRL", nombreFantasia: null,
  domicilio: "Av. Siempreviva 742", condicionIva: IVA_RESPONSABLE_INSCRIPTO,
  ingresosBrutos: "901-123456-7", inicioActividades: "2020-01-01", puntoVenta: 1,
  ambiente: "homologacion", defaultIvaId: 5, umbralConsumidorFinal: null,
  empleadosPuedenEmitir: false, enabled: true,
  createdAt: AHORA, updatedAt: AHORA, ...over,
});

const cliente = (over: Partial<ClienteFiscal> = {}): ClienteFiscal => ({
  id: 10, name: "Juan Pérez", docTipo: null, docNro: null, condicionIva: null,
  razonSocial: null, domicilio: null, ...over,
});

const receptorCF: DatosReceptor = {
  docTipo: DOC_CONSUMIDOR_FINAL, docNro: "0", condicionIva: IVA_CONSUMIDOR_FINAL,
  nombre: "Consumidor Final", domicilio: null, clientId: null,
};

describe("validarCuit", () => {
  it("acepta CUIT con dígito verificador correcto", () => {
    expect(validarCuit(CUIT_VALIDO)).toBe(true);
    expect(validarCuit(CUIT_VALIDO_2)).toBe(true);
    expect(validarCuit("20-11111111-2")).toBe(true); // tolera guiones
  });

  it("rechaza dígito verificador incorrecto, largo incorrecto y vacío", () => {
    expect(validarCuit("20111111113")).toBe(false);
    expect(validarCuit("2011111111")).toBe(false);
    expect(validarCuit("")).toBe(false);
    expect(validarCuit(null)).toBe(false);
  });

  it("normalizarDoc deja solo dígitos", () => {
    expect(normalizarDoc("20-11111111-2")).toBe(CUIT_VALIDO);
    expect(normalizarDoc("  ")).toBeNull();
    expect(normalizarDoc(null)).toBeNull();
  });

  it("formatearCuit y formatearNumeroComprobante son solo presentación", () => {
    expect(formatearCuit(CUIT_VALIDO)).toBe("20-11111111-2");
    expect(formatearNumeroComprobante(1, 123)).toBe("0001-00000123");
    expect(formatearNumeroComprobante(37, 1)).toBe("0037-00000001");
  });
});

describe("resolverReceptor / determinarCbteTipo — tabla A vs B", () => {
  const resolver = (c: ClienteFiscal | null, impTotal = 1000, umbral: number | null = null) =>
    resolverReceptor({ cliente: c, impTotal, umbralConsumidorFinal: umbral });

  it("Responsable Inscripto con CUIT válido => Factura A", () => {
    const r = resolver(cliente({ docTipo: DOC_CUIT, docNro: CUIT_VALIDO, condicionIva: IVA_RESPONSABLE_INSCRIPTO }));
    expect(r.docTipo).toBe(DOC_CUIT);
    expect(r.docNro).toBe(CUIT_VALIDO);
    expect(r.condicionIva).toBe(IVA_RESPONSABLE_INSCRIPTO);
    expect(determinarCbteTipo(r)).toBe(CBTE_FACTURA_A);
  });

  // ⚠️ EL ERROR FISCAL MÁS COMÚN DEL DOMINIO. Un monotributista TIENE CUIT y le
  // corresponde Factura B. Emitirle A es un error fiscal real, no cosmético.
  it("REGRESIÓN: monotributista con CUIT => Factura B, no A", () => {
    const r = resolver(cliente({ docTipo: DOC_CUIT, docNro: CUIT_VALIDO, condicionIva: IVA_MONOTRIBUTO }));
    expect(determinarCbteTipo(r)).toBe(CBTE_FACTURA_B);
    expect(r.condicionIva).toBe(IVA_MONOTRIBUTO);
    expect(r.docTipo).toBe(DOC_CUIT); // el CUIT igual se informa
  });

  it("REGRESIÓN: sujeto exento con CUIT => Factura B", () => {
    const r = resolver(cliente({ docTipo: DOC_CUIT, docNro: CUIT_VALIDO, condicionIva: IVA_SUJETO_EXENTO }));
    expect(determinarCbteTipo(r)).toBe(CBTE_FACTURA_B);
    expect(r.condicionIva).toBe(IVA_SUJETO_EXENTO);
  });

  it("consumidor final con DNI => Factura B con DocTipo 96", () => {
    const r = resolver(cliente({ docTipo: DOC_DNI, docNro: "30111222", condicionIva: IVA_CONSUMIDOR_FINAL }));
    expect(r.docTipo).toBe(DOC_DNI);
    expect(r.docNro).toBe("30111222");
    expect(determinarCbteTipo(r)).toBe(CBTE_FACTURA_B);
  });

  it("sin cliente => Factura B a Consumidor Final 99/0, sin fricción", () => {
    const r = resolver(null);
    expect(r).toMatchObject({ docTipo: DOC_CONSUMIDOR_FINAL, docNro: "0", condicionIva: IVA_CONSUMIDOR_FINAL, clientId: null });
    expect(r.nombre).toBe("Consumidor Final");
    expect(determinarCbteTipo(r)).toBe(CBTE_FACTURA_B);
  });

  it("cliente sin datos fiscales => Consumidor Final pero conserva el nombre y el id", () => {
    const r = resolver(cliente({ name: "Juan Pérez" }));
    expect(r.docTipo).toBe(DOC_CONSUMIDOR_FINAL);
    expect(r.nombre).toBe("Juan Pérez");
    expect(r.clientId).toBe(10);
  });

  it("RI con DNI en vez de CUIT => CUIT_REQUERIDO_FACTURA_A", () => {
    expect(() => resolver(cliente({ docTipo: DOC_DNI, docNro: "30111222", condicionIva: IVA_RESPONSABLE_INSCRIPTO })))
      .toThrow("CUIT_REQUERIDO_FACTURA_A");
  });

  it("CUIT con dígito verificador malo => CUIT_INVALIDO", () => {
    expect(() => resolver(cliente({ docTipo: DOC_CUIT, docNro: "20111111113", condicionIva: IVA_RESPONSABLE_INSCRIPTO })))
      .toThrow("CUIT_INVALIDO");
  });

  it("sin identificación y por encima del umbral => IDENTIFICACION_REQUERIDA", () => {
    expect(() => resolver(null, 500_000, 400_000)).toThrow("IDENTIFICACION_REQUERIDA");
  });

  it("sin identificación pero por debajo del umbral => se emite", () => {
    expect(resolver(null, 100_000, 400_000).docTipo).toBe(DOC_CONSUMIDOR_FINAL);
  });

  it("umbral sin configurar (null) nunca exige identificación", () => {
    expect(resolver(null, 99_999_999, null).docTipo).toBe(DOC_CONSUMIDOR_FINAL);
  });

  it("razón social pisa el nombre de fantasía del cliente", () => {
    const r = resolver(cliente({
      name: "Juancito", razonSocial: "Pérez y Asociados SRL",
      docTipo: DOC_CUIT, docNro: CUIT_VALIDO, condicionIva: IVA_RESPONSABLE_INSCRIPTO,
    }));
    expect(r.nombre).toBe("Pérez y Asociados SRL");
  });

  it("infiere el tipo de documento cuando el cliente no lo tiene cargado", () => {
    const cuit = resolver(cliente({ docNro: CUIT_VALIDO, condicionIva: IVA_RESPONSABLE_INSCRIPTO }));
    expect(cuit.docTipo).toBe(DOC_CUIT);
    const dni = resolver(cliente({ docNro: "30111222", condicionIva: IVA_CONSUMIDOR_FINAL }));
    expect(dni.docTipo).toBe(DOC_DNI);
  });
});

describe("construirComprobante", () => {
  const armar = (over: Partial<Parameters<typeof construirComprobante>[0]> = {}) =>
    construirComprobante({
      saleId: 42, storeId: 1, total: 1000, discountAmount: 0,
      items: [{ descripcion: "Remera M", cantidad: 1, unitPrice: 1000, discountAmount: 0 }],
      receptor: receptorCF, config: config(), numero: 7, userId: "u1", ahora: AHORA, ...over,
    });

  it("arma fila y payload consistentes entre sí", () => {
    const { fila, payload } = armar();
    expect(fila.clase).toBe("factura");
    expect(fila.cbteTipo).toBe(CBTE_FACTURA_B);
    expect(fila.estado).toBe("pendiente");
    expect(fila.numero).toBe(7);
    expect(fila.impTotal).toBe(1000);
    expect(fila.impNeto).toBe(826.45);
    expect(fila.impIva).toBe(173.55);
    expect(payload.FeCabReq).toEqual({ CantReg: 1, PtoVta: 1, CbteTipo: CBTE_FACTURA_B });
    expect(payload.FeDetReq[0].ImpTotal).toBe(fila.impTotal);
    expect(payload.FeDetReq[0].ImpNeto).toBe(fila.impNeto);
  });

  it("la forma del payload cumple lo que exige WSFEv1", () => {
    const det = armar().payload.FeDetReq[0];
    expect(det.Concepto).toBe(1);
    expect(det.MonId).toBe("PES");
    expect(det.MonCotiz).toBe(1);
    expect(det.CbteDesde).toBe(det.CbteHasta);
    expect(det.CbteDesde).toBe(7);
    expect(det.CbteFch).toMatch(/^\d{8}$/);
    // Obligatorio desde la RG 5616: sin esto ARCA devuelve 10242/10246.
    expect(det.CondicionIVAReceptorId).toBe(IVA_CONSUMIDOR_FINAL);
    expect(det.CbtesAsoc).toBeUndefined();
  });

  it("la fecha del comprobante es la de Argentina, no la de la venta ni la de UTC", () => {
    // 01:00 UTC del 30 es todavía el 29 en Buenos Aires.
    const det = armar({ ahora: new Date("2026-07-30T01:00:00Z") }).payload.FeDetReq[0];
    expect(det.CbteFch).toBe("20260729");
  });

  // ⚠️ WSFEv1 exige ImpNeto/ImpIVA/Iva[] TAMBIÉN para Factura B. Creer que B
  // manda solo ImpTotal es un error caro y común: solo el documento IMPRESO
  // omite el desglose.
  it("la Factura B lleva el mismo desglose de IVA que la A", () => {
    const b = armar().payload.FeDetReq[0];
    expect(b.Iva).toHaveLength(1);
    expect(b.Iva[0]).toEqual({ Id: 5, BaseImp: 826.45, Importe: 173.55 });
    expect(b.ImpNeto).toBeGreaterThan(0);
    expect(b.ImpIVA).toBeGreaterThan(0);
  });

  it("Factura A cuando el receptor es Responsable Inscripto", () => {
    const receptor = resolverReceptor({
      cliente: cliente({ docTipo: DOC_CUIT, docNro: CUIT_VALIDO, condicionIva: IVA_RESPONSABLE_INSCRIPTO }),
      impTotal: 1000, umbralConsumidorFinal: null,
    });
    const { fila, payload } = armar({ receptor });
    expect(fila.cbteTipo).toBe(CBTE_FACTURA_A);
    expect(payload.FeCabReq.CbteTipo).toBe(CBTE_FACTURA_A);
    expect(fila.clientId).toBe(10);
  });

  it("congela el detalle de líneas en la fila: reimprimir no toca products.name", () => {
    const { fila } = armar({
      items: [
        { descripcion: "Remera M", cantidad: 2, unitPrice: 500, discountAmount: 0 },
        { descripcion: "Gorra", cantidad: 1, unitPrice: 300, discountAmount: 50 },
      ],
      total: 1250,
    });
    expect(fila.lineas).toHaveLength(2);
    expect(fila.lineas[0].descripcion).toBe("Remera M");
    expect(fila.lineas[1].descuentoLinea).toBe(50);
    const suma = fila.lineas.reduce((a, l) => a + Math.round(l.netoAsignado * 100), 0);
    expect(suma).toBe(125000);
  });

  it("propaga el descuento general y sigue cerrando contra el total", () => {
    const { fila } = armar({
      items: [
        { descripcion: "A", cantidad: 1, unitPrice: 1000, discountAmount: 0 },
        { descripcion: "B", cantidad: 1, unitPrice: 1000, discountAmount: 0 },
      ],
      discountAmount: 333.33, total: 1666.67,
    });
    expect(fila.impTotal).toBe(1666.67);
    expect(Math.round((fila.impNeto + fila.impIva) * 100)).toBe(166667);
  });

  it("snapshotea el CUIT del emisor y el punto de venta de la config", () => {
    const { fila } = armar({ config: config({ cuit: CUIT_VALIDO, puntoVenta: 37 }) });
    expect(fila.cuitEmisor).toBe(CUIT_VALIDO);
    expect(fila.ptoVta).toBe(37);
  });

  it("ambiente producción queda registrado en la fila (scope de numeración)", () => {
    expect(armar({ config: config({ ambiente: "produccion" }) }).fila.ambiente).toBe("produccion");
  });
});

describe("construirNotaCredito", () => {
  const facturaBase = (over: Partial<Comprobante> = {}): Comprobante => ({
    id: 500, storeId: 1, saleId: 42, clientId: null, clase: "factura", cbteTipo: CBTE_FACTURA_B,
    ambiente: "homologacion", ptoVta: 1, numero: 7, estado: "autorizado",
    docTipo: DOC_CONSUMIDOR_FINAL, docNro: "0", condIvaReceptor: IVA_CONSUMIDOR_FINAL,
    receptorNombre: "Consumidor Final", receptorDomicilio: null,
    impTotal: 1000, impNeto: 826.45, impIva: 173.55, impTotConc: 0, impOpEx: 0, impTrib: 0,
    ivaDesglose: [{ id: 5, baseImp: 826.45, importe: 173.55 }],
    lineas: [{ descripcion: "Remera M", cantidad: 1, precioUnitario: 1000, descuentoLinea: 0, netoAsignado: 1000, ivaId: 5, baseImp: 826.45, importeIva: 173.55 }],
    cbteFch: "2026-07-29", publicToken: "token-de-prueba-de-32-bytes-largo",
    cae: "76123456789012", caeVto: "2026-08-08", resultado: "A",
    observaciones: null, errorMsg: null, intentos: 1, autorizadoAt: AHORA, cbteAsocId: null,
    cuitEmisor: CUIT_VALIDO_2, requestJson: null, responseJson: null,
    createdBy: "u1", createdAt: AHORA, updatedAt: AHORA, ...over,
  });

  it("NC B para una factura B, con los mismos importes al centavo", () => {
    const factura = facturaBase();
    const { fila, payload } = construirNotaCredito({ factura, config: config(), numero: 3, userId: "u1", ahora: AHORA });
    expect(fila.clase).toBe("nota_credito");
    expect(fila.cbteTipo).toBe(CBTE_NOTA_CREDITO_B);
    expect(fila.impTotal).toBe(factura.impTotal);
    expect(fila.impNeto).toBe(factura.impNeto);
    expect(fila.impIva).toBe(factura.impIva);
    expect(fila.ivaDesglose).toEqual(factura.ivaDesglose);
    expect(payload.FeDetReq[0].ImpTotal).toBe(1000);
  });

  it("NC A para una factura A", () => {
    const factura = facturaBase({ cbteTipo: CBTE_FACTURA_A, docTipo: DOC_CUIT, docNro: CUIT_VALIDO, condIvaReceptor: IVA_RESPONSABLE_INSCRIPTO });
    const { fila } = construirNotaCredito({ factura, config: config(), numero: 3, userId: "u1", ahora: AHORA });
    expect(fila.cbteTipo).toBe(CBTE_NOTA_CREDITO_A);
    expect(ncPara(CBTE_FACTURA_A)).toBe(CBTE_NOTA_CREDITO_A);
  });

  it("informa CbtesAsoc apuntando a la factura que anula", () => {
    const factura = facturaBase();
    const { fila, payload } = construirNotaCredito({ factura, config: config(), numero: 3, userId: "u1", ahora: AHORA });
    expect(fila.cbteAsocId).toBe(500);
    expect(payload.FeDetReq[0].CbtesAsoc).toEqual([{
      Tipo: CBTE_FACTURA_B, PtoVta: 1, Nro: 7, Cuit: CUIT_VALIDO_2, CbteFch: "20260729",
    }]);
  });

  it("los importes son POSITIVOS: el signo lo da el tipo de comprobante", () => {
    const { fila, payload } = construirNotaCredito({ factura: facturaBase(), config: config(), numero: 3, userId: "u1", ahora: AHORA });
    expect(fila.impTotal).toBeGreaterThan(0);
    expect(payload.FeDetReq[0].ImpTotal).toBeGreaterThan(0);
    expect(payload.FeDetReq[0].Iva[0].Importe).toBeGreaterThan(0);
  });

  it("sale en la secuencia de la factura aunque la tienda haya cambiado de ambiente", () => {
    const factura = facturaBase({ ambiente: "homologacion", ptoVta: 1 });
    const { fila } = construirNotaCredito({
      factura, config: config({ ambiente: "produccion", puntoVenta: 9 }), numero: 3, userId: "u1", ahora: AHORA,
    });
    expect(fila.ambiente).toBe("homologacion");
    expect(fila.ptoVta).toBe(1);
  });

  it("copia el detalle de líneas congelado de la factura", () => {
    const { fila } = construirNotaCredito({ factura: facturaBase(), config: config(), numero: 3, userId: "u1", ahora: AHORA });
    expect(fila.lineas).toEqual(facturaBase().lineas);
  });

  it("rechaza anular algo que no es una factura autorizada", () => {
    expect(() => construirNotaCredito({ factura: facturaBase({ estado: "rechazado" }), config: config(), numero: 3, userId: "u1" }))
      .toThrow("SIN_FACTURA_PARA_ANULAR");
    expect(() => construirNotaCredito({ factura: facturaBase({ clase: "nota_credito" }), config: config(), numero: 3, userId: "u1" }))
      .toThrow("CBTE_ASOCIADO_INVALIDO");
  });
});

// La decisión de reconciliar depende de la edad de la fila y se calcula EN SQL
// (ver `hayQueReconciliar` en fiscal-emision.ts): comparar un timestamp de la DB
// contra `new Date()` da horas de diferencia fantasma fuera de UTC. Los tests de
// ese comportamiento están en tests/fiscal-emision.test.ts, contra PGlite.

describe("mensajeDeObservaciones", () => {
  it("muestra el texto de ARCA tal cual, con su código", () => {
    expect(mensajeDeObservaciones([{ code: 10016, msg: "Fecha fuera de rango" }]))
      .toBe("Fecha fuera de rango (10016)");
  });

  it("junta varias observaciones", () => {
    expect(mensajeDeObservaciones([{ code: 1, msg: "Uno" }, { code: 2, msg: "Dos" }]))
      .toBe("Uno (1) · Dos (2)");
  });

  it("vacío o null da string vacío", () => {
    expect(mensajeDeObservaciones([])).toBe("");
    expect(mensajeDeObservaciones(null)).toBe("");
  });
});
