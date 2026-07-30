import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loginCms, parseLoginTicketResponse } from "@/lib/arca/wsaa";
import {
  feCAESolicitar, feCompUltimoAutorizado, feCompConsultar, feDummy,
  feCaeRequestXml, parseFeCaeResponse, parseFeCompUltimoAutorizado, parseFeCompConsultar,
  feParamGetCondicionIvaReceptor,
} from "@/lib/arca/wsfev1";
import { parseSoapResponse, type SoapRequest } from "@/lib/arca/soap";
import { ArcaError } from "@/lib/arca/errors";
import type { FeCaeRequest } from "@/lib/arca/types";
import {
  fakeTransport, generarCertificado, paginaMantenimiento, respuestaCompConsultar,
  respuestaConErrors, respuestaFeCaeAprobado, respuestaFeCaeRechazado, respuestaFeDummy,
  respuestaLoginCms, respuestaUltimoAutorizado, soapFault,
} from "./helpers/arca";

const AUTH = { token: "TOKEN-AAA", sign: "SIGN-BBB", cuit: "30707429530" };

const REQ_MINIMO: FeCaeRequest = {
  FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 6 },
  FeDetReq: [{
    Concepto: 1, DocTipo: 99, DocNro: "0", CbteDesde: 1, CbteHasta: 1, CbteFch: "20260730",
    ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpIVA: 21, ImpTrib: 0,
    MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: 5,
    Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
  }],
};
const ctx = (transport: ReturnType<typeof fakeTransport>) =>
  ({ ambiente: "homologacion" as const, auth: AUTH, transport });

