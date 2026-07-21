import { describe, expect, it } from 'vitest';
import { buildXml, validate } from '../src/xml.js';
import { parseFioCard } from '../src/parse/fioCard.js';
import type { LineItem } from '../src/types.js';

const FIO_PASTE = [
  'Platba kartou\tAktuální\t04.07.2026 14:59\t05.07.2026 14:02\tOrlen\t994,72\tCZK\tdovolená\tPHM',
  'Platba kartou\tAktuální\t06.07.2026 12:26\t07.07.2026 14:08\tŻabka\t196,94\tCZK\tdovolená\tnákup',
].join('\n');

/** Referenční transakce z docs/SAMPLE_DATA.md — pořadí polí je závazné. */
const REFERENCE = [
  '\t\t<DomesticTransaction>',
  '\t\t\t<accountFrom>2401442781</accountFrom>',
  '\t\t\t<currency>CZK</currency>',
  '\t\t\t<amount>994.72</amount>',
  '\t\t\t<accountTo>2900203312</accountTo>',
  '\t\t\t<bankCode>2010</bankCode>',
  '\t\t\t<date>2026-07-21</date>',
  '\t\t\t<messageForRecipient>Dovolená - PHM ze dne 04.07.2026 Orlen</messageForRecipient>',
  '\t\t\t<comment>Dovolená - PHM ze dne 04.07.2026 Orlen</comment>',
  '\t\t\t<paymentType>431001</paymentType>',
  '\t\t</DomesticTransaction>',
].join('\r\n');

describe('buildXml', () => {
  const rows = parseFioCard(FIO_PASTE);
  const xml = buildXml(rows, '2026-07-21');

  it('sedí na referenční transakci znak po znaku', () => {
    expect(xml).toContain(REFERENCE);
  });

  it('má hlavičku, CRLF a žádné komentáře', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n')).toBe(true);
    expect(xml).toContain('<Import xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
    expect(xml).not.toContain('<!--');
    expect(/[^\r]\n/.test(xml)).toBe(false);
    expect(xml.endsWith('</Import>\r\n')).toBe(true);
  });

  it('messageForRecipient === comment', () => {
    const msgs = [...xml.matchAll(/<messageForRecipient>(.*?)<\/messageForRecipient>/g)].map((m) => m[1]);
    const comments = [...xml.matchAll(/<comment>(.*?)<\/comment>/g)].map((m) => m[1]);
    expect(msgs).toEqual(comments);
  });

  it('escapuje ampersand v textu', () => {
    const row: LineItem = {
      id: 'x', source: 'fio', fingerprint: 'x', status: 'NEW', mandatory: false,
      include: true, amount: 10, message: 'Nákup H&M',
    };
    expect(buildXml([row], '2026-07-21')).toContain('<comment>Nákup H&amp;M</comment>');
  });
});

describe('validate', () => {
  const rows = parseFioCard(FIO_PASTE);

  it('spočítá kontrolní součet a počty', () => {
    const v = validate(rows, '2026-07-21', buildXml(rows, '2026-07-21'));
    expect(v.ok).toBe(true);
    expect(v.count).toBe(2);
    expect(v.total).toBe(1191.66);
    expect(v.bySource).toEqual({ fio: 2 });
  });

  it('hlásí dlouhé zprávy nad limit Fio (~140 znaků)', () => {
    const long: LineItem = {
      id: 'x', source: 'fio', fingerprint: 'x', status: 'NEW', mandatory: false,
      include: true, amount: 10, message: 'a'.repeat(141),
    };
    const v = validate([long], '2026-07-21', buildXml([long], '2026-07-21'));
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes('delší než 140'))).toBe(true);
  });
});
