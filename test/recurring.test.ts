import { describe, expect, it } from 'vitest';
import { buildRecurring, RECURRING_TEMPLATE } from '../src/recurring.js';
import { validate, buildXml } from '../src/xml.js';

describe('pravidelné platby', () => {
  const rows = buildRecurring({ date: '2026-07-21' });

  it('akceptační kritérium: 9 řádků, součet 8 314 CZK', () => {
    expect(rows).toHaveLength(9);
    const v = validate(rows, '2026-07-21', buildXml(rows, '2026-07-21'));
    expect(v.total).toBe(8314);
    expect(v.mandatoryCount).toBe(3);
  });

  it('doplní měsíc a rok podle data splatnosti', () => {
    expect(rows[0].message).toBe('Neo Modrý - telefon Maxík mobil (400 Kč) - červenec 2026');
    expect(rows[8].message).toBe('plyn záloha Havlíčkova486-červenec 2026');
    expect(rows[6].message).toBe('stočné záloha Havlíčkova 486_4 osoby_2026 červenec 2026');
  });

  it('mandatorní řádky jsou označené a zapnuté', () => {
    const mandatory = rows.filter((r) => r.mandatory);
    expect(mandatory.map((r) => r.amount)).toEqual([650, 3414, 2800]);
    expect(mandatory.every((r) => r.include)).toBe(true);
  });

  it('žádná zpráva nepřekročí limit Fio', () => {
    expect(rows.every((r) => r.message.length <= 140)).toBe(true);
  });

  it('carry-over přebere změněnou zálohu z minulého XML, měsíc přepíše', () => {
    const prev = [
      { amount: 3600, message: 'plyn záloha Havlíčkova486-červen 2026' },
      { amount: 994.72, message: 'Dovolená - PHM ze dne 04.06.2026 Orlen' }, // platba kartou = ignorovat
    ];
    const withCarry = buildRecurring({ date: '2026-07-21', prev });
    const plyn = withCarry.find((r) => r.message.startsWith('plyn záloha'));

    expect(plyn?.amount).toBe(3600);
    expect(plyn?.message).toBe('plyn záloha Havlíčkova486-červenec 2026');
    expect(plyn?.note).toContain('výchozí 2800');
    expect(withCarry).toHaveLength(RECURRING_TEMPLATE.length);
  });
});
