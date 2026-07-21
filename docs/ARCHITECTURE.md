# Architektura — FIO-import

Cloudflare-native aplikace, která z výpisů (Fio, Revolut) a pravidelných plateb
sestaví XML pro hromadný import do Fio banky, **odfiltruje už uplatněné náklady**
(deduplikace proti historii) a volitelně použije **AI vrstvu** pro kategorizaci.

Zadání je v [SPEC.md](SPEC.md), ověřená vstupní data a akceptační čísla v [SAMPLE_DATA.md](SAMPLE_DATA.md).

## Stack

| Vrstva | Volba | Poznámka |
|--------|-------|----------|
| Runtime | **Cloudflare Workers** (TS, `nodejs_compat`) | jeden Worker, API + statické UI |
| Data | **D1** (SQLite) | ledger uplatněných nákladů, šablona pravidelných, audit dávek |
| UI | statické `public/` (binding `ASSETS`) | vanilla JS moduly, IT-ops dark, i18n CS/EN |
| AI | **Claude Haiku 4.5** (`claude-haiku-4-5`) přes `@anthropic-ai/sdk` | kategorizace/čištění; best-effort, neblokuje |
| Testy | **Vitest** | rizikové jádro: parsery, otisk, XML, dedup |
| Secrets | `ANTHROPIC_API_KEY` | `wrangler secret put` / `.dev.vars` |

## Tok dat

```
Fio výpis (paste) ─┐
Revolut CSV ───────┼─► /api/process ─► parse ─► [AI classify] ─► dedup ─► návrh (JSON)
Historie CSV ──────┤        │                                     ▲
Minulé XML ────────┘        └─ D1: šablona pravidelných + ledger ─┘
                                                                    │
   UI (editace, filtry, přepínače include, živý součet)  ◄──────────┘
                                                                    │
                                        /api/generate ─► buildXml (CRLF, bez komentářů)
                                                          ├─ zápis dávky do `batches`
                                                          ├─ append zahrnutých do `claimed_ledger`
                                                          └─ stažení .xml  ─► import do Fio
```

## Moduly (`src/`)

| Soubor | Odpovědnost |
|--------|-------------|
| `types.ts` | společný line-item model + záznam ledgeru |
| `util.ts` | normAmount, fingerprint (**datum+částka**), buildMsg, CSV parser, ASCII-fold. **Ověřené jádro.** |
| `parse/fioCard.ts` | Fio copy-paste (tab), jen `Platba kartou` / `Bankomat` |
| `parse/revolut.ts` | Revolut CSV (comma, DOKONČENO, vícemenovost) |
| `parse/history.ts` | Fio CSV pohyby 2900203312 → řádky ledgeru |
| `parse/prevXml.ts` | z minulého XML: ledger + transakce pro carry-over |
| `recurring.ts` | sestavení pravidelných ze šablony + carry-over částek |
| `dedup.ts` | statusy NEW / ALREADY_CLAIMED / DUPLICATE_IN_BATCH (shody se nemažou, jen `include=false`) |
| `xml.ts` | **buildXml** + `validate` — CRLF, žádné komentáře, pevné pořadí elementů, desetinná tečka |
| `ai.ts` | Claude Haiku: category, note, claimable, čištění obchodníka |
| `index.ts` | Worker: routy `/api/*` + statické UI |

## API

| Metoda | Cesta | Vstup | Výstup |
|--------|-------|-------|--------|
| POST | `/api/process` | `{date, fio?, revolut?, historyCsv?, prevXml?, useAi?}` | `{date, rows[], report, historySize, aiUsed}` |
| POST | `/api/generate` | `{date, rows[]}` — generuje se jen z `include=true` | `.xml` + hlavičky `x-fio-count`, `x-fio-total` |
| POST | `/api/ledger/import` | `{csv}` — pohyby účtu příjemce | `{imported}` |
| GET | `/api/template` | — | `{template[]}` (šablona pravidelných plateb) |
| GET | `/api/version` | — | `{commit}` — živý commit hash v patičce UI |

## Kritická pravidla formátu (v `xml.ts`, ověřeno na přijatém importu)

1. Žádné XML komentáře · 2. Konce řádků **CRLF** · 3. UTF-8 bez BOM · 4. tabulátory ·
5. desetinná tečka, celá čísla bez desetin · 6. pevné pořadí elementů ·
`messageForRecipient === comment`.

`validate()` navíc hlídá kontrolní součet, počty podle zdroje, mandatorní platby
a limit délky zprávy (140 znaků).

## Deduplikace

- Klíč = **`datum_txn + částka`** (obchodník se mezi zdroji liší: „Lidl" × „nákup Lidl",
  „MOL" × „Malíkov PHM MOL" — proto není v klíči).
- Zdroj historie: **D1 `claimed_ledger`** (naplní se importem CSV pohybů 2900203312 a po
  každé dávce) + volitelně nahraný CSV/XML v rámci requestu.
- Shody se **nemažou**, jen `include=false` + status → uživatel může přebít (legitimní duplicity).
- Počítají se **výskyty**: 2 v historii vs. 3 nově → první dva se vyřadí, třetí zůstane `NEW`.

## AI vrstva

Vstup: transakce bez kategorie (hlavně Revolut). Výstup (structured outputs, striktní JSON):
`category`, `note`, `claimable`, vyčištěný `merchant`. `claimable=false` (Netflix,
předplatné, převody sobě) → řádek se defaultně vyřadí. Best-effort: bez `ANTHROPIC_API_KEY`,
při chybě nebo timeoutu (20 s) pipeline pokračuje beze změny.

Model **`claude-haiku-4-5`** — klasifikace je krátká a levná; Haiku 4.5 nepodporuje
`effort` ani adaptive thinking, což tu nevadí.

## Datový model (D1) — viz [`schema.sql`](../schema.sql)

`claimed_ledger` (fingerprint, date_txn, amount, merchant, source, batch_date) ·
`recurring_template` (ord, amount, mandatory, template) · `batches` (audit).

D1 je **volitelná**: bez nakonfigurované databáze appka funguje (šablona je zabudovaná,
dedup jede jen z podkladů nahraných v requestu), jen si nepamatuje historii mezi běhy.

## Rozhodnutí při implementaci (odchylky od doslovného znění SPECu)

| Věc | Rozhodnutí | Proč |
|-----|------------|------|
| Desetinná místa | Celá čísla bez desetin (`400`), jinak vždy 2 místa (`1290.50`) | SPEC řeší jen celá čísla; dvě místa jsou jednoznačná a konzistentní pro otisk |
| ASCII-fold | Foldne se **veškerá diakritika včetně české**, ale **jen u obchodníků** | Rozlišovat „českou" a „cizí" po znacích nešlo (`ó` je obojí); uživatel 2026-07-21 rozhodl diakritiku u obchodníků zrušit. Kategorie, poznámka a texty pravidelných plateb ji mají dál — shodně s přijatým referenčním importem |
| Rok v textech pravidelných plateb | Zástupné `{rok}` místo literálu `2026` | Pro rok 2026 se vykreslí znak po znaku stejně, ale text nezastará v lednu 2027 |
| Cizoměnový Revolut řádek | Defaultně `include=false` + upozornění | Do banky jde CZK; ekvivalent, který reálně padl, musí doplnit uživatel |
| Zápis do D1 při generování | Selhání se loguje, ale XML se vrátí | Audit není důvod shodit celou dávku |
