# Repository security

How this **public** repository is protected, what can and cannot be prevented, and the GitHub settings to switch on. Reporting a vulnerability: [SECURITY.md](../SECURITY.md). Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md).

## What "public" means (and cannot be changed)

On a public GitHub repository **anyone can view, clone, download and fork it**, including every old commit and branch. That cannot be switched off while the repository is public. What you *can* control is who can **change** it:

| Person | Can do | Cannot do |
|---|---|---|
| Anyone on GitHub | read, clone, download, star, fork, open issues, open a pull request from their own fork | push to this repository, merge, delete branches, change settings |
| Collaborators you add | what you grant (avoid adding any) | |
| You (owner) | everything | |

So "people can only fork, star and open PRs" is how a public repository already behaves for strangers: a clone of it is a private copy on their machine, and nothing they do there reaches your repository unless you merge their pull request.

If you also want to stop people from *reading or copying* the code, the repository must be **private** (then nobody but people you invite can see it, and stars, forks and outside PRs are gone too), or the public repository should contain only what you want public (README, releases, docs).

## Nothing secret may ever be committed

Everything ever committed is public forever, including branches and old commits. Guards in this repository:

- `.gitignore` blocks keys, certificates, keystores (`*.jks`, `*.keystore`, `key.properties`), `local.properties`, `.env*`, `google-services.json`, APK/AAB files and FlashPush state files.
- `python scripts/audit-secrets.py` scans **every file in every commit** for private keys, GitHub/AWS/Google/Slack tokens, JWTs, Android signing passwords and assigned secret-looking values, checks for sensitive file names, and lists personal data. It prints names only, never values.
- `.githooks/pre-push` runs it before every push (enable once: `git config core.hooksPath .githooks`).
- The pull request template asks every contributor to confirm it.

**Audit on 2026-09-22 (546 files, 106 commits, all branches): no secrets, no sensitive file names, no personal data in files.** Mobile: no keystore, `key.properties`, `local.properties`, `google-services.json` or APK was ever committed; the release signing config does not exist yet (the debug build uses the debug key).

### Known, accepted exposure

- **Commit author identity.** Every commit carries the git `user.name` and `user.email` of the author, so it is public. To stop that for new commits, use GitHub's private address (Settings → Emails → *Keep my email addresses private* and *Block command line pushes that expose my email*, then `git config user.email "<id>+<username>@users.noreply.github.com"`). Old commits keep the old address unless history is rewritten and force-pushed, which is destructive and is left to the owner.
- **Sample names and addresses** in tests, docs and design mock-ups (a laptop called `MITHLESH-PC`, `192.168.x.x` and `100.x.y.z` example addresses, the Stitch project id). None of these is a credential.
- Images exported from Stitch contain a tiny editor tag and a hash; no location or device data.

### Before a release build

Create the signing keystore **outside the repository**, reference it from an ignored `key.properties`, and never commit either. Do not use the debug key for a published app.

## GitHub settings to switch on (in the browser)

Repository → **Settings**. None of this can be set from the repository files.

1. **Branches → Add branch ruleset** (or *branch protection rule*) for `main` and `develop`:
   - Require a pull request before merging, with **1 approval** and **Require review from Code Owners** (see `.github/CODEOWNERS`)
   - Block force pushes, block deletions
   - Require status checks to pass, once CI exists
   - Optional: require signed commits, require linear history
2. **Code security** → enable **Secret scanning** and **Push protection** (free for public repositories), **Private vulnerability reporting**, and **Dependabot alerts**.
3. **Actions → General** (when workflows exist): *Require approval for all outside collaborators* for fork pull requests, and *Read repository contents permission* as the default token permission.
4. **Collaborators**: none. Do not add anyone who does not need write access.
5. **General**: keep *Issues* on if you want bug reports; turn *Wikis* and *Projects* off if you do not use them; leave *Allow forking* on (needed for outside pull requests).
6. Your **account**: turn on two-factor authentication.

## If a secret is ever committed

1. **Revoke it immediately** (rotate the key/token/password): removing it from git does not make it safe.
2. Remove it from the current files and push.
3. Only then consider rewriting history (`git filter-repo`) and force-pushing; anyone who cloned earlier still has it, so step 1 is the fix.
