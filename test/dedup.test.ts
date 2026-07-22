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

  it('pravidelnou platbu dedup neřeší přes otisk (nemá datum txn)', () => {
    const rec: LineItem = {
      id: 'rec-9', source: 'pravidelna', fingerprint: 'rec|9|2026-07-21', status: 'NEW',
      mandatory: true, include: true, amount: 2800, message: 'plyn záloha Havlíčkova486-červenec 2026',
    };
    // Shodná částka jiné transakce v historii nesmí pravidelnou platbu vyřadit.
    const { rows, report } = dedupe([rec], [hist('2026-07-01', 2800)]);
    expect(rows[0].status).toBe('NEW');
    expect(rows[0].include).toBe(true);
    expect(report.new).toBe(1);
  });

  it('pravidelnou platbu vyřadí, když je její TEXT už v historii (zaplaceno tento měsíc)', () => {
    const rec: LineItem = {
      id: 'rec-1', source: 'pravidelna', fingerprint: 'rec|1|2026-07-21', status: 'NEW',
      mandatory: false, include: true, amount: 400,
      message: 'Neo Modrý - telefon Maxík mobil (400 Kč) - červenec 2026',
    };
    const paid: LedgerEntry = {
      fingerprint: '2026-07-21|400.00', date_txn: '2026-07-21', amount: 400,
      merchant: 'Neo Modrý - telefon Maxík mobil (400 Kč) - červenec 2026', source: 'history',
    };
    const { rows, report } = dedupe([rec], [paid]);
    expect(rows[0].status).toBe('ALREADY_CLAIMED');
    expect(rows[0].include).toBe(false);
    expect(rows[0].note).toContain('2026-07-21');
    expect(report.alreadyClaimed).toBe(1);
  });

  it('loňský/minulý text (jiný měsíc) pravidelnou platbu nevyřadí', () => {
    const rec: LineItem = {
      id: 'rec-1', source: 'pravidelna', fingerprint: 'rec|1|2026-07-21', status: 'NEW',
      mandatory: false, include: true, amount: 400,
      message: 'Neo Modrý - telefon Maxík mobil (400 Kč) - červenec 2026',
    };
    const lastMonth: LedgerEntry = {
      fingerprint: '2026-06-21|400.00', date_txn: '2026-06-21', amount: 400,
      merchant: 'Neo Modrý - telefon Maxík mobil (400 Kč) - červen 2026', source: 'prev_xml',
    };
    const { rows } = dedupe([rec], [lastMonth]);
    expect(rows[0].status).toBe('NEW');
    expect(rows[0].include).toBe(true);
  });

  // Regrese: šablona píše vedoucí podíl ½/¾, Fio ho ve „Zprávě pro příjemce"
  // nahradí `?` → dřív se řádek nespároval a Oneplay/O2/Rodinné se navrhly podruhé.
  it('pravidelnou platbu se zlomkem (½/¾) spáruje s ? z Fio výpisu', () => {
    const rec = (message: string, amount: number): LineItem => ({
      id: `rec-${message}`, source: 'pravidelna', fingerprint: `rec|${message}`, status: 'NEW',
      mandatory: false, include: true, amount, message,
    });
    const paid = (merchant: string, amount: number): LedgerEntry => ({
      fingerprint: `2026-07-21|${amount}.00`, date_txn: '2026-07-21', amount, merchant, source: 'history',
    });

    const { rows, report } = dedupe(
      [
        rec('½ Oneplay Extra Sport (200 Kč) - červenec 2026', 200),
        rec('¾ O2 Internet MAX 250 (300 Kč) - červenec 2026', 300),
        rec('½ Rodinné sledování (50 Kč) - červenec 2026', 50),
      ],
      [
        paid('? Oneplay Extra Sport (200 Kč) - červenec 2026', 200),
        paid('? O2 Internet MAX 250 (300 Kč) - červenec 2026', 300),
        paid('? Rodinné sledování (50 Kč) - červenec 2026', 50),
      ],
    );

    expect(rows.map((r) => r.status)).toEqual(['ALREADY_CLAIMED', 'ALREADY_CLAIMED', 'ALREADY_CLAIMED']);
    expect(rows.every((r) => r.include === false)).toBe(true);
    expect(report).toMatchObject({ alreadyClaimed: 3, new: 0 });
  });

  it('smazání zlomku nezamění dvě různé ½ položky', () => {
    const rec: LineItem = {
      id: 'rec-3', source: 'pravidelna', fingerprint: 'rec|3', status: 'NEW',
      mandatory: false, include: true, amount: 200,
      message: '½ Oneplay Extra Sport (200 Kč) - červenec 2026',
    };
    // V historii je jen jiná ½ položka (Rodinné) — Oneplay se nesmí chytit.
    const other: LedgerEntry = {
      fingerprint: '2026-07-21|50.00', date_txn: '2026-07-21', amount: 50,
      merchant: '? Rodinné sledování (50 Kč) - červenec 2026', source: 'history',
    };
    const { rows } = dedupe([rec], [other]);
    expect(rows[0].status).toBe('NEW');
  });
});
