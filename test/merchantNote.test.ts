import { describe, expect, it } from 'vitest';
import { guessNote } from '../src/merchantNote.js';
import { parseRevolut } from '../src/parse/revolut.js';

describe('guessNote', () => {
  it('pozná čerpačku, obchod, parkoviště a lékárnu', () => {
    expect(guessNote('Orlen Brno')).toEqual({ kategorie: 'PHM', poznamka: 'PHM' });
    expect(guessNote('LIDL 1234')).toEqual({ kategorie: 'nákup', poznamka: 'nákup' });
    expect(guessNote('Parkoviste Vinohrady')).toEqual({ kategorie: 'parkování', poznamka: 'parkování' });
    expect(guessNote('Dr.Max lékárna')).toEqual({ kategorie: 'léky', poznamka: 'léky' });
  });

  it('funguje bez ohledu na diakritiku a velikost písmen', () => {
    expect(guessNote('Žabka Praha').poznamka).toBe('nákup');
    expect(guessNote('LÉKÁRNA BENU').poznamka).toBe('léky');
  });

  it('výběr z bankomatu pozná i podle typu pohybu', () => {
    expect(guessNote('CSOB', 'Výběr z bankomatu')).toEqual({ poznamka: 'výběr' });
    expect(guessNote('ATM Wien')).toEqual({ poznamka: 'výběr' });
  });

  it('u neznámého obchodníka si nic nevymýšlí', () => {
    expect(guessNote('Nejaky Neznamy Obchod')).toEqual({ poznamka: 'platba kartou' });
  });
});

describe('Revolut → text zprávy', () => {
  const csv = [
    'Typ,Produkt,Datum zahájení,Datum dokončení,Popis,Částka,Poplatek,Měna,State,Zůstatek',
    'Platba kartou,Aktuální,2026-07-01 03:45,2026-07-01 11:37,Orlen Brno,-994.72,0.00,CZK,DOKONČENO,3218.53',
    'Platba kartou,Aktuální,2026-07-02 03:45,2026-07-02 11:37,Lidl 1234,-350.00,0.00,CZK,DOKONČENO,2868.53',
    'Výběr z bankomatu,Aktuální,2026-07-03 03:45,2026-07-03 11:37,CSOB ATM,-2000.00,0.00,CZK,DOKONČENO,868.53',
  ].join('\n');

  const rows = parseRevolut(csv);

  it('každý řádek popíše podle toho, co to je — ne všude „nákup"', () => {
    expect(rows.map((r) => r.message)).toEqual([
      'PHM - PHM ze dne 01.07.2026 Orlen Brno',
      'Nákup - nákup ze dne 02.07.2026 Lidl 1234',
      'výběr ze dne 03.07.2026 CSOB ATM',
    ]);
  });
});
