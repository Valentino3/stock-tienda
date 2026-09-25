import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  clients, clientAccountMovements, cashSessions, sales, saleItems, productVariants, products, user,
  type Client,
} from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Segunda vuelta sobre `user`: quien anuló un movimiento, al lado de quien lo
// anotó.
const anulador = alias(user, "anulador");

// Saldo = Σcargo − Σpago − Σanulación − Σcrédito − Σajuste, solo lo NO anulado.
//   positivo = el cliente debe;  negativo = tiene saldo A FAVOR.
// `cargo` suma; todo lo demás resta, y por eso cae en el else. Un crédito
// cargado por adelantado entra acá sin código extra, y una venta a cuenta
// posterior lo consume sola.
//
// El anulado se descarta DENTRO del CASE y no con un WHERE: `listClientsWithBalance`
// hace leftJoin, y un `WHERE voided = false` sacaría de la lista a los
// clientes sin movimientos (ahí `voided` es NULL).
const balanceExpr = sql<number>`coalesce(sum(case when ${clientAccountMovements.voided} then 0 when ${clientAccountMovements.type} = 'cargo' then ${clientAccountMovements.amount} else -${clientAccountMovements.amount} end), 0)`;

/** Datos fiscales del cliente. Todos opcionales: ver el comentario en schema.ts. */
export type DatosFiscalesCliente = {
  docTipo?: number | null;
  docNro?: string | null;
  condicionIva?: number | null;
  razonSocial?: string | null;
  domicilio?: string | null;
  /** Para mandarle el comprobante. No es un dato fiscal, viaja con ellos. */
  email?: string | null;
};

export async function createClient(
  db: any,
  input: { storeId: number; name: string; phone?: string | null; note?: string | null } & DatosFiscalesCliente
): Promise<Client> {
  if (!input.name.trim()) throw new Error("EMPTY_NAME");
  const [row] = await db.insert(clients).values({
    storeId: input.storeId,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    note: input.note?.trim() || null,
    docTipo: input.docTipo ?? null,
    docNro: input.docNro?.trim() || null,
    condicionIva: input.condicionIva ?? null,
    razonSocial: input.razonSocial?.trim() || null,
    domicilio: input.domicilio?.trim() || null,
  }).returning();
  return row;
}

/**
 * Actualiza SOLO los datos fiscales de un cliente. Separado de createClient
 * porque la carga fiscal cae sobre el dueño, después, y no sobre el cajero con
 * cola en el mostrador.
 */
export async function updateDatosFiscales(
  db: any,
  input: { storeId: number; clientId: number } & DatosFiscalesCliente
): Promise<Client> {
  const [row] = await db.update(clients).set({
    docTipo: input.docTipo ?? null,
    docNro: input.docNro?.trim() || null,
    condicionIva: input.condicionIva ?? null,
    razonSocial: input.razonSocial?.trim() || null,
    domicilio: input.domicilio?.trim() || null,
    email: input.email?.trim() || null,
  }).where(and(eq(clients.id, input.clientId), eq(clients.storeId, input.storeId))).returning();
  if (!row) throw new Error("CLIENT_NOT_FOUND");
  return row;
}

export async function listClientsWithBalance(db: any, storeId: number) {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phone,
      active: clients.active,
      balance: balanceExpr.mapWith(Number),
    })
    .from(clients)
    .leftJoin(clientAccountMovements, eq(clientAccountMovements.clientId, clients.id))
    .where(eq(clients.storeId, storeId))
    .groupBy(clients.id)
    .orderBy(clients.name);
}

export async function getClient(db: any, storeId: number, id: number): Promise<Client | null> {
  const [row] = await db.select().from(clients)
    .where(and(eq(clients.id, id), eq(clients.storeId, storeId)));
  return row ?? null;
}

export async function getClientBalance(db: any, storeId: number, clientId: number): Promise<number> {
  const [row] = await db
    .select({ balance: balanceExpr.mapWith(Number) })
    .from(clientAccountMovements)
    .where(and(eq(clientAccountMovements.storeId, storeId), eq(clientAccountMovements.clientId, clientId)));
  return round2(row?.balance ?? 0);
}

