/**
 * Fio — copy-paste z internetového bankovnictví (tab-separated).
 * Sloupce: Typ · Stav · DatumTxn · DatumZauct · Obchodník · Částka · Měna · Kategorie · Poznámka
 */

import { buildMsg, fingerprint, normAmount, parseCzDate } from '../util.js';
import type { LineItem } from '../types.js';

/** Berou se jen skutečné výdaje kartou / výběry, ne příchozí a interní přesuny. */
const ACCEPTED_TYPES = ['platba kartou', 'bankomat'];

export function parseFioCard(text: string): LineItem[] {
  const out: LineItem[] = [];
  let i = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length < 6) continue;

    const [typ, , datumTxn, , obchodnik, castka, mena, kategorie, poznamka] = cols;
    if (!ACCEPTED_TYPES.includes(typ.toLowerCase())) continue;

    const date_txn = parseCzDate(datumTxn);
    const amount = Math.abs(normAmount(castka));
    if (!date_txn || !Number.isFinite(amount) || amount === 0) continue;

    out.push({
      id: `fio-${i++}`,
      source: 'fio',
      fingerprint: fingerprint(date_txn, amount),
      status: 'NEW',
      mandatory: false,
      include: true,
      amount,
      currency_orig: mena && mena !== 'CZK' ? mena : undefined,
      message: buildMsg({ kategorie, poznamka, date_txn, merchant: obchodnik }),
      date_txn,
      kategorie: kategorie || undefined,
      merchant: obchodnik,
    });
  }

  return out;
}
