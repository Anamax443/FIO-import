/**
 * Pravidelné / mandatorní platby (docs/SPEC.md §7).
 *
 * Šablona = zdroj pravdy pro strukturu (texty, mandatory, výchozí částky).
 * Částky se přebírají z minulého přijatého XML (carry-over) — zálohy přetrvají,
 * měsíc se přepíše na aktuální. Bez minulého XML platí výchozí částky.
 *
 * Pozn.: v textech je rok zástupný `{rok}` (v SPECu byl literál 2026) —
 * pro rok 2026 se vykreslí znak po znaku stejně, ale nezastará.
 */

import { CZ_MONTHS } from './util.js';
import type { LineItem } from './types.js';
import type { PrevTransaction } from './parse/prevXml.js';

export interface RecurringRow {
  ord: number;
  amount: number;
  mandatory: boolean;
  template: string;
}

/** Vodné se neplatí (jen stočné). */
export const RECURRING_TEMPLATE: RecurringRow[] = [
  { ord: 1, amount: 400, mandatory: false, template: 'Neo Modrý - telefon Maxík mobil (400 Kč) - {mesic} {rok}' },
  { ord: 2, amount: 400, mandatory: false, template: 'Neo Modrý - telefon Ferda mobil (400 Kč) - {mesic} {rok}' },
  { ord: 3, amount: 200, mandatory: false, template: '½ Oneplay Extra Sport (200 Kč) - {mesic} {rok}' },
  { ord: 4, amount: 100, mandatory: false, template: 'Kanály navíc (100 Kč) - {mesic} {rok}' },
  { ord: 5, amount: 300, mandatory: false, template: '¾ O2 Internet MAX 250 (300 Kč) - {mesic} {rok}' },
  { ord: 6, amount: 50, mandatory: false, template: '½ Rodinné sledování (50 Kč) - {mesic} {rok}' },
  { ord: 7, amount: 650, mandatory: true, template: 'stočné záloha Havlíčkova 486_4 osoby_{rok} {mesic} {rok}' },
  {
    ord: 8, amount: 3414, mandatory: true,
    template: 'zaloha na elektriku-Havlíčkova 486 odb.místo 859182400205072937 3000 (odhad 2414byt+1000dílna) SIPO {mesic} {rok}',
  },
  { ord: 9, amount: 2800, mandatory: true, template: 'plyn záloha Havlíčkova486-{mesic} {rok}' },
];

export function renderTemplate(template: string, mesic: string, rok: string): string {
  return template.replace(/\{mesic\}/g, mesic).replace(/\{rok\}/g, rok);
}

/** Šablona → regex, aby šel v minulém XML najít odpovídající řádek (jiný měsíc). */
function templateMatcher(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\\\{mesic\\\}/g, '\\S+')
    .replace(/\\\{rok\\\}/g, '\\d{4}');
  return new RegExp(`^${pattern}$`);
}

export interface BuildRecurringOptions {
  /** Datum splatnosti dávky RRRR-MM-DD — určuje měsíc a rok v textech. */
  date: string;
  /** Šablona (default = RECURRING_TEMPLATE, jinak z D1). */
  template?: RecurringRow[];
  /** Transakce z minulého přijatého XML pro carry-over částek. */
  prev?: PrevTransaction[];
}

export function buildRecurring({ date, template = RECURRING_TEMPLATE, prev = [] }: BuildRecurringOptions): LineItem[] {
  const [rok, mesicNum] = date.split('-');
  const mesic = CZ_MONTHS[Number(mesicNum) - 1] ?? '';

  return template.map((row) => {
    const matcher = templateMatcher(row.template);
    // Carry-over: z minulé dávky vezmi částku odpovídajícího řádku.
    const hit = prev.find((t) => matcher.test(t.message.trim()));
    const amount = hit ? hit.amount : row.amount;

    return {
      id: `rec-${row.ord}`,
      source: 'pravidelna',
      fingerprint: `rec|${row.ord}|${date}`,
      status: 'NEW',
      mandatory: row.mandatory,
      include: true,
      amount,
      message: renderTemplate(row.template, mesic, rok),
      note: hit && hit.amount !== row.amount
        ? `Částka převzata z minulého XML (výchozí ${row.amount} Kč).`
        : undefined,
    } satisfies LineItem;
  });
}
