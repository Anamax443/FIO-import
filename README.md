# FIO-import

> Z bankovních výpisů (Fio, Revolut) a pravidelných plateb sestaví XML pro hromadný import
> platebních příkazů do Fio banky — bez dvojího uplatnění už proplacených nákladů.

## Co to dělá
1. Načte **Fio** (copy-paste z IB) a **Revolut** (CSV) výdaje kartou / výběry.
2. Přidá **pravidelné a mandatorní platby** ze šablony; částky převezme z minulého přijatého XML (carry-over).
3. **Dedup** proti historii už uplatněných nákladů (klíč = `datum_txn + částka`) — shoda se nikdy nemaže, jen se předvyplní jako vyřazená.
4. **Review krok** — tabulka k editaci, filtry, přepínače `include`, živý součet.
5. Vygeneruje `.xml`, které Fio přijme na první pokus (CRLF, bez komentářů, pevné pořadí elementů).

Detailní zadání: [docs/SPEC.md](docs/SPEC.md).

## Stack
Cílový (viz [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **Cloudflare Workers** (TypeScript, `nodejs_compat`) — API + statické UI v jednom Workeru
- **D1** (SQLite) — ledger uplatněných nákladů, šablona pravidelných plateb, audit dávek
- **Claude Haiku** (Anthropic API) — volitelná kategorizace/čištění, best-effort, neblokuje pipeline

## Požadavky
- Node.js 22+, `wrangler`
- Cloudflare účet s D1
- `ANTHROPIC_API_KEY` (jen pro AI vrstvu; bez něj pipeline běží dál)

## Spuštění / build
Zatím není co spustit — repo obsahuje **zadání a ověřená vstupní data**, implementace začíná
`src/util.ts` (fingerprint, normAmount, buildMsg) a `src/xml.ts`. Postup viz [docs/BUILD.md](docs/BUILD.md).

## Konfigurace
Tajemství nikdy do gitu — zkopíruj `*.example` na reálný soubor a vyplň lokálně
(`.dev.vars` pro lokální běh, `wrangler secret put` pro produkci).
Do gitu nepatří ani reálné výpisy a vygenerovaná XML (čísla účtů, útraty).

## Nasazení
Postup od nuly viz [docs/BUILD.md](docs/BUILD.md).

## Dokumentace
- [docs/SPEC.md](docs/SPEC.md) — zadání: formát XML, dedup, pravidelné platby, validace
- [docs/SAMPLE_DATA.md](docs/SAMPLE_DATA.md) — reálné formáty vstupů + akceptační čísla (ground truth pro testy)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — jak je to poskládané
- [docs/BUILD.md](docs/BUILD.md) — jak postavit od nuly (výrobní)
- [HANDOFF.md](HANDOFF.md) — deník stavu
