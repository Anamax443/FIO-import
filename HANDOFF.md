# HANDOFF — deník stavu: FIO-import

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

## 2026-07-21 — založení projektu
- Repo založeno podle **project-standard** (scaffold), GitHub `Anamax443/FIO-import` (privátní).
- Commit identita = **Milan Trnka <info@maxferit.cz>** (osobní projekt, ne AXIMA) — nastaveno lokálně v repu.
- **Hotové:** zadání a ověřená vstupní data v `docs/` — [SPEC.md](docs/SPEC.md),
  [SAMPLE_DATA.md](docs/SAMPLE_DATA.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md); README + BUILD vyplněné.
- **Rozpracované:** —
- **Zbývá (v tomto pořadí):**
  1. `src/util.ts` + `src/xml.ts` — **ověřit jádro** proti referenční transakci, teprve pak stavět okolo
  2. parsery Fio / Revolut / historie + testy na akceptační čísla (33 750,92 / 8 314 / 42 064,92 CZK)
  3. `dedup.ts` — cíl 11 shod ALREADY_CLAIMED
  4. UI (review tabulka), D1 (ledger, šablona), AI vrstva (Haiku, best-effort)
- **Otevřené otázky:**
  - model string pro Haiku ověřit před nasazením (aktuální: `claude-haiku-4-5-20251001`)
  - vícemenové Revolut řádky — kde přesně brát CZK ekvivalent, co reálně padl
