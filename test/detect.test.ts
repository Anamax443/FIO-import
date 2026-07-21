import { describe, expect, it } from 'vitest';
import { detectKind } from '../public/detect.js';

const FIO_PASTE = 'Platba kartou\tAktuální\t04.07.2026 14:59\t05.07.2026 14:02\tOrlen\t994,72\tCZK\tdovolená\tPHM';
const HISTORY = '﻿"Datum";"Objem";"Měna";"Protiúčet";"Kód banky";"Zpráva pro příjemce";"Poznámka";"Typ";"VS"\r\n"03.03.2023";"1290,5";…';
const REVOLUT = 'Typ,Produkt,Datum zahájení,Datum dokončení,Popis,Částka,Poplatek,Měna,State,Zůstatek\nPlatba kartou,Aktuální,…';
const PREV_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Import xmlns:xsi="…">';

describe('detectKind', () => {
  it('pozná Fio copy-paste', () => {
    expect(detectKind(FIO_PASTE, 'vypis.txt')).toBe('fio');
  });

  it('pozná Fio CSV pohyby (i s BOM a názvem Pohyby_na_uctu)', () => {
    expect(detectKind(HISTORY, 'Pohyby_na_uctu_260721.csv')).toBe('historyCsv');
    expect(detectKind(HISTORY, 'cokoliv.csv')).toBe('historyCsv');
  });

  it('pozná Revolut CSV', () => {
    expect(detectKind(REVOLUT, 'account-statement.csv')).toBe('revolut');
  });

  it('pozná minulé XML', () => {
    expect(detectKind(PREV_XML, 'fio-import-2026-06-21.xml')).toBe('prevXml');
  });

  it('nezamění pohyby účtu za Revolut ani naopak', () => {
    expect(detectKind(HISTORY, 'x.csv')).not.toBe('revolut');
    expect(detectKind(REVOLUT, 'x.csv')).not.toBe('historyCsv');
  });

  it('u neznámého obsahu vrátí null (použije se pole, kam uživatel pustil)', () => {
    expect(detectKind('jen nějaký text', 'poznamky.txt')).toBeNull();
    expect(detectKind('', '')).toBeNull();
  });

  it('podle názvu souboru dopadne správně i u prázdného obsahu', () => {
    expect(detectKind('', 'Pohyby_na_uctu.csv')).toBe('historyCsv');
    expect(detectKind('', 'revolut-export.csv')).toBe('revolut');
  });
});
