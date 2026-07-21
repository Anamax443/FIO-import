/**
 * AI vrstva — kategorizace a čištění řádků, které nemají kategorii (hlavně Revolut).
 *
 * Best-effort: při chybě, chybějícím klíči nebo timeoutu pipeline pokračuje beze změny.
 * Model: Claude Haiku 4.5 — klasifikace je krátká a levná, extended thinking netřeba.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildMsg } from './util.js';
import type { LineItem } from './types.js';

/** Ověřeno proti konzoli Anthropicu — viz docs/SAMPLE_DATA.md „Pozn. k AI modelu". */
export const AI_MODEL = 'claude-haiku-4-5';

const MAX_ITEMS = 60;
const TIMEOUT_MS = 20_000;

const SYSTEM = [
  'Klasifikuješ bankovní transakce pro rozúčtování rodinných nákladů.',
  'Ke každé transakci urči kategorii (dovolená, nákup, PHM, parkování, jídlo, léky, drogerie, ostatní),',
  'krátkou poznámku česky (1–2 slova, např. "nákup", "PHM", "oběd"),',
  'vyčištěný název obchodníka (bez ID terminálu, čísel a balastu)',
  'a příznak claimable = false u věcí, které se nerozúčtovávají:',
  'předplatné (Netflix, Spotify), převody sobě, dobíjení účtu, vlastní spoření.',
  'Odpovídej výhradně daným JSON schématem, ve stejném pořadí a počtu jako vstup.',
].join(' ');

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string' },
          note: { type: 'string' },
          merchant: { type: 'string' },
          claimable: { type: 'boolean' },
        },
        required: ['id', 'category', 'note', 'merchant', 'claimable'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

interface Classified {
  id: string;
  category: string;
  note: string;
  merchant: string;
  claimable: boolean;
}

/**
 * Doplní kategorii/poznámku a přepíše text zprávy. Vrací nové pole;
 * při jakémkoli problému vrací vstup beze změny.
 */
export async function classify(rows: LineItem[], apiKey: string | undefined): Promise<LineItem[]> {
  if (!apiKey) return rows;

  const targets = rows.filter((r) => r.source === 'revolut' && !r.kategorie).slice(0, MAX_ITEMS);
  if (targets.length === 0) return rows;

  let result: Classified[];
  try {
    result = await callClaude(targets, apiKey);
  } catch (err) {
    console.warn('AI klasifikace selhala, pokračuji bez ní:', err);
    return rows;
  }

  const byId = new Map(result.map((c) => [c.id, c]));

  return rows.map((row) => {
    const c = byId.get(row.id);
    if (!c) return row;

    const merchant = c.merchant?.trim() || row.merchant;
    return {
      ...row,
      kategorie: c.category || row.kategorie,
      merchant,
      message: buildMsg({
        kategorie: c.category,
        poznamka: c.note,
        date_txn: row.date_txn,
        merchant,
      }),
      // claimable = false → řádek se defaultně vyřadí, uživatel může přebít.
      include: c.claimable === false ? false : row.include,
      note: c.claimable === false
        ? 'AI: nevypadá jako rozúčtovatelný náklad (předplatné / převod sobě).'
        : row.note,
    };
  });
}

async function callClaude(targets: LineItem[], apiKey: string): Promise<Classified[]> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  const payload = targets.map((r) => ({
    id: r.id,
    merchant: r.merchant ?? '',
    amount: r.amount,
    date: r.date_txn ?? '',
  }));

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AI nevrátila textový blok');

  const parsed = JSON.parse(text.text) as { items?: Classified[] };
  if (!Array.isArray(parsed.items)) throw new Error('AI odpověď nemá pole items');
  return parsed.items;
}
