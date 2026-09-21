# Contributing

Thank you for helping. The only way changes get into this repository is a **pull request from your own fork**; nobody but the maintainer can push to it.

## How to contribute

1. **Fork** the repository on GitHub.
2. Clone **your fork**, and create a branch from `develop`: `feature/<short-name>`.
3. Make the change **test-first** and update the docs it touches (`docs/`, `CHANGELOG.md`). See [`docs/README.md`](docs/README.md).
4. Run the checks:
   - server: `cd server && npm install && npm test`
   - app: `cd app && flutter analyze && flutter test`
   - secrets: `python scripts/audit-secrets.py` (and `git config core.hooksPath .githooks` once, so it runs before every push)
5. Open a pull request against **`develop`**. Fill in the template. The maintainer reviews and merges; direct pushes are not possible.

## Ground rules

- **Never commit secrets**: keys, tokens, keystores, `.env`, certificates, `%APPDATA%\FlashPush` state. The history of a public repository is public forever.
- **Security first**: read [`docs/security.md`](docs/security.md) and its review checklist before adding a route or a permission.
- **Keep tests from running scripts.** Tests must not launch PowerShell, VBS hosts, `netsh` and similar, and must not open network-wide listeners ([`docs/dev-safety.md`](docs/dev-safety.md)); `npm test` enforces this.
- Small, focused changes; clean code over clever code; no speculative features.
- Security problems go through [`SECURITY.md`](SECURITY.md), not public issues.
