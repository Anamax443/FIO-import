import { describe, expect, it } from 'vitest';
import { monthRange } from '../public/period.js';

// Base = 23. 7. 2026 (index měsíce 6 = červenec). Explicitní datum → deterministické.
const JUL = new Date(2026, 6, 23);

describe('monthRange', () => {
  it('offset 0 = aktuální měsíc base', () => {
    expect(monthRange(JUL, 0, 1)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('offset −1 = minulý měsíc (jako dřívější „Minulý měsíc")', () => {
    expect(monthRange(JUL, -1, 1)).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('offset 0, count 2 = poslední 2 měsíce včetně aktuálního', () => {
    expect(monthRange(JUL, 0, 2)).toEqual({ from: '2026-06-01', to: '2026-07-31' });
  });

  it('offset −1, count 3 = tři měsíce končící minulým', () => {
    expect(monthRange(JUL, -1, 3)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('přetečení přes rok dozadu', () => {
    const JAN = new Date(2026, 0, 15);
    expect(monthRange(JAN, -1, 1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('přetečení přes rok dopředu (offset +1)', () => {
    const DEC = new Date(2026, 11, 10);
    expect(monthRange(DEC, 1, 1)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });

  it('únor v přestupném roce má 29 dní', () => {
    const FEB = new Date(2028, 1, 5);
    expect(monthRange(FEB, 0, 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('nesmyslný počet spadne na 1, offset se ořízne na celé číslo', () => {
    expect(monthRange(JUL, -1.9, 0)).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });
});
