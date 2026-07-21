/**
 * Revolut — CSV export (oddělovač `,`, desetinná tečka).
 * Sloupce: Typ · Produkt · Datum zahájení · Datum dokončení · Popis · Částka · Poplatek · Měna · State · Zůstatek
 *
 * Bere se State = DOKONČENO, typy Platba kartou / Výběr z bankomatu, Částka < 0.
 * Kategorii ani poznámku Revolut nemá → doplní je AI vrstva (src/ai.ts).
 */

import {
  asciiFold, buildMsg, colIndex, fingerprint, normAmount, parseCsv, parseIsoDate,
} from '../util.js';
import { guessNote } from '../merchantNote.js';
import type { LineItem } from '../types.js';

const ACCEPTED_TYPES = ['platba kartou', 'vyber z bankomatu', 'card payment', 'atm'];
const DONE = ['dokonceno', 'completed'];

// Porovnáváme klíčová slova, takže „DOKONČENO" musí padnout na „dokonceno".
const norm = (s: string | undefined) => asciiFold(s ?? '').toLowerCase().trim();

export function parseRevolut(text: string): LineItem[] {
  const rows = parseCsv(text, ',');
  if (rows.length < 2) return [];

  const header = rows[0];
  const iType = colIndex(header, 'Typ', 'Type');
  const iDone = colIndex(header, 'Datum dokončení', 'Completed Date');
  const iDesc = colIndex(header, 'Popis', 'Description');
  const iAmount = colIndex(header, 'Částka', 'Amount');
  const iCurrency = colIndex(header, 'Měna', 'Currency');
  const iState = colIndex(header, 'State', 'Stav');

  const out: LineItem[] = [];
  let i = 0;

  for (const r of rows.slice(1)) {
    if (iState >= 0 && !DONE.includes(norm(r[iState]))) continue;
    if (iType >= 0 && !ACCEPTED_TYPES.some((t) => norm(r[iType]).startsWith(t))) continue;

    const signed = normAmount(r[iAmount] ?? '');
    if (!Number.isFinite(signed) || signed >= 0) continue; // kladné = příchozí, ne výdaj

    const date_txn = parseIsoDate(r[iDone] ?? '');
    if (!date_txn) continue;

    const amount = Math.abs(signed);
    const currency = (r[iCurrency] ?? 'CZK').trim();
    const merchant = (r[iDesc] ?? '').trim();

    // Revolut nemá kategorii ani poznámku — odhadneme je z obchodníka,
    // ať ve zprávě není u čerpačky i parkoviště shodně „nákup".
    const guess = guessNote(merchant, r[iType]);

    const item: LineItem = {
      id: `rev-${i++}`,
      source: 'revolut',
      fingerprint: fingerprint(date_txn, amount),
      status: 'NEW',
      mandatory: false,
      include: true,
      amount,
      message: buildMsg({ kategorie: guess.kategorie, poznamka: guess.poznamka, date_txn, merchant }),
      date_txn,
      kategorie: guess.kategorie,
      merchant,
    };

    // Vícemenovost: do banky jde CZK. Cizoměnový řádek nese částku v původní měně,
    // takže se defaultně vyřadí — uživatel doplní CZK ekvivalent, který reálně padl.
    if (currency && currency !== 'CZK') {
      item.currency_orig = currency;
      item.include = false;
      item.note = `Cizí měna (${currency}) — doplň CZK ekvivalent, který reálně padl, a zapni řádek.`;
    }

    out.push(item);
  }

  return out;
}
