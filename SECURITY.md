# Security Policy

## Reporting a vulnerability

If you discover a security issue in this repository, please report it responsibly and confidentially.

Preferred reporting methods:

- Open a GitHub issue in this repository with the title prefixed by `SECURITY:` and include enough detail to reproduce the problem.
- If you prefer not to use a public issue, email the maintainers at `security@stableroute.org`.

Please include:

- a clear description of the issue
- affected versions or branches
- reproduction steps or a proof-of-concept
- impact and risk assessment
- any relevant screenshots, logs, or request/response details

## Coordinated disclosure

We appreciate coordinated disclosure. Please:

- avoid public disclosure until a fix is available
- give maintainers time to investigate and remediate the issue
- work with the project team to confirm when the vulnerability has been resolved

## Response

We aim to acknowledge valid reports within 3 business days and to coordinate a fix or mitigation as quickly as possible.

## Scope

This policy covers security issues in the `stableroute-frontend` repository, including:

- frontend application bugs that expose sensitive data
- API integration or configuration issues that weaken security controls
- authentication, authorization, and session handling problems
- UI-level issues that may allow data leakage or unauthorized access

Issues outside this repository should be reported to the appropriate upstream project or service provider.

## What not to do

- do not exploit or publicize vulnerabilities before disclosure
- do not use this repository for unsolicited penetration testing without permission
- do not include personal data or sensitive production credentials in your report

## HTTP security headers

Security-relevant response headers are set for every route in `next.config.ts`.

### Cross-origin isolation

The following headers collectively enforce cross-origin isolation, preventing the
dashboard from being embedded or window-opened by untrusted origins:

| Header                                | Value                    | Purpose                                                                                                                                                                    |
| ------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cross-Origin-Opener-Policy`          | `same-origin`            | Prevents cross-origin pages from retaining a reference to the dashboard's browsing-context group, closing opener-based side-channel attacks.                               |
| `Cross-Origin-Resource-Policy`        | `same-origin`            | Prevents other origins from loading dashboard resources via no-cors fetch/XHR requests.                                                                                    |
| `Content-Security-Policy` (directive) | `frame-ancestors 'none'` | Blocks the page from being embedded in any `<iframe>`, `<frame>`, `<embed>`, or `<object>`, defending against clickjacking even in browsers that ignore `X-Frame-Options`. |

`X-Frame-Options: DENY` is also set as a defence-in-depth fallback for older
browsers that do not support the CSP `frame-ancestors` directive.

### Other hardening headers

| Header                   | Value                                                             |
| ------------------------ | ----------------------------------------------------------------- |
| `X-Content-Type-Options` | `nosniff`                                                         |
| `Referrer-Policy`        | `strict-origin-when-cross-origin`                                 |
| `Permissions-Policy`     | camera, microphone, geolocation, and interest-cohort all disabled |

All header assertions are covered by `src/__tests__/nextConfigHeaders.test.ts`.

---

## Secret scanning

The repository ships a lightweight, dependency-free **secret scanner** that
blocks accidental commits of API keys, webhook secrets, and `.env` files. The
scanner runs in **two** layers:

1. **Pre-commit** (`hooks/pre-commit`) — runs locally before each commit.
2. **CI** (`.github/workflows/ci.yml`, job `secret-scan`) — runs against the
   PR diff on every pull request targeting `main`.

### What it detects

The scanner (`scripts/check-staged-secrets.js`) is **fail-closed** on the
following:

| Category                                         | Detector                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Blocked filenames** *(rejected outright)*      | `.env`, `.env.*`, `.envrc`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_dsa`, `id_ed25519`, `id_ecdsa` |
| **AWS**                                          | `AKIA…` access key IDs, AWS secret access keys in assignments                                  |
| **GitHub tokens**                                | `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`, `github_pat_…`                                     |
| **Stripe** *(live only — test keys are ignored)* | `sk_live_…`, `pk_live_…`, `rk_live_…`                                                          |
| **Slack**                                        | `xoxb-…`, `xoxp-…`, `xoxa-…`, `xoxs-…`, `xoxr-…`, `https://hooks.slack.com/services/…`          |
| **Google**                                       | `AIza…` API keys                                                                               |
| **OpenAI / Anthropic**                           | `sk-…T3BlbkFJ…`, `sk-ant-…`                                                                    |
| **Private key blocks**                           | `-----BEGIN [OPENSSH |RSA ]?PRIVATE KEY-----`                                                  |
| **Other**                                        | `Authorization: Bearer <opaque>`, generic `KEY = "<opaque>"` with Shannon entropy ≥ 4.5        |

