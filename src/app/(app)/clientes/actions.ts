"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStore, requireStoreOwner } from "@/lib/session";
import {
  createClient, recordAccountAdjustment, recordAccountMovement, setClientActive, updateClient,
  updateDatosFiscales, voidAccountMovement,
} from "@/domain/clients";
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

/**
 * Nombre, teléfono y nota. `requireStore` igual que al darlo de alta: el que
 * lo creó en el mostrador tiene que poder corregirle un typo.
 */
export async function updateClientAction(input: {
  clientId: number; name: string; phone?: string; note?: string;
}): Promise<Resultado> {
  const { storeId } = await requireStore();
  if (!input.name.trim()) return { error: "Nombre requerido" };
  try {
    await updateClient(db, { storeId, ...input });
  } catch (e) {
    return { error: e instanceof Error && e.message === "CLIENT_NOT_FOUND" ? "Cliente no encontrado" : "No se pudo guardar" };
  }
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${input.clientId}`);
  revalidatePath("/vender");
  return { ok: true as const };
}

/** Desactivar o reactivar. No toca la cuenta: ver `setClientActive`. */
export async function setClientActiveAction(clientId: number, active: boolean): Promise<Resultado> {
  const { storeId } = await requireStore();
  try {
    await setClientActive(db, { storeId, clientId, active });
  } catch {
    return { error: "Cliente no encontrado" };
  }
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clientId}`);
  // El selector del mostrador y el salón lo muestran o lo esconden.
  revalidatePath("/vender");
  revalidatePath("/salon");
  return { ok: true as const };
}

const ERRORES_CUENTA: Record<string, string> = {
  INVALID_AMOUNT: "Monto inválido",
  CLIENT_NOT_FOUND: "Cliente no encontrado",
  NO_OPEN_SESSION:
    "No hay caja abierta. Abrila para cobrar en efectivo, o registralo con otro medio si la plata no entró al cajón.",
  INVALID_METHOD: "Elegí un medio de pago válido.",
  INVALID_KIND: "Tipo de movimiento inválido.",
  MOTIVO_REQUIRED: "Escribí el motivo: es lo que va a explicar este cambio en la deuda.",
  VOID_REASON_REQUIRED: "Escribí por qué se anula.",
  MOVEMENT_NOT_FOUND: "Ese movimiento no existe.",
  ALREADY_VOIDED: "Ese movimiento ya está anulado.",
  ANULACION_NOT_VOIDABLE: "Es la reversión automática de una venta anulada: no se anula.",
  SALE_CHARGE_NOT_VOIDABLE: "Este cargo es de una venta. Anulá la venta desde Ventas.",
  CASH_SESSION_CLOSED:
    "Entró en efectivo a una caja que ya se cerró: anularlo cambiaría un arqueo cerrado. Registrá un cargo manual por el mismo monto, con el motivo.",
};

/** Adónde impacta un cambio en la cuenta de un cliente. */
function revalidarCuenta(clientId: number) {
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes/movimientos");
  // El arqueo de la caja y el saldo del selector de venta quedan viejos si no.
  revalidatePath("/caja");
  revalidatePath("/vender");
}

/**
 * Un movimiento en la cuenta de un cliente: cobro de deuda, carga de crédito,
 * cargo manual o ajuste.
 *
 * `requireStore` y no owner, para los cuatro. Cobrar y cargar crédito METEN
 * plata: el cajero del mostrador del torneo tiene que poder. Cargo manual y
 * ajuste no mueven plata pero sí deuda, y el comercio decidió que también los
 * pueda hacer cualquiera de la tienda: queda registrado quién, y el motivo es
 * obligatorio. Ninguno de los dos toca la caja (ver recordAccountAdjustment).
 */
export async function recordClientAccountMovement(input: {
  clientId: number;
  kind: "pago" | "credito" | "cargo" | "ajuste";
  amount: number;
  method?: string;
  note?: string;
}): Promise<{ ok: true; balance: number } | { error: string }> {
  const { id: userId, storeId } = await requireStore();
  if (!(input.amount > 0)) return { error: ERRORES_CUENTA.INVALID_AMOUNT };
  let balance: number;
  try {
    ({ balance } = input.kind === "cargo" || input.kind === "ajuste"
      ? await recordAccountAdjustment(db, {
          storeId,
          clientId: input.clientId,
          kind: input.kind,
          amount: input.amount,
          reason: input.note ?? "",
          userId,
        })
      : await recordAccountMovement(db, {
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
  revalidarCuenta(input.clientId);
  return { ok: true as const, balance };
}

/**
 * Anular un movimiento mal cargado.
 *
 * `requireStore` y no owner: decisión del comercio. Lo puede hacer cualquiera
 * de la tienda porque queda registrado quién lo anuló y por qué, igual que
 * quién lo cargó. Lo que sí protege al arqueo son las reglas del dominio (ver
 * `motivoNoAnulable`), que valen para todos.
 */
export async function voidClientAccountMovementAction(
  movementId: number, reason: string,
): Promise<{ ok: true; balance: number } | { error: string }> {
  const { id: userId, storeId } = await requireStore();
  let res: { clientId: number; balance: number };
  try {
    res = await voidAccountMovement(db, { storeId, movementId, userId, reason });
  } catch (e) {
    const clave = e instanceof Error ? e.message : "";
    return { error: ERRORES_CUENTA[clave] ?? "No se pudo anular el movimiento" };
  }
  revalidarCuenta(res.clientId);
  return { ok: true as const, balance: res.balance };
}
