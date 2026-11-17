# Submission status

Implementation, verification and transcript packaging are complete. **The official local worktree check passes. The owner has authorized GitHub publication and submission.**

## Verified

- 196 ranked candidates from 758 sealed protocols; all 40 required watchlist slugs included.
- 416 token-bearing records and 146 derivative products kept outside the ranked candidate board.
- Offline dashboard with shared valuation engine, filters, sorting, scenarios, detailed farm plans, shortlist and export.
- Optional live discovery across DexScreener profiles/boosts and GeckoTerminal, bounded retries/fallback, Solana RPC evidence and synthetic replay.
- `node verify.mjs --live`: **14/14 groups passed**.
- Two complete builds have identical directory manifests; dossier matches the official library byte for byte.
- Three genuine 1440×1000 screenshots; zero browser errors and zero remote page requests.
- Launch scoring p95 0.0718 ms; full board build p95 7.3805 ms.
- Last live verification: 24 observations in 3330 ms; all discovery sources healthy.
- `npm run build`: passed using the local development loader on a distribution build of Node without TypeScript support.
- Existing make.fun credentials copied into `.makefun/credentials` and authenticated identity verified as `@ren-elara`.
- Signing key copied into `.makefun/keypairs/https_make.fun.json` and verified to match the stored credential wallet; private files are mode 600 and excluded from Git.
- Original OpenCode session `ses_e16856076ffeoHnoNiggHzwLaB` bundled from a consistent native SQLite backup; other terminals' sessions excluded.
- Official `makefun.mjs bundle`: successful, with the original opening prompt and complete run record.
- Official `makefun.mjs check --worktree --transcripts artifacts/transcripts.tar.gz`: **passed**, with no failed checks. Transcript recording, structure, window, authored coverage, turns, model pricing, revisions and run-record checks all pass.

## Packaged artifacts

- `artifacts/transcripts.tar.gz`: transcript upload bundle.
- `artifacts/makefun-bundle.json`: bundle manifest, SHA-256, size and session coverage.
- `artifacts/makefun-check.json`: official local verdict on the current worktree and transcript bundle.
- `sessions/opencode.db`: native database snapshot taken with the original store opened read-only. Messages, usage, model IDs and timestamps are not edited. Only the selected session goes into the kit's bundle.

Reports are in `artifacts/`: verification.json, benchmarks.json, verification-live.json, capture.json, makefun-check.json and makefun-bundle.log. Artifacts, sessions, credentials, private keys, kit files and development caches are excluded from Git.

## Publication

The owner explicitly confirmed GitHub push and submission after the passing bundle/check. GitHub authentication is verified as `ren-elara`. The public repository is https://github.com/ren-elara/aperture-token-radar, created 2026-11-17 after the bounty opened. Its About metadata includes the make.fun bounty URL and required makefun topic.

README badges identify `ren-elara/aperture-token-radar`. `.makefun/owner.json` names the verified signing wallet. The final commit is checked again before submitting; remote public access, ownership, commit availability and the entry signature are submission-time checks. The receipt and final submission status are recorded in the excluded artifacts directory so they do not require changing the submitted commit.
