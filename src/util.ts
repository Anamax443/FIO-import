/**
 * Ověřené jádro: normalizace částek, otisk pro dedup, skládání textu zprávy,
 * CSV parser a ASCII-fold. Pravidla viz docs/SPEC.md §6 a docs/SAMPLE_DATA.md.
 */

/** Měsíce v 1. pádu — jdou do textů pravidelných plateb. */
export const CZ_MONTHS = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
] as const;

/** Písmena bez rozkladu v NFD — nutná explicitní mapa. */
const FOLD_SPECIAL: Record<string, string> = {
  ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ø: 'o', Ø: 'O',
  æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', þ: 'th', Þ: 'Th', ð: 'd', Ð: 'D',
};

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * „1 290,5" → 1290.5, „-419.00" → -419, „994,72" → 994.72.
 * Desetinná čárka i tečka, mezery a nbsp jako oddělovač tisíců.
 */
export function normAmount(raw: string): number {
  let s = String(raw).replace(/\s/g, '').replace(/"/g, '');
  if (s === '') return NaN;
  if (s.includes(',')) {
    // Čárka = desetinný oddělovač, tečky jsou tisíce.
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Jen tečky: víc než jedna = oddělovač tisíců (1.234.567).
    const parts = s.split('.');
    if (parts.length > 2) s = parts.join('');
  }
  return Number(s);
}

/** Do XML: desetinná tečka, celá čísla bez desetin (400, ne 400.00). */
export function formatAmount(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** „04.07.2026 14:59" nebo „04.07.2026" → „2026-07-04". */
export function parseCzDate(raw: string): string | null {
  const m = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/.exec(String(raw));
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** „2026-07-04 03:45:46" nebo „2026-07-04" → „2026-07-04". */
export function parseIsoDate(raw: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** „2026-07-04" → „04.07.2026" (formát, který jde do textu zprávy). */
export function czDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Z textu zprávy vytáhne „… ze dne DD.MM.RRRR" → „2026-07-04". */
export function dateFromMessage(msg: string): string | null {
  const m = /ze dne\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i.exec(msg);
  return m ? parseCzDate(m[1]) : null;
}

/**
 * Foldne diakritiku na ASCII — VŠECHNU, včetně české.
 *
 * SPEC §6 původně chtěl českou diakritiku v obchodnících zachovat, ale rozlišovat
 * „českou" a „cizí" nešlo dělat po znacích (`ó` je obojí, akceptační kritérium
 * chce „Gdański Zarząd Dróg" → „Gdanski Zarzad Drog"). Na přání uživatele
 * (2026-07-21) se ruší celá — obchodníci jdou do zprávy bez diakritiky.
 *
 * Týká se to JEN názvů obchodníků z výpisů. Texty pravidelných plateb
 * (`recurring.ts`) i názvy měsíců jsou literály a diakritiku si ponechávají.
 */
export function asciiFold(s: string): string {
  let out = '';
  for (const ch of s) out += foldChar(ch);
  return out;
}

function foldChar(ch: string): string {
  const special = FOLD_SPECIAL[ch];
  if (special !== undefined) return special;
  // \p{M} = kombinující diakritické znaky (po NFD rozkladu)
  return ch.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Hlavní klíč dedupu = datum transakce + částka.
 * Obchodník v klíči NENÍ — texty se mezi zdroji liší („Lidl" × „nákup Lidl").
 */
export function fingerprint(dateTxn: string, amount: number): string {
  return `${dateTxn}|${formatAmount(Math.abs(amount))}`;
}

/** Zkrátí ukecané názvy bankomatů a přebytečné mezery. */
export function cleanMerchant(raw: string, maxLen = 40): string {
  const s = asciiFold(String(raw)).replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen).trimEnd() : s;
}

export interface MsgParts {
  kategorie?: string;
  poznamka?: string;
  /** Datum transakce RRRR-MM-DD. */
  date_txn?: string;
  merchant?: string;
}

/**
 * „{Kategorie} - {Poznámka} ze dne {datum} {Obchodník}"
 * → „Dovolená - PHM ze dne 04.07.2026 Orlen"
 */
export function buildMsg({ kategorie, poznamka, date_txn, merchant }: MsgParts): string {
  const head = [kategorie ? capitalize(kategorie) : '', poznamka ?? '']
    .filter(Boolean)
    .join(' - ');
  const tail = [
    date_txn ? `ze dne ${czDate(date_txn)}` : '',
    merchant ? cleanMerchant(merchant) : '',
  ].filter(Boolean).join(' ');
  return [head, tail].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase('cs') + s.slice(1);
}

/**
 * CSV parser respektující uvozovky a CRLF. Prázdné řádky vypadnou.
 * Fio používá `;`, Revolut `,` — oddělovač se předává.
 */
export function parseCsv(text: string, delim: string): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Najde index sloupce podle libovolného z aliasů (bez diakritiky, case-insensitive). */
export function colIndex(header: string[], ...aliases: string[]): number {
  const norm = (s: string) => asciiFold(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = aliases.map(norm);
  return header.findIndex((h) => wanted.includes(norm(h)));
}
