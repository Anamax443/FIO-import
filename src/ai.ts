/**
 * AI vrstva — kategorizace a čištění řádků, které nemají kategorii (hlavně Revolut).
 *
 * Best-effort: při chybě, chybějícím backendu nebo timeoutu pipeline pokračuje
 * beze změny.
 *
 * Backend je **přepínatelný „dle úhrady"** (docs/ARCHITECTURE.md):
 *   - `anthropic`   — Claude Haiku 4.5 (placený, přesnější čeština),
 *   - `workers-ai`  — Cloudflare Workers AI, Llama 3.1 8B (zdarma, nativní binding,
 *                     data neopustí Cloudflare; free 10k neuronů/den).
 * Výběr řídí `AI_PROVIDER`; když placený backend spadne (došel kredit, billing),
 * vrstva se sama přepne na free (je-li binding). Prázdné `AI_PROVIDER` = auto
 * (placený když je klíč, jinak free; free vždy jako fallback).
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildMsg } from './util.js';
import type { LineItem } from './types.js';

/** Placený backend — ověřeno proti konzoli Anthropicu (viz docs/SAMPLE_DATA.md). */
export const AI_MODEL = 'claude-haiku-4-5';
/**
 * Free backend — malý instruct model, JSON přes prompt (Workers AI, GPU edge).
 * `-fp8` je jediná dostupná varianta 3.1-8B v katalogu (ověřeno `wrangler ai models`);
 * 8B je levné na neurony, takže i plná dávka (60 řádků) zůstane ve free 10k/den.
 */
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';

export type AiProvider = 'anthropic' | 'workers-ai';

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

/** Kontext pro výběr backendu — z env (viz index.ts). */
export interface AiContext {
  /** `AI_PROVIDER`: 'anthropic' | 'workers-ai' | 'off'; prázdné = auto. */
  provider?: string;
  /** `ANTHROPIC_API_KEY` — placený backend. */
  anthropicKey?: string;
  /** Workers AI binding (`env.AI`) — free backend. */
  ai?: Ai;
}

export interface ClassifyResult {
  rows: LineItem[];
  /** Který backend reálně doplnil data (null = žádný neběžel). */
  provider: AiProvider | null;
}

/**
 * Pořadí backendů „dle úhrady": placený primárně, free jako automatický fallback.
 * Rozhoduje `AI_PROVIDER` + dostupnost klíče/bindingu.
 */
export function providerChain(ctx: AiContext): AiProvider[] {
  const pref = (ctx.provider ?? '').trim().toLowerCase();
  const hasAnthropic = Boolean(ctx.anthropicKey);
  const hasWorkers = Boolean(ctx.ai);

  const paidThenFree: AiProvider[] = [
    ...(hasAnthropic ? (['anthropic'] as const) : []),
    ...(hasWorkers ? (['workers-ai'] as const) : []),
  ];

  if (pref === 'off') return [];
  if (pref === 'workers-ai') return hasWorkers ? ['workers-ai'] : [];
  if (pref === 'anthropic') return paidThenFree; // placený, s free fallbackem
  return paidThenFree; // auto
}

/**
 * Doplní kategorii/poznámku a přepíše text zprávy. Zkouší backendy v pořadí
 * `providerChain` — když placený selže (kredit/billing/výpadek), spadne na free.
 * Při jakémkoli neúspěchu vrací vstup beze změny (best-effort).
 */
export async function classify(rows: LineItem[], ctx: AiContext): Promise<ClassifyResult> {
  // Revolut řádky mají jen odhad z názvu obchodníka (merchantNote.ts) — AI ho zpřesní.
  // Fio řádky nesou kategorii i poznámku přímo z výpisu, ty se nepřepisují.
  const targets = rows.filter((r) => r.source === 'revolut').slice(0, MAX_ITEMS);
  if (targets.length === 0) return { rows, provider: null };

  for (const provider of providerChain(ctx)) {
    try {
      const result = provider === 'anthropic'
        ? await callAnthropic(targets, ctx.anthropicKey as string)
        : await callWorkersAi(targets, ctx.ai as Ai);
      return { rows: apply(rows, result), provider };
    } catch (err) {
      console.warn(`AI backend ${provider} selhal, zkouším další / pokračuji bez AI:`, err);
    }
  }
  return { rows, provider: null };
}

/** Promítne klasifikaci zpět do řádků (společné pro oba backendy). */
function apply(rows: LineItem[], result: Classified[]): LineItem[] {
  const byId = new Map(result.map((c) => [c.id, c]));

  return rows.map((row) => {
    const c = byId.get(row.id);
    if (!c) return row;

    const merchant = c.merchant?.trim() || row.merchant;
    return {
      ...row,
      kategorie: c.category || row.kategorie,
      merchant,
      message: buildMsg({ kategorie: c.category, poznamka: c.note, date_txn: row.date_txn, merchant }),
      // claimable = false → řádek se defaultně vyřadí, uživatel může přebít.
      include: c.claimable === false ? false : row.include,
      note: c.claimable === false
        ? 'AI: nevypadá jako rozúčtovatelný náklad (předplatné / převod sobě).'
        : row.note,
    };
  });
}

/**
 * Ověří, že placený backend reálně poběží — nestačí `models.retrieve` (to je
 * zdarma a projde i bez kreditu). Pošle minimální dotaz (max_tokens 1), aby se
 * ukázal i problém s kreditem/billingem. Vyhodí při neplatném klíči i nedostatku
 * kreditu. (Free backend se neprobíruje — je nativní a zdarma.)
 */
export async function checkAi(apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: 8000, maxRetries: 0 });
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1,
    messages: [{ role: 'user', content: '.' }],
  });
  return res.model;
}

function payloadFor(targets: LineItem[]): Array<{ id: string; merchant: string; amount: number; date: string }> {
  return targets.map((r) => ({ id: r.id, merchant: r.merchant ?? '', amount: r.amount, date: r.date_txn ?? '' }));
}

async function callAnthropic(targets: LineItem[], apiKey: string): Promise<Classified[]> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(payloadFor(targets)) }],
  });

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AI nevrátila textový blok');
  return parseItems(text.text);
}

async function callWorkersAi(targets: LineItem[], ai: Ai): Promise<Classified[]> {
  const system = `${SYSTEM} Vrať POUZE JSON tvaru {"items":[{"id":"…","category":"…","note":"…","merchant":"…","claimable":true}]} bez dalšího textu, bez markdownu.`;

  const res = (await ai.run(WORKERS_AI_MODEL, {
    temperature: 0,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payloadFor(targets)) },
    ],
  })) as { response?: string };

  return parseItems(res.response ?? '');
}

/** Vytáhne `items` z odpovědi. Model je občas obalí textem/```json — jsme tolerantní. */
function parseItems(text: string): Classified[] {
  const parsed = JSON.parse(extractJson(text)) as { items?: unknown };
  if (!Array.isArray(parsed.items)) throw new Error('AI odpověď nemá pole items');
  return parsed.items as Classified[];
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('AI nevrátila JSON');
  return body.slice(start, end + 1);
}
