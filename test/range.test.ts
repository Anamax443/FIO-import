import { describe, expect, it } from 'vitest';
import { inRange } from '../src/util.js';

describe('období transakcí', () => {
  it('meze jsou včetně', () => {
    expect(inRange('2026-07-01', '2026-07-01', '2026-07-31')).toBe(true);
    expect(inRange('2026-07-31', '2026-07-01', '2026-07-31')).toBe(true);
  });

  it('mimo období vypadne', () => {
    expect(inRange('2026-06-30', '2026-07-01', '2026-07-31')).toBe(false);
    expect(inRange('2026-08-01', '2026-07-01', '2026-07-31')).toBe(false);
  });

  it('jednostranné omezení funguje', () => {
    expect(inRange('2026-06-30', '2026-07-01', undefined)).toBe(false);
    expect(inRange('2026-08-01', '2026-07-01', undefined)).toBe(true);
    expect(inRange('2026-08-01', undefined, '2026-07-31')).toBe(false);
  });

  it('bez omezení projde vše', () => {
    expect(inRange('2020-01-01')).toBe(true);
  });

  it('řádky bez data transakce (pravidelné platby) projdou vždy', () => {
    expect(inRange(undefined, '2026-07-01', '2026-07-31')).toBe(true);
  });
});
