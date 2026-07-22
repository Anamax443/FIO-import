# BUILD — jak postavit FIO-import od nuly

> **Test hotovosti:** dostane se nový člověk (nebo já po výměně PC) JEN z tohoto dokumentu
> k běžící aplikaci? Když ne, doplň, co chybělo.

Kroky 1–5 jsou **odzkoušené** (2026-07-21, Windows 11, Node 22). Krok 6 (produkce) zatím ne —
aktualizuj ho při prvním reálném nasazení.

## 1. Závislosti

- **Node.js 22+** (LTS), npm
- Cloudflare účet s právem na Workers + D1 (produkce; lokální vývoj ho nepotřebuje)
- účet u Anthropicu pro `ANTHROPIC_API_KEY` — **jen pro placený AI backend** (Claude); free backend (Workers AI) běží zdarma přes binding, bez klíče

`wrangler`, `typescript` a `vitest` se instalují jako devDependencies, globálně nic netřeba.

## 2. Získání kódu

```
gh repo clone Anamax443/FIO-import
cd FIO-import
npm install
```

## 3. Konfigurace a secrety

- lokálně: zkopíruj `.dev.vars.example` → `.dev.vars` a vyplň `ANTHROPIC_API_KEY`
  (jen pro placený backend; bez něj jede free Workers AI)
- produkce: `npx wrangler secret put ANTHROPIC_API_KEY` (jen pro placený backend)
- **AI backend** řídí `AI_PROVIDER` ve `wrangler.jsonc` → `vars`: `workers-ai` (zdarma,
  výchozí), `anthropic` (placený, s automatickým free fallbackem) nebo `off`. Workers AI
  používá binding `ai` (už ve `wrangler.jsonc`) a běží jen `--remote`/v produkci.
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
npm test            # vitest — 98 testů, akceptační čísla z docs/SAMPLE_DATA.md
```

Testy kryjí rizikové jádro: normalizaci částek, otisk pro dedup, ASCII-fold, parsery
Fio/Revolut/historie/minulé XML, dedup statusy a formát XML (včetně shody
s referenční transakcí znak po znaku).

## 5. Spuštění lokálně

```
npx wrangler dev --local --port 8788
# UI na http://127.0.0.1:8788
```

> **AI vrstva lokálně:** Workers AI v `--local` neběží (model je na GPU síti Cloudflare).
> Pro test free backendu použij `npx wrangler dev --remote`, nebo ho ověř až v produkci
> přes `/api/ai-check`.

Rychlý smoke test API bez UI:

```
curl http://127.0.0.1:8788/api/version
```

## 6. Nasazení do produkce

**Živě běží:** `https://fio-import.bass443.workers.dev` (účet **bass443**, D1 `fio-import`
v regionu EEUR, id `c082caa7-9624-43b3-bf77-7f1c5e8db94c`).

- `npm run deploy` (= `wrangler deploy`)
- commit hash do buildu: nasazuj s `COMMIT_SHA` (patička UI a `/api/version` ho ukazují)
  ```
  npx wrangler deploy --var COMMIT_SHA:$(git rev-parse --short HEAD)
  ```
- ověření po nasazení: otevřít URL, vygenerovat testovací dávku a zkontrolovat,
  že XML má CRLF, 0 komentářů a sedí kontrolní součet; **uvést živý commit hash**

## 7. Přístup k aplikaci (brána)

API je **fail-closed** — bez nakonfigurované brány nevrátí nic (kromě `/api/version`).
Důvod: veřejná URL by jinak vydala čísla účtů, adresu a odběrné místo elektřiny.

### Varianta A — Cloudflare Access (doporučená, „přihlášení přes Cloudflare")

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**
2. doména: `fio-import.bass443.workers.dev`
3. politika: *Allow* → **Emails** → tvůj e-mail
4. z detailu aplikace zkopíruj **Application Audience (AUD) Tag** a název týmu
   (`<tym>.cloudflareaccess.com`)
5. doplň do `wrangler.jsonc` → `vars` a nasaď:
   ```jsonc
   "ACCESS_TEAM_DOMAIN": "<tym>",
   "ACCESS_AUD": "<aud tag>"
   ```

Worker si JWT z Accessu **ověřuje sám** (JWKS, RS256, kontrola `aud`/`iss`/`exp`),
takže Access nejde obejít přímým voláním `*.workers.dev`.

### Varianta B — sdílený token (záložní, aktivní teď)

```
npx wrangler secret put APP_TOKEN
```
UI se na token doptá při prvním volání API a uloží si ho do `localStorage`.
Až bude Access hotový, token se dá zrušit: `npx wrangler secret delete APP_TOKEN`.

### Ostatní

- `ANTHROPIC_API_KEY` — secret pro **placený** AI backend (volitelný; free Workers AI běží bez něj)
- Cloudflare API token pro CI (pokud se CI zapne) — scope Workers Scripts:Edit + D1:Edit
- žádné podpisové certifikáty, žádné servisní účty

## 8. Ověřovací postup pro budoucí změny jádra

Pořadí, ve kterém se jádro stavělo a v němž se má i ověřovat po zásahu:

1. `src/util.ts` — `normAmount`, `fingerprint` (datum+částka), `buildMsg`, CSV parser, ASCII-fold
2. `src/xml.ts` — `buildXml` proti referenční transakci v [SAMPLE_DATA.md](SAMPLE_DATA.md)
3. parsery `fioCard` / `revolut` / `fioCsv` (pohyby + historie) / `prevXml`
4. `dedup.ts` — statusy, počítání výskytů, textový dedup pravidelných (normalizace zlomků)
5. teprve pak UI, D1 a AI vrstva

Ověřená akceptační čísla (živý běh 2026-07-21): pravidelné platby **9 řádků / 8 314 CZK**,
Fio × Revolut týž náklad → `DUPLICATE_IN_BATCH`, shoda proti historii → `ALREADY_CLAIMED`.
Čísla vázaná na reálné výpisy (36 řádků Fio = 33 750,92 / celkem 42 064,92 / 11 shod
Revolut × historie) **zatím ověřená nejsou** — chybí k tomu ty konkrétní výpisy.