beforeEach(() => {
  vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
  vi.stubEnv("ARCA_WSAA_URL", "");
  vi.stubEnv("ARCA_WSFE_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("WSAA loginCms", () => {
  it("obtiene token y sign de una respuesta real", async () => {
    const { certPem, keyPem } = generarCertificado();
    const ta = await loginCms(
      { ambiente: "homologacion", certPem, keyPem },
      fakeTransport({ "": respuestaLoginCms({ token: "TK", sign: "SG" }) }),
    );
    expect(ta.token).toBe("TK");
    expect(ta.sign).toBe("SG");
    expect(ta.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // El loginTicketResponse viene XML-ESCAPADO dentro del body SOAP: hay que
  // parsear dos veces. Si se parsea una sola, token y sign vienen vacíos.
  it("desanida el loginTicketResponse escapado dentro del body SOAP", () => {
    const ta = parseLoginTicketResponse(respuestaLoginCms({ token: "ANIDADO" }));
    expect(ta.token).toBe("ANIDADO");
  });

  it("pega contra el endpoint de homologación, sin SOAPAction", async () => {
    const { certPem, keyPem } = generarCertificado();
    const vistos: SoapRequest[] = [];
    await loginCms({ ambiente: "homologacion", certPem, keyPem },
      fakeTransport({ "": respuestaLoginCms() }, vistos));
    expect(vistos[0].url).toBe("https://wsaahomo.afip.gov.ar/ws/services/LoginCms");
    expect(vistos[0].soapAction).toBe("");
    expect(vistos[0].body).toContain("<in0>");
  });

  it("bloquea producción sin el kill switch antes de tocar la red", async () => {
    const { certPem, keyPem } = generarCertificado();
    const vistos: SoapRequest[] = [];
    await expect(loginCms({ ambiente: "produccion", certPem, keyPem },
      fakeTransport({ "": respuestaLoginCms() }, vistos))).rejects.toThrow("ARCA_PRODUCCION_BLOQUEADA");
    expect(vistos).toHaveLength(0);
  });

  it("falta de delegación de wsfe => mensaje accionable, no 'error de autenticación'", async () => {
    const { certPem, keyPem } = generarCertificado();
    await expect(loginCms({ ambiente: "homologacion", certPem, keyPem },
      fakeTransport({ "": soapFault("Computador no autorizado a acceder al servicio") })))
      .rejects.toThrow("ARCA_CERT_SIN_DELEGACION");
  });

  it("certificado inválido => ARCA_CERT_INVALIDO", async () => {
    const { certPem, keyPem } = generarCertificado();
    await expect(loginCms({ ambiente: "homologacion", certPem, keyPem },
      fakeTransport({ "": soapFault("cms.sign.invalid: CMS signature invalid") })))
      .rejects.toThrow("ARCA_CERT_INVALIDO");
  });

  // Sin este manejo, una carrera de renovación deja a la tienda sin facturar
  // hasta 12 horas.
  it("'ya posee un TA valido' es error BLANDO: ARCA_TA_EN_RENOVACION", async () => {
    const { certPem, keyPem } = generarCertificado();
    await expect(loginCms({ ambiente: "homologacion", certPem, keyPem },
      fakeTransport({ "": soapFault("El CEE ya posee un TA valido para el acceso al WSN solicitado") })))
      .rejects.toThrow("ARCA_TA_EN_RENOVACION");
  });

  it("una respuesta ilegible no filtra el XML crudo", async () => {
    const { certPem, keyPem } = generarCertificado();
    await expect(loginCms({ ambiente: "homologacion", certPem, keyPem },
      fakeTransport({ "": "<Envelope><Body><loginCmsResponse/></Body></Envelope>" })))
      .rejects.toThrow(ArcaError);
  });
});

describe("WSFEv1: armado del request", () => {
  const req: FeCaeRequest = {
    FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 6 },
    FeDetReq: [{
      Concepto: 1, DocTipo: 99, DocNro: "0", CbteDesde: 7, CbteHasta: 7, CbteFch: "20260730",
      ImpTotal: 1000, ImpTotConc: 0, ImpNeto: 826.45, ImpOpEx: 0, ImpIVA: 173.55, ImpTrib: 0,
      MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: 5,
      Iva: [{ Id: 5, BaseImp: 826.45, Importe: 173.55 }],
    }],
  };

  it("serializa la cabecera y el detalle con los nombres de WSFEv1", () => {
    const xml = feCaeRequestXml(req);
    expect(xml).toContain("<FeCabReq><CantReg>1</CantReg><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo></FeCabReq>");
    expect(xml).toContain("<CbteDesde>7</CbteDesde><CbteHasta>7</CbteHasta>");
    expect(xml).toContain("<CondicionIVAReceptorId>5</CondicionIVAReceptorId>");
    expect(xml).toContain("<MonId>PES</MonId>");
  });

  // String(1000) daría "1000" y String(0.1+0.2) daría "0.30000000000000004".
  it("los importes van con 2 decimales fijos", () => {
    const xml = feCaeRequestXml(req);
    expect(xml).toContain("<ImpTotal>1000.00</ImpTotal>");
    expect(xml).toContain("<ImpNeto>826.45</ImpNeto>");
    expect(xml).toContain("<ImpIVA>173.55</ImpIVA>");
    expect(xml).toContain("<ImpTrib>0.00</ImpTrib>");
  });

  it("las alícuotas van dentro de <Iva><AlicIva>", () => {
    expect(feCaeRequestXml(req)).toContain(
      "<Iva><AlicIva><Id>5</Id><BaseImp>826.45</BaseImp><Importe>173.55</Importe></AlicIva></Iva>");
  });

  it("sin comprobantes asociados no emite el nodo CbtesAsoc", () => {
    expect(feCaeRequestXml(req)).not.toContain("CbtesAsoc");
  });

  it("una nota de crédito informa CbtesAsoc", () => {
    const nc: FeCaeRequest = {
      FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 8 },
      FeDetReq: [{ ...req.FeDetReq[0], CbtesAsoc: [{ Tipo: 6, PtoVta: 1, Nro: 7, Cuit: "30707429530", CbteFch: "20260729" }] }],
    };
    const xml = feCaeRequestXml(nc);
    expect(xml).toContain("<CbtesAsoc><CbteAsoc><Tipo>6</Tipo><PtoVta>1</PtoVta><Nro>7</Nro>");
    expect(xml).toContain("<Cuit>30707429530</Cuit><CbteFch>20260729</CbteFch>");
  });

  it("manda Auth con Token, Sign y Cuit, y el SOAPAction correcto", async () => {
    const vistos: SoapRequest[] = [];
    await feCAESolicitar(ctx(fakeTransport({ FECAESolicitar: respuestaFeCaeAprobado() }, vistos)), req);
    expect(vistos[0].soapAction).toBe("http://ar.gov.afip.dif.FEV1/FECAESolicitar");
    expect(vistos[0].url).toBe("https://wswhomo.afip.gov.ar/wsfev1/service.asmx");
    expect(vistos[0].body).toContain("<Auth><Token>TOKEN-AAA</Token><Sign>SIGN-BBB</Sign><Cuit>30707429530</Cuit></Auth>");
  });
});

describe("WSFEv1: parseo de FECAESolicitar", () => {
  const parse = (xml: string) => parseFeCaeResponse(parseSoapResponse(xml));

  it("aprobado: devuelve CAE y vencimiento", () => {
    const r = parse(respuestaFeCaeAprobado({ cae: "76123456789012", caeVto: "20260809", cbteDesde: 7 }));
    expect(r.resultado).toBe("A");
    expect(r.cae).toBe("76123456789012");
    expect(r.caeVto).toBe("20260809");
    expect(r.cbteDesde).toBe(7);
    expect(r.errores).toEqual([]);
  });

  // Un comprobante puede salir APROBADO con observaciones. Colapsarlas con los
  // errores convertiría un éxito con advertencia en un falso error.
  it("aprobado CON observaciones: sigue siendo aprobado y conserva el CAE", () => {
    const r = parse(respuestaFeCaeAprobado({
      observaciones: [{ code: 10063, msg: "El comprobante no cumple con RG 1361" }],
    }));
    expect(r.resultado).toBe("A");
    expect(r.cae).toBeTruthy();
    expect(r.observaciones).toEqual([{ code: 10063, msg: "El comprobante no cumple con RG 1361" }]);
    expect(r.errores).toEqual([]);
  });

  it("rechazado: sin CAE y con el motivo de ARCA", () => {
    const r = parse(respuestaFeCaeRechazado([{ code: 10016, msg: "Fecha fuera de rango" }]));
    expect(r.resultado).toBe("R");
    expect(r.cae).toBeNull();
    expect(r.observaciones).toEqual([{ code: 10016, msg: "Fecha fuera de rango" }]);
  });

  it("errores de cabecera sin detalle: se reporta rechazado, no se rompe", () => {
    const r = parse(respuestaConErrors([{ code: 600, msg: "Token invalido" }]));
    expect(r.resultado).toBe("R");
    expect(r.errores).toEqual([{ code: 600, msg: "Token invalido" }]);
    expect(r.cae).toBeNull();
  });

  it("un CAE de 14 dígitos sobrevive sin perder precisión", () => {
    expect(parse(respuestaFeCaeAprobado({ cae: "76123456789012" })).cae).toBe("76123456789012");
  });

  it("una página de mantenimiento da ARCA_MANTENIMIENTO", async () => {
    await expect(feCAESolicitar(
      ctx(fakeTransport({ FECAESolicitar: paginaMantenimiento() })), REQ_MINIMO,
    )).rejects.toThrow("ARCA_MANTENIMIENTO");
  });

  it("un soap:Fault se traduce a ARCA_SOAP_FAULT", async () => {
    await expect(feCAESolicitar(
      ctx(fakeTransport({ FECAESolicitar: soapFault("Internal error") })), REQ_MINIMO,
    )).rejects.toThrow("ARCA_SOAP_FAULT");
  });

  it("un request sin detalle falla con un código del dominio, no con un TypeError", () => {
    expect(() => feCaeRequestXml(
      { FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 6 }, FeDetReq: [] } as unknown as FeCaeRequest,
    )).toThrow("SIN_LINEAS");
  });
});

describe("WSFEv1: resto de métodos", () => {
  it("FECompUltimoAutorizado devuelve el número", async () => {
    const n = await feCompUltimoAutorizado(
      ctx(fakeTransport({ FECompUltimoAutorizado: respuestaUltimoAutorizado(57) })),
      { ptoVta: 1, cbteTipo: 6 });
    expect(n).toBe(57);
  });

  it("FECompUltimoAutorizado devuelve 0 en una secuencia sin usar", async () => {
    const n = await feCompUltimoAutorizado(
      ctx(fakeTransport({ FECompUltimoAutorizado: respuestaUltimoAutorizado(0) })),
      { ptoVta: 1, cbteTipo: 6 });
    expect(n).toBe(0);
  });

  it("FECompUltimoAutorizado con Errors no devuelve un número inventado", () => {
    expect(() => parseFeCompUltimoAutorizado(parseSoapResponse(`
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
        <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompUltimoAutorizadoResult><Errors><Err><Code>600</Code><Msg>Token invalido</Msg></Err></Errors></FECompUltimoAutorizadoResult>
        </FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`)))
      .toThrow(ArcaError);
  });

  it("FEDummy reporta el estado de los tres servidores", async () => {
    const r = await feDummy({ ambiente: "homologacion", transport: fakeTransport({ FEDummy: respuestaFeDummy() }) });
    expect(r).toEqual({ appServer: "OK", dbServer: "OK", authServer: "OK" });
  });

  it("FEDummy no manda Auth: es el health check sin autenticar", async () => {
    const vistos: SoapRequest[] = [];
    await feDummy({ ambiente: "homologacion", transport: fakeTransport({ FEDummy: respuestaFeDummy() }, vistos) });
    expect(vistos[0].body).not.toContain("<Auth>");
  });

  it("FECompConsultar devuelve el comprobante con su CAE e importe", async () => {
    const r = await feCompConsultar(
      ctx(fakeTransport({ FECompConsultar: respuestaCompConsultar({ cae: "76999", cbteNro: 7, impTotal: 1000 }) })),
      { ptoVta: 1, cbteTipo: 6, cbteNro: 7 });
    expect(r).not.toBeNull();
    expect(r!.cae).toBe("76999");
    expect(r!.impTotal).toBe(1000);
    expect(r!.cbteDesde).toBe(7);
  });

  // "No existe" es la respuesta que dice que el número quedó libre: quien llama
  // lo necesita como null, no como excepción.
  it("FECompConsultar devuelve null cuando el comprobante no existe", () => {
    const r = parseFeCompConsultar(parseSoapResponse(`
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
        <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existen datos en nuestra base</Msg></Err></Errors></FECompConsultarResult>
        </FECompConsultarResponse></soap:Body></soap:Envelope>`));
    expect(r).toBeNull();
  });

  it("FEParamGetCondicionIvaReceptor trae la tabla vigente de ARCA", async () => {
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
      <FEParamGetCondicionIvaReceptorResponse xmlns="http://ar.gov.afip.dif.FEV1/">
        <FEParamGetCondicionIvaReceptorResult><ResultGet>
          <CondicionIvaReceptor><Id>1</Id><Desc>IVA Responsable Inscripto</Desc></CondicionIvaReceptor>
          <CondicionIvaReceptor><Id>5</Id><Desc>Consumidor Final</Desc></CondicionIvaReceptor>
        </ResultGet></FEParamGetCondicionIvaReceptorResult>
      </FEParamGetCondicionIvaReceptorResponse></soap:Body></soap:Envelope>`;
    const r = await feParamGetCondicionIvaReceptor(ctx(fakeTransport({ FEParamGetCondicionIvaReceptor: xml })));
    expect(r).toEqual([
      { id: 1, desc: "IVA Responsable Inscripto" },
      { id: 5, desc: "Consumidor Final" },
    ]);
  });
});
