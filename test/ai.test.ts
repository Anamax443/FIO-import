import { describe, expect, it, vi } from 'vitest';
import { classify, providerChain } from '../src/ai.js';
import type { LineItem } from '../src/types.js';

// Placený backend v testech vždy „nemá kredit" — ověřuje fallback na Workers AI,
// aniž bychom sahali na síť.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: () => Promise.reject(new Error('Your credit balance is too low')) };
  },
}));

function rev(id: string, merchant: string, amount = 100): LineItem {
  return {
    id, source: 'revolut', fingerprint: `fp-${id}`, status: 'NEW',
    mandatory: false, include: true, amount, message: merchant, date_txn: '2026-07-04', merchant,
  };
}

/** Fake Workers AI binding, které vrátí zadanou odpověď. */
function fakeAi(response: string): Ai {
  return { run: () => Promise.resolve({ response }) } as unknown as Ai;
}

const okItems = (id = 'r1') => JSON.stringify({
  items: [{ id, category: 'PHM', note: 'benzín', merchant: 'ORLEN', claimable: true }],
});

describe('providerChain — pořadí backendů „dle úhrady"', () => {
  const ai = fakeAi('{}');

  it('off = žádný backend', () => {
    expect(providerChain({ provider: 'off', anthropicKey: 'x', ai })).toEqual([]);
  });
  it('workers-ai jen s bindingem', () => {
    expect(providerChain({ provider: 'workers-ai', ai })).toEqual(['workers-ai']);
    expect(providerChain({ provider: 'workers-ai' })).toEqual([]);
  });
  it('anthropic = placený, s free fallbackem (když je binding)', () => {
    expect(providerChain({ provider: 'anthropic', anthropicKey: 'x', ai })).toEqual(['anthropic', 'workers-ai']);
    expect(providerChain({ provider: 'anthropic', anthropicKey: 'x' })).toEqual(['anthropic']);
  });
  it('auto = placený když je klíč, jinak free; free jako fallback', () => {
    expect(providerChain({ anthropicKey: 'x', ai })).toEqual(['anthropic', 'workers-ai']);
    expect(providerChain({ ai })).toEqual(['workers-ai']);
    expect(providerChain({ anthropicKey: 'x' })).toEqual(['anthropic']);
    expect(providerChain({})).toEqual([]);
  });
});

describe('classify — Workers AI backend', () => {
  it('doplní kategorii, obchodníka a přepíše text zprávy', async () => {
    const { rows, provider } = await classify([rev('r1', 'ORLEN 12345')], { provider: 'workers-ai', ai: fakeAi(okItems()) });
    expect(provider).toBe('workers-ai');
    expect(rows[0].kategorie).toBe('PHM');
    expect(rows[0].merchant).toBe('ORLEN');
    expect(rows[0].message).toBe('PHM - benzín ze dne 04.07.2026 ORLEN');
  });

  it('snese JSON obalený v ```json fence', async () => {
    const fenced = '```json\n' + JSON.stringify({ items: [{ id: 'r1', category: 'nákup', note: 'nákup', merchant: 'Lidl', claimable: true }] }) + '\n```';
    const { rows, provider } = await classify([rev('r1', 'Lidl 998')], { provider: 'workers-ai', ai: fakeAi(fenced) });
    expect(provider).toBe('workers-ai');
    expect(rows[0].merchant).toBe('Lidl');
  });

  it('claimable=false řádek vyřadí a označí', async () => {
    const resp = JSON.stringify({ items: [{ id: 'r1', category: 'ostatní', note: 'předplatné', merchant: 'Netflix', claimable: false }] });
    const { rows } = await classify([rev('r1', 'Netflix')], { provider: 'workers-ai', ai: fakeAi(resp) });
    expect(rows[0].include).toBe(false);
    expect(rows[0].note).toContain('nevypadá');
  });

  it('nevalidní odpověď = řádky beze změny (best-effort)', async () => {
    const row = rev('r1', 'X');
    const { rows, provider } = await classify([row], { provider: 'workers-ai', ai: fakeAi('žádný json tady') });
    expect(provider).toBeNull();
    expect(rows).toEqual([row]);
  });

  it('bez Revolut řádků AI neběží', async () => {
    const fio: LineItem = { ...rev('f1', 'x'), source: 'fio' };
    const { rows, provider } = await classify([fio], { provider: 'workers-ai', ai: fakeAi(okItems()) });
    expect(provider).toBeNull();
    expect(rows).toEqual([fio]);
  });
});

describe('classify — fallback „dle úhrady"', () => {
  it('placený backend bez kreditu spadne na Workers AI', async () => {
    const { rows, provider } = await classify(
      [rev('r1', 'ORLEN 12345')],
      { provider: 'anthropic', anthropicKey: 'sk-test', ai: fakeAi(okItems()) },
    );
    expect(provider).toBe('workers-ai');
    expect(rows[0].kategorie).toBe('PHM');
  });

  it('bez jakéhokoli backendu vrátí vstup beze změny', async () => {
    const row = rev('r1', 'Lidl');
    const { rows, provider } = await classify([row], {});
    expect(provider).toBeNull();
    expect(rows).toEqual([row]);
  });
});
