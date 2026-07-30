import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { generarCertificado, fakeTransport, respuestaLoginCms, soapFault } from "./helpers/arca";
import { arcaAccessTickets, arcaCredentials } from "@/db/schema";
import {
  saveFiscalConfig, getFiscalConfig, requireFiscalConfig,
  saveCredentials, loadCredentials, getCredencialesResumen, deleteCredentials,
  crearTicketStore,
} from "@/domain/fiscal-config";
import { createArcaClient } from "@/lib/arca/client";

const KEY = Buffer.alloc(32, 7).toString("base64");
const CUIT = "30707429530";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let otraStore: number;

beforeEach(async () => {
  vi.stubEnv("ARCA_MASTER_KEY", KEY);
  vi.stubEnv("ARCA_MASTER_KEY_ID", "k1");
  vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
  db = await createTestDb();
  store = await seedTestStore(db, "t1");
  otraStore = await seedTestStore(db, "t2");
  await seedTestUser(db, "u1", "owner", store);
});

afterEach(() => vi.unstubAllEnvs());

const configBase = (storeId: number) => ({
  storeId, cuit: CUIT, razonSocial: "Mi Comercio SRL", domicilio: "Av. Siempreviva 742",
  puntoVenta: 1, enabled: true,
});

describe("config fiscal", () => {
  it("guarda y relee la config", async () => {
    await saveFiscalConfig(db, configBase(store));
    const cfg = await getFiscalConfig(db, store);
    expect(cfg).toMatchObject({ cuit: CUIT, puntoVenta: 1, ambiente: "homologacion", defaultIvaId: 5 });
  });

  it("upsert: guardar de nuevo actualiza, no duplica", async () => {
    await saveFiscalConfig(db, configBase(store));
    await saveFiscalConfig(db, { ...configBase(store), puntoVenta: 37 });
    expect((await getFiscalConfig(db, store))!.puntoVenta).toBe(37);
  });

  it("los defaults protegen: empleados no emiten y arranca deshabilitada", async () => {
    await saveFiscalConfig(db, { ...configBase(store), enabled: undefined });
    const cfg = await getFiscalConfig(db, store)!;
    expect(cfg!.empleadosPuedenEmitir).toBe(false);
    expect(cfg!.enabled).toBe(false);
    expect(cfg!.ambiente).toBe("homologacion");
  });

  it("el umbral de consumidor final queda en null (permisivo) si no se fija", async () => {
    await saveFiscalConfig(db, configBase(store));
    expect((await getFiscalConfig(db, store))!.umbralConsumidorFinal).toBeNull();
  });

  it("requireFiscalConfig falla si no hay config o está deshabilitada", async () => {
    await expect(requireFiscalConfig(db, store)).rejects.toThrow("FISCAL_NO_CONFIGURADO");
    await saveFiscalConfig(db, { ...configBase(store), enabled: false });
    await expect(requireFiscalConfig(db, store)).rejects.toThrow("FISCAL_NO_CONFIGURADO");
    await saveFiscalConfig(db, configBase(store));
    expect((await requireFiscalConfig(db, store)).cuit).toBe(CUIT);
  });

  it("cada tienda tiene su propia config", async () => {
    await saveFiscalConfig(db, configBase(store));
    await saveFiscalConfig(db, { ...configBase(otraStore), cuit: "20111111112", puntoVenta: 9 });
    expect((await getFiscalConfig(db, store))!.puntoVenta).toBe(1);
    expect((await getFiscalConfig(db, otraStore))!.puntoVenta).toBe(9);
  });
});

