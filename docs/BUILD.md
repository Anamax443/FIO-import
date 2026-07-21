# BUILD — jak postavit FIO-import od nuly

> **Test hotovosti:** dostane se nový člověk (nebo já po výměně PC) JEN z tohoto dokumentu
> k běžící aplikaci? Když ne, doplň, co chybělo.

> **Stav:** projekt je zatím ve fázi zadání. Kroky 3–6 popisují **cílový** postup, nejsou
> odzkoušené — aktualizuj je při první reálné implementaci a nasazení.

## 1. Závislosti
- **Node.js 22+** (LTS), npm
- **wrangler** (Cloudflare CLI) — `npm i -D wrangler`, přihlášení `npx wrangler login`
- Cloudflare účet s právem na Workers + D1
- účet u Anthropicu pro `ANTHROPIC_API_KEY` (volitelné — AI vrstva je best-effort)

## 2. Získání kódu
```
gh repo clone Anamax443/FIO-import
cd FIO-import
npm install
```

## 3. Konfigurace a secrety
- lokálně: zkopíruj `.dev.vars.example` → `.dev.vars` a vyplň `ANTHROPIC_API_KEY`
- produkce: `npx wrangler secret put ANTHROPIC_API_KEY`
- D1 databáze:
  ```
  npx wrangler d1 create fio-import
  # vzniklé database_id zapiš do wrangler.jsonc
  npx wrangler d1 execute fio-import --remote --file=schema.sql
  ```
- naplnění ledgeru historií: `/api/ledger/import` s CSV pohyby účtu příjemce

## 4. Build
```
npm run typecheck
npm test          # akceptační čísla z docs/SAMPLE_DATA.md
```

## 5. Spuštění lokálně
```
npx wrangler dev
# UI na http://localhost:8787
```

## 6. Nasazení do produkce
- cíl: Cloudflare Workers (účet **bass443**, stejně jako job-watch / aukce)
- `npm run deploy` (= `wrangler deploy`)
- ověření: otevřít URL Workeru, vygenerovat testovací dávku a zkontrolovat, že XML má CRLF,
  0 komentářů a sedí kontrolní součet; po nasazení uvést **živý commit hash**

## 7. Certifikáty / přístupy / práva
- Cloudflare API token pro CI (pokud se CI zapne) — scope Workers Scripts:Edit + D1:Edit
- žádné podpisové certifikáty, žádné servisní účty

## 8. Pořadí implementace (ověř jádro dřív, než stavíš UI)
1. `src/util.ts` — `normAmount`, `fingerprint` (datum+částka), `buildMsg`, CSV parser, ASCII-fold
2. `src/xml.ts` — `buildXml`; ověřit proti referenční transakci v [SAMPLE_DATA.md](SAMPLE_DATA.md)
3. parsery `fioCard.ts` / `revolut.ts` / `history.ts` — testy na akceptační čísla (33 750,92 / 8 314 / 42 064,92)
4. `dedup.ts` — cíl: 11 shod ALREADY_CLAIMED (Revolut × historie)
5. teprve pak UI, D1 a AI vrstva
