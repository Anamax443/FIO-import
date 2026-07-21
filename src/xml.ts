/**
 * Generátor XML pro hromadný import do Fio.
 *
 * Tvrdě ověřená pravidla (docs/SPEC.md §2) — nedodržení = banka odmítne:
 *   1. žádné XML komentáře   2. CRLF   3. UTF-8   4. tabulátory
 *   5. desetinná tečka, celá čísla bez desetin   6. pevné pořadí elementů
 *   messageForRecipient === comment
 */

import { formatAmount } from './util.js';
import type { LineItem } from './types.js';

export interface XmlConstants {
  accountFrom: string;
  accountTo: string;
  bankCode: string;
  currency: string;
  paymentType: string;
}

export const DEFAULT_CONSTANTS: XmlConstants = {
  accountFrom: '2401442781',
  accountTo: '2900203312',
  bankCode: '2010',
  currency: 'CZK',
  paymentType: '431001',
};

const CRLF = '\r\n';

/** Fio limit délky zprávy pro příjemce. */
export const MESSAGE_MAX_LEN = 140;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sestaví celý soubor. Bere VÝHRADNĚ řádky, které dostane —
 * filtrování `include` dělá volající (docs/SPEC.md §9).
 */
export function buildXml(
  rows: LineItem[],
  date: string,
  c: XmlConstants = DEFAULT_CONSTANTS,
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Import xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<Orders>',
  ];

  for (const r of rows) {
    const msg = esc(r.message);
    lines.push(
      '\t\t<DomesticTransaction>',
      `\t\t\t<accountFrom>${c.accountFrom}</accountFrom>`,
      `\t\t\t<currency>${c.currency}</currency>`,
      `\t\t\t<amount>${formatAmount(r.amount)}</amount>`,
      `\t\t\t<accountTo>${c.accountTo}</accountTo>`,
      `\t\t\t<bankCode>${c.bankCode}</bankCode>`,
      `\t\t\t<date>${date}</date>`,
      `\t\t\t<messageForRecipient>${msg}</messageForRecipient>`,
      `\t\t\t<comment>${msg}</comment>`,
      `\t\t\t<paymentType>${c.paymentType}</paymentType>`,
      '\t\t</DomesticTransaction>',
    );
  }

  lines.push('\t</Orders>', '</Import>');
  return lines.join(CRLF) + CRLF;
}

export interface Validation {
  ok: boolean;
  count: number;
  total: number;
  bySource: Record<string, number>;
  mandatoryCount: number;
  problems: string[];
}

/** Kontroly před odevzdáním (docs/SPEC.md §11). */
export function validate(rows: LineItem[], date: string, xml: string): Validation {
  const problems: string[] = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`Datum splatnosti není RRRR-MM-DD: ${date}`);
  if (rows.length === 0) problems.push('Dávka je prázdná — není co importovat.');
  if (xml.includes('<!--')) problems.push('XML obsahuje komentář — banka soubor odmítne.');
  if (/[^\r]\n/.test(xml)) problems.push('XML má LF konce řádků místo CRLF.');

  const bySource: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    total += r.amount;
    if (!(r.amount > 0)) problems.push(`Nekladná částka u „${r.message}“: ${r.amount}`);
    if (r.message.length > MESSAGE_MAX_LEN) {
      problems.push(`Zpráva delší než ${MESSAGE_MAX_LEN} znaků (${r.message.length}): „${r.message}“`);
    }
  }

  return {
    ok: problems.length === 0,
    count: rows.length,
    total: Math.round(total * 100) / 100,
    bySource,
    mandatoryCount: rows.filter((r) => r.mandatory).length,
    problems,
  };
}
