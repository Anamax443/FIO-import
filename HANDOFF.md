# HANDOFF — deník stavu: FIO-import

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

## 2026-07-22 — Nastavení (minimální částka) + záložka Dokumentace

Nové záložky **Nastavení** a **Dokumentace** (styl job-watch).

- **Nastavení → Minimální částka výdaje** (výchozí 200 Kč, variabilní, localStorage).
  Výdaje z výpisů (Fio/Revolut) pod prahem se předvyplní jako **vypnuté**
  (`include=false` + poznámka), řádek se nemaže. Pravidelných/povinných plateb se
  netýká. Server-side: `src/threshold.ts` (`applyMinAmount`, `DEFAULT_MIN_AMOUNT=200`),
  aplikuje se v `/api/process` po dedupu; request nese `minAmount`, response vrací
  `minAmount` + `belowMin` (kolik vypnuto).
- **Dokumentace** — in-app přehled dokumentace dle standardu (vrstvy v repu) +
  klíčová pravidla (formát XML, dedup/stavy, pravidelné, AI, minčástka). Renderuje
  se z `t.docs` (i18n CS+EN), stejný pattern jako Nápověda.

Drobně srovnán drift: ARCHITECTURE/SPEC teď uvádějí i `ALREADY_GENERATED` v seznamu stavů.

**Ověřeno:** `test/threshold.test.ts` (7 testů) + živý e2e (`/api/process`: práh 200 →
položka 150 vypnutá s příznakem, 500 zapnutá, `belowMin=1`; práh 0 → bez filtru).
**105 testů**, `tsc` čistý, `node --check` na `app.js`/`i18n.js` OK.

## 2026-07-22 — sladění UI textů s přepínatelným AI backendem

Dokumentace (README, ARCHITECTURE, BUILD, SAMPLE_DATA, prezentace, status) přepínatelný
backend popisovala správně, ale **UI texty v `public/i18n.js`** pořád tvářily Claude
Haiku / `ANTHROPIC_API_KEY` jako jediný backend. Sladěno (CS+EN): checkbox „Použít AI
kategorizaci" (bez názvu modelu), hlášky `aiOff`/`aiNone` (obecné, bez odkazu na
Anthropic klíč), nápověda „Co dělá AI" (přepínatelný backend, free Workers AI výchozí).
Drobně: komentář v `app.js`, řádek Secrets v ARCHITECTURE, BUILD §7. Bez změny logiky
(98 testů beze změny). `public/` servíruje Worker → v živé appce až po `npm run deploy`.

## 2026-07-22 — dedup: autorita Fio výpisu (nový status ALREADY_GENERATED)

Dřív se jako „už uplatněné" bralo i to, co je jen **vygenerované** (D1 ledger
z generování + `prev_xml`). Jenže vygenerovat XML ≠ nahrát ho do banky — když ho
nenahraješ, náklad reálně neodešel, a přesto ho dedup napořád skryl → riziko, že
se nikdy neproplatí. (Bylo vidět na tom, že tentýž náklad byl v historii dvakrát:
`revolut` z ledgeru + `prev_xml`.)

**Princip:** jediná autorita pro tvrdé „už uplatněno" je **Fio výpis**
(`source === 'history'`). `dedup.ts` teď historii dělí na dvě úrovně:
- potvrzené Fio výpisem → `ALREADY_CLAIMED` (vyřadit),
- jen vygenerované (`prev_xml` / ledger se source revolut/fio/pravidelná) → nový
  status **`ALREADY_GENERATED`**: zůstane v návrhu s příznakem, **defaultně
  vypnuté** (`include=false`) — když jsi XML nenahrál, jedním klikem zapneš.
Platí i pro pravidelné (textový dedup dostal stejné rozdělení). Počítání výskytů
zachováno, autorita per-otisk i per-text.

Frontend: nový badge (modrý), volba ve filtru statusu, souhrn „Vygenerováno
(nepotvrzeno)", dashboard karta, HTML/CSV export, i18n CS+EN, nápověda §5. Report
má pole `alreadyGenerated`.

**Ověřeno:** `test/dedup.test.ts` +4 testy (prev_xml→GENERATED, ledger revolut→
GENERATED, Fio history→CLAIMED, pravidelná prev_xml→GENERATED). **98 testů**,
`tsc --noEmit` čistý.

## 2026-07-22 — AI vrstva: přepínatelný backend + free Cloudflare Workers AI

AI kategorizace jela jen na Claude Haiku (Anthropic), ale sdílená Anthropic org je
**bez kreditu** → vrstva reálně neběžela. Přidán **přepínatelný backend**:
- `anthropic` — Claude Haiku 4.5 (placený, přesnější čeština),
- `workers-ai` — Cloudflare Workers AI, Llama 3.1 8B (**zdarma**, nativní `env.AI`
  binding, data neopustí Cloudflare; free 10k neuronů/den ≈ ~50 klasifikací/den).

Řídí `AI_PROVIDER` (`anthropic` | `workers-ai` | `off`; prázdné = auto). „Dle úhrady":
placený backend primárně, a když spadne (kredit/billing/výpadek), vrstva se **sama
přepne na free**. Teď je ve `wrangler.jsonc` `AI_PROVIDER=workers-ai` (Anthropic bez
kreditu); po dobití stačí přepnout na `anthropic` (placený s free fallbackem).

