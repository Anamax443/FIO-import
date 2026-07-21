/**
 * Minulé přijaté XML — dvojí užití (docs/SPEC.md §7b, §8):
 *   1. ledger  — všechny řádky = už uplatněné náklady,
 *   2. carry-over — částky pravidelných plateb (přetrvají zálohy).
 *
 * Formát je náš vlastní výstup, takže stačí regex; DOMParser ve Workers není.
 */

import { dateFromMessage, fingerprint, normAmount } from '../util.js';
import type { LedgerEntry } from '../types.js';

export interface PrevTransaction {
  amount: number;
  message: string;
  date?: string;
}

const TXN_RE = /<DomesticTransaction>([\s\S]*?)<\/DomesticTransaction>/g;

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? unescapeXml(m[1].trim()) : undefined;
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function parsePrevXml(xml: string): PrevTransaction[] {
  const out: PrevTransaction[] = [];
  for (const m of xml.matchAll(TXN_RE)) {
    const block = m[1];
    const amount = normAmount(tag(block, 'amount') ?? '');
    const message = tag(block, 'comment') ?? tag(block, 'messageForRecipient') ?? '';
    if (!Number.isFinite(amount)) continue;
    out.push({ amount, message, date: tag(block, 'date') });
  }
  return out;
}

/** Řádky minulé dávky jako záznamy už uplatněných nákladů. */
export function prevXmlToLedger(xml: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const t of parsePrevXml(xml)) {
    // Datum transakce je v textu („… ze dne DD.MM.RRRR"); pravidelné platby ho nemají.
    const date_txn = dateFromMessage(t.message);
    if (!date_txn) continue;
    out.push({
      fingerprint: fingerprint(date_txn, t.amount),
      date_txn,
      amount: t.amount,
      merchant: t.message,
      source: 'prev_xml',
    });
  }
  return out;
}
