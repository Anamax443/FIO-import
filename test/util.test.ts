import { describe, expect, it } from 'vitest';
import {
  asciiFold, buildMsg, colIndex, czDate, dateFromMessage, fingerprint,
  formatAmount, normAmount, parseCsv, parseCzDate, parseIsoDate,
} from '../src/util.js';

describe('normAmount', () => {
  it('bere desetinnou čárku i tečku', () => {
    expect(normAmount('994,72')).toBe(994.72);
    expect(normAmount('-419.00')).toBe(-419);
    expect(normAmount('1290,5')).toBe(1290.5);
  });

  it('ignoruje oddělovač tisíců (mezera, nbsp, tečka)', () => {
    expect(normAmount('1 290,50')).toBe(1290.5);
    expect(normAmount('1 290,50')).toBe(1290.5);
    expect(normAmount('1.234.567')).toBe(1234567);
  });
});

describe('formatAmount', () => {
  it('celá čísla bez desetin, jinak dvě místa s tečkou', () => {
    expect(formatAmount(400)).toBe('400');
    expect(formatAmount(994.72)).toBe('994.72');
    expect(formatAmount(1290.5)).toBe('1290.50'); // desetinná část vždy na 2 místa
    expect(formatAmount(3414)).toBe('3414');
  });
});

describe('data', () => {
  it('parsuje české i ISO datum a otáčí zpět', () => {
    expect(parseCzDate('04.07.2026 14:59')).toBe('2026-07-04');
    expect(parseCzDate('4.7.2026')).toBe('2026-07-04');
    expect(parseIsoDate('2026-05-01 11:37:24')).toBe('2026-05-01');
    expect(czDate('2026-07-04')).toBe('04.07.2026');
  });

  it('vytáhne datum transakce z textu zprávy', () => {
    expect(dateFromMessage('Lidl  Za Nakup ze dne 28.02.2023')).toBe('2023-02-28');
    expect(dateFromMessage('plyn záloha Havlíčkova486-červenec 2026')).toBeNull();
  });
});

describe('asciiFold', () => {
  it('foldne cizí diakritiku, českou nechá', () => {
    expect(asciiFold('Żabka')).toBe('Zabka');
    expect(asciiFold('Gdański Zarząd Dróg')).toBe('Gdanski Zarzad Drog');
    expect(asciiFold('Havlíčkova 486')).toBe('Havlíčkova 486');
    expect(asciiFold('Łódź')).toBe('Lodz');
  });
});

describe('fingerprint', () => {
  it('klíč je datum + částka, obchodník v něm není', () => {
    expect(fingerprint('2026-07-04', 994.72)).toBe('2026-07-04|994.72');
    expect(fingerprint('2026-07-04', -994.72)).toBe(fingerprint('2026-07-04', 994.72));
  });
});

describe('buildMsg', () => {
  it('kategorie + poznámka + datum + obchodník', () => {
    expect(buildMsg({ kategorie: 'dovolená', poznamka: 'PHM', date_txn: '2026-07-04', merchant: 'Orlen' }))
      .toBe('Dovolená - PHM ze dne 04.07.2026 Orlen');
  });

  it('bez kategorie jen poznámka', () => {
    expect(buildMsg({ poznamka: 'nákup', date_txn: '2026-07-06', merchant: 'Żabka' }))
      .toBe('nákup ze dne 06.07.2026 Zabka');
  });
});

describe('parseCsv', () => {
  it('respektuje uvozovky, BOM a CRLF', () => {
    const csv = '﻿"Datum";"Objem"\r\n"03.03.2023";"1290,5"\r\n';
    expect(parseCsv(csv, ';')).toEqual([['Datum', 'Objem'], ['03.03.2023', '1290,5']]);
  });

  it('najde sloupec podle aliasu bez ohledu na diakritiku', () => {
    const header = ['Typ', 'Datum dokončení', 'Částka'];
    expect(colIndex(header, 'Datum dokončení', 'Completed Date')).toBe(1);
    expect(colIndex(header, 'Amount', 'Částka')).toBe(2);
    expect(colIndex(header, 'Neexistuje')).toBe(-1);
  });
});
