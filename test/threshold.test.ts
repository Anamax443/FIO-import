import { describe, expect, it } from 'vitest';
import { applyMinAmount, DEFAULT_MIN_AMOUNT } from '../src/threshold.js';
import type { LineItem } from '../src/types.js';

function item(source: LineItem['source'], amount: number, include = true): LineItem {
  return {
    id: `${source}-${amount}`, source, fingerprint: `fp-${source}-${amount}`, status: 'NEW',
    mandatory: false, include, amount, message: `${source} ${amount}`,
  };
}

describe('applyMinAmount — minimální částka výdaje', () => {
  it('výchozí práh je 200', () => {
    expect(DEFAULT_MIN_AMOUNT).toBe(200);
  });

  it('výdaj z výpisu pod prahem vypne a označí, řádek nemaže', () => {
    const out = applyMinAmount([item('revolut', 150)], 200);
    expect(out).toHaveLength(1);
    expect(out[0].include).toBe(false);
    expect(out[0].note).toContain('minimální částkou (200');
  });

  it('výdaj na prahu i nad prahem nechá zapnutý', () => {
    const out = applyMinAmount([item('fio', 200), item('revolut', 250)], 200);
    expect(out.every((r) => r.include)).toBe(true);
    expect(out.every((r) => !r.note)).toBe(true);
  });

  it('pravidelných / povinných plateb se netýká (i pod prahem)', () => {
    const rec = { ...item('pravidelna', 50), mandatory: true };
    const out = applyMinAmount([rec], 200);
    expect(out[0].include).toBe(true);
    expect(out[0].note).toBeUndefined();
  });

  it('už vypnutý řádek (dedup, cizí měna) nechá být a nepřepíše poznámku', () => {
    const excluded = item('revolut', 100, false);
    excluded.note = 'AI: předplatné';
    const out = applyMinAmount([excluded], 200);
    expect(out[0].include).toBe(false);
    expect(out[0].note).toBe('AI: předplatné');
  });

  it('práh 0 nebo neplatný = bez filtru', () => {
    const rows = [item('revolut', 10)];
    expect(applyMinAmount(rows, 0)[0].include).toBe(true);
    expect(applyMinAmount(rows, Number.NaN)[0].include).toBe(true);
  });

  it('variabilní práh: 500 vypne i položku za 300', () => {
    const out = applyMinAmount([item('fio', 300)], 500);
    expect(out[0].include).toBe(false);
  });
});
