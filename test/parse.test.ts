import { describe, expect, it } from 'vitest';
import { parseFioCard } from '../src/parse/fioCard.js';
import { parseRevolut } from '../src/parse/revolut.js';
import { parseHistoryCsv } from '../src/parse/fioCsv.js';
import { parsePrevXml, prevXmlToLedger } from '../src/parse/prevXml.js';

describe('Fio — copy-paste z IB', () => {
  const paste = [
    'Platba kartou\tAktuální\t04.07.2026 14:59\t05.07.2026 14:02\tOrlen\t994,72\tCZK\tdovolená\tPHM',
    'Bankomat\tAktuální\t05.07.2026 09:00\t05.07.2026 09:00\tCSOB ATM Brno Vinohrady 123456\t2000\tCZK\t\tvýběr',
    'Příchozí platba\tAktuální\t05.07.2026 10:00\t05.07.2026 10:00\tMzda\t50000\tCZK\t\t',
  ].join('\r\n');

  const rows = parseFioCard(paste);

  it('bere jen platby kartou a bankomat, ne příchozí', () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source)).toEqual(['fio', 'fio']);
  });

  it('skládá text zprávy a otisk', () => {
    expect(rows[0].message).toBe('Dovolená - PHM ze dne 04.07.2026 Orlen');
    expect(rows[0].fingerprint).toBe('2026-07-04|994.72');
    expect(rows[0].amount).toBe(994.72);
  });

  it('zkrátí ukecaný název bankomatu', () => {
    expect(rows[1].message.length).toBeLessThanOrEqual(140);
    expect(rows[1].message).toContain('výběr ze dne 05.07.2026');
  });
});

describe('Revolut CSV', () => {
  const csv = [
    'Typ,Produkt,Datum zahájení,Datum dokončení,Popis,Částka,Poplatek,Měna,State,Zůstatek',
    'Platba kartou,Aktuální,2026-05-01 03:45:46,2026-05-01 11:37:24,Netflix,-419.00,0.00,CZK,DOKONČENO,3218.53',
    'Platba kartou,Aktuální,2026-05-02 03:45:46,2026-05-02 11:37:24,Lidl,-1898.59,0.00,CZK,DOKONČENO,1319.94',
    'Platba kartou,Aktuální,2026-05-03 03:45:46,2026-05-03 11:37:24,Zrušená,-100.00,0.00,CZK,ZRUŠENO,1219.94',
    'Dobití,Aktuální,2026-05-04 03:45:46,2026-05-04 11:37:24,Vklad,5000.00,0.00,CZK,DOKONČENO,6219.94',
    'Platba kartou,Aktuální,2026-05-05 03:45:46,2026-05-05 11:37:24,Zabka Warszawa,-25.40,0.00,PLN,DOKONČENO,6194.54',
  ].join('\n');

  const rows = parseRevolut(csv);

  it('bere jen DOKONČENO výdaje kartou/bankomat', () => {
    expect(rows.map((r) => r.merchant)).toEqual(['Netflix', 'Lidl', 'Zabka Warszawa']);
  });

  it('otáčí znaménko a počítá otisk z data dokončení', () => {
    expect(rows[1].amount).toBe(1898.59);
    expect(rows[1].fingerprint).toBe('2026-05-02|1898.59');
  });

  it('cizoměnový řádek vyřadí a upozorní', () => {
    const pln = rows[2];
    expect(pln.currency_orig).toBe('PLN');
    expect(pln.include).toBe(false);
    expect(pln.note).toContain('CZK ekvivalent');
  });
});

describe('Fio CSV pohyby (historie pro dedup)', () => {
  const csv = [
    '﻿"Datum";"Objem";"Měna";"Protiúčet";"Kód banky";"Zpráva pro příjemce";"Poznámka";"Typ";"VS"',
    '"03.03.2023";"1290,5";"CZK";"2401442781";"2010";"Lidl  Za Nakup ze dne 28.02.2023";"";"Platba převodem uvnitř banky";""',
    '"10.03.2023";"-500";"CZK";"2401442781";"2010";"odchozí platba";"";"Platba převodem uvnitř banky";""',
  ].join('\r\n');

  const entries = parseHistoryCsv(csv);

  it('bere jen příchozí a datum čte z textu „ze dne"', () => {
    expect(entries).toHaveLength(1);
    expect(entries[0].date_txn).toBe('2023-02-28');
    expect(entries[0].amount).toBe(1290.5);
    expect(entries[0].fingerprint).toBe('2023-02-28|1290.50');
  });
});

describe('minulé XML', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Import xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<Orders>',
    '\t\t<DomesticTransaction>',
    '\t\t\t<amount>994.72</amount>',
    '\t\t\t<date>2026-07-21</date>',
    '\t\t\t<comment>Dovolená - PHM ze dne 04.07.2026 Orlen</comment>',
    '\t\t</DomesticTransaction>',
    '\t\t<DomesticTransaction>',
    '\t\t\t<amount>3600</amount>',
    '\t\t\t<date>2026-07-21</date>',
    '\t\t\t<comment>plyn záloha Havlíčkova486-červenec 2026</comment>',
    '\t\t</DomesticTransaction>',
    '\t</Orders>',
    '</Import>',
  ].join('\r\n');

  it('vytáhne všechny transakce', () => {
    const txns = parsePrevXml(xml);
    expect(txns).toHaveLength(2);
    expect(txns[1].amount).toBe(3600);
  });

  it('do ledgeru jdou jen řádky s datem transakce v textu', () => {
    const ledger = prevXmlToLedger(xml);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].fingerprint).toBe('2026-07-04|994.72');
  });
});
