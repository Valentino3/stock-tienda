import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { stores } from "@/db/schema";
import { getFiscalConfig, requireFiscalConfig, saveFiscalConfig } from "@/domain/fiscal-config";
import { eq } from "drizzle-orm";

/**
 * Una tienda de prueba no puede emitir un comprobante real.
 *
 * Es la única consecuencia irreversible de tener una tienda de prueba en la
 * misma base que los locales: `ARCA_ALLOW_PRODUCCION` es del servidor entero y
 * en producción está en `true`, así que sin esta guarda una prueba emitiría una
 * factura de verdad ante ARCA. Borrar la fila no la deshace: hay que emitir una
 * nota de crédito.
 *
 * La guarda vive en `requireFiscalConfig` porque es el único punto por el que
 * pasan las dos vías de emisión, y por el que va a tener que pasar cualquier
 * vía futura.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let real: number, prueba: number;

const configValida = (storeId: number, ambiente: "homologacion" | "produccion") => ({
  storeId,
  cuit: "20111111112",
  razonSocial: "Test SA",
  domicilio: "Calle 1",
  puntoVenta: 1,
  ambiente,
  enabled: true,
});

beforeEach(async () => {
  db = await createTestDb();
  real = await seedTestStore(db, "real");
  prueba = await seedTestStore(db, "prueba");
  await db.update(stores).set({ esPrueba: true }).where(eq(stores.id, prueba));
  await seedTestUser(db, "u1", "owner", real);
});

describe("tienda de prueba y facturación", () => {
  it("no deja emitir en producción", async () => {
    await saveFiscalConfig(db, configValida(prueba, "produccion"));
    await expect(requireFiscalConfig(db, prueba))
      .rejects.toThrow("TIENDA_DE_PRUEBA_NO_FACTURA_EN_PRODUCCION");
  });

  it("sí deja emitir en homologación", async () => {
    // Es el punto de tener la tienda: probar el camino fiscal entero sin
    // consecuencias. Bloquear los dos ambientes la volvería inútil.
    await saveFiscalConfig(db, configValida(prueba, "homologacion"));
    const cfg = await requireFiscalConfig(db, prueba);
    expect(cfg.ambiente).toBe("homologacion");
  });

  it("una tienda real sigue pudiendo emitir en producción", async () => {
    // La no-regresión: los dos locales facturan de verdad todos los días.
    await saveFiscalConfig(db, configValida(real, "produccion"));
    const cfg = await requireFiscalConfig(db, real);
    expect(cfg.ambiente).toBe("produccion");
  });

  it("marcar una tienda como de prueba la bloquea sin tocar su config", async () => {
    await saveFiscalConfig(db, configValida(real, "produccion"));
    expect((await requireFiscalConfig(db, real)).ambiente).toBe("produccion");

    await db.update(stores).set({ esPrueba: true }).where(eq(stores.id, real));

    await expect(requireFiscalConfig(db, real))
      .rejects.toThrow("TIENDA_DE_PRUEBA_NO_FACTURA_EN_PRODUCCION");
    // La config quedó intacta: la guarda no muta nada, solo rechaza.
    expect((await getFiscalConfig(db, real))!.ambiente).toBe("produccion");
  });

  it("por defecto ninguna tienda es de prueba", async () => {
    // El default importa: una migración que marcara todo como prueba dejaría a
    // los dos locales sin poder facturar.
    const [r] = await db.select().from(stores).where(eq(stores.id, real));
    expect(r.esPrueba).toBe(false);
  });

  it("el error de config incompleta gana sobre el de tienda de prueba", async () => {
    // Sin config, el problema es que falta configurar, no el ambiente.
    await expect(requireFiscalConfig(db, prueba)).rejects.toThrow("FISCAL_NO_CONFIGURADO");
  });
});
