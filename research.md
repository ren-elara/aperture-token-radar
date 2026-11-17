# Aperture: research and rubric deconstruction

The actual token-radar-01 brief concerns **pre-token DeFi protocols**, not newly traded memecoins. The sealed dataset is DefiLlama's 2026-11-14 snapshot: 758 protocols, ten fields each, and 40 required watchlist slugs. The judge prioritizes working coverage, a data-derived valuation, concrete farming plans, a useful page, then visual quality. We build around those priorities and supply the requested live launch intelligence as an explicit optional CLI.

## Evidence and source boundaries

Sources inspected: make.fun skill.md version 1.5.200; competition.yaml and input/README.md from the token-radar-01 kit; its official vendor/makefun-board.ts. DefiLlama data fields are TVL, seven-day TVL growth, listing date, token ticker/id and circulating market cap. They contain **no token allocation, campaign, investor funding, FDV, fees, unique buyers, token authorities or holder balances**. Listing age is time since tracking began, not proof of operating history or time spent tokenless. A null token record does not prove no token exists. Parent relationships are absent: the supplied watchlist is authoritative at its floor and new candidates below it have incomplete parent evidence.

The entrypoint must run on Node 22 standard library only in a container without network and produce identical bytes twice. The board needs 100–4000 unique snapshot slugs, all watchlist entries, positive values decreasing by rank and 3–12 steps per row (20–600 characters). Dashboard files have a 4 MiB cap and no remote resource/link attributes. Three screenshots must be genuine page captures, each 800+ on the short side, 1440 or less on the long side, under 512 KiB. The dossier must match the official library and remain under 1.5 MiB. Its source text cap is 65,536 bytes.

## Valuation research

For traded protocols with positive market cap and TVL, take circulating market-cap / TVL, winsorized to [0.03, 3]. Use a category median shrunk to the universe median with w=n/(n+5). This reduces single-peer influence and lets unseen categories use the market prior. This is a circulating-equivalent implied launch value, **not FDV or a personal airdrop payout**; supply and dilution are unavailable. The value uses the snapshot's own peers, TVL, growth and age, without protocol-name valuation overrides.

Value = TVL × peer multiple × growth adjustment × maturity adjustment.
Growth = clamp(1 + clamp(7d change, -60,150)/200, .55,1.65).
Maturity = .65 + .5 × min(listing age or 180 days,1095)/1095.
Low/base/high = .5× / 1× / 1.8×; these are scenario bands, not statistical intervals.

Snapshot alpha = 40% bounded momentum + 30% log-scaled TVL + 20% capped listing age + 10% evidence coverage. It is a prioritization heuristic, not a probability of launch or financial return. Evidence confidence rewards category sample size and reported dates/growth; it does not certify contract safety. Mint/freeze, holder concentration and audits remain unknown for pre-token protocols. Farming plans follow category and supported chain, with estimated gas, capital, time, withdrawal procedure and access gates; no invented campaign or guaranteed eligibility.

## Optional launch monitor

DexScreener profiles and boosts are independent discovery routes on the same vendor (boosts are paid promotion, not quality). DexScreener pair enrichment provides volume windows, liquidity, FDV and transaction counts; buys/sells count transactions, not unique wallets. GeckoTerminal new pools supplies a second vendor for discovery and pair data. Solana public RPC optionally supplies mint/freeze authority, mint supply and largest **token accounts**; these are not unique holders and pool/custody accounts can dominate. SPL Token-2022 and RPC failures remain unverified. All adapters declare their evidence fields and provenance. Replay fixtures are synthetic adversarial patterns, never claimed historical outcomes.

Live momentum weights volume acceleration, buy pressure, observed unique buyer velocity (only with an explicit wallet feed) and liquidity/FDV. Missing values contribute zero and reduce coverage. Safety penalizes authorities, account concentration, slippage and wash-like transaction/volume patterns. Unknown is not safe: incomplete authority/holder evidence caps safety; high alpha never overrides a hard risk veto. A score explains each contribution and reason. Thresholded alerts are keyed by chain+mint and score bucket in a bounded TTL cache, with explicit re-alert on changed risk.

Each request has a deadline, bounded attempts, exponential backoff with jitter, Retry-After handling and bounded body size. A failing source falls through to the next, and when all fail the CLI labels its synthetic fixture replay. No API key is necessary. Live observations never change the sealed evaluation outputs. Low latency is measured on deterministic CPU scoring separately from network latency; live outage is reported as degraded rather than a successful live fetch.

## Verification plan

Test strict schema refusal, missing and duplicate watchlist slugs, corrupt/null/non-finite values, token/derivative separation, complete coverage, ranks, formula monotonicity and age sensitivity, peer outlier resistance, deterministic directory hashes, real screenshot dimensions, no-network rendering with every request intercepted, filters/details/sorting/export, retry/fallback, malformed vendor payloads, dedup TTL and score transitions, runner/rug synthetic ordering, unknown-evidence caps, CPU p50/p95/p99 and a separately reported bounded live probe. Run the official local scorer if available, then bundle/check the real harness sessions unchanged.
