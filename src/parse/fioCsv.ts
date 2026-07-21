/**
 * Fio — CSV export „Pohyby na účtu".
 * UTF-8 s BOM, CRLF, oddělovač `;`, hodnoty v uvozovkách, desetinná čárka.
 * Sloupce: Datum;Objem;Měna;Protiúčet;Kód banky;Zpráva pro příjemce;Poznámka;Typ;VS
 *
 * **Znaménko rozhoduje o významu řádku:**
 *   - `Objem < 0` = výdaj → platby kartou a výběry jdou do dávky k rozúčtování,
 *   - `Objem > 0` = příjem → **jen** převody z platebního účtu jsou už uplatněné náklady.
 *
 * Ostatní příjmy (mzda, vratky) se ignorují — kdyby se braly jako historie,
 * mohly by omylem vyřadit legitimní výdaj o shodné částce a datu.
 */

import { buildMsg, colIndex, dateFromMessage, fingerprint, normAmount, parseCsv, parseCzDate } from '../util.js';
import { guessNote } from '../merchantNote.js';
import type { LedgerEntry, LineItem } from '../types.js';

/** Typy pohybů, které jsou výdajem k rozúčtování. */
const EXPENSE_TYPES = /platba kartou|bankomat|v[ýy]b[ěe]r/i;

export interface FioMovements {
  /** Výdaje kartou / výběry (Objem < 0). */
  expenses: LineItem[];
  /** Už uplatněné náklady (příchozí z platebního účtu). */
  history: LedgerEntry[];
}

export interface FioCsvOptions {
  /** Číslo platebního účtu — příchozí platby z něj jsou už uplatněné náklady. */
  accountFrom?: string;
}

export function parseFioMovements(text: string, opts: FioCsvOptions = {}): FioMovements {
  const rows = parseCsv(text, ';');
  const out: FioMovements = { expenses: [], history: [] };
  if (rows.length < 2) return out;

  const header = rows[0];
  const iDate = colIndex(header, 'Datum', 'Date');
  const iAmount = colIndex(header, 'Objem', 'Amount');
  const iCurrency = colIndex(header, 'Měna', 'Mena', 'Currency');
  const iCounter = colIndex(header, 'Protiúčet', 'Protiucet');
  const iMessage = colIndex(header, 'Zpráva pro příjemce', 'Zprava pro prijemce');
  const iNote = colIndex(header, 'Poznámka', 'Poznamka');
  const iType = colIndex(header, 'Typ', 'Type');

  let i = 0;

  for (const r of rows.slice(1)) {
    const amount = normAmount(r[iAmount] ?? '');
    if (!Number.isFinite(amount) || amount === 0) continue;

    const message = (r[iMessage] ?? '').trim();
    const note = iNote >= 0 ? (r[iNote] ?? '').trim() : '';
    const type = iType >= 0 ? (r[iType] ?? '').trim() : '';
    const counter = iCounter >= 0 ? (r[iCounter] ?? '').trim() : '';
    const bookedDate = parseCzDate(r[iDate] ?? '');

    if (amount > 0) {
      // Příjem = uplatněný náklad jen tehdy, když přišel z platebního účtu.
      const fromPaymentAccount = opts.accountFrom ? counter === opts.accountFrom : true;
      if (!fromPaymentAccount) continue;

      // Datum transakce je v textu („… ze dne DD.MM.RRRR"), zaúčtování je záloha.
      const date_txn = dateFromMessage(message) ?? dateFromMessage(note) ?? bookedDate;
      if (!date_txn) continue;

      out.history.push({
        fingerprint: fingerprint(date_txn, amount),
        date_txn,
        amount,
        merchant: message || note || undefined,
        source: 'history',
      });
      continue;
    }

    // Výdaj — bere se jen platba kartou / výběr, ne trvalé příkazy a převody.
    if (!EXPENSE_TYPES.test(type)) continue;
    if (!bookedDate) continue;

    const merchant = note || message;
    const guess = guessNote(merchant, type);
    const value = Math.abs(amount);
    const currency = iCurrency >= 0 ? (r[iCurrency] ?? 'CZK').trim() : 'CZK';

    out.expenses.push({
      id: `fiocsv-${i++}`,
      source: 'fio',
      fingerprint: fingerprint(bookedDate, value),
      status: 'NEW',
      mandatory: false,
      include: true,
      amount: value,
      currency_orig: currency && currency !== 'CZK' ? currency : undefined,
      message: buildMsg({ kategorie: guess.kategorie, poznamka: guess.poznamka, date_txn: bookedDate, merchant }),
      date_txn: bookedDate,
      kategorie: guess.kategorie,
      merchant: merchant || undefined,
    });
  }

  return out;
}

/** Jen historie — používá `/api/ledger/import`. */
export function parseHistoryCsv(text: string, opts: FioCsvOptions = {}): LedgerEntry[] {
  return parseFioMovements(text, opts).history;
}
