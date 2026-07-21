import { describe, expect, it } from 'vitest';
import { dedupe } from '../src/dedup.js';
import { fingerprint } from '../src/util.js';
import type { LedgerEntry, LineItem } from '../src/types.js';

function row(id: string, date: string, amount: number, source: LineItem['source'] = 'fio'): LineItem {
  return {
    id, source, fingerprint: fingerprint(date, amount), status: 'NEW',
    mandatory: false, include: true, amount, message: `${id} ze dne ${date}`, date_txn: date,
  };
}

function hist(date: string, amount: number): LedgerEntry {
  return { fingerprint: fingerprint(date, amount), date_txn: date, amount, source: 'history' };
}

describe('dedupe', () => {
  it('shodu proti historii označí a vyřadí, ale nesmaže', () => {
    const { rows, report } = dedupe([row('a', '2026-05-01', 419)], [hist('2026-05-01', 419)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ALREADY_CLAIMED');
    expect(rows[0].include).toBe(false);
    expect(rows[0].note).toContain('Už uplatněno');
    expect(report.alreadyClaimed).toBe(1);
  });

  it('týž náklad z Fio i Revolutu nechá jednou', () => {
    const { rows, report } = dedupe(
      [row('fio', '2026-05-02', 1898.59, 'fio'), row('rev', '2026-05-02', 1898.59, 'revolut')],
      [],
    );
    expect(rows[0].status).toBe('NEW');
    expect(rows[0].include).toBe(true);
    expect(rows[1].status).toBe('DUPLICATE_IN_BATCH');
    expect(rows[1].include).toBe(false);
    expect(report).toEqual({ new: 1, alreadyClaimed: 0, duplicateInBatch: 1 });
  });

  it('počítá výskyty: 2 v historii vs. 3 nově → třetí zůstane NEW', () => {
    const batch = [row('a', '2026-06-01', 250), row('b', '2026-06-01', 250), row('c', '2026-06-01', 250)];
    const history = [hist('2026-06-01', 250), hist('2026-06-01', 250)];
    const { rows } = dedupe(batch, history);
    expect(rows.map((r) => r.status)).toEqual(['ALREADY_CLAIMED', 'DUPLICATE_IN_BATCH', 'DUPLICATE_IN_BATCH']);
  });

  it('legitimní duplicita v jeden den se dá přebít (řádek zůstává v seznamu)', () => {
    const { rows } = dedupe([row('alza1', '2026-06-10', 999), row('alza2', '2026-06-10', 999)], []);
    expect(rows).toHaveLength(2);
    expect(rows[1].include).toBe(false); // uživatel může v UI zapnout zpět
  });

  it('pravidelné platby dedup neřeší', () => {
    const rec: LineItem = {
      id: 'rec-9', source: 'pravidelna', fingerprint: 'rec|9|2026-07-21', status: 'NEW',
      mandatory: true, include: true, amount: 2800, message: 'plyn záloha',
    };
    const { rows, report } = dedupe([rec], [hist('2026-07-01', 2800)]);
    expect(rows[0].status).toBe('NEW');
    expect(rows[0].include).toBe(true);
    expect(report.new).toBe(1);
  });
});
