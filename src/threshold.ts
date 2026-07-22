/**
 * Minimální částka výdaje (Nastavení).
 *
 * „Zabýváme se částkami nad práh" — výdaje z výpisů (Fio/Revolut) pod minimem
 * se předvyplní jako **vypnuté** (`include=false`) s poznámkou; jsou to malé
 * položky, které nemá smysl rozúčtovávat. Řádek se NEMAŽE — uživatel ho může
 * jedním klikem zapnout. Práh je variabilní (posílá se z Nastavení).
 *
 * Netýká se **pravidelných / povinných plateb** (`source === 'pravidelna'`) —
 * ty jsou malé záměrně (Rodinné sledování 50, Kanály navíc 100) a musí zůstat.
 */

import type { LineItem } from './types.js';

/** Výchozí práh, když Nastavení nic nepošle. */
export const DEFAULT_MIN_AMOUNT = 200;

export function applyMinAmount(rows: LineItem[], min: number): LineItem[] {
  if (!Number.isFinite(min) || min <= 0) return rows;

  return rows.map((row) => {
    const fromStatement = row.source === 'fio' || row.source === 'revolut';
    if (!fromStatement || !row.include || row.amount >= min) return row;

    const note = `Pod minimální částkou (${min} Kč) — malá položka; zapni, pokud ji chceš rozúčtovat.`;
    return { ...row, include: false, note: row.note ? `${row.note} ${note}` : note };
  });
}
