# Specifikace: Generátor Fio import XML (náklady)

Dokument popisuje, jak z **bankovních výpisů** (Fio + Revolut) a **pravidelných plateb** vytvořit XML pro hromadný import platebních příkazů do Fio banky. Slouží jako zadání pro aplikaci i jako přesný recept pro generování.

---

## 1. Účel a tok dat

Vstup: platby kartou z výpisů (Fio, Revolut) + pravidelné/mandatorní platby.
Výstup: jeden `.xml` s hromadnou dávkou tuzemských příkazů, který Fio přijme na první pokus, **bez dvojího uplatnění nákladů**.

```
Fio výpis     ─┐
Revolut výpis ─┼─► normalizace ─► DEDUPLIKACE ─► EDITACE/FILTRACE ─► generování ─► import Fio
Pravidelné ───┘   (společný      (proti historii   (review krok)     (jen označené)
                   line item)      už uplatněných)
                      ▲                  ▲
       šablona + carry-over        archiv přijatých XML / ledger
```

Všechny příkazy jdou z jednoho účtu na jeden účet (rozúčtování nákladů), liší se jen částka, zpráva a poznámka.

---

## 2. Kritická pravidla formátu (nedodržení = banka odmítne)

Tvrdě ověřená pravidla:

1. **Žádné XML komentáře** (`<!-- ... -->`), ani jako oddělovače sekcí.
2. **Konce řádků CRLF** (`\r\n`, Windows), ne LF.
3. **Kódování UTF-8**, deklarace `encoding="UTF-8"`.
4. **Odsazení tabulátory**: 1 tab `<Orders>`, 2 `<DomesticTransaction>`, 3 pole.
5. **Částky s desetinnou tečkou**, bez oddělovače tisíců/mezer. Celá čísla bez desetin (`400`).
6. **Pořadí elementů** v transakci je pevné (sekce 4).

---

## 3. Konstanty (pro všechny příkazy stejné)

| Pole | Hodnota |
|------|---------|
| `accountFrom` | `2401442781` |
| `accountTo` | `2900203312` |
| `bankCode` | `2010` |
| `currency` | `CZK` |
| `paymentType` | `431001` |
| `date` | **parametr** — zadává se při běhu (sekce 10) |

---

## 4. Struktura výstupního XML

```
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Import xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
	<Orders>
		... jednotlivé <DomesticTransaction> ...
	</Orders>
</Import>
```

Jedna transakce (pořadí polí závazné):

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

`messageForRecipient` a `comment` jsou vždy **stejný text**.

---

## 5. Datový model řádku (line item)

Do XML jde jen to, co má `include = true`.

| Pole | Popis |
|------|-------|
| `source` | `fio` / `revolut` / `pravidelná` |
| `txn_id` | ID transakce z exportu (pokud je k dispozici) — primární klíč pro deduplikaci |
| `fingerprint` | náhradní klíč = `datum_txn + obchodník_norm + amount + currency` |
| `status` | `NEW` / `ALREADY_CLAIMED` / `DUPLICATE_IN_BATCH` (sekce 8) |
| `mandatory` | `true` = povinná (stočné, plyn, elektrika…), v editaci chráněná |
| `include` | jde do XML? Default `true`, u shod z dedupu `false` (sekce 8) |
| `amount` | částka **v CZK** (desetinná tečka) — u cizoměnových viz 6c |
| `currency_orig` | původní měna transakce (EUR/PLN…), jen informativně |
| `message` | text zprávy = `comment` |
| `datum_txn` | datum transakce (jde do textu zprávy) |
| `kategorie` | pro filtrování (dovolená, nákup, PHM, parkování…) |

`date` (splatnost) je společné pro celou dávku (sekce 10), není součástí řádku.

---

## 6. Vstupní zdroje výpisů

Každý zdroj má vlastní parser, který převede řádky do společného line-item modelu (sekce 5). Berou se jen skutečné **výdaje kartou / výběry**, ne příchozí platby a interní přesuny.

> **Pozn.:** Žádný z níže uvedených exportů nenese stabilní ID transakce (Fio má sloupec `VS` většinou prázdný). Deduplikace proto jede na **otisk = `datum_txn + částka`** (obchodník jen pomocně — jeho text se mezi zdroji liší). `txn_id` se použije jen tam, kde ho zdroj má.

