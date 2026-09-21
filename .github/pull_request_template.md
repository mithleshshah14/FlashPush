## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] Built test-first; `cd server && npm test` and/or `cd app && flutter analyze && flutter test` pass
- [ ] Docs and `CHANGELOG.md` updated for the change
- [ ] **No secrets or personal data** in the diff or in any earlier commit of this branch (`python scripts/audit-secrets.py` is clean)
- [ ] New or changed routes/permissions follow the review checklist in `docs/security.md`
- [ ] Tests do not launch PowerShell/VBS/netsh or open network-wide listeners (`docs/dev-safety.md`)
- [ ] Opened against `develop`
