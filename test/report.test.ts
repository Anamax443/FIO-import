import { describe, expect, it } from 'vitest';
import { summarize, buildCsv, buildReportHtml } from '../public/report.js';

/** Stejný formát čísla jako v reportu (cs-CZ používá pevnou mezeru jako oddělovač tisíců). */
const czk = (n: number) => new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2 }).format(n);

const ROWS = [
  { source: 'fio', status: 'NEW', include: true, amount: 100, kategorie: 'PHM', message: 'PHM ze dne 01.07.2026 Orlen', date_txn: '2026-07-01', mandatory: false },
  { source: 'fio', status: 'NEW', include: true, amount: 50, kategorie: 'nákup', message: 'nákup Lidl', date_txn: '2026-07-02', mandatory: false },
  { source: 'pravidelna', status: 'NEW', include: true, amount: 2800, kategorie: undefined, message: 'plyn', date_txn: undefined, mandatory: true },
  { source: 'revolut', status: 'ALREADY_CLAIMED', include: false, amount: 419, kategorie: 'předplatné', message: 'Netflix', date_txn: '2026-07-03', mandatory: false },
];

const LABELS = {
  locale: 'cs-CZ', lang: 'cs',
  source: 'Zdroj', status: 'Stav', date: 'Datum', category: 'Kategorie', amount: 'Částka', include: 'Do XML', message: 'Zpráva',
  yes: 'ano', no: 'ne', statusMap: { NEW: 'nový', ALREADY_CLAIMED: 'už uplatněno', DUPLICATE_IN_BATCH: 'duplicita' },
  reportTitle: 'Přehled', due: 'Splatnost', generatedAt: 'kdy', version: 'verze',
  active: 'Aktivní', sum: 'Součet', allRows: 'Řádky',
  activeOrders: 'Příkazů', checksum: 'Součet', mandatory: 'Povinné', claimed: 'Uplatněno', duplicate: 'Duplicity',
  bySource: 'Podle zdroje', byCategory: 'Podle kategorie',
};

describe('summarize', () => {
  const s = summarize(ROWS);

  it('počítá jen zapnuté řádky do součtu a počtu příkazů', () => {
    expect(s.activeCount).toBe(3);           // Netflix je vypnutý
    expect(s.total).toBe(2950);              // 100 + 50 + 2800
  });

  it('sleduje stavy dedupu a povinné platby', () => {
    expect(s.claimed).toBe(1);
    expect(s.duplicate).toBe(0);
    expect(s.mandatory).toBe(1);
    expect(s.mandatoryTotal).toBe(2800);
  });

  it('rozpad podle zdroje má součty jen ze zapnutých', () => {
    const fio = s.bySource.find((g) => g.key === 'fio');
    expect(fio).toMatchObject({ count: 2, active: 2, total: 150 });
    const rev = s.bySource.find((g) => g.key === 'revolut');
    expect(rev).toMatchObject({ count: 1, active: 0, total: 0 });
  });

  it('rozpad podle kategorie, prázdná kategorie jako —', () => {
    expect(s.byCategory.find((g) => g.key === '—')).toMatchObject({ count: 1 });
  });
});

describe('buildCsv', () => {
  const csv = buildCsv(ROWS, LABELS);

  it('začíná BOM a hlavičkou se středníky', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('Zdroj;Stav;Datum;Kategorie;Částka;Do XML;Zpráva');
  });

  it('desetinná čárka a český stav', () => {
    expect(csv).toContain('fio;nový;2026-07-01;PHM;100;ano;');
    expect(csv).toContain('revolut;už uplatněno;2026-07-03;předplatné;419;ne;');
  });

  it('escapuje středník v textu uvozovkami', () => {
    const tricky = buildCsv([{ source: 'fio', status: 'NEW', include: true, amount: 1, message: 'a;b' }], LABELS);
    expect(tricky).toContain('"a;b"');
  });
});

describe('buildReportHtml', () => {
  const html = buildReportHtml(ROWS, summarize(ROWS), LABELS, { date: '2026-07-21', now: '21.7.', commit: 'abc' });

  it('je platné HTML se souhrnem i tabulkou', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(czk(2950)); // kontrolní součet naformátovaný
    expect(html).toContain('Netflix');
    expect(html).toContain('class="off"'); // vypnutý řádek přeškrtnutý
  });

  it('escapuje < > & v textu', () => {
    const h = buildReportHtml([{ source: 'fio', status: 'NEW', include: true, amount: 1, message: 'A & <b>' }], summarize([]), LABELS, { date: '', now: '', commit: '' });
    expect(h).toContain('A &amp; &lt;b&gt;');
  });
});
