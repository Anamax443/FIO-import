import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../src/index.js';
import { RECURRING_TEMPLATE, buildRecurring } from '../src/recurring.js';

describe('validace šablony pravidelných plateb', () => {
  it('výchozí seznam projde', () => {
    const r = validateTemplate(RECURRING_TEMPLATE);
    expect('rows' in r && r.rows).toHaveLength(9);
  });

  it('přečísluje pořadí podle skutečného pořadí v seznamu', () => {
    const r = validateTemplate([
      { amount: 100, mandatory: false, template: 'druhá {mesic} {rok}' },
      { amount: 200, mandatory: true, template: 'první {mesic} {rok}' },
    ]);
    expect('rows' in r && r.rows.map((x) => x.ord)).toEqual([1, 2]);
  });

  it('odmítne prázdný seznam, prázdný text a nekladnou částku', () => {
    expect(validateTemplate([])).toHaveProperty('error');
    expect(validateTemplate([{ amount: 100, template: '  ' }])).toHaveProperty('error');
    expect(validateTemplate([{ amount: 0, template: 'x' }])).toHaveProperty('error');
    expect(validateTemplate([{ amount: -5, template: 'x' }])).toHaveProperty('error');
    expect(validateTemplate('nic')).toHaveProperty('error');
  });

  it('hlídá limit 140 znaků i pro nejdelší měsíc', () => {
    // 127 + „ listopad 2026" = 141 znaků → přes limit; s „červen" by ještě prošlo.
    const tooLong = `${'a'.repeat(127)} {mesic} {rok}`;
    const r = validateTemplate([{ amount: 100, template: tooLong }]);
    expect(r).toHaveProperty('error');
    if ('error' in r) expect(r.error).toContain('limit');

    // Přesně na limitu (140) projít musí.
    expect(validateTemplate([{ amount: 100, template: `${'a'.repeat(126)} {mesic} {rok}` }]))
      .toHaveProperty('rows');
  });

  it('uložená šablona se skutečně použije při sestavení dávky', () => {
    const custom = [{ ord: 1, amount: 1234, mandatory: true, template: 'moje platba {mesic} {rok}' }];
    const rows = buildRecurring({ date: '2026-11-15', template: custom });
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('moje platba listopad 2026');
    expect(rows[0].amount).toBe(1234);
    expect(rows[0].mandatory).toBe(true);
  });
});
