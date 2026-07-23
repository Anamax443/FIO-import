/**
 * Kontrola refundací (dobropisů) — poradní vrstva, ne autorita.
 *
 * Hledá **příchozí (kladné) částky**, které vypadají jako vrácení dřívějšího výdaje,
 * a hlavně upozorní, když ten výdaj **už byl rozúčtovaný** (je v ledgeru / historii).
 * Zapomenutá refundace = tichý přeplatek — stejně drahá chyba jako duplicita.
 *
 * Filozofie stejná jako u AI vrstvy: **deterministické jádro** (párování otiskem
 * částky, obchodníka a data), výstup = seznam varování k ruční kontrole. Nic nemění,
 * nic nezahazuje. Fuzzy případy (rozházené názvy obchodníků) jsou místo, kam se dá
 * později připojit AI — jádro ale musí dávat smysl i bez ní.
 */

import { asciiFold } from './util.js';
import type { LedgerEntry } from './types.js';

/** Příchozí transakce, která může být refundací (kladná částka). */
export interface RefundCandidate {
  id: string;
  merchant?: string;
  /** Kladná = příchozí (vrácení peněz). */
  amount: number;
  /** Datum transakce RRRR-MM-DD. */
  date_txn?: string;
  source: string;
}

/** Varování: příchozí částka vypadá jako vrácení konkrétního dřívějšího výdaje. */
export interface RefundFlag {
  candidateId: string;
  merchant?: string;
  amount: number;
  date_txn?: string;
  /** Dřívější výdaj, ke kterému refundace nejspíš patří. */
  match: {
    date_txn: string;
    amount: number;
    merchant?: string;
    source: string;
  };
  /** `full` = vráceno celé (± tolerance), `partial` = jen část výdaje. */
  kind: 'full' | 'partial';
  /** Kolik dní po výdaji refundace přišla (null = některé datum chybí). */
  daysAfter: number | null;
}

export interface RefundOptions {
  /** Jak daleko zpět hledat původní výdaj (dny). Default 120. */
  windowDays?: number;
  /** Tolerance částky pro „plnou" refundaci (kurz/haléře). Default 0.5 Kč. */
  amountTolerance?: number;
  /** Nejkratší token názvu obchodníka, který smí párovat. Default 3. */
  minToken?: number;
}

/** RRRR-MM-DD → pořadové číslo dne (UTC, deterministické — bez aktuálního času). */
function toEpochDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Název obchodníka → tokeny bez diakritiky (shodné se stylem dedupu). */
function tokens(s: string | undefined, minToken: number): string[] {
  if (!s) return [];
  return asciiFold(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= minToken);
}

/**
 * Obchodník sedí, když sdílí aspoň jeden token (přesná shoda tokenu, ne substring —
 * „mol" tak nechytne „smolařova"). Texty se mezi zdroji liší („Lidl" × „nákup Lidl 123"),
 * proto se páruje po tokenech, ne na celý řetězec.
 */
function merchantMatch(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((t) => set.has(t));
}

/**
 * Najde příchozí částky, které vypadají jako vrácení dřívějšího výdaje z `history`.
 * `history` = už uplatněné náklady (D1 ledger) i libovolné výdaje, proti kterým chceš
 * refundace párovat. Vrací varování seřazená: plné shody napřed, pak částečné.
 */
export function findRefunds(
  candidates: RefundCandidate[],
  history: LedgerEntry[],
  opts: RefundOptions = {},
): RefundFlag[] {
  const windowDays = opts.windowDays ?? 120;
  const tol = opts.amountTolerance ?? 0.5;
  const minToken = opts.minToken ?? 3;

  const hist = history.map((h) => ({ entry: h, toks: tokens(h.merchant, minToken), day: toEpochDay(h.date_txn) }));
  const flags: RefundFlag[] = [];

  for (const c of candidates) {
    if (!(c.amount > 0)) continue; // jen příchozí (kladné) částky
    const cToks = tokens(c.merchant, minToken);
    const cDay = c.date_txn ? toEpochDay(c.date_txn) : null;

    let best: { entry: LedgerEntry; kind: 'full' | 'partial'; daysAfter: number | null; score: number } | null = null;

    for (const h of hist) {
      if (!merchantMatch(cToks, h.toks)) continue;
      // Vrácení nemůže být vyšší než původní výdaj (nad rámec tolerance).
      if (c.amount > h.entry.amount + tol) continue;

      const kind: 'full' | 'partial' = Math.abs(c.amount - h.entry.amount) <= tol ? 'full' : 'partial';

      let daysAfter: number | null = null;
      if (cDay !== null && h.day !== null) {
        daysAfter = cDay - h.day;
        if (daysAfter < 0 || daysAfter > windowDays) continue; // před nákupem nebo mimo okno
      }

      // Skóre: plná shoda > částečná; bližší datum lepší (chybějící datum = neutrální).
      const score = (kind === 'full' ? 1000 : 500) - (daysAfter ?? 60);
      if (!best || score > best.score) best = { entry: h.entry, kind, daysAfter, score };
    }

    if (best) {
      flags.push({
        candidateId: c.id,
        merchant: c.merchant,
        amount: c.amount,
        date_txn: c.date_txn,
        match: {
          date_txn: best.entry.date_txn,
          amount: best.entry.amount,
          merchant: best.entry.merchant,
          source: best.entry.source,
        },
        kind: best.kind,
        daysAfter: best.daysAfter,
      });
    }
  }

  return flags.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'full' ? -1 : 1));
}
