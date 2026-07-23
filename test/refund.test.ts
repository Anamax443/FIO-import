import { describe, expect, it } from 'vitest';
import { findRefunds, type RefundCandidate } from '../src/refund.js';
import type { LedgerEntry } from '../src/types.js';

// Už uplatněné výdaje (D1 ledger). Částky kladné, jak je ukládá recordBatch.
const HISTORY: LedgerEntry[] = [
  { fingerprint: 'a', date_txn: '2026-06-03', amount: 640, merchant: 'Albert 123', source: 'fio' },
  { fingerprint: 'b', date_txn: '2026-06-10', amount: 1200, merchant: 'nákup Lidl', source: 'revolut' },
  { fingerprint: 'c', date_txn: '2026-05-01', amount: 900, merchant: 'Orlen PHM', source: 'revolut' },
];

const cand = (o: Partial<RefundCandidate> & { id: string }): RefundCandidate => ({ source: 'fio', amount: 0, ...o });

describe('findRefunds', () => {
  it('plná refundace k už rozúčtovanému výdaji', () => {
    const [f] = findRefunds([cand({ id: 'r1', merchant: 'ALBERT 123', amount: 640, date_txn: '2026-06-20' })], HISTORY);
    expect(f.kind).toBe('full');
    expect(f.match.date_txn).toBe('2026-06-03');
    expect(f.match.amount).toBe(640);
    expect(f.daysAfter).toBe(17);
  });

  it('částečná refundace (vráceno míň než výdaj)', () => {
    const [f] = findRefunds([cand({ id: 'r2', merchant: 'Lidl', amount: 300, date_txn: '2026-06-15' })], HISTORY);
    expect(f.kind).toBe('partial');
    expect(f.match.amount).toBe(1200);
    expect(f.daysAfter).toBe(5);
  });

  it('párování obchodníka snese rozdílný text (Lidl × nákup Lidl)', () => {
    const flags = findRefunds([cand({ id: 'r2', merchant: 'Lidl', amount: 1200, date_txn: '2026-06-12' })], HISTORY);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('full');
  });

  it('vrácení vyšší než výdaj se nespáruje', () => {
    expect(findRefunds([cand({ id: 'r3', merchant: 'Albert', amount: 2000, date_txn: '2026-06-21' })], HISTORY)).toEqual([]);
  });

  it('vrácení před nákupem se ignoruje', () => {
    expect(findRefunds([cand({ id: 'r4', merchant: 'Orlen', amount: 900, date_txn: '2026-04-20' })], HISTORY)).toEqual([]);
  });

  it('mimo časové okno se ignoruje', () => {
    expect(findRefunds([cand({ id: 'r5', merchant: 'Orlen', amount: 900, date_txn: '2026-11-01' })], HISTORY)).toEqual([]);
  });

  it('jiný obchodník se nespáruje', () => {
    expect(findRefunds([cand({ id: 'r6', merchant: 'Kaufland', amount: 640, date_txn: '2026-06-20' })], HISTORY)).toEqual([]);
  });

  it('výdaj (záporná částka) není kandidát na refundaci', () => {
    expect(findRefunds([cand({ id: 'r7', merchant: 'Albert', amount: -640, date_txn: '2026-06-20' })], HISTORY)).toEqual([]);
  });

  it('bez data kandidáta se páruje na obchodníka + částku (daysAfter null)', () => {
    const [f] = findRefunds([cand({ id: 'r8', merchant: 'Albert 123', amount: 640 })], HISTORY);
    expect(f.kind).toBe('full');
    expect(f.daysAfter).toBeNull();
  });

  it('krátký token (mol) nechytne substring (smolařova)', () => {
    const hist: LedgerEntry[] = [{ fingerprint: 'x', date_txn: '2026-06-01', amount: 500, merchant: 'Smolařova pekárna', source: 'fio' }];
    expect(findRefunds([cand({ id: 'r9', merchant: 'MOL', amount: 500, date_txn: '2026-06-05' })], hist)).toEqual([]);
  });

  it('plné shody řadí před částečné', () => {
    const flags = findRefunds([
      cand({ id: 'p', merchant: 'Lidl', amount: 300, date_txn: '2026-06-15' }),        // partial
      cand({ id: 'f', merchant: 'Albert 123', amount: 640, date_txn: '2026-06-20' }),  // full
    ], HISTORY);
    expect(flags.map((f) => f.kind)).toEqual(['full', 'partial']);
  });
});
