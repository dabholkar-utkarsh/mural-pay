# Mural Pay — ICP Company Discovery

An internal GTM tool that finds and ranks companies matching Mural Pay's ideal customer profile. It searches Apollo's B2B database, enriches the most promising candidates, verifies buying committees, and uses an LLM judge that understands what Mural Pay sells to rank companies as **prospects** — not just industry matches.

Built as a take-home project for the GTM Engineer role. The interesting part isn't the UI — it's the matching pipeline and the data problems it had to solve (documented in [Design decisions](#design-decisions--what-the-data-taught-us)).

![Tool](docs/screenshot.png)

## Quick start

```bash
pnpm install
# add the two keys below to apps/server/.env
pnpm build   # one-time: builds the shared package the apps import
pnpm dev     # admin UI on :3001, NestJS API on :4000
```

| Variable (in `apps/server/.env`) | Required | Purpose |
|----------|----------|---------|
| `APOLLO_API_KEY` | Yes | Company search, enrichment, people search |
| `ANTHROPIC_API_KEY` | No, but strongly recommended | AI pre-screen + prospect ranking. Without it, the tool falls back to filter-signal ranking only. |
| `REDIS_URL` | No | Caches search results for 24h to skip repeat Apollo/Anthropic calls. Leave unset to disable caching; search still works. |

The keys live only in the NestJS server; the Next.js admin proxies to it through `COMPANY_DISCOVERY_API_URL`, which is server-side only.

Select ICP filter chips, set how many companies you want, and hit **Search Companies**. Each result card shows firmographics, which filter signals matched, and the AI's judgment with a one-line reason.

## Railway deploy

Deploy this monorepo as separate Railway services, each from the same repo with its own config-as-code path:

| Service | Code | Config path | Public domain? |
|---------|------|-------------|----------------|
| **server** | `apps/server` | `docs/deploy/railway.server.toml` | No — keep private |
| **admin** | `apps/admin` | `docs/deploy/railway.admin.toml` | Yes (the team UI) |
| **app** | `apps/app` | `docs/deploy/railway.app.toml` | Yes (public portal) |

Set these variables on the **server** service:

| Variable | Required | Notes |
|----------|----------|-------|
| `APOLLO_API_KEY` | Yes | Rotate before deploy if the key was exposed during local exploration. |
| `ANTHROPIC_API_KEY` | No | Enables AI pre-screening and prospect ranking. A missing/malformed value silently drops the AI judgment while Apollo results still return. |
| `REDIS_URL` | No | Set to a Redis service (e.g. `${{Redis.REDIS_URL}}`) to cache search results for 24h. Leave unset to disable caching. |
| `PORT` | No | Railway injects this at runtime. Set it explicitly only if admin references `${{server.PORT}}` (cross-service refs don't resolve the injected port automatically). |

Set this variable on the **admin** service:

| Variable | Required | Notes |
|----------|----------|-------|
| `COMPANY_DISCOVERY_API_URL` | Yes | Runtime URL for the NestJS service. Private: `http://${{server.RAILWAY_PRIVATE_DOMAIN}}:${{server.PORT}}`. Public: the server's `https://…up.railway.app`. Do not use a `NEXT_PUBLIC_` prefix. |

The **app** (public portal) needs none of these variables — it only holds whatever the portal itself uses.

Notes:

- **Private networking is IPv6-only.** The server binds to `::` (see `apps/server/src/main.ts`) so it's reachable over Railway's private network. Without that bind, admin gets connection-refused.
- Prefer private networking for `COMPANY_DISCOVERY_API_URL` and keep the NestJS service private. If the server is public, add auth or a shared internal API key before exposing it.
- Keep the server at **1 replica** — the search rate limiter is in-memory (`railway.server.toml` pins this).

### Optional: search result caching

Add a Redis service to the project and set the server's `REDIS_URL` to its private URL. Identical searches are then served from cache for 24h, skipping Apollo/Anthropic entirely. The cache is **fail-open**: if Redis is unset or unreachable, search runs uncached rather than erroring.

## How it works

```
       ┌─────────────┐   1 call, up to 100 candidates (per_page=100)
       │ Apollo      │   q_organization_keyword_tags = curated clusters
       │ search      │   + size / location / hiring / revenue filters
       └──────┬──────┘
              │ slim records (name, domain, revenue — no industry/size/location)
       ┌──────▼──────┐   parallel Haiku calls (chunks of 25), scores only
       │ AI          │   "Is this plausibly a Mural Pay prospect?"
       │ pre-screen  │   Sorts the pool so enrichment is spent wisely
       └──────┬──────┘
       ┌──────▼──────┐   limit × 2 (cap 20) candidates, batches in parallel
       │ Bulk        │   Adds employees, industry, keywords, description,
       │ enrichment  │   location — the fields scoring actually needs
       └──────┬──────┘
       ┌──────▼──────┐   Drops companies whose KNOWN location contradicts
       │ Geography   │   the location filter (Apollo's HQ filter leaks);
       │ gate        │   unknown locations are kept, not punished
       └──────┬──────┘
       ┌──────▼──────┐   1 people-search call over the top 20:
       │ Buyer       │   does a CPO/CLO/CFO actually exist there?
       │ verification│   (mixed_people/search is credit-free)
       └──────┬──────┘   ← runs CONCURRENTLY with ranking below
       ┌──────▼──────┐   parallel Haiku calls over the top 20 (chunks of
       │ AI prospect │   10), with reasons. Knows what Mural Pay sells and
       │ ranking     │   what a great prospect looks like
       └──────┬──────┘
              ▼
        Top N results   (composite score, sorted)
```

For a typical search: 1 search + 4 parallel pre-screen chunks + 1–2 parallel enrichment + (1 people search ∥ 2 parallel ranking chunks). LLM calls are output-token-bound, so chunking them and overlapping verification with ranking cut end-to-end latency from ~10s to ~5–6s.

### Scoring model

Final score is a 50/50 composite:

| Half | Points | Source |
|------|--------|--------|
| Filter signals | 50 | 10 per **active** filter (industry keywords, size, revenue, geography, buyer persona, hiring-for), normalized — only filters you selected count |
| AI judgment | 50 | LLM prospect score (0–100, scaled) |

Rules that keep the ranking honest:

- **Missing data ≠ match.** A signal only scores when the data exists; the denominator is all *active* filters, so a sparse record can't score 100% by matching the one field it has (this was a real bug — see below).
- **Unjudged can't beat judged.** Every candidate gets an AI score (pre-screen at minimum). A company the AI skipped gets a neutral 25/50, never its raw filter score.
- **Fit labels:** Strong ≥ 75, Medium ≥ 45, else Weak.

### The AI judge knows the seller

The ranking prompt (see `SELLER_CONTEXT` in `constants.ts`) tells the model what Mural Pay sells (stablecoin accounts, real-time cross-border payments, LatAm rails), who its reference customers are (Opera, Deel, Bolt, Koywe), and what makes a prospect strong: **online platforms that regularly pay out money to many recipients**. It also carries calibration anchors — Kalshi, Whop, and Underdog are pinned as 85–100 ideal prospects — so scores stay stable as the rubric evolves.

This is the difference between "is this a payroll company?" and "would this payroll company buy Mural Pay?" In practice: Ontop (global payroll → LatAm contractors) scores 92, while PrismHR (domestic PEO software that doesn't move money) scores 30 — both are "payroll companies."

## ICP filters

| Filter | Type | Notes |
|--------|------|-------|
| Industries | Preset chips | Payroll, E-commerce, Marketplace, Betting & Prediction Markets — each expands to a curated keyword cluster (below) |
| Company size | Preset chips | 1–10 through 500–1,000 |
| Locations | Preset chips | United States, Mexico, Brazil — enforced by a hard post-enrichment gate, not just Apollo's filter |
| Buyer personas | Chips + free text | Verified via people search (does the title exist at the company?) |
| Hiring for | Chips + free text | Maps to Apollo's *active job postings* filter — an intent signal, off by default |
| Min revenue ($M) | Numeric input | Blank = off. **Leave it off for young verticals** (see findings) |

### Curated keyword clusters

Apollo ORs keyword tags, so every loose tag adds junk. Each industry chip expands to ~12 validated multi-word tags (`KEYWORD_SYNONYMS` in `constants.ts`); bare terms like "betting" or "marketplace" are deliberately excluded. The betting cluster was validated against live data: a 6-tag prediction-market query returned a 58-company universe with Kalshi as result #1.

To build a cluster for a new vertical: enrich 5–10 known-good companies, collect the `keywords` Apollo returns for them, keep the tags they share, and test each tag solo (check `total_entries` + eyeball page 1) before adding it.

## Design decisions — what the data taught us

Each of these came from a live failure, not theory:

1. **Apollo's `accounts` are CRM records, not search results.** The `mixed_companies` endpoint injects companies saved in your Apollo workspace *without applying keyword filters* — we got Dallas real-estate firms in an e-commerce search. Fix: use only `organizations`.

2. **The search response is too slim to score.** It omits employee count, industry, keywords, description, and location — every result flatlined at the same score until we added bulk enrichment. The pipeline enriches `limit × 2` candidates (10 domains per credit-consuming call).

3. **The revenue floor erases young verticals.** Apollo has no revenue data for most young private companies — a $10M floor removed Polymarket, Novig, and Futuur from a prediction-market search while keeping a magazine and a hedge fund. That's why the floor is optional.

4. **`q_organization_job_titles` means *hiring for*, not *has*.** It filters by active job postings. Using it for buyer personas (CFO etc.) was both wrong and noisy; personas moved to a people-search verification step, and the postings filter became the explicit "Hiring for" intent signal.

5. **Apollo's location filter leaks.** A Greek sportsbook (Stoiximan) and an Austrian operator surfaced in a US-only search. The hard geography gate drops any company whose *known* enriched location contradicts the filter — without punishing companies whose location is simply missing.

6. **Percentage-of-available scoring inverts the ranking.** Sparse records (revenue-only stubs) scored 100% by matching the only signal they had. Scoring now divides by all active filter weight, so unknowns count against ranking — a company you know nothing about shouldn't outrank a verified one.

7. **A judge with a stricter rubric needs anchors.** Adding "cross-border is the ICP" to the prompt tanked Kalshi (US-domestic) to 35 — the seed company itself. Calibration anchors and "high payout volume matters more than cross-border" restored sane scores. Lesson: every rubric change should be checked against named known-good companies.

## Cost & latency per search (limit = 10)

| Step | Calls | Credits | ~Latency |
|------|-------|---------|----------|
| Apollo search | 1 | per-call (cheap) | 1–2s |
| AI pre-screen (scores only) | 4 Haiku, parallel | — (~$0.001) | 1–2s |
| Bulk enrichment | 2, parallel | ~20 (1/company) | 1–2s |
| People search | 1 | free | ~1s (overlapped with ranking) |
| AI ranking (reasons) | 2 Haiku, parallel | — (~$0.001) | 1–2s |

With `REDIS_URL` configured, an identical repeat search within 24h skips every step above — it returns straight from cache for ~0 credits and negligible latency.

Tuning knobs all live in `apps/admin/src/features/company-discovery/constants.ts`: pool depth (`PRESCREEN_MULTIPLIER`), enrichment spend (`ENRICH_MULTIPLIER`/`ENRICH_MAX`), AI weight (`LLM_RERANK_WEIGHT`), fit thresholds, keyword clusters, and the seller context prompt.

## Testing

50 unit tests cover the risky pipeline logic: Apollo request mapping, keyword expansion, enrichment merging and failure fallback, the geography gate, composite scoring (including regression tests named after real bugs — the revenue-only stub, the Greek sportsbook, the unjudged-company leapfrog), people-search verification, LLM chunking/partial-failure merging, and prompt construction. 5 NestJS tests cover the API's error mapping (missing key, bad body, Apollo 401).

```bash
pnpm test   # runs vitest (packages/company-discovery) + jest (apps/server) via turbo
```

All external calls are injected (`fetcher` parameter), so tests run fully offline.

## Known limitations & next steps

- **No iterative deepening.** If a vertical's pool is mostly weak (e.g. domestic payroll processors), a search returns fewer Strong results rather than digging deeper automatically. Next step: keep fetching/judging batches until N Strong are found or a cost cap is hit.
- **LLM score variance.** Near-tied companies (85 vs 80) can swap order between runs. Anchors reduce this; temperature 0 and larger request sizes would reduce it further.
- **Apollo-only retrieval.** True "companies like X" lookalike search would add a semantic source (Exa `findSimilar`, Ocean.io) in front of Apollo enrichment.
- **No persistence or CRM export** — live search only, by design for the MVP.

## Project structure

```
packages/company-discovery/src/   # Shared domain package (framework-agnostic)
├── constants.ts    # ICP defaults, keyword clusters, weights, seller context
├── apollo.ts       # Pipeline: search → pre-screen → enrich → gate → verify → rank
├── rerank.ts       # LLM judge (chunked parallel calls, verdict parsing)
├── types.ts        # Shared types (consumed by both apps)
└── *.test.ts       # 50 tests (vitest)

apps/server/src/company-discovery/  # NestJS API: POST /company-search
├── company-discovery.controller.ts # Route
├── company-discovery.service.ts    # Keys via ConfigService, cache, error mapping
├── search-cache.ts                 # Fail-open Redis cache (24h TTL), optional
└── company-discovery.service.spec.ts

apps/admin/src/
├── app/api/company-search/route.ts        # Thin proxy to the NestJS API
└── components/company-discovery-client.tsx # UI: filter chips, results, AI judgments
```

Monorepo: Turborepo + pnpm, TypeScript throughout. Next.js 14 admin UI → NestJS API → shared domain package, so the pipeline has one home and typed boundaries on both sides. Redis is used for optional search-result caching; the `app` workspace is the future public portal. (Earlier Postgres/Prisma and BullMQ scaffolding was removed — there's no persistence or job queue yet; see next steps.)
