# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: the **Security** tab of this repository → **Report a vulnerability**. Include what you found, how to reproduce it, and which version or commit. You will get an answer as soon as the maintainer can; this is a personal project, so please be patient.

## What FlashPush protects

Transfers between your own phone and laptop are encrypted (HTTPS with a pinned certificate), a phone must be approved on the laptop (matching 6-digit code), and everything else is rejected. The model, its limits and what is **not** protected are in [`docs/security.md`](docs/security.md); the pairing cryptography is in [`docs/pairing.md`](docs/pairing.md).

## Supported versions

Only the latest commit on `develop` / the newest release is supported.

## Secrets and this repository

This repository is public, so nothing secret may ever be committed: no keys, keystores, tokens, `.env` files, certificates or state files. The check is automated (`python scripts/audit-secrets.py`, run by the pre-push hook) and explained in [`docs/repo-security.md`](docs/repo-security.md). If you find a secret in the history, report it privately as above.
