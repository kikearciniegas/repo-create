---
name: repo-create
description: Create and configure GitHub repositories with a read-only audit that knows what each GitHub plan (Free, Pro, Team) gives public and private repos. Use when CREATING a repository, renaming one or changing its visibility, changing repository or organization settings, answering a plan / quota / Actions-minutes question, choosing a licence, or applying the storage rules (media out of git, LFS, pulls that untrack files). Not for CI pipeline work (workflows, required checks, branch protection scripts, deploy): that is ci-flow.
---

# repo-create — repositories created and configured on purpose

Internal skill. The rules live in `POLICY.md` beside this file (the one source; CLAUDE.md §3c/§3e point to it): read it first. This file carries the two journeys, the plan table, the audit check ids and the naming lifecycle. `scripts/audit.ts` checks a repository against POLICY §1. Every script below lives in `~/.claude/skills/repo-create/scripts/` and runs with `bun`.

## Before anything else

1. **Run the audit first, and again last.** `bun ~/.claude/skills/repo-create/scripts/audit.ts <repo-path>` reads `origin/main` via `git show` plus `gh api` GETs and writes nothing. **Before `gh repo create`:** `audit.ts --owner <login>`. An unknown answer is FAIL, never PASS. In a sandboxed shell `gh` fails TLS verification; re-run that one command outside the sandbox (it is read-only).
2. **A repo that gains CI: load ci-flow; protection moves to the repository's own protect script** (ci-flow's `[protect-script]`; it is per repo, not a script in ci-flow's skill folder).
3. **The constraints every step below obeys:**
   - Nothing is written to GitHub before the owner approves it, and only the approved rows run.
   - A one-way door (visibility, delete, transfer, recreate) gets its own question; none is reachable from `apply.ts`.
   - A write is verified by a GET read-back (the audit run again), never by an exit code.
   - Never `--admin` past protection.
   - Local files are added or appended to, never overwritten.
   - Secrets: names only; values live in 1Password.
4. **Before acting on an audit row's fix in a repo, read that project's memory** (`~/.claude/projects/<project-id>/memory/`): a recorded owner decision outranks a fix derived from an audit row (a rename fixed the row and left the label in history, where only a recreate removes it).

## New repo journey (`/repo-create`)

Questions go through `AskUserQuestion`, batched only where the answers are independent.

1. **Owner facts.** Run `audit.ts --owner <login>` for the personal login and for the org (`<org>`). Each report gives the plan, the repo counts, this month's minutes and a random development name. A plan the report cannot read is asked, never assumed.
2. **Interview.**
   - `AskUserQuestion` batch 1: the owner (personal account or `<org>`), each option showing its detected plan for confirmation.
   - Batch 2 (independent questions): visibility (private is the default; each option says what it gives on that plan, from the table below); an existing code path or none; purpose signals: will it deploy, will it have CI, will it hold client or personal data, is it a public product or internal.
   - Batch 3 (depends on batch 2): the name and the licence.
     - **Name:** the random development name is the default while private. When it is used, ask where the owner wants the product name kept; the skill stores it nowhere, and asks again each time.
     - **Licence** (POLICY "Licensing": two levels only): `none`, or `full` = LICENSE + the manifest `license` key + a header in every source file. The type is `mit` or `all-rights-reserved`. Recommend from the answers: public → `mit`; private product or client work → `all-rights-reserved`; a throwaway → `none`.
3. **Existing code** (skip with none):
   - `scan.ts <path>` (read-only; `--large-mb <n>` changes the 5 MiB threshold). Show its facts: manifests, deploy config, large files, env-file secret *names*, licence, headers, suggested Dependabot ecosystems, environments, LFS and `.gitignore`.
   - **Offer** the claude-security scan (`claude-security:claude-security`) in its own question, with the cost sentence: "minutes to hours and a large token spend; not measured". Run it only on yes; report its findings, never fix them from this skill.
   - If the path has git history: `gitleaks git <path> --redact` before any push. A finding blocks the push until the secret is rotated (POLICY: rotated, not just deleted).
4. **Create.**
   - **Public is a one-way door:** confirm it in its own `AskUserQuestion`, naming that the full history becomes public (POLICY "Visibility and names").
   - Run `gh repo create <owner>/<name> --private|--public`, with `--source <path> --remote origin --push` for existing code. For an empty folder, `git -C <path> init` first and leave out `--push`.
   - Read it back with `gh repo view <owner>/<name> --json name,visibility,owner` and show the answer.
