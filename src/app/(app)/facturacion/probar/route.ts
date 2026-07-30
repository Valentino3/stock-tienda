import { db } from "@/db";
import { assertSameOrigin, requireStoreOwner } from "@/lib/session";
import { requireFiscalConfig } from "@/domain/fiscal-config";
import { createArcaClientForStore } from "@/lib/arca/client";
import { feDummy } from "@/lib/arca/wsfev1";
import { arcaUserMessage } from "@/lib/arca/errors";
import { CBTE_FACTURA_A, CBTE_FACTURA_B, formatearNumeroComprobante } from "@/domain/fiscal-catalogs";

/**
 * "Probar conexión": la herramienta de diagnóstico más útil de la pantalla.
 * Convierte un "no anda" en una línea concreta que falla.
 *
 * Los tres pasos están ordenados a propósito, de menos a más exigente:
 *   1. FEDummy — no lleva autenticación, así que dice si ARCA está arriba
 *      incluso con el certificado mal.
 *   2. WSAA + FECompUltimoAutorizado B — prueba el certificado y la delegación.
 *   3. FECompUltimoAutorizado A — confirma la otra secuencia.
 *
 * Cada paso reporta su propio resultado en vez de cortar todo con un error
 * único, porque saber cuál de los tres falla es todo el diagnóstico.
 */

export const maxDuration = 60;

type Paso = { nombre: string; ok: boolean; detalle: string };

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST() {
  let storeId: number;
  try {
    await assertSameOrigin();
    ({ storeId } = await requireStoreOwner());
  } catch {
    return fail(403, "No tenés permiso para hacer esto.");
  }

  const pasos: Paso[] = [];

  try {
    const cfg = await requireFiscalConfig(db, storeId);

    // Paso 1 — ¿está arriba el servicio?
    try {
      const dummy = await feDummy({ ambiente: cfg.ambiente });
      const arriba = dummy.appServer === "OK" && dummy.dbServer === "OK" && dummy.authServer === "OK";
      pasos.push({
        nombre: "Servicio de ARCA disponible",
        ok: arriba,
        detalle: arriba
          ? "Los tres servidores responden OK."
          : `App: ${dummy.appServer} · Base: ${dummy.dbServer} · Auth: ${dummy.authServer}`,
      });
      if (!arriba) return Response.json({ ok: false, pasos, ambiente: cfg.ambiente });
    } catch (err) {
      pasos.push({ nombre: "Servicio de ARCA disponible", ok: false, detalle: arcaUserMessage(err).message });
      return Response.json({ ok: false, pasos, ambiente: cfg.ambiente });
    }

    // Paso 2 — certificado, delegación y numeración de Factura B.
    const arca = await createArcaClientForStore(db, storeId);
    let ultimoB: number;
    try {
      ultimoB = await arca.lastAuthorized(CBTE_FACTURA_B);
      pasos.push({ nombre: "Autenticación con ARCA (certificado y delegación)", ok: true, detalle: "Autenticado correctamente." });
      pasos.push({
        nombre: `Último comprobante autorizado — Factura B, punto de venta ${String(cfg.puntoVenta).padStart(4, "0")}`,
        ok: true,
        detalle: ultimoB === 0
          ? "Todavía no emitiste ninguna Factura B en este punto de venta."
          : `N° ${formatearNumeroComprobante(cfg.puntoVenta, ultimoB)}`,
      });
    } catch (err) {
      pasos.push({
        nombre: "Autenticación con ARCA (certificado y delegación)",
        ok: false,
        detalle: arcaUserMessage(err).message,
      });
      return Response.json({ ok: false, pasos, ambiente: cfg.ambiente });
    }

    // Paso 3 — la otra secuencia.
    try {
      const ultimoA = await arca.lastAuthorized(CBTE_FACTURA_A);
      pasos.push({
        nombre: "Último comprobante autorizado — Factura A",
        ok: true,
        detalle: ultimoA === 0
          ? "Todavía no emitiste ninguna Factura A en este punto de venta."
          : `N° ${formatearNumeroComprobante(cfg.puntoVenta, ultimoA)}`,
      });
    } catch (err) {
      pasos.push({ nombre: "Último comprobante autorizado — Factura A", ok: false, detalle: arcaUserMessage(err).message });
    }

    return Response.json({
      ok: pasos.every((p) => p.ok),
      pasos,
      ambiente: cfg.ambiente,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[facturacion/probar]", err instanceof Error ? err.message : err);
    const { status, message } = arcaUserMessage(err);
    return fail(status, message);
  }
}