### 6a. Fio — copy-paste z internetového bankovnictví
Sloupce (tab): `Typ` · `Stav` · `Datum transakce` · `Datum zaúčtování` · `Obchodník` · `Částka` · `Měna` · `Kategorie` · `Poznámka`. Typy `Platba kartou`, `Bankomat`.

### 6b. Fio — CSV export pohybů („Pohyby na účtu")
**Reálný formát:** UTF-8 **s BOM**, **CRLF**, oddělovač **středník `;`**, hodnoty v uvozovkách, **desetinná čárka**.
Sloupce: `Datum` · `Objem` · `Měna` · `Protiúčet` · `Kód banky` · `Zpráva pro příjemce` · `Poznámka` · `Typ` · `VS`.
- Kladný `Objem` = příchozí, záporný = odchozí.
- **Tento export z účtu příjemce (2900203312) je zároveň zdroj historie pro dedup** (sekce 8): příchozí řádky = už uplatněné náklady. Datum transakce se čte z textu `… ze dne DD.MM.RRRR`, částka z `Objem`.

### 6c. Revolut — CSV export
**Reálný formát:** UTF-8, oddělovač **čárka `,`**, **desetinná tečka**.
Sloupce: `Typ` · `Produkt` · `Datum zahájení` · `Datum dokončení` · `Popis` · `Částka` · `Poplatek` · `Měna` · `State` · `Zůstatek`.
- Bere se `State = DOKONČENO`, typy `Platba kartou`, `Výběr z bankomatu`; `Částka < 0` = výdaj.
- Datum transakce = datum z `Datum dokončení`. Obchodník = `Popis`.
- **Vícemenovost:** do banky jde CZK. U cizoměnového řádku použij **CZK ekvivalent, který reálně padl**; původní měnu ulož do `currency_orig` jen informativně.

### Skládání textu zprávy (společné)
- Kategorie i Poznámka → `{Kategorie} - {Poznámka} ze dne {datum} {Obchodník}` → `Dovolená - PHM ze dne 04.07.2026 Orlen`
- Jen Poznámka → `{Poznámka} ze dne {datum} {Obchodník}`
- Kategorie „dovolená" → **`Dovolená`**.
- Částka: čárka → tečka, bez mezer/oddělovače tisíců.
- Obchodník: **ASCII-foldni veškerou diakritiku** včetně české (`Żabka`→`Zabka`, `Havlíčkova`→`Havlickova`); dlouhé názvy bankomatu zkrať.
  *(Změna 2026-07-21 na přání uživatele — původně se měla česká diakritika zachovávat. Kategorie, poznámka a texty pravidelných plateb diakritiku dál mají, shodně s přijatým referenčním importem.)*

---

## 7. Vstup — pravidelné / mandatorní platby

Nevznikají z výpisu. Dvě složky:

### 7a. Šablona = zdroj pravdy pro strukturu (texty, `mandatory`, výchozí částky)

| mandatory | Výchozí částka | Text zprávy (doplň měsíc) |
|:---------:|---------------:|---------------------------|
| | 400 | `Neo Modrý - telefon Maxík mobil (400 Kč) - {měsíc} 2026` |
| | 400 | `Neo Modrý - telefon Ferda mobil (400 Kč) - {měsíc} 2026` |
| | 200 | `½ Oneplay Extra Sport (200 Kč) - {měsíc} 2026` |
| | 100 | `Kanály navíc (100 Kč) - {měsíc} 2026` |
| | 300 | `¾ O2 Internet MAX 250 (300 Kč) - {měsíc} 2026` |
| | 50 | `½ Rodinné sledování (50 Kč) - {měsíc} 2026` |
| **✔** | 650 | `stočné záloha Havlíčkova 486_4 osoby_2026 {měsíc} 2026` |
| **✔** | 3414 | `zaloha na elektriku-Havlíčkova 486 odb.místo 859182400205072937 3000 (odhad 2414byt+1000dílna) SIPO {měsíc} 2026` |
| **✔** | 2800 | `plyn záloha Havlíčkova486-{měsíc} 2026` |

Vodné se **neplatí** (jen stočné). `½` `¾` a diakritika jsou OK (UTF-8).

> **Pozn.:** Fio ve „Zprávě pro příjemce" vulgární zlomek nepodporuje a uloží ho jako
> `?` (na výpisu příjemce je pak `? Oneplay…`). Do generovaného příkazu jde `½/¾` beze
> změny; dedup si `?` ↔ `½/¾` srovná normalizací textu (§8).

