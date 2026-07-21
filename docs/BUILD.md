# BUILD — jak postavit FIO-import od nuly

> **Test hotovosti:** dostane se nový člověk (nebo já po výměně PC) JEN z tohoto dokumentu
> k běžící aplikaci? Když ne, doplň, co chybělo.

Kroky 1–5 jsou **odzkoušené** (2026-07-21, Windows 11, Node 22). Krok 6 (produkce) zatím ne —
aktualizuj ho při prvním reálném nasazení.

## 1. Závislosti

- **Node.js 22+** (LTS), npm
- Cloudflare účet s právem na Workers + D1 (produkce; lokální vývoj ho nepotřebuje)
- účet u Anthropicu pro `ANTHROPIC_API_KEY` (volitelné — AI vrstva je best-effort)

`wrangler`, `typescript` a `vitest` se instalují jako devDependencies, globálně nic netřeba.

## 2. Získání kódu

```
gh repo clone Anamax443/FIO-import
cd FIO-import
npm install
```

## 3. Konfigurace a secrety

- lokálně: zkopíruj `.dev.vars.example` → `.dev.vars` a vyplň `ANTHROPIC_API_KEY`
  (bez něj appka funguje, jen bez AI kategorizace)
- produkce: `npx wrangler secret put ANTHROPIC_API_KEY`
- konstanty příkazu (čísla účtů, `bankCode`, `paymentType`) jsou ve `wrangler.jsonc` → `vars`

**D1 databáze** — volitelná, ale bez ní si appka nepamatuje historii mezi běhy:

```
npx wrangler d1 create fio-import
# vzniklé database_id zapiš do wrangler.jsonc (nahradí PLACEHOLDER-VYPLN-PO-VYTVORENI)
npx wrangler d1 execute fio-import --local  --file=schema.sql   # pro `wrangler dev`
npx wrangler d1 execute fio-import --remote --file=schema.sql   # pro produkci
```

Naplnění ledgeru historií (CSV pohybů účtu příjemce):

```
curl -X POST http://127.0.0.1:8788/api/ledger/import \
  -H "content-type: application/json" \
  --data-binary '{"csv": "…obsah CSV…"}'
```

> Reálné výpisy ani vygenerovaná XML **nepatří do gitu** — `.gitignore` je blokuje
> (`vypisy/`, `data/`, `*.csv`, `/*.xml`).

## 4. Build a testy

```
npm run typecheck   # tsc --noEmit
npm test            # vitest — 36 testů, akceptační čísla z docs/SAMPLE_DATA.md
```

Testy kryjí rizikové jádro: normalizaci částek, otisk pro dedup, ASCII-fold, parsery
Fio/Revolut/historie/minulé XML, dedup statusy a formát XML (včetně shody
s referenční transakcí znak po znaku).

## 5. Spuštění lokálně

```
npx wrangler dev --local --port 8788
# UI na http://127.0.0.1:8788
```

Rychlý smoke test API bez UI:

```
curl http://127.0.0.1:8788/api/version
```

## 6. Nasazení do produkce

- cíl: Cloudflare Workers (účet **bass443**, stejně jako job-watch / aukce)
- `npm run deploy` (= `wrangler deploy`)
- commit hash do buildu: nasazuj s `COMMIT_SHA` (patička UI a `/api/version` ho ukazují)
  ```
  npx wrangler deploy --var COMMIT_SHA:$(git rev-parse --short HEAD)
  ```
- ověření po nasazení: otevřít URL, vygenerovat testovací dávku a zkontrolovat,
  že XML má CRLF, 0 komentářů a sedí kontrolní součet; **uvést živý commit hash**

## 7. Certifikáty / přístupy / práva

- Cloudflare API token pro CI (pokud se CI zapne) — scope Workers Scripts:Edit + D1:Edit
- žádné podpisové certifikáty, žádné servisní účty
- `ANTHROPIC_API_KEY` — jediný secret

## 8. Ověřovací postup pro budoucí změny jádra

Pořadí, ve kterém se jádro stavělo a v němž se má i ověřovat po zásahu:

1. `src/util.ts` — `normAmount`, `fingerprint` (datum+částka), `buildMsg`, CSV parser, ASCII-fold
2. `src/xml.ts` — `buildXml` proti referenční transakci v [SAMPLE_DATA.md](SAMPLE_DATA.md)
3. parsery `fioCard` / `revolut` / `history` / `prevXml`
4. `dedup.ts` — statusy a počítání výskytů
5. teprve pak UI, D1 a AI vrstva

Ověřená akceptační čísla (živý běh 2026-07-21): pravidelné platby **9 řádků / 8 314 CZK**,
Fio × Revolut týž náklad → `DUPLICATE_IN_BATCH`, shoda proti historii → `ALREADY_CLAIMED`.
Čísla vázaná na reálné výpisy (36 řádků Fio = 33 750,92 / celkem 42 064,92 / 11 shod
Revolut × historie) **zatím ověřená nejsou** — chybí k tomu ty konkrétní výpisy.
