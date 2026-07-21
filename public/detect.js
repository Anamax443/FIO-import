/**
 * Rozpoznání, do kterého vstupního pole soubor patří.
 *
 * Díky tomu jde soubor přetáhnout kamkoli a výpis pohybů neskončí v poli
 * pro platby kartou (kde by ho parser tiše přeskočil a nenačetl nic).
 *
 * Vrací `fio` | `revolut` | `historyCsv` | `prevXml`, nebo `null` když si není jistý —
 * pak se použije pole, do kterého uživatel soubor pustil.
 */
export function detectKind(text, filename = '') {
  const head = String(text).slice(0, 4000);
  const firstLine = head.split(/\r?\n/, 1)[0] ?? '';
  const name = String(filename).toLowerCase();

  // 1) Naše vlastní XML z minulé dávky.
  if (/^\s*(﻿)?<\?xml/.test(head) || head.includes('<DomesticTransaction>')) return 'prevXml';

  // 2) Fio CSV pohyby na účtu: středníky + Objem / Zpráva pro příjemce.
  if (/Zpr[áa]va pro p[řr][íi]jemce/i.test(firstLine)) return 'historyCsv';
  if (firstLine.includes(';') && /Objem/i.test(firstLine)) return 'historyCsv';

  // 3) Revolut CSV: čárky + Datum dokončení / State.
  if (/Datum dokon[čc]en[íi]|Completed Date/i.test(firstLine)) return 'revolut';
  if (firstLine.includes(',') && /(^|,)\s*"?State"?\s*(,|$)/i.test(firstLine)) return 'revolut';

  // 4) Fio copy-paste z IB: tabulátory a typ pohybu.
  if (head.includes('\t') && /Platba kartou|Bankomat/i.test(head)) return 'fio';

  // 5) Poslední záchrana podle názvu souboru (export se jmenuje „Pohyby_na_uctu…").
  if (name.startsWith('pohyby')) return 'historyCsv';
  if (name.includes('revolut')) return 'revolut';
  if (name.endsWith('.xml')) return 'prevXml';

  return null;
}
