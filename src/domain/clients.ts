import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  clients, clientAccountMovements, sales, saleItems, productVariants, products, user,
  type Client,
} from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Saldo = Σcargo − Σpago − Σanulación (positivo = el cliente debe).
// `cargo` suma; `pago` y `anulacion` restan, y por eso caen las dos en el else.
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

export async function getClientMovements(db: any, storeId: number, clientId: number) {
  return db.select().from(clientAccountMovements)
    .where(and(eq(clientAccountMovements.storeId, storeId), eq(clientAccountMovements.clientId, clientId)))
    .orderBy(desc(clientAccountMovements.createdAt));
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

export type MovementType = "cargo" | "pago" | "anulacion";

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
  const last = row?.lastMovementAt ?? null;
  return {
    /** Comprado neto: lo cargado menos lo que se anuló. */
    charged: round2(charged - voided),
    paid,
    voided,
    purchases: row?.purchases ?? 0,
    balance: round2(charged - paid - voided),
    lastMovementAt: last ? new Date(last) : null,
  };
}

// Registra un pago del cliente (baja la deuda). El medio (efectivo/etc.) es
// informativo — NO entra a la caja en este alcance (ver plan, follow-up).
export async function recordPayment(
  db: any,
  input: { storeId: number; clientId: number; amount: number; method?: string | null; note?: string | null; userId: string }
): Promise<void> {
  if (!(input.amount > 0)) throw new Error("INVALID_AMOUNT");
  const client = await getClient(db, input.storeId, input.clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  await db.insert(clientAccountMovements).values({
    storeId: input.storeId,
    clientId: input.clientId,
    type: "pago",
    amount: round2(input.amount),
    method: (input.method as any) ?? null,
    note: input.note?.trim() || null,
    createdBy: input.userId,
  });
}