describe("credenciales", () => {
  it("guarda cifrado y descifra el par completo", async () => {
    const { certPem, keyPem } = generarCertificado({ cuit: CUIT });
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", certPem, keyPem });

    const leidas = await loadCredentials(db, store, "homologacion");
    expect(leidas.certPem).toBe(certPem);
    expect(leidas.keyPem).toBe(keyPem);
  });

  it("en la DB no queda nada en claro", async () => {
    const { certPem, keyPem } = generarCertificado();
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", certPem, keyPem });

    const [row] = await db.select().from(arcaCredentials).where(eq(arcaCredentials.storeId, store));
    expect(row.certPemEnc).not.toContain("BEGIN CERTIFICATE");
    expect(row.keyPemEnc).not.toContain("BEGIN");
    expect(row.certPemEnc.startsWith("v1.k1.")).toBe(true);
  });

  // El camino de la UI no PUEDE filtrar el certificado: no selecciona esas
  // columnas. Es estructural, no una convención.
  it("el resumen para la UI no incluye los PEM cifrados", async () => {
    const { certPem, keyPem } = generarCertificado({ cuit: CUIT, cn: "mi-comercio" });
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", certPem, keyPem });

    const resumen = await getCredencialesResumen(db, store, "homologacion");
    expect(resumen!.certCuit).toBe(CUIT);
    expect(resumen!.certSubject).toContain("mi-comercio");
    expect(resumen!.certFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(resumen!)).not.toContain("certPemEnc");
    expect(Object.keys(resumen!)).not.toContain("keyPemEnc");
    expect(JSON.stringify(resumen)).not.toContain("BEGIN");
  });

  // Guarda anti cross-tenant: el AAD ata el ciphertext a la tienda.
  it("REGRESIÓN: el blob de una tienda no descifra en otra", async () => {
    const { certPem, keyPem } = generarCertificado();
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", certPem, keyPem });

    const [row] = await db.select().from(arcaCredentials).where(eq(arcaCredentials.storeId, store));
    // Trasplante manual, como si un atacante escribiera en la DB.
    await db.insert(arcaCredentials).values({
      storeId: otraStore, ambiente: "homologacion",
      certPemEnc: row.certPemEnc, keyPemEnc: row.keyPemEnc,
    });
    await expect(loadCredentials(db, otraStore, "homologacion")).rejects.toThrow("SECRET_DECRYPT_FAILED");
  });

  it("rechaza una clave privada que no corresponde al certificado", async () => {
    const a = generarCertificado();
    const b = generarCertificado();
    await expect(saveCredentials(db, {
      storeId: store, ambiente: "homologacion", certPem: a.certPem, keyPem: b.keyPem,
    })).rejects.toThrow("ARCA_CERT_INVALIDO");
    expect(await db.select().from(arcaCredentials)).toHaveLength(0);
  });

  it("rechaza un certificado vencido", async () => {
    const vencido = generarCertificado({
      notBefore: new Date(Date.now() - 400 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    await expect(saveCredentials(db, {
      storeId: store, ambiente: "homologacion", certPem: vencido.certPem, keyPem: vencido.keyPem,
    })).rejects.toThrow("ARCA_CERT_VENCIDO");
  });

  it("rechaza un certificado de otro CUIT", async () => {
    const otro = generarCertificado({ cuit: "20111111112" });
    await expect(saveCredentials(db, {
      storeId: store, ambiente: "homologacion", certPem: otro.certPem, keyPem: otro.keyPem,
      cuitEsperado: CUIT,
    })).rejects.toThrow("ARCA_CERT_INVALIDO");
  });

  // Homologación y producción son certificados distintos que deben coexistir.
  it("los certificados de homologación y producción conviven", async () => {
    const homo = generarCertificado({ cn: "homo" });
    const prod = generarCertificado({ cn: "prod" });
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", ...homo });
    await saveCredentials(db, { storeId: store, ambiente: "produccion", ...prod });

    expect((await loadCredentials(db, store, "homologacion")).certPem).toBe(homo.certPem);
    expect((await loadCredentials(db, store, "produccion")).certPem).toBe(prod.certPem);
  });

  // Un ticket emitido con el certificado anterior ya no sirve.
  it("subir un certificado nuevo borra el ticket cacheado", async () => {
    const c1 = generarCertificado();
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", ...c1 });
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set({ token: "T", sign: "S", generatedAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) });
    expect(await tickets.get()).not.toBeNull();

    await saveCredentials(db, { storeId: store, ambiente: "homologacion", ...generarCertificado() });
    expect(await tickets.get()).toBeNull();
  });

  it("borrar credenciales limpia también el ticket", async () => {
    await saveCredentials(db, { storeId: store, ambiente: "homologacion", ...generarCertificado() });
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set({ token: "T", sign: "S", generatedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });

    await deleteCredentials(db, store, "homologacion");
    expect(await db.select().from(arcaCredentials)).toHaveLength(0);
    expect(await db.select().from(arcaAccessTickets)).toHaveLength(0);
  });

  it("sin credenciales cargadas, loadCredentials falla con el código del dominio", async () => {
    await expect(loadCredentials(db, store, "homologacion")).rejects.toThrow("FISCAL_NO_CONFIGURADO");
  });
});

describe("cache del ticket de acceso", () => {
  const ticketFresco = () => ({
    token: "TK", sign: "SG",
    generatedAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000),
  });

  it("round-trip cifrado del token y la firma", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set(ticketFresco());
    const leido = await tickets.get();
    expect(leido!.token).toBe("TK");
    expect(leido!.sign).toBe("SG");
  });

  // Son credenciales bearer de 12 h: quien las tenga puede facturar a nombre del
  // contribuyente. Un dump de la DB no puede alcanzar.
  it("token y sign quedan cifrados en la DB", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set(ticketFresco());
    const [row] = await db.select().from(arcaAccessTickets).where(eq(arcaAccessTickets.storeId, store));
    expect(row.token).not.toBe("TK");
    expect(row.token.startsWith("v1.k1.")).toBe(true);
    expect(row.sign).not.toBe("SG");
  });

  it("un ticket vencido se reporta como ausente", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set({ token: "TK", sign: "SG", generatedAt: new Date(0), expiresAt: new Date(Date.now() - 1000) });
    expect(await tickets.get()).toBeNull();
  });

  // Margen de 10 minutos: cubre el desfasaje de reloj más la llamada que sigue.
  it("un ticket que vence dentro del margen se considera vencido", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set({ token: "TK", sign: "SG", generatedAt: new Date(), expiresAt: new Date(Date.now() + 5 * 60_000) });
    expect(await tickets.get()).toBeNull();

    await tickets.set({ token: "TK", sign: "SG", generatedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60_000) });
    expect(await tickets.get()).not.toBeNull();
  });

  it("upsert: la fila es un slot mutable, nunca un log", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.set(ticketFresco());
    await tickets.set({ ...ticketFresco(), token: "TK2" });
    const filas = await db.select().from(arcaAccessTickets).where(eq(arcaAccessTickets.storeId, store));
    expect(filas).toHaveLength(1);
    expect((await tickets.get())!.token).toBe("TK2");
  });

  it("cada tienda y cada ambiente tienen su propio slot", async () => {
    const a = crearTicketStore(db, store, "homologacion", CUIT);
    const b = crearTicketStore(db, store, "produccion", CUIT);
    const c = crearTicketStore(db, otraStore, "homologacion", "20111111112");
    await a.set({ ...ticketFresco(), token: "A" });
    await b.set({ ...ticketFresco(), token: "B" });
    await c.set({ ...ticketFresco(), token: "C" });
    expect((await a.get())!.token).toBe("A");
    expect((await b.get())!.token).toBe("B");
    expect((await c.get())!.token).toBe("C");
  });

  describe("lease de renovación", () => {
    it("el primero toma el lease y el segundo no", async () => {
      const tickets = crearTicketStore(db, store, "homologacion", CUIT);
      expect(await tickets.tryAcquireLease()).toBe(true);
      expect(await tickets.tryAcquireLease()).toBe(false);
    });

    it("liberar el lease permite reintentar enseguida, sin esperar los 60 s", async () => {
      const tickets = crearTicketStore(db, store, "homologacion", CUIT);
      expect(await tickets.tryAcquireLease()).toBe(true);
      await tickets.releaseLease();
      expect(await tickets.tryAcquireLease()).toBe(true);
    });

    it("con un ticket fresco nadie toma el lease: el camino común no lo toca", async () => {
      const tickets = crearTicketStore(db, store, "homologacion", CUIT);
      await tickets.set(ticketFresco());
      expect(await tickets.tryAcquireLease()).toBe(false);
    });

    it("escribir el ticket libera el lease", async () => {
      const tickets = crearTicketStore(db, store, "homologacion", CUIT);
      await tickets.tryAcquireLease();
      await tickets.set(ticketFresco());
      const [row] = await db.select().from(arcaAccessTickets).where(eq(arcaAccessTickets.storeId, store));
      expect(row.lockedUntil).toBeNull();
    });

    it("el lease de una tienda no bloquea a otra", async () => {
      const a = crearTicketStore(db, store, "homologacion", CUIT);
      const b = crearTicketStore(db, otraStore, "homologacion", "20111111112");
      expect(await a.tryAcquireLease()).toBe(true);
      expect(await b.tryAcquireLease()).toBe(true);
    });
  });
});