### 7b. Částky z posledního přijatého XML (carry-over)
App z minulého XML vytáhne řádky odpovídající šabloně a **převezme částky** (přetrvají zálohy). Platby kartou z minula ignoruje, měsíc přepíše na aktuální. Bez minulého XML → výchozí částky. Mandatorní řádky jsou vždy předvyplněné a chráněné.

---

## 8. Deduplikace — kontrola už uplatněných nákladů

Cíl: **žádnou částku nestáhnout podruhé**, ať už kvůli překryvu období, přítomnosti nákladu ve Fio i Revolutu, nebo opakovanému importu.

### Zdroj historie
Množina otisků už uplatněných nákladů se sestaví z:
- **CSV exportu pohybů na účtu příjemce 2900203312** (sekce 6b) — příchozí řádky (`Objem > 0`) = už uplatněné náklady. Datum se čte z textu `… ze dne DD.MM.RRRR`, částka z `Objem`. *Ověřeno na reálných datech: 880 položek zpět do 03/2023.*
- a/nebo **archivu už přijatých XML** / **ledgeru**, který si app připíše po každém úspěšném importu.

**Autorita = Fio výpis.** Potvrzené uplatnění je jen to, co reálně odešlo na účet příjemce (CSV pohyby, `source = history`). Minulé XML a ledger z generování jsou jen „vygenerováno" — XML se dá vytvořit a do banky nenahrát, proto takové shody padnou do `ALREADY_GENERATED` (zůstanou v návrhu, vypnuté), ne do `ALREADY_CLAIMED`.

### Klíč porovnání
1. **`fingerprint` = `datum_txn + částka`** — hlavní klíč. *Ověřeno: texty obchodníka se mezi zdroji liší („Lidl" × „nákup Lidl", „MOL" × „Malíkov PHM MOL"), takže obchodník je jen pomocný/potvrzující, ne součást klíče.*
2. `txn_id` jen tam, kde ho zdroj má (tyto exporty ho nemají).

### Statusy a chování
- **`ALREADY_CLAIMED`** — shoda proti **Fio výpisu** (potvrzený pohyb, `source = history`) → `include = false` + upozornění „už uplatněno ve Fio výpisu".
- **`ALREADY_GENERATED`** — shoda jen proti **vygenerovanému** záznamu (minulé XML / ledger z generování), ale NE ve Fio výpisu → zůstane v návrhu s příznakem, **default `include = false`**. Vygenerovat XML ≠ nahrát ho do banky, takže tohle není potvrzení — když jsi XML nenahrál, řádek zapni a pošli.
- **`DUPLICATE_IN_BATCH`** — týž náklad dvakrát v aktuálním vstupu (Fio × Revolut, překryv) → nechá se jeden, druhý `include = false` + upozornění.
- **`NEW`** — bez shody → `include = true`.

**Pravidelné platby a dedup:** nemají datum transakce, takže je otisk `datum+částka`
nechytí. Porovnávají se proto **podle textu zprávy** (ten obsahuje měsíc i částku, je
jednoznačný). Když už tenhle měsíc zálohu zaplatíš, přijde na účet příjemce se stejným
textem — pravidelná platba se pak označí `ALREADY_CLAIMED`, aby nešla podruhé.
Text z minulého měsíce (`… červen 2026`) tu na aktuální (`… červenec 2026`) nesedne.

Text se před porovnáním **normalizuje** (ASCII-fold + smazání vulgárních zlomků
`½/¾` a jejich náhrad `?`/`�`): vedoucí „podíl" totiž uloží každý systém jinak —
šablona `½ Oneplay…`, Fio výpis `? Oneplay…` (banka zlomek do zprávy nepustí),
staré XML `Â½ Oneplay…`. Bez normalizace by se řádek nespároval a záloha se stáhla
podruhé.
*(Oprava 2026-07-22 — dřív se pravidelné platby z dedupu vyjímaly úplně; poté přidán
textový dedup a doplněna normalizace zlomkového podílu, aby seděl i na `?` z výpisu.)*

