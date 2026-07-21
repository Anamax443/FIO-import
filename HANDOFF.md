# HANDOFF — deník stavu: FIO-import

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

## 2026-07-21 — implementace jádra + UI + dokumentace

**Hotové:**
- **Jádro ověřené** (`src/util.ts`, `src/xml.ts`): normalizace částek, otisk `datum+částka`,
  skládání textu zprávy, CSV parser, ASCII-fold, generátor XML. Sedí na referenční
  transakci z [SAMPLE_DATA.md](docs/SAMPLE_DATA.md) znak po znaku.
- Parsery: Fio copy-paste, Revolut CSV (vč. vícemenovosti), Fio CSV pohyby (historie),
  minulé XML (ledger + carry-over).
- `dedup.ts` — NEW / ALREADY_CLAIMED / DUPLICATE_IN_BATCH, počítání výskytů, shody se nemažou.
- `recurring.ts` — 9 pravidelných plateb, carry-over částek, měsíc/rok z data splatnosti.
- `ai.ts` — Claude Haiku 4.5 (`claude-haiku-4-5`), structured outputs, best-effort.
- Worker (`src/index.ts`): `/api/process`, `/api/generate`, `/api/ledger/import`,
  `/api/template`, `/api/version` + statické UI.
- UI `public/` — IT-ops dark, filtry, editace na místě, ochrana mandatorních,
  živý součet, **i18n CS/EN**, tooltip na každém ovládacím prvku, commit hash v patičce.
- Dokumentace: README (CS+EN), ARCHITECTURE, BUILD, navod.html (CS+EN),
  project-status.html, prezentace.html.
- **36 testů (Vitest) zelených**, `tsc --noEmit` čistý.

**Ověřeno živě** (`wrangler dev --local`, 2026-07-21):
- celý řetězec výpis → dedup → XML,
- Fio × Revolut týž náklad → `DUPLICATE_IN_BATCH`; shoda proti historii → `ALREADY_CLAIMED`,
- vygenerovaný soubor: validní XML, **CRLF všude**, 0 komentářů, bez BOM,
- kontrolní součet 9 308,72 = 994,72 (Fio) + **8 314 (pravidelné platby — akceptační číslo sedí)**.

**Zbývá:**
1. Nasadit do Cloudflare (`npm run deploy`) — potřebuje účet, `d1 create` a doplnit
   `database_id` ve `wrangler.jsonc`; po nasazení uvést živý commit hash.
2. Naplnit ledger historií účtu příjemce (`/api/ledger/import`).
3. Projet jednu **reálnou měsíční dávku** vedle dosavadního ručního postupu a porovnat.

**Otevřené otázky / neověřené:**
- Akceptační čísla vázaná na konkrétní červencové výpisy — **36 řádků Fio = 33 750,92 Kč**,
  **celkem 42 064,92 Kč / 45 příkazů**, **11 shod Revolut × historie** — zatím ověřená nejsou,
  chybí ty výpisy. Až budou, jsou to první testy k doplnění.
- Vícemenové Revolut řádky: appka je vyřadí a upozorní, CZK ekvivalent doplňuje uživatel ručně.
  Kdyby v exportu byl sloupec s CZK ekvivalentem, dá se to zautomatizovat.
- Formát částky: neceločíselné jdou do XML vždy na 2 desetinná místa (`1290.50`).
  Kdyby to banka nebrala, změna je na jednom místě (`formatAmount` v `src/util.ts`).

## 2026-07-21 — založení projektu
- Repo založeno podle **project-standard** (scaffold), GitHub `Anamax443/FIO-import` (privátní).
- Commit identita = **Milan Trnka <info@maxferit.cz>** (osobní projekt, ne AXIMA).
- Zadání a ověřená vstupní data v `docs/`: SPEC.md, SAMPLE_DATA.md, ARCHITECTURE.md.
