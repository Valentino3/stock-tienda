import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  clients, clientAccountMovements, cashSessions, sales, saleItems, productVariants, products, user,
  type Client,
} from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Saldo = Σcargo − Σpago − Σanulación − Σcrédito.
//   positivo = el cliente debe;  negativo = tiene saldo A FAVOR.
// `cargo` suma; los otros tres restan, y por eso caen todos en el else. Un
// crédito cargado por adelantado entra acá sin código extra, y una venta a
// cuenta posterior lo consume sola.
const balanceExpr = sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'cargo' then ${clientAccountMovements.amount} else -${clientAccountMovements.amount} end), 0)`;

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

export type MovementType = "cargo" | "pago" | "anulacion" | "credito";

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
  /** Saldo del cliente después de aplicar este movimiento. */
  balanceAfter: number;
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
    })
    .from(clientAccountMovements)
    .leftJoin(user, eq(clientAccountMovements.createdBy, user.id))
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
    running = round2(running + (m.type === "cargo" ? m.amount : -m.amount));
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
    };
  });

  return entries.reverse();
}

/** Totales de la relación comercial, para el encabezado del detalle. */
export async function getClientSummary(db: any, storeId: number, clientId: number) {
  const [row] = await db
    .select({
      charged: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'cargo' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      paid: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'pago' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      // Las anulaciones se cuentan aparte: si se sumaran a `paid` el historial
      // mostraría plata que nunca entró, y si se ignoraran el saldo no cerraría.
      voided: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'anulacion' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      // Plata que el cliente dejo por adelantado. Va aparte de `paid` porque no
      // cancela ninguna deuda: sumarla ahi diria que pago algo que nunca debio.
      credited: sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'credito' then ${clientAccountMovements.amount} else 0 end), 0)`.mapWith(Number),
      purchases: sql<number>`count(*) filter (where ${clientAccountMovements.type} = 'cargo') - count(*) filter (where ${clientAccountMovements.type} = 'anulacion')`.mapWith(Number),
      // Un max() agregado no pasa por el mapeo de columna del driver: Neon
      // devuelve Date y PGlite string. Se normaliza abajo.
      lastMovementAt: sql<string | Date | null>`max(${clientAccountMovements.createdAt})`,
    })
    .from(clientAccountMovements)
    .where(and(
      eq(clientAccountMovements.storeId, storeId),
      eq(clientAccountMovements.clientId, clientId),
    ));

  const charged = round2(row?.charged ?? 0);
  const paid = round2(row?.paid ?? 0);
  const voided = round2(row?.voided ?? 0);
  const credited = round2(row?.credited ?? 0);
  const last = row?.lastMovementAt ?? null;
  return {
    /** Comprado neto: lo cargado menos lo que se anuló. */
    charged: round2(charged - voided),
    paid,
    voided,
    purchases: row?.purchases ?? 0,
    credited,
    // ⚠️ Tiene que dar EXACTAMENTE lo mismo que `balanceExpr`. Son dos cuentas
    // distintas —una en SQL, otra en JS— y si divergen, /clientes y
    // /clientes/[id] muestran dos saldos distintos para el mismo cliente.
    balance: round2(charged - paid - voided - credited),
    lastMovementAt: last ? new Date(last) : null,
  };
}

/** Cobro de una deuda, o carga de crédito por adelantado. */
export type ClientAccountKind = "pago" | "credito";

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
      method: (input.method as any) ?? null,
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

/**
 * Cobro de deuda. Envoltorio, para no tocar los llamados que ya existen.
 */
export async function recordPayment(
  db: any,
  input: { storeId: number; clientId: number; amount: number; method?: string | null; note?: string | null; userId: string }
): Promise<void> {
  await recordAccountMovement(db, { ...input, kind: "pago" });
}
