/**
 * Mobbex operation status codes → what TABA may do with them.
 *
 * Source: https://mobbex.dev/codigos-de-estado (table read on 2026-11-03).
 *
 * The table is copied code by code, never inferred. The classification is
 * deliberately conservative because it decides when money counts as received:
 *
 *   - Only codes whose documented meaning is "paid / credited / settled" are
 *     `approved`. Everything the documentation does not explain (201 "Aceptada",
 *     800 "Lista", 4 "Entregada", 0 "Sin Estado", 603 "Desconocida") is
 *     `unknown`, which can never approve a purchase: the ledger sends it to
 *     manual review instead of guessing.
 *   - `3` "Autorizada" is a card authorization that still has to be captured
 *     (per the docs). Authorized is not money: it never finalizes an order.
 *   - Mobbex documents NO chargeback / dispute code. A chargeback therefore
 *     surfaces, if at all, as a previously paid operation moving to a
 *     different code. The ledger treats any such regression as a reversal that
 *     needs a person (see `mobbex_record_provider_snapshot`).
 */

export type MobbexStatusClass =
  | 'approved'
  | 'authorized'
  | 'pending'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'reversing'
  | 'refunded'
  | 'partially_refunded'
  | 'unknown';

export interface MobbexStatus {
  /** The code exactly as the provider sent it (a string such as "200"). */
  code: string;
  statusClass: MobbexStatusClass;
  /** True when this code means money has reached, or has been returned from, the account. */
  moneyMoved: boolean;
  /** Spanish label of the official table, for operator screens. */
  label: string;
}

const TABLE: Record<string, { statusClass: MobbexStatusClass; label: string }> = {
  '0': { statusClass: 'unknown', label: 'Sin Estado' },
  '1': { statusClass: 'pending', label: 'Pendiente' },
  '2': { statusClass: 'pending', label: 'En Espera' },
  '3': { statusClass: 'authorized', label: 'Autorizada' },
  '4': { statusClass: 'unknown', label: 'Entregada' },
  '100': { statusClass: 'pending', label: 'En Revisión' },
  '200': { statusClass: 'approved', label: 'Paga' },
  '201': { statusClass: 'unknown', label: 'Aceptada' },
  '210': { statusClass: 'pending', label: 'Retenida' },
  '299': { statusClass: 'pending', label: 'Liquidación en Progreso' },
  '300': { statusClass: 'approved', label: 'Acreditado' },
  '301': { statusClass: 'approved', label: 'Liquidado' },
  '302': { statusClass: 'approved', label: 'Conciliada' },
  '303': { statusClass: 'pending', label: 'Liberación Retenida' },
  '400': { statusClass: 'rejected', label: 'Declinada' },
  '401': { statusClass: 'expired', label: 'Expirada' },
  '402': { statusClass: 'expired', label: 'Abandonada' },
  '403': { statusClass: 'rejected', label: 'Fallida' },
  '410': { statusClass: 'rejected', label: 'Denegada: Fondos insuficientes' },
  '411': { statusClass: 'rejected', label: 'Denegada: Autorización Requerida' },
  '412': { statusClass: 'rejected', label: 'Denegada: Comercio Inválido' },
  '413': { statusClass: 'rejected', label: 'Denegada: Tarjeta Inválida' },
  '414': { statusClass: 'rejected', label: 'Denegada: Problema en la Red' },
  '415': { statusClass: 'rejected', label: 'Denegada: Método de Pago Inválido' },
  '416': { statusClass: 'rejected', label: 'Denegada: Operación Inválida' },
  '417': { statusClass: 'rejected', label: 'Denegada: Tarjeta no vigente o vencida' },
  '418': { statusClass: 'rejected', label: 'Denegada, No Autorizada' },
  '419': { statusClass: 'rejected', label: 'Denegada' },
  '500': { statusClass: 'rejected', label: 'Error' },
  '600': { statusClass: 'reversing', label: 'Cancelación en proceso' },
  '601': { statusClass: 'cancelled', label: 'Cancelada' },
  '602': { statusClass: 'refunded', label: 'Devuelta' },
  '603': { statusClass: 'unknown', label: 'Desconocida' },
  '604': { statusClass: 'rejected', label: 'Transacción Denegada' },
  '605': { statusClass: 'partially_refunded', label: 'Parcialmente Devuelta' },
  '610': { statusClass: 'cancelled', label: 'Cancelada por Operatoria inválida' },
  '800': { statusClass: 'unknown', label: 'Lista' },
};

const MONEY_CLASSES = new Set<MobbexStatusClass>(['approved', 'refunded', 'partially_refunded']);

/** Accepts the code as a number or a string; anything else is `unknown` (fail closed). */
export function classifyMobbexStatus(code: unknown): MobbexStatus {
  const text = typeof code === 'number' && Number.isInteger(code)
    ? String(code)
    : typeof code === 'string' ? code.trim() : '';
  const entry = /^[0-9]{1,4}$/.test(text) ? TABLE[text] : undefined;
  if (!entry) return { code: text.slice(0, 16), statusClass: 'unknown', moneyMoved: false, label: 'Estado no documentado' };
  return { code: text, statusClass: entry.statusClass, moneyMoved: MONEY_CLASSES.has(entry.statusClass), label: entry.label };
}

/** The documented table, exposed for the contract test that pins it to the official page. */
export function documentedMobbexStatusCodes(): readonly string[] {
  return Object.keys(TABLE);
}
