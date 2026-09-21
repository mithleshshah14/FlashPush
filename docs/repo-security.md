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

## Applied on 2026-09-22 (with the GitHub CLI)

Read back from GitHub after applying:

| Setting | State |
|---|---|
| `main` and `develop` | protected: a pull request is required, **no approval and no code-owner review** (see below), **no force pushes, no deletions**. The working `feature/*` branches are deliberately not protected. |
| Secret scanning + push protection | on (GitHub enables them for public repositories) |
| Private vulnerability reporting | on |
| Dependabot alerts | on |
| Wiki, Projects | off (Issues stay on, forking stays on) |
| Collaborators | none (only the owner) |
| Visibility | public |

### Why no required approval

The first setup required 1 approval plus a code-owner review. In a repository with one maintainer that can never be satisfied (GitHub does not let an author approve their own pull request), so every merge needed the owner "bypass" and it protected nothing. What keeps outsiders out is that they have **no write access**: they can only open pull requests from forks, and only someone with write access can merge. The rule was relaxed to *pull request required, 0 approvals*, on `main` and `develop`. **If you ever add a collaborator with write access, turn approvals back on** (Settings → Branches, or `required_approving_review_count: 1`).

### Squash merges and the feature branch

Merging a pull request with **Squash and merge** replaces its commits by one commit on the target branch: `develop` and `main` on GitHub show one commit for the whole first feature, and the detailed history (112 commits) exists only on `feature/v2-pairing-autostart-tailscale`. **Keep that branch** (do not use "Delete branch"), or use **Create a merge commit** instead of squash for future pull requests.

Two-factor authentication on the GitHub account could not be verified through the API with the current token scopes: check it in Settings → Password and authentication.

### Files only take effect on the default branch

GitHub reads `SECURITY.md`, `CONTRIBUTING.md`, the pull request template and `CODEOWNERS` from the **default branch** (`main`). They currently live on the feature branch, so "Report a vulnerability" guidance, the PR template and required code-owner review become active once the feature branch is merged into `develop` and then `main` (through pull requests, since both branches are protected).

### Reproduce or change

```
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input protection.json
```

with `protection.json`: `{"required_status_checks":null,"enforce_admins":false,"required_pull_request_reviews":{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true},"restrictions":null,"allow_force_pushes":false,"allow_deletions":false,"required_conversation_resolution":true}` (same for `develop`); `gh api -X PUT repos/<owner>/<repo>/private-vulnerability-reporting`; `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts`. Set `enforce_admins` to `true` to remove the owner bypass.
