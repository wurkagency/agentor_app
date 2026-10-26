# ADR 0003 · Dependency supply-chain policy

Status: accepted (M0) · 19. okt. 2026

- **pnpm** is pinned through `packageManager` and run with corepack.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (a release must be 7 days old before it can be installed), `blockExoticSubdeps: true` and `trustPolicy: no-downgrade`. Exceptions are listed in the file with a reason and reviewed in the PR that adds them.
- Install scripts are denied by default; `allowBuilds` lists the reviewed exceptions (`esbuild`, `msgpackr-extract`).
- CI installs with `--frozen-lockfile`, which also re-verifies the lockfile against these policies, then runs gitleaks on the full history, Semgrep (`p/default`, `p/typescript`, `p/nodejs`) and `pnpm audit --prod --audit-level high`.
- Dependency ranges are major-level (`^16.0.0`), so the lockfile, not the range, decides the exact version.
