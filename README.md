# FIO-import

> Z bankovních výpisů (Fio, Revolut) a pravidelných plateb sestaví XML pro hromadný import
> platebních příkazů do Fio banky — bez dvojího uplatnění už proplacených nákladů.

🇬🇧 [English version](README.en.md)

## Co to dělá
1. Načte **Fio** (copy-paste z IB) a **Revolut** (CSV) výdaje kartou / výběry.
2. Přidá **pravidelné a mandatorní platby** ze šablony; částky převezme z minulého přijatého XML (carry-over).
3. **Dedup** proti historii už uplatněných nákladů (klíč = `datum_txn + částka`) — shoda se nikdy nemaže, jen se předvyplní jako vyřazená.
4. **Review krok** — tabulka k editaci, filtry, přepínače `include`, živý součet.
5. Vygeneruje `.xml`, které Fio přijme na první pokus (CRLF, bez komentářů, pevné pořadí elementů).

Detailní zadání: [docs/SPEC.md](docs/SPEC.md). Uživatelský návod: [docs/navod.html](docs/navod.html).

## Stav
Jádro **hotové a ověřené**: 98 testů (Vitest), typecheck čistý, celá pipeline proběhla živě
od výpisu po platný soubor; appka je **nasazená na Cloudflare** (bass443). Zbývá ostrý běh
na reálné měsíční dávce — viz [HANDOFF.md](HANDOFF.md).

## Stack
- **Cloudflare Workers** (TypeScript, `nodejs_compat`) — API + statické UI v jednom Workeru
- **D1** (SQLite) — ledger uplatněných nákladů, šablona pravidelných plateb, audit dávek (volitelná)
- **AI kategorizace** Revolut řádků (volitelná, best-effort) — **přepínatelný backend**: Cloudflare Workers AI (Llama 3.1 8B, zdarma, nativní, výchozí) nebo Claude Haiku 4.5 (placený); řídí `AI_PROVIDER`, placený s automatickým fallbackem na free
- **Vitest** — testy rizikového jádra (parsery, otisk, dedup, formát XML)

## Požadavky
- Node.js 22+
- Cloudflare účet s D1 (jen pro produkci; lokální vývoj ho nepotřebuje)
- `ANTHROPIC_API_KEY` **jen pro placený AI backend** (Claude Haiku); free backend (Cloudflare Workers AI) běží bez klíče. Bez obojího pipeline běží dál.

## Spuštění / build
```
npm install
npm test            # 98 testů
npm run typecheck
npx wrangler dev --local --port 8788   # UI na http://127.0.0.1:8788
```
Podrobně (včetně D1 a secretů) v [docs/BUILD.md](docs/BUILD.md).

## Konfigurace
Tajemství nikdy do gitu — zkopíruj `.dev.vars.example` na `.dev.vars` a vyplň lokálně,
v produkci `wrangler secret put`. Do gitu nepatří ani reálné výpisy a vygenerovaná XML
(čísla účtů, útraty) — `.gitignore` je blokuje.

## Nasazení
`npm run deploy`; postup od nuly viz [docs/BUILD.md](docs/BUILD.md).

## Dokumentace
| Vrstva | Dokument |
|--------|----------|
| Zadání | [docs/SPEC.md](docs/SPEC.md) — formát XML, dedup, pravidelné platby, validace |
| Vzorová data | [docs/SAMPLE_DATA.md](docs/SAMPLE_DATA.md) — reálné formáty vstupů + akceptační čísla |
| Technická | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — moduly, API, rozhodnutí při implementaci |
| Výrobní | [docs/BUILD.md](docs/BUILD.md) — jak postavit od nuly |
| Uživatelská | [docs/navod.html](docs/navod.html) · [EN](docs/navod.en.html) |
| Manažerská | [docs/project-status.html](docs/project-status.html) — stav, milníky, rizika |
| Prezentační | [docs/prezentace.html](docs/prezentace.html) |
| Deník | [HANDOFF.md](HANDOFF.md) |