`ai.ts` je nově tenká abstrakce (`providerChain` + `classify(rows, ctx)` →
`{rows, provider}`); Workers AI dělá JSON přes prompt s tolerantním parsováním
(Workers AI nemá napříč verzemi zaručený `response_format`). `/api/ai-check` je
provider-aware, `/api/process` vrací `aiProvider`. Binding `ai` + var `AI_PROVIDER`
ve `wrangler.jsonc`; Workers AI běží jen `--remote`/v produkci (lokálně model není).

**Ověřeno:** `test/ai.test.ts` (11 testů — provider chain, enrich, fenced JSON,
best-effort, fallback přes mock Anthropicu). **94 testů zelených**, `tsc --noEmit` čistý.

**Pozn. k modelu:** plain `@cf/meta/llama-3.1-8b-instruct` v katalogu účtu **není** —
použit `@cf/meta/llama-3.1-8b-instruct-fp8` (ověřeno `wrangler ai models`). Špatné ID
by AI tiše shodilo (chyba 7502 → best-effort skip, žádný alarm), takže model ID vždy
ověřit proti živému katalogu, ne z paměti. 8B (levné na neurony) drží i plnou dávku
60 řádků ve free 10k neuronů/den; 70B by ji mohl prostřelit.

## 2026-07-22 — dedup pravidelných plateb: normalizace zlomkového podílu

Textový dedup pravidelných plateb (SPEC §8, přidaný 2026-07-22) padal na **vedoucím
podílu `½`/`¾`**. Šablona ho píše jako `½ Oneplay…`, ale Fio ho ve „Zprávě pro
příjemce" uloží jako `? Oneplay…` (zlomek do pole nepustí a nahradí `?`), staré XML
jako `Â½` (dvojité UTF-8). `asciiFold` jede přes NFD, které vulgární zlomky
nerozkládá — řádky se nespárovaly a `½ Oneplay 200`, `¾ O2 300`, `½ Rodinné 50`
padaly jako `NEW`. Hrozila **dvojí úhrada zálohy, která už tenhle měsíc odešla**.
(Přišlo najevo při kontrole červencové dávky: ty tři položky reálně jsou na výpisu
příjemce 2900203312 k 21. 7. 2026, ale dedup je nechytil.)

**Oprava:** `normText` v `src/dedup.ts` teď před porovnáním smaže vulgární zlomky
i jejich náhrady (`? �`). Týká se **jen porovnávání** — generované texty příkazů
(`½/¾`) zůstávají beze změny. Ostatní pravidelné (Neo Modrý, Kanály navíc, stočné,
elektřina, plyn) se párovaly správně už dřív, protože zlomek nemají.

**Ověřeno:** `test/dedup.test.ts` +2 regresní testy (½/¾ ↔ `?`; a že se dvě různé
½ položky nezamění). **83 testů (Vitest) zelených**, `tsc --noEmit` čistý.

**Nasazeno:** `wrangler deploy` na bass443 (2026-07-22) s `COMMIT_SHA` — živě běží
commit `1055efe`, Version `f5df567c-b951-4687-912e-e261da8d9c30`, ověřeno přes
`/api/version`. FIO-import nemá CI, nasazuje se ručně (`npm run deploy`).

## 2026-07-21 — nasazeno na Cloudflare + brána k API

**Živě:** `https://fio-import.bass443.workers.dev` (účet bass443), commit `7441ea9`.
D1 `fio-import` (EEUR, `c082caa7-9624-43b3-bf77-7f1c5e8db94c`), schéma aplikované.

**Brána (`src/auth.ts`)** — API je fail-closed, protože veřejná URL by vydala čísla účtů,
adresu a odběrné místo elektřiny:
- **Cloudflare Access** — Worker si ověřuje JWT sám (JWKS, RS256, `aud`/`iss`/`exp`),
  takže Access nejde obejít přímým voláním `*.workers.dev`. Zapne se doplněním
  `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` do `vars` — postup v [BUILD.md](docs/BUILD.md) §7.
  **Zatím nenastaveno** — moje wrangler oprávnění na Zero Trust nesahají (jen workers).
- **Sdílený token** `APP_TOKEN` — aktivní záložní cesta, UI se na něj doptá a uloží ho
  do `localStorage`. Po zprovoznění Accessu jde zrušit.

**Ověřeno v produkci:** `/api/template` bez tokenu → 401, s tokenem → 200; celý řetězec
process → generate → 10 příkazů / 9 308,72 CZK; **D1 ledger se učí** — po vygenerování
dávky je týž náklad při dalším běhu `ALREADY_CLAIMED`. Testovací data z D1 smazána
(ledger i batches jsou prázdné).

## 2026-07-21 — zrušena česká výjimka v ASCII-foldu

Na přání uživatele se u **obchodníků** foldne veškerá diakritika včetně české
(`Havlíčkova` → `Havlickova`). Odpadl tím celý mechanismus rozlišování „česká × cizí"
za celý řetězec — `asciiFold` je teď prostý per-znak fold, `foldAll` zaniklo.

**Nedotčené (záměrně):** kategorie a poznámka z výpisu (`Dovolená`, `nákup`), texty
pravidelných plateb a názvy měsíců (`stočné záloha…`, `červenec`). Důvod: přijatý
referenční import v [SAMPLE_DATA.md](docs/SAMPLE_DATA.md) tuhle diakritiku obsahuje
a test na shodu znak po znaku je nejsilnější důkaz, který o formátu máme.
Kdyby se měla zrušit i tam, je to jedna změna v `buildMsg` + `recurring.ts`,
ale rozbije to byte-shodu s referencí — chce to výslovné rozhodnutí.

Aktualizováno v `docs/SPEC.md` §6 a v tabulce rozhodnutí v `docs/ARCHITECTURE.md`.
37 testů zelených.

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