export type LedgerItem = {
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

export type LedgerSale = {
  id: number;
  createdAt: Date;
  discountAmount: number;
  voided: boolean;
  sellerName: string | null;
  items: LedgerItem[];
};

export type MovementType = "cargo" | "pago" | "anulacion" | "credito" | "ajuste";

export type LedgerEntry = {
  id: number;
  type: MovementType;
  amount: number;
  createdAt: Date;
  method: string | null;
  note: string | null;
  createdByName: string | null;
  /** La venta que originó el cargo. null en pagos y en cargos manuales. */
  sale: LedgerSale | null;
  /**
   * Saldo del cliente después de aplicar este movimiento. En un anulado es el
   * mismo que dejó el anterior: está en la lista pero no aporta.
   */
  balanceAfter: number;
  voided: boolean;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidedReason: string | null;
  /** Si se le puede ofrecer el botón Anular. Ver `motivoNoAnulable`. */
  anulable: boolean;
};

/**
 * Cuenta corriente completa del cliente: cada movimiento con el saldo que dejó,
 * y para los cargos, la venta que los originó con su detalle de productos.
 *
 * Responde "¿de qué está hecha esta deuda?", que el número agregado de la lista
 * de clientes no contesta. Devuelto del más nuevo al más viejo (orden de
 * lectura), pero el saldo corrido se calcula del más viejo al más nuevo.
 *
 * Solo aparecen ventas a cuenta: son las únicas que quedan asociadas a un
 * cliente. Una venta pagada en efectivo no registra a quién se le vendió.
 */
export async function getClientLedger(
  db: any,
  storeId: number,
  clientId: number
): Promise<LedgerEntry[]> {
  // El `db` del dominio es `any` (ver src/db/index.ts), así que los selects
  // vuelven sin tipo; estas anotaciones les devuelven la forma.
  type MovementRow = {
    id: number;
    type: MovementType;
    amount: number;
    createdAt: Date;
    method: string | null;
    note: string | null;
    saleId: number | null;
    createdByName: string | null;
    voided: boolean;
    voidedAt: Date | null;
    voidedByName: string | null;
    voidedReason: string | null;
    cashSessionId: number | null;
    cajaCerradaEn: Date | null;
  };
  type SaleRow = {
    id: number;
    createdAt: Date;
    discountAmount: number;
    voided: boolean;
    sellerName: string | null;
  };
  type ItemRow = LedgerItem & { saleId: number };

  const movements: MovementRow[] = await db
    .select({
      id: clientAccountMovements.id,
      type: clientAccountMovements.type,
      amount: clientAccountMovements.amount,
      createdAt: clientAccountMovements.createdAt,
      method: clientAccountMovements.method,
      note: clientAccountMovements.note,
      saleId: clientAccountMovements.saleId,
      createdByName: user.name,
      voided: clientAccountMovements.voided,
      voidedAt: clientAccountMovements.voidedAt,
      voidedByName: anulador.name,
      voidedReason: clientAccountMovements.voidedReason,
      cashSessionId: clientAccountMovements.cashSessionId,
      cajaCerradaEn: cashSessions.closedAt,
    })
    .from(clientAccountMovements)
    .leftJoin(user, eq(clientAccountMovements.createdBy, user.id))
    .leftJoin(anulador, eq(clientAccountMovements.voidedBy, anulador.id))
    .leftJoin(cashSessions, eq(clientAccountMovements.cashSessionId, cashSessions.id))
    .where(and(
      eq(clientAccountMovements.storeId, storeId),
      eq(clientAccountMovements.clientId, clientId),
    ))
    // Asc para poder acumular el saldo; se invierte al final.
    .orderBy(asc(clientAccountMovements.createdAt), asc(clientAccountMovements.id));

  if (movements.length === 0) return [];

  const saleIds: number[] = [
    ...new Set(movements.map((m) => m.saleId).filter((id): id is number => id != null)),
  ];

  // Dos queries fijas para todas las ventas de la página, no una por movimiento.
  const [saleRows, itemRows]: [SaleRow[], ItemRow[]] = await Promise.all([
    saleIds.length
      ? db.select({
          id: sales.id,
          createdAt: sales.createdAt,
          discountAmount: sales.discountAmount,
          voided: sales.voided,
          sellerName: user.name,
        })
        .from(sales)
        .leftJoin(user, eq(sales.sellerId, user.id))
        .where(and(eq(sales.storeId, storeId), inArray(sales.id, saleIds)))
      : [],
    saleIds.length
      ? db.select({
          saleId: saleItems.saleId,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          discountAmount: saleItems.discountAmount,
          productName: products.name,
          variantName: productVariants.name,
        })
        .from(saleItems)
        .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
        .orderBy(asc(saleItems.id))
      : [],
  ]);

  const itemsBySale = new Map<number, LedgerItem[]>();
  for (const it of itemRows) {
    const list = itemsBySale.get(it.saleId) ?? [];
    list.push({
      productName: it.productName,
      variantName: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountAmount: it.discountAmount,
    });
    itemsBySale.set(it.saleId, list);
  }

  const saleById = new Map<number, LedgerSale>(
    saleRows.map((s) => [s.id, {
      id: s.id,
      createdAt: s.createdAt,
      discountAmount: s.discountAmount,
      voided: s.voided,
      sellerName: s.sellerName,
      items: itemsBySale.get(s.id) ?? [],
    }])
  );

  let running = 0;
  const entries: LedgerEntry[] = movements.map((m) => {
    // El anulado queda en su lugar, en orden, pero no mueve el saldo. Así
    // `ledger[0].balanceAfter` sigue siendo el saldo aunque lo último que se
    // hizo haya sido anular.
    if (!m.voided) running = round2(running + (m.type === "cargo" ? m.amount : -m.amount));
    return {
      id: m.id,
      type: m.type,
      amount: m.amount,
      createdAt: m.createdAt,
      method: m.method,
      note: m.note,
      createdByName: m.createdByName,
      sale: m.saleId != null ? saleById.get(m.saleId) ?? null : null,
      balanceAfter: running,
      voided: m.voided,
      voidedAt: m.voidedAt ?? null,
      voidedByName: m.voidedByName ?? null,
      voidedReason: m.voidedReason ?? null,
      anulable: motivoNoAnulable(m, m.cajaCerradaEn != null) == null,
    };
  });

  return entries.reverse();
}

/** Totales de la relación comercial, para el encabezado del detalle. */
export async function getClientSummary(db: any, storeId: number, clientId: number) {
  const [row] = await db
    .select({
      // Cargos de VENTA y cargos manuales por separado: "Total comprado" no
      // puede incluir una deuda de la libreta que no fue una compra acá.
      charged: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'cargo' and ${clientAccountMovements.saleId} is not null then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      manualCharged: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'cargo' and ${clientAccountMovements.saleId} is null then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      // Deuda que bajó SIN plata. Aparte de `paid` por la misma razón que el
      // crédito: "Total pagado" no puede incluir plata que nunca entró.
      adjusted: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'ajuste' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      paid: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'pago' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      // Las anulaciones se cuentan aparte: si se sumaran a `paid` el historial
      // mostraría plata que nunca entró, y si se ignoraran el saldo no cerraría.
      voided: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'anulacion' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      // Plata que el cliente dejo por adelantado. Va aparte de `paid` porque no
      // cancela ninguna deuda: sumarla ahi diria que pago algo que nunca debio.
      credited: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'credito' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      purchases: sql<number>`count(*) filter (where ${clientAccountMovements.type} = 'cargo' and ${clientAccountMovements.saleId} is not null) - count(*) filter (where ${clientAccountMovements.type} = 'anulacion')`.mapWith(Number),
      // Un max() agregado no pasa por el mapeo de columna del driver: Neon
      // devuelve Date y PGlite string. Se normaliza abajo.
      lastMovementAt: sql<string | Date | null>`max(${clientAccountMovements.createdAt})`,
    })
    .from(clientAccountMovements)
    .where(and(
      eq(clientAccountMovements.storeId, storeId),
      eq(clientAccountMovements.clientId, clientId),
      // Acá sí va en el WHERE: no hay leftJoin que pueda perder al cliente.
      eq(clientAccountMovements.voided, false),
    ));

  const charged = round2(row?.charged ?? 0);
  const manualCharged = round2(row?.manualCharged ?? 0);
  const paid = round2(row?.paid ?? 0);
  const voided = round2(row?.voided ?? 0);
  const credited = round2(row?.credited ?? 0);
  const adjusted = round2(row?.adjusted ?? 0);
  const last = row?.lastMovementAt ?? null;
  return {
    /** Comprado neto: lo cargado por ventas menos lo que se anuló. */
    charged: round2(charged - voided),
    /** Cargos manuales: deuda que no salió de una venta. */
    manualCharged,
    paid,
    voided,
    purchases: row?.purchases ?? 0,
    credited,
    /** Ajustes: deuda que bajó sin que entrara plata. */
    adjusted,
    // ⚠️ Tiene que dar EXACTAMENTE lo mismo que `balanceExpr`. Son dos cuentas
    // distintas —una en SQL, otra en JS— y si divergen, /clientes y
    // /clientes/[id] muestran dos saldos distintos para el mismo cliente.
    balance: round2(charged + manualCharged - paid - voided - credited - adjusted),
    lastMovementAt: last ? new Date(last) : null,
  };
}

/** Cobro de una deuda, o carga de crédito por adelantado. */
export type ClientAccountKind = "pago" | "credito";

/** Con qué puede entrar plata a una cuenta. "cuenta" no: sería fiar un pago. */
const MEDIOS_DE_COBRO: readonly string[] = ["efectivo", "transferencia", "tarjeta"] as const;

/**
 * 🔴 CAMINO DE PLATA. Registra un movimiento de cuenta corriente que resta del
 * saldo, y —si entró en efectivo— lo imputa a la caja abierta.
 *
 * Antes el medio de pago era informativo y NADA de esto entraba al arqueo. Eso
 * ya era un bug: cobrarle 5.000 de fiado a un cliente en efectivo dejaba el
 * cajón con plata que el esperado no explicaba, y el cierre marcaba una
 * diferencia positiva que en realidad estaba bien.
 *
 * Reglas, y la asimetría es a propósito:
 *   - En EFECTIVO exige caja abierta y se ata a ella por FK. Es plata física.
 *   - Por transferencia o tarjeta NO la exige: una transferencia puede entrar a
 *     las once de la noche con la caja cerrada, y rechazarla sería inventar una
 *     restricción que el negocio no tiene.
 *
 * El lock sobre la sesión no es decorativo: sin él, el cajero cobra mientras
 * otro dispositivo cierra la caja, el movimiento aterriza en una sesión ya
 * cerrada y el `expectedCash` congelado no lo contempla. La plata queda en el
 * cajón y el descuadre aparece recién en la hoja impresa.
 */
export async function recordAccountMovement(
  db: any,
  input: {
    storeId: number; clientId: number; kind: ClientAccountKind; amount: number;
    method?: string | null; note?: string | null; userId: string;
  }
): Promise<{ movementId: number; balance: number }> {
  if (!(input.amount > 0)) throw new Error("INVALID_AMOUNT");
  // Validado acá y no solo en el <select>: un "cuenta" o un medio inventado
  // llegaría al enum de la base. `null` sigue valiendo, como "sin medio".
  if (input.method != null && !MEDIOS_DE_COBRO.includes(input.method)) throw new Error("INVALID_METHOD");
  // El cliente se valida ANTES que la caja: sin este orden, cobrarle a un
  // cliente de otra tienda sin caja abierta devolvería NO_OPEN_SESSION, que es
  // el menos informativo de los dos errores.
  const client = await getClient(db, input.storeId, input.clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  const enEfectivo = input.method === "efectivo";

  return db.transaction(async (tx: any) => {
    let cashSessionId: number | null = null;
    if (enEfectivo) {
      const [abierta] = await tx.select().from(cashSessions)
        .where(and(eq(cashSessions.storeId, input.storeId), isNull(cashSessions.closedAt)))
        .limit(1)
        .for("update");
      if (!abierta) throw new Error("NO_OPEN_SESSION");
      cashSessionId = abierta.id;
    }

    const [mov] = await tx.insert(clientAccountMovements).values({
      storeId: input.storeId,
      clientId: input.clientId,
      type: input.kind,
      amount: round2(input.amount),
      // Ya validado contra MEDIOS_DE_COBRO arriba.
      method: (input.method ?? null) as "efectivo" | "transferencia" | "tarjeta" | null,
      cashSessionId,
      note: input.note?.trim() || null,
      createdBy: input.userId,
    }).returning({ id: clientAccountMovements.id });

    // El saldo resultante viaja de vuelta para el aviso honesto ("le quedan
    // 15.000 a favor") sin una consulta extra desde la UI.
    const [row] = await tx
      .select({ balance: balanceExpr.mapWith(Number) })
      .from(clientAccountMovements)
      .where(and(
        eq(clientAccountMovements.storeId, input.storeId),
        eq(clientAccountMovements.clientId, input.clientId),
      ));

    return { movementId: mov.id, balance: round2(row?.balance ?? 0) };
  });
}

/** Mínimo de un motivo, ya recortado. Evita el "." y el "asd". */
export const MOTIVO_MIN = 3;

/** Lo que mueve el saldo sin que entre ni salga plata. */
export type ClientAdjustmentKind = "cargo" | "ajuste";

/**
 * 🔴 CAMINO DE PLATA. Suma o resta deuda sin que se mueva plata.
 *
 *   - `cargo`: un cargo manual. Una deuda de la libreta de antes del sistema,
 *     algo que se llevó sin pasar por la caja.
 *   - `ajuste`: baja la deuda sin cobro. Un descuento, una deuda que se
 *     perdona. Sin tope a propósito: si deja al cliente con saldo a favor, es
 *     una decisión del comercio, y queda con quién la tomó y por qué.
 *
 * Función aparte de `recordAccountMovement` y no un `kind` más de aquella: así
 * ninguno de los dos puede terminar atado a una caja. No hay medio, no hay
 * `cashSessionId`, no se lee ni se bloquea la caja. Si entrara al arqueo, un
 * ajuste "en efectivo" haría aparecer plata que no está en el cajón.
 *
 * El motivo es obligatorio por lo mismo que en una anulación: es lo único que
 * va a explicar, dentro de tres meses, por qué cambió esa deuda.
 */
export async function recordAccountAdjustment(
  db: any,
  input: { storeId: number; clientId: number; kind: ClientAdjustmentKind; amount: number; reason: string; userId: string },
): Promise<{ movementId: number; balance: number }> {
  if (!(input.amount > 0)) throw new Error("INVALID_AMOUNT");
  if (input.kind !== "cargo" && input.kind !== "ajuste") throw new Error("INVALID_KIND");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < MOTIVO_MIN) throw new Error("MOTIVO_REQUIRED");
  const client = await getClient(db, input.storeId, input.clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  return db.transaction(async (tx: any) => {
    const [mov] = await tx.insert(clientAccountMovements).values({
      storeId: input.storeId,
      clientId: input.clientId,
      type: input.kind,
      amount: round2(input.amount),
      saleId: null,
      method: null,
      cashSessionId: null,
      note: reason,
      createdBy: input.userId,
    }).returning({ id: clientAccountMovements.id });

    const [row] = await tx
      .select({ balance: balanceExpr.mapWith(Number) })
      .from(clientAccountMovements)
      .where(and(eq(clientAccountMovements.storeId, input.storeId), eq(clientAccountMovements.clientId, input.clientId)));
    return { movementId: mov.id, balance: round2(row?.balance ?? 0) };
  });
}

export type MotivoNoAnulable =
  | "ALREADY_VOIDED"
  | "ANULACION_NOT_VOIDABLE"
  | "SALE_CHARGE_NOT_VOIDABLE"
  | "CASH_SESSION_CLOSED";

/**
 * Por qué un movimiento NO se puede anular, o `null` si se puede.
 *
 * Pura y compartida: la usa el ledger para decidir si muestra el botón y
 * `voidAccountMovement` para rechazar. Si fueran dos reglas, el botón podría
 * ofrecer algo que el servidor rechaza, o al revés.
 *
 *   - El cargo de una VENTA no se anula suelto: se anula la venta, que además
 *     devuelve el stock y emite la nota de crédito. Anular solo el cargo
 *     dejaría una venta viva que el cliente ya no debe.
 *   - La `anulacion` es la reversión automática de una venta anulada. Anularla
 *     resucitaría una deuda de una venta que no existe.
 *   - Un cobro en efectivo de una caja YA CERRADA no se toca: su plata está en
 *     un arqueo firmado, y anularlo cambiaría el esperado de un cierre que ya
 *     se contó. Se corrige con un cargo manual, que no toca ninguna caja.
 */
export function motivoNoAnulable(
  m: { type: MovementType; saleId: number | null; cashSessionId: number | null; voided: boolean },
  cajaCerrada: boolean,
): MotivoNoAnulable | null {
  if (m.voided) return "ALREADY_VOIDED";
  if (m.type === "anulacion") return "ANULACION_NOT_VOIDABLE";
  if (m.type === "cargo" && m.saleId != null) return "SALE_CHARGE_NOT_VOIDABLE";
  if (m.cashSessionId != null && cajaCerrada) return "CASH_SESSION_CLOSED";
  return null;
}

/**
 * 🔴 CAMINO DE PLATA. Anula un movimiento de cuenta corriente mal cargado.
 *
 * No lo borra ni lo edita: lo marca, con quién, cuándo y por qué, y deja de
 * contar en el saldo y en la caja (ver `balanceExpr` y `efectivoDeCuentaEnCaja`).
 *
 * Locks, en este orden: la fila del movimiento y después su caja.
 * `closeCashSession` toma la caja y lee los movimientos SIN lock, así que no
 * hay ciclo. Si el cierre gana, esto ve `closedAt` y rechaza; si gana esto, el
 * cierre ya no lo suma. En ningún orden una caja cerrada cambia de número.
 */
export async function voidAccountMovement(
  db: any,
  input: { storeId: number; movementId: number; userId: string; reason: string },
): Promise<{ clientId: number; balance: number }> {
  // En el dominio y no solo en el diálogo: si la guarda viviera en la UI, la
  // server action sería un bypass.
  const reason = input.reason?.trim() ?? "";
  if (reason.length < MOTIVO_MIN) throw new Error("VOID_REASON_REQUIRED");

  return db.transaction(async (tx: any) => {
    // Scope por tienda: los ids son secuenciales.
    const [mov] = await tx.select().from(clientAccountMovements)
      .where(and(eq(clientAccountMovements.id, input.movementId), eq(clientAccountMovements.storeId, input.storeId)))
      .for("update");
    if (!mov) throw new Error("MOVEMENT_NOT_FOUND");

    let cajaCerrada = false;
    if (mov.cashSessionId != null) {
      const [caja] = await tx.select({ closedAt: cashSessions.closedAt }).from(cashSessions)
        .where(and(eq(cashSessions.id, mov.cashSessionId), eq(cashSessions.storeId, input.storeId)))
        .for("update");
      cajaCerrada = !caja || caja.closedAt != null;
    }

    const motivo = motivoNoAnulable(mov, cajaCerrada);
    if (motivo) throw new Error(motivo);

    // `voided = false` en el WHERE, igual que voidSale: dos anulaciones
    // simultáneas del mismo movimiento dejan pasar una sola.
    const [anulado] = await tx.update(clientAccountMovements)
      .set({ voided: true, voidedAt: new Date(), voidedBy: input.userId, voidedReason: reason })
      .where(and(
        eq(clientAccountMovements.id, mov.id),
        eq(clientAccountMovements.storeId, input.storeId),
        eq(clientAccountMovements.voided, false),
      ))
      .returning({ id: clientAccountMovements.id });
    if (!anulado) throw new Error("ALREADY_VOIDED");

    const [row] = await tx
      .select({ balance: balanceExpr.mapWith(Number) })
      .from(clientAccountMovements)
      .where(and(eq(clientAccountMovements.storeId, input.storeId), eq(clientAccountMovements.clientId, mov.clientId)));
    return { clientId: mov.clientId, balance: round2(row?.balance ?? 0) };
  });
}

/**
 * Cobro de deuda. Envoltorio, para no tocar los llamados que ya existen.
 */
export async function recordPayment(
  db: any,
  input: { storeId: number; clientId: number; amount: number; method?: string | null; note?: string | null; userId: string }
): Promise<void> {
  await recordAccountMovement(db, { ...input, kind: "pago" });
}
