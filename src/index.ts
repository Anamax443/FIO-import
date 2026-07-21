/**
 * Cloudflare Worker: API + statické UI.
 *
 * Tok dat (docs/ARCHITECTURE.md):
 *   /api/process  → parse → [AI] → dedup → návrh řádků (JSON) k ruční kontrole
 *   /api/generate → buildXml → zápis dávky + ledgeru do D1 → stažení .xml
 */

import { classify } from './ai.js';
import { dedupe } from './dedup.js';
import { parseFioCard } from './parse/fioCard.js';
import { parseHistoryCsv } from './parse/history.js';
import { parsePrevXml, prevXmlToLedger } from './parse/prevXml.js';
import { parseRevolut } from './parse/revolut.js';
import { buildRecurring, RECURRING_TEMPLATE, type RecurringRow } from './recurring.js';
import { buildXml, DEFAULT_CONSTANTS, validate, type XmlConstants } from './xml.js';
import type { LedgerEntry, LineItem } from './types.js';

export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  ANTHROPIC_API_KEY?: string;
  COMMIT_SHA?: string;
  ACCOUNT_FROM?: string;
  ACCOUNT_TO?: string;
  BANK_CODE?: string;
  PAYMENT_TYPE?: string;
}

interface ProcessBody {
  date?: string;
  fio?: string;
  revolut?: string;
  historyCsv?: string;
  prevXml?: string;
  useAi?: boolean;
}

interface GenerateBody {
  date?: string;
  rows?: LineItem[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/version') return json({ commit: env.COMMIT_SHA ?? 'dev' });
      if (url.pathname === '/api/template') return json({ template: await loadTemplate(env) });
      if (url.pathname === '/api/process' && request.method === 'POST') return await handleProcess(request, env);
      if (url.pathname === '/api/generate' && request.method === 'POST') return await handleGenerate(request, env);
      if (url.pathname === '/api/ledger/import' && request.method === 'POST') return await handleLedgerImport(request, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Neznámý endpoint' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : 'Neočekávaná chyba' }, 500);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleProcess(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as ProcessBody;
  const date = body.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Datum splatnosti musí být RRRR-MM-DD.' }, 400);

  // 1) Výpisy → společný line-item model
  let rows: LineItem[] = [
    ...(body.fio ? parseFioCard(body.fio) : []),
    ...(body.revolut ? parseRevolut(body.revolut) : []),
  ];

  // 2) AI vrstva (best-effort, neblokuje)
  if (body.useAi !== false) {
    rows = await classify(rows, env.ANTHROPIC_API_KEY);
  }

  // 3) Pravidelné platby + carry-over částek z minulého XML
  const prev = body.prevXml ? parsePrevXml(body.prevXml) : [];
  const template = await loadTemplate(env);
  rows = [...rows, ...buildRecurring({ date, template, prev })];

  // 4) Historie už uplatněných nákladů: D1 ledger + nahrané CSV/XML v requestu
  const history: LedgerEntry[] = [
    ...(await loadLedger(env)),
    ...(body.historyCsv ? parseHistoryCsv(body.historyCsv) : []),
    ...(body.prevXml ? prevXmlToLedger(body.prevXml) : []),
  ];

  // 5) Dedup — shody se nemažou, jen předvyplní jako vyřazené
  const { rows: deduped, report } = dedupe(rows, history);

  return json({
    date,
    rows: deduped,
    report,
    historySize: history.length,
    aiUsed: body.useAi !== false && Boolean(env.ANTHROPIC_API_KEY),
  });
}

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as GenerateBody;
  const date = body.date ?? today();
  const rows = (body.rows ?? []).filter((r) => r.include);

  if (rows.length === 0) return json({ error: 'Není označen žádný řádek k odeslání.' }, 400);

  const xml = buildXml(rows, date, constants(env));
  const check = validate(rows, date, xml);
  if (!check.ok) return json({ error: 'Validace selhala.', problems: check.problems }, 400);

  await recordBatch(env, rows, date, check.total);

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename="fio-import-${date}.xml"`,
      'x-fio-count': String(check.count),
      'x-fio-total': String(check.total),
    },
  });
}

async function handleLedgerImport(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 databáze není nakonfigurovaná (viz docs/BUILD.md §3).' }, 501);

  const body = (await request.json()) as { csv?: string };
  if (!body.csv) return json({ error: 'Chybí pole csv.' }, 400);

  const entries = parseHistoryCsv(body.csv);
  await insertLedger(env.DB, entries, null);

  return json({ imported: entries.length });
}

/* ---------- D1 (volitelné — bez databáze appka funguje, jen si nepamatuje historii) ---------- */

async function loadTemplate(env: Env): Promise<RecurringRow[]> {
  if (!env.DB) return RECURRING_TEMPLATE;
  try {
    const { results } = await env.DB
      .prepare('SELECT ord, amount, mandatory, template FROM recurring_template ORDER BY ord')
      .all<{ ord: number; amount: number; mandatory: number; template: string }>();
    if (!results?.length) return RECURRING_TEMPLATE;
    return results.map((r) => ({ ...r, mandatory: r.mandatory === 1 }));
  } catch (err) {
    console.warn('Šablona z D1 nedostupná, beru zabudovanou:', err);
    return RECURRING_TEMPLATE;
  }
}

async function loadLedger(env: Env): Promise<LedgerEntry[]> {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare('SELECT fingerprint, date_txn, amount, merchant, source FROM claimed_ledger')
      .all<LedgerEntry>();
    return results ?? [];
  } catch (err) {
    console.warn('Ledger z D1 nedostupný, dedup jede jen z nahraných podkladů:', err);
    return [];
  }
}

async function recordBatch(env: Env, rows: LineItem[], date: string, total: number): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB
      .prepare('INSERT INTO batches (batch_date, count, total) VALUES (?, ?, ?)')
      .bind(date, rows.length, total)
      .run();

    const entries: LedgerEntry[] = rows
      .filter((r) => r.date_txn)
      .map((r) => ({
        fingerprint: r.fingerprint,
        date_txn: r.date_txn as string,
        amount: r.amount,
        merchant: r.merchant,
        source: r.source,
      }));
    await insertLedger(env.DB, entries, date);
  } catch (err) {
    // XML má uživatel dostat i tak — zápis auditu není důvod celou dávku shodit.
    console.error('Zápis dávky do D1 selhal:', err);
  }
}

async function insertLedger(db: D1Database, entries: LedgerEntry[], batchDate: string | null): Promise<void> {
  if (entries.length === 0) return;
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO claimed_ledger (fingerprint, date_txn, amount, merchant, source, batch_date) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const batch = entries.map((e) =>
    stmt.bind(e.fingerprint, e.date_txn, e.amount, e.merchant ?? null, e.source, batchDate),
  );
  await db.batch(batch);
}

/* ---------- pomocné ---------- */

function constants(env: Env): XmlConstants {
  return {
    ...DEFAULT_CONSTANTS,
    accountFrom: env.ACCOUNT_FROM ?? DEFAULT_CONSTANTS.accountFrom,
    accountTo: env.ACCOUNT_TO ?? DEFAULT_CONSTANTS.accountTo,
    bankCode: env.BANK_CODE ?? DEFAULT_CONSTANTS.bankCode,
    paymentType: env.PAYMENT_TYPE ?? DEFAULT_CONSTANTS.paymentType,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
