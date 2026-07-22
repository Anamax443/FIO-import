# FIO-import

> Turns bank statements (Fio, Revolut) and recurring payments into an XML file for bulk
> payment-order import into Fio bank — without claiming the same cost twice.

🇨🇿 [Česká verze](README.md)

## What it does
1. Reads **Fio** (paste from internet banking) and **Revolut** (CSV) card payments / withdrawals.
2. Adds **recurring and mandatory payments** from a template; amounts are carried over from the last accepted XML.
3. **Deduplicates** against the history of already claimed costs (key = `txn_date + amount`) — a match is never deleted, only pre-set as excluded.
4. **Review step** — editable table, filters, `include` toggles, live total.
5. Generates the `.xml` that Fio accepts on the first attempt (CRLF, no comments, fixed element order).

Full specification (Czech): [docs/SPEC.md](docs/SPEC.md). User guide: [docs/navod.en.html](docs/navod.en.html).

## Status
The core is **done and verified**: 83 tests (Vitest), clean typecheck, and the whole pipeline
ran live from statement to a valid file; the app is **deployed on Cloudflare** (bass443).
A first real monthly batch remains — see [HANDOFF.md](HANDOFF.md) (Czech).

## Stack
- **Cloudflare Workers** (TypeScript, `nodejs_compat`) — API and static UI in one Worker
- **D1** (SQLite) — claimed-cost ledger, recurring template, batch audit (optional)
- **Claude Haiku 4.5** (`claude-haiku-4-5`) — optional categorisation of Revolut rows, best-effort
- **Vitest** — tests for the risky core (parsers, fingerprint, dedup, XML format)

## Requirements
- Node.js 22+
- A Cloudflare account with D1 (production only; local development does not need it)
- `ANTHROPIC_API_KEY` (AI layer only; the pipeline runs without it)

## Run / build
```
npm install
npm test            # 83 tests
npm run typecheck
npx wrangler dev --local --port 8788   # UI at http://127.0.0.1:8788
```
Details (D1, secrets) in [docs/BUILD.md](docs/BUILD.md) (Czech).

## Configuration
Never commit secrets — copy `.dev.vars.example` to `.dev.vars` and fill it in locally;
in production use `wrangler secret put`. Real statements and generated XML files
(account numbers, spending) do not belong in git either — `.gitignore` blocks them.

## Deployment
`npm run deploy`; the from-scratch procedure is in [docs/BUILD.md](docs/BUILD.md).

## Documentation
| Layer | Document |
|-------|----------|
| Specification | [docs/SPEC.md](docs/SPEC.md) — XML format, dedup, recurring payments, validation |
| Sample data | [docs/SAMPLE_DATA.md](docs/SAMPLE_DATA.md) — real input formats + acceptance figures |
| Technical | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, API, implementation decisions |
| Build | [docs/BUILD.md](docs/BUILD.md) — how to build from scratch |
| User | [docs/navod.en.html](docs/navod.en.html) · [CS](docs/navod.html) |
| Management | [docs/project-status.html](docs/project-status.html) — status, milestones, risks |
| Pitch | [docs/prezentace.html](docs/prezentace.html) |
| Journal | [HANDOFF.md](HANDOFF.md) |

> The Czech documents are the source of truth; the English ones are translations of the
> user-facing and overview layers.
