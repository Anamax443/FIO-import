import { describe, expect, it } from 'vitest';
import { parseFioMovements } from '../src/parse/fioCsv.js';

const H = '﻿"Datum";"Objem";"Měna";"Protiúčet";"Kód banky";"Zpráva pro příjemce";"Poznámka";"Typ";"VS"';

const CSV = [
  H,
  // výdaje (mínus)
  '"04.07.2026";"-994,72";"CZK";"";"";"";"Orlen Brno";"Platba kartou";""',
  '"05.07.2026";"-2000";"CZK";"";"";"";"CSOB ATM Brno";"Bankomat";""',
  '"06.07.2026";"-3500";"CZK";"1234567890";"0800";"nájem";"";"Platba převodem uvnitř banky";""',
  // příjmy (plus)
  '"07.07.2026";"1290,5";"CZK";"2401442781";"2010";"Lidl Za Nakup ze dne 28.06.2026";"";"Platba převodem uvnitř banky";""',
  '"08.07.2026";"50000";"CZK";"9876543210";"0300";"mzda";"";"Platba převodem";""',
].join('\r\n');

describe('Fio CSV pohyby — znaménko určuje význam', () => {
  const res = parseFioMovements(CSV, { accountFrom: '2401442781' });

  it('mínus u platby kartou / bankomatu = výdaj do dávky', () => {
    expect(res.expenses.map((e) => e.amount)).toEqual([994.72, 2000]);
    expect(res.expenses[0].message).toBe('PHM - PHM ze dne 04.07.2026 Orlen Brno');
    expect(res.expenses[1].message).toBe('výběr ze dne 05.07.2026 CSOB ATM Brno');
  });

  it('mínus u převodu (nájem, trvalý příkaz) se nebere', () => {
    expect(res.expenses.some((e) => e.merchant === 'nájem' || e.amount === 3500)).toBe(false);
  });

  it('plus z platebního účtu = už uplatněný náklad', () => {
    expect(res.history).toHaveLength(1);
    expect(res.history[0].date_txn).toBe('2026-06-28'); // datum z textu „ze dne", ne zaúčtování
    expect(res.history[0].amount).toBe(1290.5);
  });

  it('plus odjinud (mzda) se do historie NEdostane', () => {
    // Jinak by mzda 50 000 mohla vyřadit legitimní výdaj o shodné částce a datu.
    expect(res.history.some((h) => h.amount === 50000)).toBe(false);
  });

  it('bez zadaného platebního účtu se berou všechny příchozí (zpětná kompatibilita)', () => {
    const all = parseFioMovements(CSV);
    expect(all.history).toHaveLength(2);
  });

  it('výdaje mají otisk z data zaúčtování a jsou zapnuté', () => {
    expect(res.expenses[0].fingerprint).toBe('2026-07-04|994.72');
    expect(res.expenses.every((e) => e.include && e.source === 'fio')).toBe(true);
  });
});