5. **Starter files and the local clone.**
   - `starter.ts <path> --slug <owner>/<name> --license mit|all-rights-reserved|none --level none|full [--gitignore <Template>]`, with the interview's answers and the scan's `.gitignore` suggestion; `--dry-run` lists first. It writes only absent files and renders `docs/*.html` only once `origin` is named like the slug.
   - `local-setup.ts <path> [--email <id>+<login>@users.noreply.github.com]`: the gitleaks pre-commit line, a repo-local noreply email, and the Synology Drive exclusions and worktree pointer it prints for the owner.
   - Personal data: ci-flow's POLICY §1, "No personal data reaches a repo", applies from the first commit; its hook reads the owner's denylist at `~/.config/pii-guard/denylist`. Point to both; never read, quote or copy the denylist.
   - Commit, `git -C <path> push origin HEAD`, then verify by sha: `git -C <path> merge-base --is-ancestor $(git -C <path> rev-parse HEAD) origin/main`.
   - The owner proves the hook with one blocked fake-secret commit.
6. **Proposal, approval, apply.**
   - `apply.ts <path> --propose` (writes nothing). Show the 7-column table verbatim.
   - Approval is one `AskUserQuestion`: `Apply all N applicable rows (Recommended)` / `Choose rows` (the owner types the ids) / `Apply none`.
   - An edited row: after approval, run the edited `gh api` command by hand, then read it back with `apply.ts <path> --propose`.
   - `apply.ts <path> --rows <id,id,…>`; show its `## Read-back` table and `skipped:` line verbatim. Exit 1 = a row reads `FAILED`: report it, never retry blindly. Exit 2 = refused, nothing written.
   - Org-wide rows (`org-baseline`, the org variant of `actions-policy`) are refused as `org-wide` and stay by hand. The `repo-name` rename stays a printed fix.
7. **Hand-off.** A repo that will have CI: load ci-flow with the scan's Dependabot ecosystems. Branch protection then belongs to the repository's own protect script; `apply.ts` refuses `branch-baseline` when the audit sees a PR-triggered workflow.

## Existing repo journey (`/repo-create --audit <path>`)

No interview. Run step 6 on the path; run step 3 (scan, the offered security scan) when the owner asks for it. `--audit` is how the owner asks for this journey, not an `audit.ts` flag (`audit.ts` has none; `audit.ts <path>` alone is the audit).

## Repository configuration (the audit's `Repository configuration` table; POLICY.md §1)

Judged against what the owner's plan gives a repo of this visibility, and
what the project needs (read from its tree: a PR workflow → it needs
protection; a deploy workflow or a deploy-like secret → it needs
environments). Plan facts checked against GitHub docs 2026-11-02:

| A repo gets | Private, Free | Private, Pro | Private, Team org | Public, any plan |
|---|---|---|---|---|
| Repositories / collaborators | unlimited | unlimited | unlimited | unlimited |
| Branch protection, rulesets | no | yes | yes | yes |
| Environments, env secrets, branch policies | no | yes | yes | yes |
| Env required reviewers / wait timers | no | no | no | yes |
| Secret scanning + push protection | no | no | paid add-on | yes |
| CodeQL | no | no | paid add-on | yes |
| Private vulnerability reporting | no | no | no | yes |
| Actions (standard Linux) | 2,000 min | 3,000 min | 3,000 min, org-shared | free |

- Plan lacks it AND the project needs it → `blocked`, with the options (move to the Team org, Pro, go public, accept the named risk). Lacks it, not needed → n.a. Available but off → FAIL with the fix. `--strict` ignores `blocked`: it is an owner decision. Owner rule (2026-11-02): a personal private repo moves to the Team org when it gains a deploy credential or an expensive required job.
- Plan: read from GitHub (an org always; a user only with the `user` scope), else inferred on a private repo: protection refused "with an upgrade message" means Free; protection readable, or answering 404 "Branch not protected", means Pro (user) or Team (org); any other 404 leaves the plan unknown.
- Checks: [plan-detected] [plan-protection] [plan-environments] [plan-minutes] [repo-name] [merge-hygiene] [dependabot-alerts] [dependabot-security-updates] [actions-token] [actions-policy] (allow-list + full-SHA pinning; org-wide for org repos, so pin every repo first) [fork-pr-policy] [secret-scanning] [private-vuln-reporting] [security-policy] [branch-baseline] (n.a. when ci-flow's protect script owns protection) [deploy-keys] [webhooks] [collaborators] [deploy-credential-scope] [log-retention] (≤ 30 days) [commit-email-noreply] [gitleaks-precommit] (the local clone's hook, present — not proven by a blocked commit) [org-baseline] [account-2fa].
- **Naming lifecycle:** private and in development → a random name unrelated to product, client or folder (`adjective-noun-NNN`; the audit suggests one). At launch, when the repo goes public, rename it to the product name (`gh repo rename`, then `git remote set-url` in every clone; GitHub's redirect is not to be relied on).
- **Minutes:** [plan-minutes] reports this month's usage of the owner (SKU `Actions Linux` only — storage is not minutes); from 80% of the included minutes the report prints a bold line: used, limit, remaining until the reset, month-end projection, and the budget left before Actions stops. Past 80% with no organization-scoped budget with stop-usage on is a FAIL (Actions stops at the quota).
