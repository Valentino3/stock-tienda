import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTra, isoConOffset } from "@/lib/arca/tra";
import { signCms } from "@/lib/arca/cms";
import {
  inspectCertificate, assertKeyMatchesCert, certVencido, diasParaVencer,
  pareceCertificado, pareceClavePrivada, esClaveCifrada,
} from "@/lib/arca/cert";
import { buildQrPayload, qrUrl, qrUrlDeComprobante } from "@/lib/arca/qr";
import { resolveEndpoints, WSAA_URL, WSFE_URL, produccionHabilitada } from "@/lib/arca/config";
import { envelope, scrubXml, scrubPayload, parseSoapResponse, SoapFault } from "@/lib/arca/soap";
import { parseXml, esc, tag, asMensajes, pick } from "@/lib/arca/xml";
import { ArcaError, arcaUserMessage, mensajeRechazo, esTaYaVigente, esCertSinDelegacion, esTokenInvalido } from "@/lib/arca/errors";
import { generarCertificado, paginaMantenimiento, soapFault } from "./helpers/arca";
import forge from "node-forge";

describe("config: endpoints y kill switch de producción", () => {
  beforeEach(() => {
    vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
    vi.stubEnv("ARCA_WSAA_URL", "");
    vi.stubEnv("ARCA_WSFE_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("homologación siempre resuelve", () => {
    expect(resolveEndpoints("homologacion")).toEqual({
      wsaa: WSAA_URL.homologacion, wsfe: WSFE_URL.homologacion,
    });
  });

  // La guarda que impide que un preview de Vercel (que comparte la DB de
  // producción) emita comprobantes fiscales reales.
  it("producción SIN el kill switch falla ruidoso, no cae a homologación", () => {
    expect(() => resolveEndpoints("produccion")).toThrow("ARCA_PRODUCCION_BLOQUEADA");
  });

  it("producción CON el kill switch resuelve a los endpoints reales", () => {
    vi.stubEnv("ARCA_ALLOW_PRODUCCION", "true");
    expect(resolveEndpoints("produccion")).toEqual({
      wsaa: WSAA_URL.produccion, wsfe: WSFE_URL.produccion,
    });
    expect(produccionHabilitada()).toBe(true);
  });

  it("los overrides de endpoint funcionan fuera de producción", () => {
    vi.stubEnv("ARCA_WSFE_URL", "http://localhost:9999/wsfe");
    expect(resolveEndpoints("homologacion").wsfe).toBe("http://localhost:9999/wsfe");
  });

  // Sin esto, un override en env podría desviar tráfico fiscal real.
  it("los overrides se IGNORAN cuando producción está habilitada", () => {
    vi.stubEnv("ARCA_ALLOW_PRODUCCION", "true");
    vi.stubEnv("ARCA_WSFE_URL", "http://atacante.example/wsfe");
    expect(resolveEndpoints("produccion").wsfe).toBe(WSFE_URL.produccion);
    expect(resolveEndpoints("homologacion").wsfe).toBe(WSFE_URL.homologacion);
  });
});

describe("TRA", () => {
  it("arma un loginTicketRequest con header, service y tiempos", () => {
    const tra = buildTra({ now: new Date("2026-07-30T15:00:00Z"), uniqueId: 12345 });
    expect(tra).toContain("<loginTicketRequest version=\"1.0\">");
    expect(tra).toContain("<uniqueId>12345</uniqueId>");
    expect(tra).toContain("<service>wsfe</service>");
    expect(tra).toMatch(/<generationTime>[^<]+<\/generationTime>/);
    expect(tra).toMatch(/<expirationTime>[^<]+<\/expirationTime>/);
  });

  // WSAA no acepta la "Z" de toISOString: exige offset explícito.
  it("los tiempos llevan offset explícito, no Z", () => {
    const tra = buildTra({ now: new Date("2026-07-30T15:00:00Z") });
    const gen = tra.match(/<generationTime>([^<]+)</)![1];
    expect(gen).not.toContain("Z");
    expect(gen).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("generationTime queda antes que expirationTime", () => {
    const tra = buildTra({ now: new Date("2026-07-30T15:00:00Z") });
    const gen = Date.parse(tra.match(/<generationTime>([^<]+)</)![1]);
    const exp = Date.parse(tra.match(/<expirationTime>([^<]+)</)![1]);
    expect(gen).toBeLessThan(exp);
  });

  it("la ventana es corta a propósito (achica la franja de 'ya posee un TA valido')", () => {
    const now = new Date("2026-07-30T15:00:00Z");
    const tra = buildTra({ now });
    const gen = Date.parse(tra.match(/<generationTime>([^<]+)</)![1]);
    const exp = Date.parse(tra.match(/<expirationTime>([^<]+)</)![1]);
    expect(exp - gen).toBeLessThanOrEqual(30 * 60_000);
  });

  it("isoConOffset usa la hora de Buenos Aires", () => {
    // 15:00 UTC son las 12:00 en Argentina (UTC-3).
    expect(isoConOffset(new Date("2026-07-30T15:00:00Z"))).toBe("2026-07-30T12:00:00-03:00");
  });

  it("uniqueId entra en un unsigned de 32 bits", () => {
    const tra = buildTra({ now: new Date("2026-07-30T15:00:00Z") });
    const id = Number(tra.match(/<uniqueId>(\d+)</)![1]);
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThan(0xffffffff);
  });
});

describe("firma CMS", () => {
  it("produce un PKCS#7 SignedData en base64 que se puede volver a parsear", () => {
    const { certPem, keyPem } = generarCertificado();
    const b64 = signCms({ tra: buildTra(), certPem, keyPem });

    expect(b64).toMatch(/^[A-Za-z0-9+/=\r\n]+$/);
    const der = forge.util.decode64(b64);
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as forge.pkcs7.PkcsSignedData;
    expect(p7.certificates).toHaveLength(1);
  });

  it("el contenido va ADJUNTO (no detached): LoginCms lo necesita así", () => {
    const { certPem, keyPem } = generarCertificado();
    const tra = buildTra({ uniqueId: 999 });
    const der = forge.util.decode64(signCms({ tra, certPem, keyPem }));
    // El TRA tiene que estar embebido en el DER.
    expect(der).toContain("<uniqueId>999</uniqueId>");
  });

  it("un certificado ilegible da CMS_SIGN_FAILED, sin filtrar el error interno", () => {
    const { keyPem } = generarCertificado();
    try {
      signCms({ tra: buildTra(), certPem: "no soy un cert", keyPem });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ArcaError);
      expect((err as ArcaError).code).toBe("CMS_SIGN_FAILED");
      // Sin `cause`: node-forge puede arrastrar material de la clave.
      expect((err as Error).cause).toBeUndefined();
    }
  });
});

describe("certificados", () => {
  it("extrae subject, CN, CUIT del serialNumber y vigencia", () => {
    const { certPem } = generarCertificado({ cuit: "30707429530", cn: "mi-comercio" });
    const info = inspectCertificate(certPem);
    expect(info.commonName).toBe("mi-comercio");
    expect(info.cuit).toBe("30707429530");
    expect(info.subject).toContain("mi-comercio");
    expect(info.notAfter.getTime()).toBeGreaterThan(Date.now());
    expect(info.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("acepta el par correcto", () => {
    const { certPem, keyPem } = generarCertificado();
    expect(() => assertKeyMatchesCert(certPem, keyPem)).not.toThrow();
  });

  // Esta guarda evita el error opaco de WSAA cuando alguien sube el .key de otro
  // certificado: sin ella, el diagnóstico cuesta horas.
  it("REGRESIÓN: rechaza una clave privada que no corresponde al certificado", () => {
    const a = generarCertificado();
    const b = generarCertificado();
    expect(() => assertKeyMatchesCert(a.certPem, b.keyPem)).toThrow("ARCA_CERT_INVALIDO");
  });

  it("detecta un certificado vencido y cuenta los días", () => {
    const vencido = generarCertificado({
      notBefore: new Date(Date.now() - 400 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    const info = inspectCertificate(vencido.certPem);
    expect(certVencido(info)).toBe(true);
    expect(diasParaVencer(info)).toBeLessThan(0);

    const vigente = inspectCertificate(generarCertificado().certPem);
    expect(certVencido(vigente)).toBe(false);
    expect(diasParaVencer(vigente)).toBeGreaterThan(300);
  });

  it("un certificado inválido da ARCA_CERT_INVALIDO", () => {
    expect(() => inspectCertificate("basura")).toThrow("ARCA_CERT_INVALIDO");
  });

  it("reconoce armaduras PEM y rechaza claves con contraseña", () => {
    const { certPem, keyPem } = generarCertificado();
    expect(pareceCertificado(certPem)).toBe(true);
    expect(pareceCertificado(keyPem)).toBe(false);
    expect(pareceClavePrivada(keyPem)).toBe(true);
    expect(esClaveCifrada(keyPem)).toBe(false);
    expect(esClaveCifrada("-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----")).toBe(true);
    expect(esClaveCifrada("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nx")).toBe(true);
  });
});

describe("QR (RG 4892)", () => {
  const cbte = {
    cbteFch: "2026-07-30", cuitEmisor: "30707429530", ptoVta: 1, cbteTipo: 6,
    numero: 123, impTotal: 1000, docTipo: 99, docNro: "0", cae: "76123456789012",
  };

  // ⚠️ cuit, nroDocRec y codAut son NÚMEROS en la especificación. Comillarlos
  // hace que el QR no resuelva nada en el sitio de ARCA.
  it("cuit, nroDocRec y codAut son números, no strings", () => {
    const p = buildQrPayload(cbte);
    expect(typeof p.cuit).toBe("number");
    expect(typeof p.nroDocRec).toBe("number");
    expect(typeof p.codAut).toBe("number");
    expect(p.codAut).toBe(76123456789012);
  });

  it("el payload tiene exactamente los campos de la especificación", () => {
    expect(buildQrPayload(cbte)).toEqual({
      ver: 1, fecha: "2026-07-30", cuit: 30707429530, ptoVta: 1, tipoCmp: 6,
      nroCmp: 123, importe: 1000, moneda: "PES", ctz: 1,
      tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: 76123456789012,
    });
  });

  it("la fecha va con guiones (a diferencia de CbteFch)", () => {
    expect(buildQrPayload(cbte).fecha).toBe("2026-07-30");
  });

  it("la URL lleva el JSON en base64 y apunta al microsite de ARCA", () => {
    const url = qrUrl(buildQrPayload(cbte));
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
    const b64 = new URL(url).searchParams.get("p")!;
    expect(JSON.parse(Buffer.from(b64, "base64").toString("utf8")).codAut).toBe(76123456789012);
  });

  it("sin CAE todavía no hay QR", () => {
    expect(qrUrlDeComprobante({ ...cbte, cae: null })).toBeNull();
    expect(qrUrlDeComprobante(cbte)).toContain("?p=");
  });
});

describe("XML", () => {
  it("esc escapa los cinco caracteres de XML", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  });

  it("tag omite el nodo cuando el valor es null (campos opcionales)", () => {
    expect(tag("A", 1)).toBe("<A>1</A>");
    expect(tag("A", null)).toBe("");
    expect(tag("A", undefined)).toBe("");
    expect(tag("A", 0)).toBe("<A>0</A>"); // 0 NO es ausencia
  });

  // Sin parseTagValue:false, un CAE de 14 dígitos pierde precisión y un DNI con
  // ceros a la izquierda se corrompe en silencio.
  it("los valores se mantienen como string: no rompe el CAE de 14 dígitos", () => {
    const doc = parseXml("<r><CAE>76123456789012</CAE><DocNro>00123456</DocNro></r>");
    expect(pick(doc, "r", "CAE")).toBe("76123456789012");
    expect(pick(doc, "r", "DocNro")).toBe("00123456");
  });

  // Sin isArray, un solo Obs viene como objeto y `obs.map` explota.
  it("Obs y Err son SIEMPRE array, venga uno o venga N", () => {
    const uno = parseXml("<r><Observaciones><Obs><Code>1</Code><Msg>Uno</Msg></Obs></Observaciones></r>");
    expect(asMensajes(pick(uno, "r", "Observaciones", "Obs"))).toEqual([{ code: 1, msg: "Uno" }]);

    const dos = parseXml("<r><Observaciones><Obs><Code>1</Code><Msg>Uno</Msg></Obs><Obs><Code>2</Code><Msg>Dos</Msg></Obs></Observaciones></r>");
    expect(asMensajes(pick(dos, "r", "Observaciones", "Obs"))).toHaveLength(2);
  });

  it("quita prefijos de namespace", () => {
    const doc = parseXml(`<soapenv:Envelope xmlns:soapenv="http://x"><soapenv:Body><A>1</A></soapenv:Body></soapenv:Envelope>`);
    expect(pick(doc, "Envelope", "Body", "A")).toBe("1");
  });

  it("una página HTML de mantenimiento da ARCA_MANTENIMIENTO, no un crash del parser", () => {
    expect(() => parseXml(paginaMantenimiento())).toThrow("ARCA_MANTENIMIENTO");
  });

  it("pick tolera rutas que no existen", () => {
    expect(pick(parseXml("<r><a>1</a></r>"), "r", "b", "c")).toBeUndefined();
  });
});

describe("SOAP", () => {
  it("envelope arma un sobre SOAP 1.1", () => {
    const e = envelope("<Foo/>");
    expect(e).toContain("http://schemas.xmlsoap.org/soap/envelope/");
    expect(e).toContain("<soapenv:Body><Foo/></soapenv:Body>");
  });

  it("parseSoapResponse convierte un Fault en SoapFault", () => {
    try {
      parseSoapResponse(soapFault("El CEE ya posee un TA valido para el acceso al WSN solicitado"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SoapFault);
      expect((err as SoapFault).faultstring).toContain("ya posee un TA valido");
    }
  });

  it("parseSoapResponse devuelve el body cuando no hay fault", () => {
    const body = parseSoapResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><Foo>1</Foo></soapenv:Body></soapenv:Envelope>`);
    expect(body.Foo).toBe("1");
  });

  // Los logs de Vercel los lee todo el equipo. token/sign son credenciales
  // bearer de 12 h; in0 es el CMS con el certificado adentro.
  it("scrubXml redacta token, sign e in0 antes de cualquier log", () => {
    const xml = "<Auth><Token>SECRETO-AAA</Token><Sign>SECRETO-BBB</Sign></Auth><in0>CMS-BASE64</in0>";
    const limpio = scrubXml(xml);
    expect(limpio).not.toContain("SECRETO-AAA");
    expect(limpio).not.toContain("SECRETO-BBB");
    expect(limpio).not.toContain("CMS-BASE64");
    expect(limpio).toContain("[REDACTADO]");
  });

  it("scrubPayload redacta las credenciales de lo que se guarda como auditoría", () => {
    const limpio = scrubPayload({ Auth: { Token: "AAA", Sign: "BBB", Cuit: "20111111112" }, FeCabReq: { PtoVta: 1 } });
    expect(limpio.Auth.Token).toBe("[REDACTADO]");
    expect(limpio.Auth.Sign).toBe("[REDACTADO]");
    expect(limpio.Auth.Cuit).toBe("20111111112"); // el CUIT no es secreto
    expect(limpio.FeCabReq.PtoVta).toBe(1);
  });

  it("scrubPayload no muta el original", () => {
    const original = { Auth: { Token: "AAA", Sign: "BBB", Cuit: "1" } };
    scrubPayload(original);
    expect(original.Auth.Token).toBe("AAA");
  });
});

describe("clasificación de errores", () => {
  it("reconoce el 'ya posee un TA valido' como caso especial", () => {
    expect(esTaYaVigente("El CEE ya posee un TA valido para el acceso al WSN solicitado")).toBe(true);
    expect(esTaYaVigente("otra cosa")).toBe(false);
  });

  it("reconoce la falta de delegación del servicio wsfe", () => {
    expect(esCertSinDelegacion("Computador no autorizado a acceder al servicio")).toBe(true);
  });

  it("reconoce el token vencido por código y por mensaje", () => {
    expect(esTokenInvalido([{ code: 600, msg: "cualquier cosa" }])).toBe(true);
    expect(esTokenInvalido([{ code: 1, msg: "El token es invalido" }])).toBe(true);
    expect(esTokenInvalido([{ code: 1, msg: "otra cosa" }])).toBe(false);
  });

  it("arcaUserMessage traduce errores del protocolo y del dominio", () => {
    expect(arcaUserMessage(new ArcaError("ARCA_CERT_SIN_DELEGACION")).status).toBe(502);
    expect(arcaUserMessage(new ArcaError("ARCA_CERT_SIN_DELEGACION")).message).toContain("Administrador de Relaciones");
    expect(arcaUserMessage(new Error("VENTA_ANULADA")).status).toBe(400);
    expect(arcaUserMessage(new Error("CUIT_REQUERIDO_FACTURA_A")).message).toContain("Responsable Inscripto");
    expect(arcaUserMessage(new Error("EMISION_EN_CURSO")).status).toBe(409);
  });

  it("un error desconocido no filtra nada al usuario", () => {
    const m = arcaUserMessage(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2"));
    expect(m.message).not.toContain("hunter2");
    expect(m.status).toBe(500);
  });

  it("un timeout de red cae en el mensaje de ARCA no responde", () => {
    expect(arcaUserMessage(new Error("fetch failed")).status).toBe(504);
  });

  // Excepción deliberada: el texto de ARCA SÍ se muestra. Es el error fiscal del
  // propio contribuyente y ocultarlo vuelve el problema irresoluble.
  it("mensajeRechazo muestra el texto original de ARCA", () => {
    expect(mensajeRechazo([{ code: 10016, msg: "El campo Fecha de comprobante esta fuera de rango" }]))
      .toBe("ARCA rechazó el comprobante: El campo Fecha de comprobante esta fuera de rango (10016)");
    expect(mensajeRechazo([])).toContain("sin dar un motivo");
  });
});
