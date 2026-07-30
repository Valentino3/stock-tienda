import forge from "node-forge";
import type { SoapRequest, SoapTransport } from "@/lib/arca/soap";

/**
 * Helpers de test para ARCA. Nada de esto toca la red.
 */

export type ParCertificado = { certPem: string; keyPem: string; cuit: string };

/**
 * Genera un certificado autofirmado en memoria, con el CUIT en el
 * `serialNumber` del subject tal como lo emite ARCA.
 *
 * Se generan claves de 1024 bits porque esto corre en cada test: la seguridad
 * del par es irrelevante, solo importa que la estructura ASN.1 sea real.
 */
export function generarCertificado(opts: {
  cuit?: string;
  cn?: string;
  notBefore?: Date;
  notAfter?: Date;
} = {}): ParCertificado {
  const cuit = opts.cuit ?? "20111111112";
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = opts.notBefore ?? new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = opts.notAfter ?? new Date(Date.now() + 365 * 86_400_000);

  const attrs = [
    { name: "commonName", value: opts.cn ?? "stock-tienda" },
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: "Comercio Test" },
    { name: "serialNumber", value: `CUIT ${cuit}` },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    cuit,
  };
}

/**
 * Transporte SOAP falso, ruteado por SOAPAction. Es la costura que hace que
 * wsaa.ts y wsfev1.ts se testeen sin red.
 *
 * WSAA no manda SOAPAction, así que su ruta es la clave "".
 */
export function fakeTransport(
  rutas: Record<string, string | ((req: SoapRequest) => string | Promise<string>)>,
  registro?: SoapRequest[],
): SoapTransport {
  return async (req) => {
    registro?.push(req);
    const clave = Object.keys(rutas).find((k) => k === req.soapAction || (k !== "" && req.soapAction.endsWith(k)));
    const ruta = clave !== undefined ? rutas[clave] : rutas[""];
    if (ruta === undefined) throw new Error(`fakeTransport: sin ruta para "${req.soapAction}"`);
    return typeof ruta === "function" ? ruta(req) : ruta;
  };
}

// ---- fixtures de respuestas ----

export function respuestaLoginCms(opts: {
  token?: string; sign?: string; generationTime?: string; expirationTime?: string;
} = {}): string {
  const ahora = new Date();
  const {
    token = "PD94bWwgdmVyc2lvbj0iMS4wIj8+VE9LRU4=",
    sign = "FIRMA-DE-PRUEBA",
    generationTime = new Date(ahora.getTime() - 60_000).toISOString().replace("Z", "-03:00"),
    expirationTime = new Date(ahora.getTime() + 12 * 3600_000).toISOString().replace("Z", "-03:00"),
  } = opts;

  // El loginTicketResponse viene XML-ESCAPADO dentro del body SOAP: hay que
  // parsear dos veces. Este fixture reproduce eso a propósito.
  const interno = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketResponse version="1.0">
  <header>
    <source>CN=wsaahomo, O=AFIP, C=AR</source>
    <destination>SERIALNUMBER=CUIT 20111111112, CN=stock-tienda</destination>
    <uniqueId>3212463</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <credentials>
    <token>${token}</token>
    <sign>${sign}</sign>
  </credentials>
</loginTicketResponse>`;

  const escapado = interno
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginCmsResponse xmlns="https://wsaahomo.afip.gov.ar/ws/services/LoginCms">
      <loginCmsReturn>${escapado}</loginCmsReturn>
    </loginCmsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function soapFault(faultstring: string, faultcode = "soapenv:Server"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>${faultcode}</faultcode>
      <faultstring>${faultstring}</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function respuestaFeCaeAprobado(opts: {
  cae?: string; caeVto?: string; cbteDesde?: number; ptoVta?: number; cbteTipo?: number;
  observaciones?: { code: number; msg: string }[];
} = {}): string {
  const {
    cae = "76123456789012", caeVto = "20260809", cbteDesde = 1, ptoVta = 1, cbteTipo = 6,
    observaciones = [],
  } = opts;

  const obs = observaciones.length === 0 ? "" : `<Observaciones>${observaciones
    .map((o) => `<Obs><Code>${o.code}</Code><Msg>${o.msg}</Msg></Obs>`).join("")}</Observaciones>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <FeCabResp>
          <Cuit>20111111112</Cuit><PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo>
          <FchProceso>20260730120000</FchProceso><CantReg>1</CantReg>
          <Resultado>${observaciones.length > 0 ? "A" : "A"}</Resultado><Reproceso>N</Reproceso>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>
            <CbteDesde>${cbteDesde}</CbteDesde><CbteHasta>${cbteDesde}</CbteHasta>
            <CbteFch>20260730</CbteFch>
            <Resultado>A</Resultado>
            ${obs}
            <CAE>${cae}</CAE><CAEFchVto>${caeVto}</CAEFchVto>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;
}

export function respuestaFeCaeRechazado(errores: { code: number; msg: string }[] = [
  { code: 10016, msg: "El campo Fecha de comprobante esta fuera de rango" },
]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <FeCabResp>
          <Cuit>20111111112</Cuit><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo>
          <FchProceso>20260730120000</FchProceso><CantReg>1</CantReg>
          <Resultado>R</Resultado><Reproceso>N</Reproceso>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>
            <CbteDesde>1</CbteDesde><CbteHasta>1</CbteHasta><CbteFch>20260730</CbteFch>
            <Resultado>R</Resultado>
            <Observaciones>${errores.map((e) => `<Obs><Code>${e.code}</Code><Msg>${e.msg}</Msg></Obs>`).join("")}</Observaciones>
            <CAE/><CAEFchVto/>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;
}

/** Errores a nivel cabecera (Errors), distintos de las Observaciones del detalle. */
export function respuestaConErrors(errores: { code: number; msg: string }[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <Errors>${errores.map((e) => `<Err><Code>${e.code}</Code><Msg>${e.msg}</Msg></Err>`).join("")}</Errors>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;
}

export function respuestaUltimoAutorizado(cbteNro: number, ptoVta = 1, cbteTipo = 6): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompUltimoAutorizadoResult>
        <PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${cbteNro}</CbteNro>
      </FECompUltimoAutorizadoResult>
    </FECompUltimoAutorizadoResponse>
  </soap:Body>
</soap:Envelope>`;
}

export function respuestaFeDummy(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult>
    </FEDummyResponse>
  </soap:Body>
</soap:Envelope>`;
}

export function respuestaCompConsultar(opts: {
  cae?: string; cbteNro?: number; impTotal?: number; ptoVta?: number; cbteTipo?: number;
} = {}): string {
  const { cae = "76123456789012", cbteNro = 1, impTotal = 1000, ptoVta = 1, cbteTipo = 6 } = opts;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompConsultarResult>
        <ResultGet>
          <Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>
          <CbteDesde>${cbteNro}</CbteDesde><CbteHasta>${cbteNro}</CbteHasta>
          <CbteFch>20260730</CbteFch><ImpTotal>${impTotal}</ImpTotal>
          <PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo>
          <Resultado>A</Resultado>
          <CodAutorizacion>${cae}</CodAutorizacion><FchVto>20260809</FchVto>
        </ResultGet>
      </FECompConsultarResult>
    </FECompConsultarResponse>
  </soap:Body>
</soap:Envelope>`;
}

/** ARCA responde 200 con una página de mantenimiento cuando está caído. */
export function paginaMantenimiento(): string {
  return `<!DOCTYPE html><html><head><title>Servicio no disponible</title></head>
<body><h1>El servicio no se encuentra disponible</h1></body></html>`;
}
