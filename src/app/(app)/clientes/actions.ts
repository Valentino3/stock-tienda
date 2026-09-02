"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStore, requireStoreOwner } from "@/lib/session";
import { createClient, recordAccountMovement, updateDatosFiscales } from "@/domain/clients";
import { DOC_CUIT, DOC_DNI, normalizarDoc, validarCuit, CONDICIONES_IVA_RECEPTOR } from "@/domain/fiscal-catalogs";

// Tipo de retorno EXPLÍCITO: sin él, TypeScript infiere
// `{error: string; ok?: undefined} | {ok: true; error?: undefined}` y el
// `"error" in res` de quien llama deja de estrechar.
type Resultado = { ok: true } | { error: string };

export async function saveClient(input: { name: string; phone?: string; note?: string; doc?: string }): Promise<Resultado> {
  const { storeId } = await requireStore();
  if (!input.name.trim()) return { error: "Nombre requerido" };

  // El diálogo rápido de venta pide UN solo campo opcional de documento: el tipo
  // se infiere por el largo. Más campos ahí matarían la razón de ser de ese
  // diálogo, que existe porque hay cola en el mostrador.
  const doc = normalizarDoc(input.doc);
  if (doc && doc.length === 11 && !validarCuit(doc)) {
    return { error: "El CUIT no es válido. Revisá el número." };
  }
  if (doc && doc.length !== 11 && (doc.length < 7 || doc.length > 8)) {
    return { error: "El documento tiene que ser un DNI (7-8 dígitos) o un CUIT (11)." };
  }

  try {
    await createClient(db, {
      storeId, name: input.name, phone: input.phone, note: input.note,
      docNro: doc,
      docTipo: doc ? (doc.length === 11 ? DOC_CUIT : DOC_DNI) : null,
      // Se deja la condición frente al IVA en null a propósito: null significa
      // "sin datos fiscales cargados", que es distinto de declarar Consumidor
      // Final. Los dos rutean a Factura B, pero solo uno es una declaración.
      condicionIva: null,
    });
  } catch {
    return { error: "No se pudo crear el cliente" };
  }
  revalidatePath("/clientes");
  return { ok: true as const };
}

/**
 * Datos fiscales completos.
 *
 * Solo el dueño: poner `condicionIva` en Responsable Inscripto cambia el
 * comprobante que le corresponde al cliente de Factura B a Factura A. Es una
 * decisión fiscal, no un dato de contacto, y no debería depender de que el
 * permiso de emitir facturas esté o no activado para los empleados.
 */
export async function saveDatosFiscalesAction(input: {
  clientId: number;
  docTipo: number | null;
  docNro: string;
  condicionIva: number | null;
  razonSocial?: string;
  domicilio?: string;
  email?: string;
}): Promise<Resultado> {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch {
    return { error: "Solo el dueño puede cargar los datos fiscales de un cliente." };
  }

  const doc = normalizarDoc(input.docNro);
  if (input.condicionIva != null && !CONDICIONES_IVA_RECEPTOR.includes(input.condicionIva as never)) {
    return { error: "La condición frente al IVA no es válida." };
  }
  if (doc && input.docTipo === DOC_CUIT && !validarCuit(doc)) {
    return { error: "El CUIT no es válido. Revisá el número." };
  }

  const email = input.email?.trim() || null;
  // Chequeo mínimo de forma. La validación real de un mail es que llegue: no
  // tiene sentido pelearse acá con una regex que igual acepta direcciones que
  // rebotan.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "El correo no parece válido. Revisalo." };
  }

  try {
    await updateDatosFiscales(db, {
      storeId,
      clientId: input.clientId,
      docTipo: doc ? input.docTipo : null,
      docNro: doc,
      condicionIva: input.condicionIva,
      razonSocial: input.razonSocial,
      domicilio: input.domicilio,
      email,
    });
  } catch (e) {
    return { error: e instanceof Error && e.message === "CLIENT_NOT_FOUND" ? "Cliente no encontrado" : "No se pudieron guardar los datos fiscales" };
  }
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${input.clientId}`);
  revalidatePath("/ventas");
  return { ok: true as const };
}

const ERRORES_CUENTA: Record<string, string> = {
  INVALID_AMOUNT: "Monto inválido",
  CLIENT_NOT_FOUND: "Cliente no encontrado",
  NO_OPEN_SESSION:
    "No hay caja abierta. Abrila para cobrar en efectivo, o registralo con otro medio si la plata no entró al cajón.",
};

/**
 * Cobro de deuda o carga de crédito.
 *
 * `requireStore` y no owner: el cajero del mostrador del torneo tiene que
 * poder. Además esto METE plata, no la saca — es menos riesgoso que un egreso,
 * que sí es solo del dueño.
 */
export async function recordClientAccountMovement(input: {
  clientId: number;
  kind: "pago" | "credito";
  amount: number;
  method?: string;
  note?: string;
}): Promise<{ ok: true; balance: number } | { error: string }> {
  const { id: userId, storeId } = await requireStore();
  if (!(input.amount > 0)) return { error: ERRORES_CUENTA.INVALID_AMOUNT };
  let balance: number;
  try {
    ({ balance } = await recordAccountMovement(db, {
      storeId,
      clientId: input.clientId,
      kind: input.kind,
      amount: input.amount,
      method: input.method || null,
      note: input.note,
      userId,
    }));
  } catch (e) {
    const clave = e instanceof Error ? e.message : "";
    return { error: ERRORES_CUENTA[clave] ?? "No se pudo registrar el movimiento" };
  }
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${input.clientId}`);
  // El arqueo de la caja y el saldo del selector de venta quedan viejos si no.
  revalidatePath("/caja");
  revalidatePath("/vender");
  return { ok: true as const, balance };
}