Filenames like `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, and
`*.min.{js,css}` are **excluded** from content scanning to avoid an avalanche
of false positives; their blocked-name matches are still rejected.

### Inline disable (escape hatch)

For the rare false positive (e.g. you genuinely need to commit a base64 SRI
hash or a hex digest next to a sensitive key name), append one of:

```js
const TOKEN = '...';               // stableroute-disable-line secret-scan
const NEXT_LINE = '...';           // stableroute-disable-next-line secret-scan
                                   // stableroute-disable-next-line secret-scan
const ACTUAL = 'aZ3q9X0P7...';
```

The marker semantics mirror `eslint-disable-line` / `eslint-disable-next-line`.

### Optional environment variable to bypass

Hooks **never** ship a silent off-switch, but maintainers may bypass locally:

| Variable                              | Effect                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| `STABLEROUTE_SKIP_SECRET_SCAN=1`      | Skip the secret scanner only (lint still runs)                     |
| `STABLEROUTE_SKIP_PRECOMMIT=1`        | Skip the entire hook (neither scan nor lint runs)                   |

> **Skipping is for emergencies, not workflow preference.** Every bypass
> should be paired with a Secret Rotation ticket and a re-rotation of the
> underlying credential.

### Installing the pre-commit hook

After `npm install` the `prepare` script will mark `hooks/pre-commit` as
executable in the working tree, but Git's `core.hooksPath` must still be
pointed at the in-repo `hooks/` directory. Run once after cloning:

```bash
npm run setup:hooks
```

This is equivalent to:

```bash
git config core.hooksPath hooks
chmod +x hooks/pre-commit
```

CI is unaffected — the `secret-scan` GitHub Actions job is wired directly in
`.github/workflows/ci.yml` and does not depend on `core.hooksPath`.

### Running the scanner manually

```bash
# Staged files (what the pre-commit hook runs)
npm run scan:secrets

# Whole working tree (local dry-run that mimics CI without git history)
npm run scan:secrets:working-tree

# PR diff against a base ref (used by the CI job)
BASE_REF=origin/main npm run scan:secrets:ci
```

### CI: `secret-scan` job

`.github/workflows/ci.yml` defines a parallel `secret-scan` job that:

- checks out the **full git history** (`fetch-depth: 0`),
- installs Node `24` and runs `npm ci`,
- runs `npm run scan:secrets:ci` against `BASE_REF` (`${{ github.event.pull_request.base.ref }}`,
  falling back to `origin/main`),
- fails the workflow if any match is reported.

A failure here blocks a PR from merging — the contributor must rotate the
leaked credential and update the PR before re-running the job.

### Detection coverage

Unit-test coverage for the scanner module is enforced at ≥95% by the Jest
config (`jest.config.js → collectCoverageFrom`). See
`scripts/__tests__/checkStagedSecrets.test.js` for behaviour and edge cases,
including CRLF handling, binary files, lockfile skips, inline disable, and
PR diff sweeps.

### Known limitations

The scanner is a **best-effort defence-in-depth** layer, not a substitute for
proper secret rotation discipline.

- **`git commit --no-verify`** bypasses every local pre-commit hook, including
  this one. Reviewers should treat the **CI `secret-scan` job** as the
  source of truth, not local hooks. Skipping the local hook does not un-leak
  the secret.
- **Binary blobs** (e.g. PNG/ICO/PDF assets under `public/`) whose content we
  cannot source are recorded as `⚠ unreadable` rather than as a finding.
  A deliberately-crafted binary could in theory stage a credential that the
  scanner would not parse. The diff is still visible in PR review and the
  binary's surface area is tiny in this repo — but if you need a stricter
  posture, run `npm run scan:secrets -- --scope=working-tree` locally before
  pushing and inspect ⚠ entries.
- **Shallow clones**: when `git diff origin/main...HEAD` is empty (e.g. fork
  PRs without a known merge-base), the scanner falls back to
  `git diff origin/main HEAD`. This may scan the entire tree rather than
  just the PR's commits; behaviour is correct but the scan volume is larger.
