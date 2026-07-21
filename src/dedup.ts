/**
 * Deduplikace — kontrola už uplatněných nákladů (docs/SPEC.md §8).
 *
 * Cíl: žádnou částku nestáhnout podruhé. Klíč = datum_txn + částka.
 * Shody se NIKDY nemažou — jen se předvyplní jako vyřazené (`include = false`)
 * a uživatel je může v editaci přebít (existují legitimní duplicity:
 * dvě stejné Alza týž den, dva Lidl týž den).
 *
 * Počítá se s výskyty: 2 v historii vs. 3 nově → první dva ALREADY_CLAIMED,
 * třetí zůstane NEW.
 */

import type { LedgerEntry, LineItem } from './types.js';

export interface DedupReport {
  new: number;
  alreadyClaimed: number;
  duplicateInBatch: number;
}

export interface DedupResult {
  rows: LineItem[];
  report: DedupReport;
}

export function dedupe(rows: LineItem[], history: LedgerEntry[]): DedupResult {
  const remaining = new Map<string, number>();
  for (const h of history) {
    remaining.set(h.fingerprint, (remaining.get(h.fingerprint) ?? 0) + 1);
  }

  const seenInBatch = new Map<string, number>();
  const report: DedupReport = { new: 0, alreadyClaimed: 0, duplicateInBatch: 0 };

  const out = rows.map((row) => {
    // Pravidelné platby z výpisu nevznikají — dedup se jich netýká.
    if (row.source === 'pravidelna') {
      report.new++;
      return row;
    }

    const fp = row.fingerprint;
    const already = seenInBatch.get(fp) ?? 0;
    seenInBatch.set(fp, already + 1);

    if (already > 0) {
      report.duplicateInBatch++;
      return {
        ...row,
        status: 'DUPLICATE_IN_BATCH' as const,
        include: false,
        note: joinNote(row.note, 'Týž náklad je v této dávce už jednou (Fio × Revolut nebo překryv období).'),
      };
    }

    const left = remaining.get(fp) ?? 0;
    if (left > 0) {
      remaining.set(fp, left - 1);
      report.alreadyClaimed++;
      const when = history.find((h) => h.fingerprint === fp);
      return {
        ...row,
        status: 'ALREADY_CLAIMED' as const,
        include: false,
        note: joinNote(row.note, `Už uplatněno${when ? ` (${when.date_txn})` : ''} — pokud jde o samostatný nákup, zapni řádek ručně.`),
      };
    }

    report.new++;
    return row;
  });

  return { rows: out, report };
}

function joinNote(existing: string | undefined, added: string): string {
  return existing ? `${existing} ${added}` : added;
}
