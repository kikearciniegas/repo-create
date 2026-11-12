# Repository policy (every project, every agent)

The one source of rules for repository configuration. `~/.claude/CLAUDE.md` §3c/§3e point here; ci-flow's `POLICY.md` keeps CI. The repo-create skill (`SKILL.md` beside this file) carries the plan table and the audit check ids, and `scripts/audit.ts` checks a repository against §1.

**When this applies:** before any repository create / edit / rename / delete / archive / transfer / visibility / settings write. Read-only git (`status`, `log`, `diff`, `fetch`) and read-only `gh api` GETs do not.

**Run first:**
- Before `gh repo create`: `bun ~/.claude/skills/repo-create/scripts/audit.ts --owner <login>`. It shows the plan, what a new private or public repo gets, the repo counts, this month's minutes and a random development name.
- Before and after a settings change: `bun ~/.claude/skills/repo-create/scripts/audit.ts <repo-path>` (any repo, with or without CI; a repo with CI also gets ci-flow's `bun ~/.claude/skills/ci-flow/scripts/audit.ts <repo-path>`). It only reads; the fixes it prints are never run.
- To apply approved fixes: `bun ~/.claude/skills/repo-create/scripts/apply.ts <repo-path> --propose` first (the proposal table; writes nothing), then `--rows <id,id,…>` with only the rows the owner approved. Its read-back table (the audit run again) is the verification, never the exit code of a write.

## 0. Owner decisions (2026-11-02)

- **The personal account stays on Free.** Its private repos run CI without enforced protection.
- **A private repo moves to the Team org** when it gains a deploy credential or an expensive required job. The owner decides each move.
- **Team org Actions budget: whatever the audit's `plan-minutes` row reads live, "Stop usage" on.** Never a figure copied into a document: the owner changes it. Overrun is paid up to that, then Actions stops. An excess Linux minute costs about US$0.006, so October's 2,612-minute overrun was about US$16.

## 1. Repository configuration: security and privacy

Repo settings live outside the tree, so nothing reviews them unless a rule names them.
- **Check them** when a repo is created, transferred, changes plan or changes visibility. Run `bun ~/.claude/skills/repo-create/scripts/audit.ts`.
- **Read back each one** with `gh api` rather than trusting the PUT.
- **Re-read a setting whenever a document claims it.** On 2026-10-31 a repo's CLAUDE.md named nine required checks on its default branch, while the live rule had none.

**Visibility and names**
- **Visibility is a one-way door.** Private by default.
  - Going public publishes the full history: every commit, deleted file and old secret.
  - Clones and forks survive switching back.
  - Before any switch to public:
    - a full-history `gitleaks git` scan with zero findings, or each finding rotated;
    - no client or personal data in history (what counts and how commits are blocked: ci-flow's POLICY.md §1, "No personal data reaches a repo");
    - the owner's explicit decision.
- **A secret that ever reached a commit is rotated, not just deleted.** Rewriting history does not un-leak it: forks, clones, caches and PR refs keep it.
- **Names leak too.** A private repo under development gets a random name unrelated to the product, client or folder (`audit.ts --owner` suggests one). Once it goes public the product name is out anyway, so the repo is renamed to it, and `git remote set-url` runs in every clone.
- **Folder prefixes are the owner's private labels, never repo content.**
  - The owner keeps the list in a local config (`~/.config/ci-flow/private-prefixes`), never in a repo.
  - They never appear in a repo's name, README, package names, docs, commit messages or URLs.
  - Derive names from the project, never from the folder. This applies at creation and to every file written later.

**Plans and privilege**
- **Know what the plan gives each visibility.**
  - Public repos get secret scanning, push protection, wait timers and required reviewers free.
  - Private repos on Free, Pro and Team get none of them; ci-flow's POLICY §1 (gitleaks in CI) covers the gap.
  - Branch protection, rulesets and environments on private repos need Pro or Team or above.
  - Re-check after any plan or org change: protection that silently stops applying looks exactly like protection that works.
- **Least privilege everywhere:**
  - Workflows declare `permissions: contents: read` at the top and widen per job only where needed.
  - Deploy credentials are ENVIRONMENT secrets, on an environment whose branch policy allows the default branch only.
    - **Exception, the preview environment (owner, 2026-11-05; narrowed 2026-11-07):** its branch policy is `preview/*`, so a deploy-workflow change is pushed as `preview/<name>` and previewed with `workflow_dispatch target=preview` before it reaches production (any other ref is refused before the token is reachable; kintag and lightfast, read back 2026-11-08). The pattern only narrows the exposure: anyone with `contents: write` can create a `preview/` branch, so the rest of this exception still applies. The day a second account gets push access, restrict it to the default branch or move previews to a separate hosting scope. Give it its own token, never the production one, so each can be rotated alone. The audit (`deploy-credential-scope`) fails again as soon as a second writer appears.
  - **Prefer short-lived OIDC credentials over a static deploy token** wherever the platform federates with GitHub for deploying (AWS: yes). Vercel does not for creating deployments (2026-11), so it keeps one scoped token per environment.
  - **A job that holds a deploy token runs no repository code.** A decision that needs the code runs in its own job with no secrets, and hands the token jobs an output. Unsetting the token for one subprocess is not isolation.
  - Pin third-party actions to a full commit SHA with the version in a comment, and enforce SHA pinning in the Actions policy once every workflow is pinned.
  - Never use `pull_request_target` with a checkout of the PR head.
  - Pass untrusted `${{ github.event.* }}` text to `run:` through `env:`, never inline.
  - Fork PRs get no write token and no secrets.

**Always on**
- **Public-repo extras:**
  - require approval before workflows run for outside contributors;
  - a `SECURITY.md` with a private reporting channel;
  - private vulnerability reporting enabled.
- **Always on, any visibility:**
  - Dependabot alerts and security updates;
  - a dependency audit in the cheap CI job with no severity threshold (exemptions only by advisory id, with a reason);
  - `.github/dependabot.yml` for the ecosystems in use, plus `github-actions` grouped when the repo has a workflow or an action;
  - artifact and log retention ≤ 30 days.
- **An alert inside a vendored tool's tree** (a deploy CLI):
  - `overrides` to the patched version inside the same major;
  - one that needs a major jump inside the vendor's packages is dismissed with the reason written on the alert;
  - both are revisited on every bump of that tool.
- **Default-branch hygiene:**
  - no force-push and no deletion on the default branch;
  - merged branches deleted automatically;
  - one merge method per repo.

**Licensing (owner, 2026-11-08)**
- **The header follows the repo's LICENSE text, not its visibility:**
  - an "All rights reserved" LICENSE ("Copyright (c) 2026 Rafael Arciniegas. All rights reserved.", manifests `"license": "UNLICENSED"`) → a copyright header in every source file;
  - an MIT LICENSE → an SPDX `MIT` header in every source file.
- **A source file** is code or a script: `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.sh`, `.py`, workflow `.yml`, and any file with a shebang. Never `.md` or other docs, JSON, lockfiles, generated files, migrations or fixtures compared byte-for-byte.
- **No header** in third-party files either, or in any file a header would stop from executing.

**People and data**
- **Collaborators, apps and keys:**
  - the fewest members, apps and OAuth grants the work needs; remove any that finished their job;
  - deploy keys read-only;
  - webhooks on https with a secret;
  - a token is scoped to one repo and the narrowest permission, and lives in 1Password, never in the tree.
- **Org baseline:**
  - 2FA required;
  - members cannot create public repositories;
  - base permission `read`;
  - fine-grained PATs only, with a maximum lifetime;
  - one owner reads the org audit log monthly.
- **Privacy of the content:**
  - no real personal data in fixtures, seeds, screenshots or logs committed to any repo, private included;
  - commit author email is the GitHub noreply address;
  - source maps are never publicly served: no `*.map` reachable on the deployed site (Next.js: `productionBrowserSourceMaps` stays off); upload them to the error tracker only.

**One-way doors**
- **Recreating a repo clean (delete + recreate) is a one-way door.** The owner confirms it in that project's session, after seeing the inventory. Steps, in order:
  1. **Land or close every open PR.** Deletion takes issues, PRs, Actions history and stars with it.
  2. **Inventory what lives outside the tree** with `gh api`, saved to `~/.claude-backups/<repo>-settings-<date>.md`:
     - environments and their branch policies;
     - secret NAMES and variables (values cannot be read back; confirm each is in 1Password first);
     - branch protection, Dependabot and security settings, Actions permissions;
     - webhooks, deploy keys, collaborators, linked apps.
  3. **Mirror backup:** `git clone --mirror` (plus `git lfs fetch --all` if the repo uses LFS) to `~/.claude-backups/<repo>-mirror-<date>/`, then `stat` it.
  4. **Clean the tree:** take out prefixes and leaked names, move large media to the NAS and `.gitignore` it, then run a full `gitleaks dir .` with zero findings.
  5. **New history:** a fresh single initial commit from the cleaned tree by default. Use `git filter-repo` only if the owner wants history kept, and then run gitleaks over the rewritten history too.
  6. **Delete, then recreate private** under a neutral name (needs `gh auth refresh -s delete_repo`):
     - push;
     - re-apply every setting and read each back;
     - re-link integrations;
     - run CI and verify a deploy.
  7. **Delete and re-clone every old clone and worktree.**
- **Transfers:** after moving a repo between owners:
  - re-check environments, secrets, branch protection, Dependabot, Actions permissions, webhooks and linked apps (a hosting platform's Git link may need the new owner's app install);
  - `git remote set-url` in every clone (never rely on the old URL's redirect);
  - run `audit.ts`, because the new owner's plan and policies now apply.

## 2. Repository storage

- **Large binaries and media stay out of git, LFS included.** Renders, videos and exports are `.gitignore`d and live on the Synology NAS copy of the project; only small posters and notes are tracked. Untracking does NOT free GitHub LFS storage: history still references the objects, and only deleting the repo or GitHub Support releases it.
- **Pulling a commit that untracks files DELETES them from every other checkout**, and a synced folder then syncs the deletion. Copy the files aside (with checksums) before that pull, restore and verify after.
- **A pull blocked by untracked files that would be overwritten:** compare each against the incoming version first (blob hash; for LFS, the file's sha256 against the pointer's `oid`), move only proven-identical files to `~/.claude-backups/`, never delete, then pull.
