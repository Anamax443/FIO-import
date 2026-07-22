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

import { asciiFold } from './util.js';
import type { LedgerEntry, LineItem } from './types.js';

/**
 * Vulgární zlomky (a jejich náhrady) se před porovnáním smažou. Vedoucí „můj
 * podíl" ½/¾ uloží každý systém jinak: šablona `½ Oneplay…`, Fio výpis
 * `? Oneplay…` (banka zlomek do zprávy pro příjemce nepustí a nahradí ho `?`),
 * staré XML `Â½ Oneplay…` (dvojitě zakódované UTF-8). asciiFold jede přes NFD,
 * které vulgární zlomky nerozkládá — bez téhle úpravy se řádek nespáruje
 * a záloha by se stáhla podruhé. Zbytek textu (název + částka + měsíc) je
 * na spárování jednoznačný.
 */
const SHARE_MARK = /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞?�]/g;

/** Normalizace textu pro porovnání pravidelných plateb s historií. */
function normText(s: string | undefined): string {
  return asciiFold(String(s ?? '')).replace(SHARE_MARK, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

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

  // Pravidelné platby nemají datum transakce, takže je otisk datum+částka nechytí.
  // Porovnávají se proto podle TEXTU (obsahuje měsíc i částku, je jednoznačný) —
  // když už tenhle měsíc zálohu zaplatíš, přijde na účet příjemce se stejným textem.
  const historyText = new Map<string, number>();
  for (const h of history) {
    const k = normText(h.merchant);
    if (k) historyText.set(k, (historyText.get(k) ?? 0) + 1);
  }

  const seenInBatch = new Map<string, number>();
  const report: DedupReport = { new: 0, alreadyClaimed: 0, duplicateInBatch: 0 };

  const out = rows.map((row) => {
    // Pravidelné platby — dedup podle textu zprávy proti historii.
    if (row.source === 'pravidelna') {
      const k = normText(row.message);
      const left = historyText.get(k) ?? 0;
      if (k && left > 0) {
        historyText.set(k, left - 1);
        report.alreadyClaimed++;
        const when = history.find((h) => normText(h.merchant) === k);
        return {
          ...row,
          status: 'ALREADY_CLAIMED' as const,
          include: false,
          note: joinNote(row.note, `Už uplatněno${when ? ` (${when.date_txn})` : ''} — tuhle zálohu jsi tenhle měsíc nejspíš už zaplatil. Pokud ne, zapni řádek ručně.`),
        };
      }
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
