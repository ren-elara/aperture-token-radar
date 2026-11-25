# Submission status

The upgrade is pushed to `main` as `f24716c`. The model, dashboard and local checks are complete; make.fun submission is pending valid transcript provenance and account approval.

## Verified

- 196 ranked candidates from 758 sealed protocols; all 40 required watchlist slugs included.
- 416 token-bearing records and 146 derivative products kept outside the ranked candidate board.
- Offline dashboard with shared valuation engine, leave-one-out peer diagnostic, filters, sorting, scenarios, detailed farm plans, shortlist and export.
- Optional live discovery across DexScreener profiles/boosts and GeckoTerminal, bounded retries/fallback, Solana RPC evidence and synthetic replay.
- `node verify.mjs`: **14/14 groups passed** after the rewrite and p75-band fix; the optional live probe has not been rerun for this upgrade.
- Two complete builds have identical directory manifests; dossier matches the official library byte for byte.
- Four genuine 1440×1000 screenshots; zero browser errors and zero remote page requests.
- Launch scoring p95 0.0629 ms; full board build p95 64.7101 ms in the latest regression run.
- Last live verification before this upgrade: 24 observations in 3330 ms; all discovery sources healthy.
- `npm run build`: passed using the local development loader on a distribution build of Node without TypeScript support.
- Existing make.fun credentials are present and the authenticated identity was previously verified as `@ren-elara`; the account connection approval for the current login attempt is still unconfirmed.
- Signing key copied into `.makefun/keypairs/https_make.fun.json` and verified to match the stored credential wallet; private files are mode 600 and excluded from Git.
- The prior submission bundle included the original OpenCode session `ses_e16856076ffeoHnoNiggHzwLaB`, taken from a consistent native SQLite backup; that bundle does not cover the current upgrade.
- The prior official bundle/check cover only the earlier submitted work. The current level-45 `check --worktree` passes local artifact gates but fails `transcripts_present` without a fresh bundle. A valid, authentic bundle and a passing check of the final commit are still required.

## Packaged artifacts

- Existing transcript artifacts are from the earlier submitted work and are not proof of this upgrade.
- A fresh `artifacts/transcripts.tar.gz`, bundle manifest and passing official check for this upgrade have not been produced.
- `sessions/opencode.db`: native database snapshot taken with the original store opened read-only. Messages, usage, model IDs and timestamps are not edited. Only the selected session goes into the kit's bundle.

Current local reports are in `artifacts/`: verification.json, benchmarks.json and capture.json. Older live and official-check reports reflect earlier runs. Artifacts, sessions, credentials, private keys, kit files and development caches are excluded from Git.

## Publication

GitHub authentication is verified as `ren-elara`. The public repository is https://github.com/ren-elara/aperture-token-radar, created 2026-11-17 after the bounty opened. Its About metadata includes the make.fun bounty URL and required makefun topic. Upgrade commit `f24716c7b51951d022d6bf65386c072df7c4b524` is pushed to `main`. Account approval remains pending, and make.fun submission awaits a fresh authentic bundle plus a passing official check for the exact submitted commit.

README badges identify `ren-elara/aperture-token-radar`. `.makefun/owner.json` names the verified signing wallet. The final commit is checked again before submitting; remote public access, ownership, commit availability and the entry signature are submission-time checks. The receipt and final submission status are recorded in the excluded artifacts directory so they do not require changing the submitted commit.
