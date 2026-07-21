/**
 * Fio — CSV export pohybů na účtu příjemce (2900203312) = zdroj historie pro dedup.
 * UTF-8 s BOM, CRLF, oddělovač `;`, hodnoty v uvozovkách, desetinná čárka.
 * Sloupce: Datum;Objem;Měna;Protiúčet;Kód banky;Zpráva pro příjemce;Poznámka;Typ;VS
 *
 * Příchozí řádky (Objem > 0) = už uplatněné náklady.
 * Datum transakce se čte z textu „… ze dne DD.MM.RRRR", částka z Objem.
 */

import { colIndex, dateFromMessage, fingerprint, normAmount, parseCsv, parseCzDate } from '../util.js';
import type { LedgerEntry } from '../types.js';

export function parseHistoryCsv(text: string): LedgerEntry[] {
  const rows = parseCsv(text, ';');
  if (rows.length < 2) return [];

  const header = rows[0];
  const iDate = colIndex(header, 'Datum', 'Date');
  const iAmount = colIndex(header, 'Objem', 'Amount');
  const iMessage = colIndex(header, 'Zpráva pro příjemce', 'Zprava pro prijemce');
  const iNote = colIndex(header, 'Poznámka', 'Poznamka');

  const out: LedgerEntry[] = [];

  for (const r of rows.slice(1)) {
    const amount = normAmount(r[iAmount] ?? '');
    if (!Number.isFinite(amount) || amount <= 0) continue; // jen příchozí = uplatněné

    const message = (r[iMessage] ?? '').trim();
    const note = iNote >= 0 ? (r[iNote] ?? '').trim() : '';

    // Datum transakce je v textu; datum zaúčtování je až záložní varianta.
    const date_txn =
      dateFromMessage(message) ?? dateFromMessage(note) ?? parseCzDate(r[iDate] ?? '');
    if (!date_txn) continue;

    out.push({
      fingerprint: fingerprint(date_txn, amount),
      date_txn,
      amount,
      merchant: message || undefined,
      source: 'history',
    });
  }

  return out;
}
