# Vzorová data a akceptační kritéria

Reálné formáty vstupů a čísla ověřená na přiložených výpisech. Slouží jako ground-truth
pro implementaci a testy — parser je správný, když sedí na tato čísla.

## Vstupní formáty (reálné)

### Fio – copy-paste (tab-separated)
Sloupce: `Typ · Stav · DatumTxn · DatumZauct · Obchodník · Částka · Měna · Kategorie · Poznámka`
```
Platba kartou	Aktuální	04.07.2026 14:59	05.07.2026 14:02	Orlen	994,72	CZK	dovolená	PHM
Platba kartou	Aktuální	06.07.2026 12:26	07.07.2026 14:08	Żabka	196,94	CZK	dovolená	nákup
```
Bere se `Platba kartou` / `Bankomat`. Částka desetinná čárka. Datum = jen DatumTxn (bez času).

### Fio – CSV pohyby na 2900203312 (zdroj historie pro dedup)
UTF-8 **s BOM**, **CRLF**, oddělovač **`;`**, hodnoty v uvozovkách, **desetinná čárka**.
Sloupce: `Datum;Objem;Měna;Protiúčet;Kód banky;Zpráva pro příjemce;Poznámka;Typ;VS`
```
"03.03.2023";"1290,5";"CZK";"2401442781";"2010";"Lidl  Za Nakup ze dne 28.02.2023";"…";"Platba převodem uvnitř banky";""
```
Příchozí (`Objem > 0`) = už uplatněné náklady. Datum transakce z textu `… ze dne DD.MM.RRRR`.

### Revolut – CSV export
UTF-8, oddělovač **`,`**, **desetinná tečka**.
Sloupce: `Typ,Produkt,Datum zahájení,Datum dokončení,Popis,Částka,Poplatek,Měna,State,Zůstatek`
```
Platba kartou,Aktuální,2026-05-01 03:45:46,2026-05-01 11:37:24,Netflix,-419.00,0.00,CZK,DOKONČENO,3218.53
```
Bere se `State = DOKONČENO`, typy `Platba kartou`/`Výběr z bankomatu`, `Částka < 0`. Kategorii/poznámku Revolut nemá → doplní AI vrstva. Vícemenové řádky: použít CZK ekvivalent, co padl.

## Výstup – přijaté XML (referenční)
Jedna transakce (pořadí polí závazné, `messageForRecipient === comment`):
```
	<DomesticTransaction>
		<accountFrom>2401442781</accountFrom>
		<currency>CZK</currency>
		<amount>994.72</amount>
		<accountTo>2900203312</accountTo>
		<bankCode>2010</bankCode>
		<date>2026-07-21</date>
		<messageForRecipient>Dovolená - PHM ze dne 04.07.2026 Orlen</messageForRecipient>
		<comment>Dovolená - PHM ze dne 04.07.2026 Orlen</comment>
		<paymentType>431001</paymentType>
	</DomesticTransaction>
```
Formát celého souboru: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` → `<Import xmlns:xsi="…">` → `<Orders>` → transakce → uzávěry. **Žádné komentáře, CRLF, tabulátory.**

## Akceptační kritéria (ověřeno na přiložených výpisech)

| Test | Očekávaný výsledek |
|------|--------------------|
| Fio karta – červencová dávka (36 řádků) | součet **33 750,92 CZK** |
| Pravidelné platby (9 řádků) | součet **8 314 CZK** |
| Celkem přijatá červencová dávka | **42 064,92 CZK**, 45 příkazů |
| Historie 2900203312 | ~880 příchozích (uplatněných) položek zpět do 03/2023 |
| Revolut výpis 05–07/2026 | ~130 výdajů kartou/bankomat (DOKONČENO) |
| Dedup Revolut × historie (klíč datum+částka) | **11 shod** ALREADY_CLAIMED (Netflix 419, Lidl 1898,59, MOL 1136,10, dálniční známka 300, …) |
| Dedup pravidelných se zlomkem (text) | `½ Oneplay 200`, `¾ O2 300`, `½ Rodinné 50` ze šablony se spárují s `? …` z výpisu příjemce → ALREADY_CLAIMED (banka `½/¾` ukládá jako `?`) |
| ASCII-fold | `Żabka` → `Zabka`, `Gdański Zarząd Dróg` → `Gdanski Zarzad Drog` |
| Dedup – falešné shody | dvě stejné Alza týž den = legitimní; shoda se NEmaže, jen include=false |

## Konstanty
`accountFrom 2401442781` → `accountTo 2900203312` / `bankCode 2010` · `paymentType 431001` · `currency CZK`.

## Pozn. k AI modelu
Model string ověř v konzoli Anthropicu (Haiku) před nasazením — může se lišit od hodnoty ve specifikaci.