### Ochrana proti falešným shodám
Existují **legitimní duplicity** (dvě stejné Alza týž den, dva Lidl týž den). Proto se shoda **nikdy nemaže automaticky** — jen předvyplní jako vyřazená a **uživatel ji může přebít** v editaci, když jde o samostatný nákup. Pomůcka: porovnávat i počet výskytů (2 v historii vs. 3 nově → flagnout jen ten navíc).

---

## 9. Editace a filtrace před generováním (review krok)

Tabulka všech řádků k finální kontrole:

- **Zap/vyp řádku** (`include`) — měkké vyřazení, řádek zůstane vidět (přeškrtnutý). Hodí se na haléřové zbytky (Booking 16,74) i na přebití dedupu.
- **Status z dedupu** — sloupec `NEW / ALREADY_CLAIMED / ALREADY_GENERATED / DUPLICATE_IN_BATCH`, barevně, s možností filtrovat.
- **Editace na místě** — částka a text (změněné zálohy, opravy).
- **Filtry** — `source` (fio/revolut/pravidelná), `kategorie`, `mandatory`, `status`.
- **Ochrana mandatorních** — zvýrazněné; vyřazení jen s potvrzením.
- **Souhrn v patičce** — živý součet částek + počet aktivních příkazů; zvlášť „vyřazeno jako už uplatněné".
- **Minimální částka** (Nastavení) — výdaje z výpisů pod prahem (výchozí 200 Kč, variabilní) se předvyplní jako vypnuté; malé položky, které nemá smysl rozúčtovávat. Nemažou se — uživatel zapne. Pravidelných/povinných plateb se netýká.

Generuje se **výhradně z řádků `include = true`**.

---

## 10. Parametry aplikace

| Parametr | Popis | Default |
|----------|-------|---------|
| `date` | Datum splatnosti pro celou dávku (`RRRR-MM-DD`), zadává uživatel. | dnešní datum |
| `měsíc` | Název měsíce do textů pravidelných plateb. | podle `date` |
| `vypisy` | Vstupy — Fio a/nebo Revolut. | — |
| `predchozi_xml` | Minulé přijaté XML (carry-over částek) **+ historie pro dedup**. | volitelné, doporučené |
| `ledger` | Průběžný záznam už uplatněných nákladů. | volitelné |
| `minAmount` | Minimální částka výdaje (Nastavení). Výdaje z výpisů pod ní se předvyplní jako vypnuté; pravidelných/povinných se netýká. | 200 Kč |

`date` je jedno pro celou dávku; datum transakce jde jen do textu zprávy.

---

## 11. Validace před odevzdáním

- Soubor je **validní XML**, **0 komentářů**, **CRLF**, **UTF-8**.
- **Počet příkazů** (fio / revolut / pravidelné).
- **Kontrolní součet** = suma všech `amount`.
- Zahrnuty všechny **mandatorní** platby.
- **Report dedupu**: kolik označeno `ALREADY_CLAIMED` / `DUPLICATE_IN_BATCH` a vyřazeno (ať je jasné, co se záměrně neposlalo).
- Dlouhé zprávy (Fio limit ~140 znaků).

---

## 12. Příklad

**Vstup (Fio výpis, jeden řádek):**
```
Platba kartou   Aktuální   06.07.2026 12:26   07.07.2026 14:08   Żabka   196,94   CZK   dovolená   nákup
```

**Výstup:**
```
	<DomesticTransaction>
		<accountFrom>2401442781</accountFrom>
		<currency>CZK</currency>
		<amount>196.94</amount>
		<accountTo>2900203312</accountTo>
		<bankCode>2010</bankCode>
		<date>2026-07-21</date>
		<messageForRecipient>Dovolená - nákup ze dne 06.07.2026 Zabka</messageForRecipient>
		<comment>Dovolená - nákup ze dne 06.07.2026 Zabka</comment>
		<paymentType>431001</paymentType>
	</DomesticTransaction>
```

---

## 13. Jak to použít se mnou (Claude)

Do chatu vlož:
1. tuto specifikaci,
2. výpis(y) — Fio a/nebo Revolut,
3. **minulá přijatá XML** (carry-over zálohy + dedup historie) — doporučeno,
4. datum splatnosti (jinak dnešní),
5. úpravy pravidelných plateb (změněné zálohy).

Vrátím ti tabulku ke kontrole — s dedup statusem a označením, co jde/nejde do XML — a po odsouhlasení hotové `.xml` + kontrolní součet, počet příkazů a report už uplatněných nákladů.
