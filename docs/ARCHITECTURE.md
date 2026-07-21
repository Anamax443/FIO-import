# Architektura – Fio import generator (Cloudflare)

Cloudflare-native aplikace, která z výpisů (Fio, Revolut) a pravidelných plateb
sestaví XML pro hromadný import do Fio banky, **odfiltruje už uplatněné náklady**
(deduplikace proti historii) a volitelně použije **AI vrstvu** pro kategorizaci.

## Stack

| Vrstva | Volba | Poznámka |
|--------|-------|----------|
| Runtime | **Cloudflare Workers** (TS, `nodejs_compat`) | jeden Worker, API + statické UI |
| Data | **D1** (SQLite) | ledger uplatněných nákladů, šablona pravidelných, audit dávek |
| UI | statické `public/` (binding `ASSETS`) | reference je klientská appka, lze napojit na `/api/*` |
| AI | **Claude Haiku** přes Anthropic API | kategorizace/čištění; best-effort, neblokuje |
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
| `util.ts` | normAmount, fingerprint (**datum+částka**), buildMsg, CSV parser, ASCII-fold. **Ověřené jádro.** |
| `parse/fioCard.ts` | Fio copy-paste (tab) |
| `parse/revolut.ts` | Revolut CSV (comma, DOKONČENO, vícemenovost) |
| `parse/history.ts` | Fio CSV pohyby 2900203312 → řádky ledgeru |
| `parse/prevXml.ts` | z minulého XML: ledger + carry-over částek pravidelných |
| `recurring.ts` | sestavení pravidelných z D1 šablony + carry-over |
| `dedup.ts` | statusy NEW / ALREADY_CLAIMED / DUPLICATE_IN_BATCH (shody se nemažou, jen include=false) |
| `xml.ts` | **buildXml** – CRLF, žádné komentáře, pevné pořadí elementů, desetinná tečka |
| `ai.ts` | Claude Haiku: category, note, claimable, čištění obchodníka |
| `index.ts` | Worker: routy `/api/process`, `/api/generate`, `/api/ledger/import`, statické UI |

## Kritická pravidla formátu (v `xml.ts`, ověřeno na přijatém importu)

1. Žádné XML komentáře · 2. Konce řádků **CRLF** · 3. UTF-8 · 4. tabulátory ·
5. desetinná tečka, celá čísla bez desetin · 6. pevné pořadí elementů ·
`messageForRecipient === comment`.

## Deduplikace

- Klíč = **`datum_txn + částka`** (obchodník se mezi zdroji liší: „Lidl" × „nákup Lidl",
  „MOL" × „Malíkov PHM MOL" – proto není v klíči). Ověřeno na reálných datech.
- Zdroj historie: **D1 `claimed_ledger`** (naplní se importem CSV pohybů 2900203312 a po
  každé dávce) + volitelně nahraný CSV/XML v rámci requestu.
- Shody se **nemažou**, jen `include=false` + status → uživatel může přebít (legitimní duplicity).

## AI vrstva

Vstup: transakce bez kategorie (hlavně Revolut). Výstup (striktní JSON): `category`,
`note`, `claimable`, vyčištěný `merchant`. `claimable=false` (Netflix, předplatné,
převody sobě) → řádek se defaultně vyřadí. Best-effort: při chybě/timeoutu pipeline
pokračuje bez AI. Vzor odpovídá extrakčnímu kroku v job-watch-mail.

## Datový model (D1) – viz `schema.sql`

`claimed_ledger` (fingerprint, date_txn, amount, merchant, source, batch_date) ·
`recurring_template` (ord, amount, mandatory, template) · `batches` (audit).