describe("createArcaClient: obtención del ticket", () => {
  const cert = generarCertificado({ cuit: CUIT });

  const cliente = (transport: ReturnType<typeof fakeTransport>) => createArcaClient({
    ambiente: "homologacion", cuit: CUIT, ptoVta: 1,
    certPem: cert.certPem, keyPem: cert.keyPem,
    tickets: crearTicketStore(db, store, "homologacion", CUIT),
    transport,
    esperaMs: async () => {},
  });

  it("loguea una vez y reutiliza el ticket cacheado en la llamada siguiente", async () => {
    const vistos: { soapAction: string }[] = [];
    const c = cliente(fakeTransport({
      "": respuestaLoginCms({ token: "TK" }),
      FEDummy: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
        <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompUltimoAutorizadoResult><CbteNro>5</CbteNro></FECompUltimoAutorizadoResult>
        </FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
      FECompUltimoAutorizado: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
        <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompUltimoAutorizadoResult><CbteNro>5</CbteNro></FECompUltimoAutorizadoResult>
        </FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
    }, vistos as never));

    expect(await c.lastAuthorized(6)).toBe(5);
    expect(await c.lastAuthorized(6)).toBe(5);
    // Un solo login (soapAction "") para dos llamadas de negocio.
    expect(vistos.filter((v) => v.soapAction === "")).toHaveLength(1);
  });

  // ⚠️ Sin este manejo, una carrera de vencimiento de lease deja a la tienda sin
  // poder facturar hasta 12 horas.
  it("REGRESIÓN: si pierde la carrera de login, usa el ticket que escribió el ganador", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    const c = createArcaClient({
      ambiente: "homologacion", cuit: CUIT, ptoVta: 1,
      certPem: cert.certPem, keyPem: cert.keyPem,
      tickets: {
        ...tickets,
        // Simula al ganador escribiendo el ticket justo mientras nosotros
        // recibimos "ya posee un TA valido".
        async get() {
          const propio = await tickets.get();
          if (propio) return propio;
          if (yaFallo) {
            await tickets.set({ token: "DEL-GANADOR", sign: "S", generatedAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) });
            return tickets.get();
          }
          return null;
        },
      },
      transport: fakeTransport({
        "": () => { yaFallo = true; return soapFault("El CEE ya posee un TA valido para el acceso al WSN solicitado"); },
        FECompUltimoAutorizado: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
          <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
            <FECompUltimoAutorizadoResult><CbteNro>9</CbteNro></FECompUltimoAutorizadoResult>
          </FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
      }),
      esperaMs: async () => {},
    });
    let yaFallo = false;

    expect(await c.lastAuthorized(6)).toBe(9);
  });

  it("si nadie renueva a tiempo, devuelve un error reintentable", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    await tickets.tryAcquireLease(); // otro se lo llevó y nunca escribe

    const c = createArcaClient({
      ambiente: "homologacion", cuit: CUIT, ptoVta: 1,
      certPem: cert.certPem, keyPem: cert.keyPem,
      tickets, transport: fakeTransport({ "": respuestaLoginCms() }), esperaMs: async () => {},
    });
    await expect(c.lastAuthorized(6)).rejects.toThrow("ARCA_TA_EN_RENOVACION");
  });

  it("un fallo de login libera el lease para que el próximo reintente", async () => {
    const tickets = crearTicketStore(db, store, "homologacion", CUIT);
    const c = createArcaClient({
      ambiente: "homologacion", cuit: CUIT, ptoVta: 1,
      certPem: cert.certPem, keyPem: cert.keyPem,
      tickets, transport: fakeTransport({ "": soapFault("Computador no autorizado a acceder al servicio") }),
      esperaMs: async () => {},
    });

    await expect(c.lastAuthorized(6)).rejects.toThrow("ARCA_CERT_SIN_DELEGACION");
    expect(await tickets.tryAcquireLease()).toBe(true);
  });

  it("el cliente no expone el certificado ni la clave privada", async () => {
    const c = cliente(fakeTransport({ "": respuestaLoginCms() }));
    expect(JSON.stringify(Object.keys(c))).not.toContain("cert");
    expect(JSON.stringify(Object.keys(c))).not.toContain("key");
    expect(Object.keys(c).sort()).toEqual(["ambiente", "authorize", "consult", "cuit", "dummy", "lastAuthorized", "ptoVta"]);
  });
});
