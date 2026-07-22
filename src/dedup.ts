/**
 * Deduplikace — kontrola už uplatněných nákladů (docs/SPEC.md §8).
 *
 * **Autorita = Fio výpis** (reálný pohyb na účtu příjemce, `source === 'history'`).
 * Jen *vygenerované* záznamy (minulé XML `prev_xml` + ledger z generování dávky)
 * NEJSOU potvrzení — XML se dá vygenerovat a do banky nenahrát. Proto:
 *   - shoda proti Fio výpisu → `ALREADY_CLAIMED` (vyřadit, potvrzeno),
 *   - shoda jen proti vygenerovanému → `ALREADY_GENERATED` (zůstane v návrhu
 *     s příznakem, defaultně vypnuté — když jsi XML nenahrál, jedním klikem zapneš).
 * Shody se NIKDY nemažou.
 *
 * Počítá se s výskyty: 2 v historii vs. 3 nově → první dva ALREADY_*, třetí NEW.
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

/** Fio výpis (reálný pohyb) = jediná autorita pro potvrzené uplatnění. */
function isConfirmed(source: string): boolean {
  return source === 'history';
}

export interface DedupReport {
  new: number;
  alreadyClaimed: number;
  alreadyGenerated: number;
  duplicateInBatch: number;
}

export interface DedupResult {
  rows: LineItem[];
  report: DedupReport;
}

export function dedupe(rows: LineItem[], history: LedgerEntry[]): DedupResult {
  // Historie ve dvou úrovních autority: potvrzené Fio výpisem × jen vygenerované.
  const confirmedFp = new Map<string, number>();
  const generatedFp = new Map<string, number>();
  const confirmedText = new Map<string, number>();
  const generatedText = new Map<string, number>();

  for (const h of history) {
    const confirmed = isConfirmed(h.source);
    inc(confirmed ? confirmedFp : generatedFp, h.fingerprint);
    const k = normText(h.merchant);
    if (k) inc(confirmed ? confirmedText : generatedText, k);
  }

  const seenInBatch = new Map<string, number>();
  const report: DedupReport = { new: 0, alreadyClaimed: 0, alreadyGenerated: 0, duplicateInBatch: 0 };

  const out = rows.map((row) => {
    // Pravidelné platby nemají datum transakce → dedup podle TEXTU zprávy.
    if (row.source === 'pravidelna') {
      const k = normText(row.message);
      if (k && take(confirmedText, k)) {
        report.alreadyClaimed++;
        const when = whenFor(history, (h) => isConfirmed(h.source) && normText(h.merchant) === k);
        return claimed(row, `Už uplatněno ve Fio výpisu${when ? ` (${when})` : ''} — tuhle zálohu jsi tenhle měsíc už zaplatil. Pokud ne, zapni řádek ručně.`);
      }
      if (k && take(generatedText, k)) {
        report.alreadyGenerated++;
        return generated(row);
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

    if (take(confirmedFp, fp)) {
      report.alreadyClaimed++;
      const when = whenFor(history, (h) => isConfirmed(h.source) && h.fingerprint === fp);
      return claimed(row, `Už uplatněno ve Fio výpisu${when ? ` (${when})` : ''} — pokud jde o samostatný nákup, zapni řádek ručně.`);
    }
    if (take(generatedFp, fp)) {
      report.alreadyGenerated++;
      return generated(row);
    }

    report.new++;
    return row;
  });

  return { rows: out, report };
}

/** Potvrzeno Fio výpisem → vyřadit. */
function claimed(row: LineItem, note: string): LineItem {
  return { ...row, status: 'ALREADY_CLAIMED', include: false, note: joinNote(row.note, note) };
}

/** Jen vygenerováno (prev_xml/ledger), Fio to nepotvrdil → zůstane v návrhu, vypnuté. */
function generated(row: LineItem): LineItem {
  return {
    ...row,
    status: 'ALREADY_GENERATED',
    include: false,
    note: joinNote(row.note, 'Vygenerováno v předchozí dávce, ale NENÍ ve Fio výpisu — pokud jsi XML nahrál do banky, nech vypnuté; pokud ne, zapni a pošli.'),
  };
}

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Odebere jeden výskyt, když existuje (počítání výskytů). */
function take(map: Map<string, number>, key: string): boolean {
  const left = map.get(key) ?? 0;
  if (left <= 0) return false;
  map.set(key, left - 1);
  return true;
}

function whenFor(history: LedgerEntry[], pred: (h: LedgerEntry) => boolean): string | undefined {
  return history.find(pred)?.date_txn;
}

function joinNote(existing: string | undefined, added: string): string {
  return existing ? `${existing} ${added}` : added;
}
