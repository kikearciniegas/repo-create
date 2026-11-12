# repo-create — design

Date: 2026-11-09. Owner: kikearciniegas. Status: DRAFT, awaiting owner approval.

## 1. Intent

One skill owns **the repository itself**: creating it, configuring it, auditing an existing one, and optimizing what it costs (storage, minutes, money, risk). The `ci-flow` skill keeps **the CI pipeline**: workflows, jobs, gates, toolchain, local tiers, deploy, required checks. Today both live in ci-flow (POLICY.md §2 and the audit's "Repository configuration" section), so creating a repo means loading a 230-line CI policy and a 1,087-line CI audit. After the split, each skill answers one question and neither restates the other.

Why now: the 2026-11-07/09 work showed the cost of the overlap — repo settings, licensing, budget and plan facts spread across POLICY.md, SKILL.md, CLAUDE.md §3c/§3e and the audit, and drifted (the US$20 budget line, the "CI job names" wording). Org minutes went over quota in November 2026, so every proposal must name its resource cost.

## 2. Goals, non-goals, anti-goals

**Goals**
- Interview → scan → proposal → owner approval → apply → read back → hand-off to ci-flow. Nothing is written to GitHub before approval.
- Plan-aware: every recommendation is checked against what the owner's plan gives a repo of that visibility (Free / Pro / Team org; private / public).
- An `--audit` mode for existing repos that reports drift and optimization wins, then goes through the same proposal/approval gate.
- Every proposal row names its resource or risk impact.

**Non-goals**
- Anything inside `.github/workflows/`, `required-checks.json`, `ci-flow.json`, local CI tiers, deploy workflows, `dependabot.yml` content (ci-flow keeps all of these).
- Hosting platforms (Vercel, Cloudflare) — GitHub only (owner decision 2026-11-09).
- DNS/DMARC (stays in CLAUDE.md §3e).

**Anti-goals** (failure even if it "works")
- Applying any setting without explicit approval, or applying a one-way door (visibility, delete, transfer, recreate) without its own confirmation.
- Overwriting an existing local file (hook, config) — lesson 25: add, never replace.
- Reporting a setting as done from a PUT's exit code instead of a GET read-back.
- Duplicating a rule that ci-flow or CLAUDE.md also states.

## 3. Modes

| Mode | Does | Writes |
|---|---|---|
| `/repo-create` | New repo: interview, scan (if code exists locally), proposal, apply | after approval |
| `/repo-create --audit <owner/repo or path>` | Existing repo: same checks, drift + optimization report, then proposal | after approval |
| `--audit --all [--owner <login>]` | Fleet: one table across every repo of an owner (drift, storage, minutes per repo, stale repos) | never; fixes go repo by repo |
| `--launch <repo>` | Private → public + rename to product name, public-only extras on, every clone's remote updated, history secret scan first | after approval; flip is a one-way door with its own confirm |
| `--transfer <repo> --to <org>` | Personal → Team org move: pre-check, transfer, re-apply what the org changes, remotes, read-back | after approval |
| `--archive <repo>` | Retire: revoke deploy keys, delete secrets/environments/webhooks, disable Actions, archive; history kept | after approval, one step at a time |
| `--secrets <repo or --all>` | Secret NAMES (never values) per repo / environment / org, last-updated dates, unused ones, rotation reminders, which belong in 1Password | never |
| `--cleanup <repo>` | Stale branches, old artifacts, per-PR Actions caches, unused environments/secrets, orphan deploy keys — dry-run list first | after approval |

## 4. The interview (new repo)

Asked with the structured question tool, batched only where answers are independent (brainstorming-extras):
1. **Owner**: personal account or an org (`arcmen`). The skill then **detects** the plan (`gh api`) and shows it for confirmation; an undetectable plan is asked, never assumed.
2. **Visibility**: private (default) or public. Shows what each gives on that plan (the plan table, §7).
3. **Name**: random development name (`adjective-noun-NNN`, generated; default while private) or the product name now. With a random name, the product name is recorded privately (owner's choice of place, never in the repo) for `--launch`.
4. **Existing code?** A local path or none.
5. **Purpose signals** that drive the proposal: will it deploy (needs environments + secrets)? will it have CI (hand-off to ci-flow)? does it hold client or personal data? public product or internal?
6. **Copyright level** (owner, 2026-11-09), recommended from intent: none · LICENSE only · LICENSE + manifest `license` field · LICENSE + manifest + header in every source file. *Corrected 2026-11-10 (plan 2 OPEN-8, POLICY wins): two levels only, none or LICENSE + manifest + header in every source file.* Header type follows the LICENSE text (MIT → SPDX; "All rights reserved" → copyright line); "source file" is POLICY's definition.

## 5. The scan (existing code)

- **Stack detection** (always, read-only, seconds): manifests and lockfiles (package.json/bun.lock, pyproject/uv.lock, Cargo, go.mod…), existing `.github/`, deploy config (vercel.json, wrangler.toml…), large binaries and media (§3e), env files and secret-looking names, licence files and headers. Output: what the repo needs (Dependabot ecosystems to hand to ci-flow, environments, LFS or not, `.gitignore` template, licence type).
- **Security scan** (owner chose "stack + security"): offered, not automatic — the claude-security skill on the code, with its cost stated (minutes to hours, tokens) before it runs. Findings are reported, never auto-fixed by repo-create.
- **History secret scan** before any `--launch` and before pushing existing history to a new remote: gitleaks over full history. A hit blocks the flip until the owner rotates (POLICY: a leaked secret is rotated, not just deleted).

## 6. The proposal

One table, every row: setting · current (audit) · recommended · why · cost/impact (minutes, storage, US$, risk) · available on this plan? · one-way door? The owner approves all, approves some, or edits rows. Then apply, then a read-back table (GET per setting), then a one-line summary of what was skipped and why.

Proposal areas: visibility and name; merge hygiene (squash only, delete branch on merge, no merge commits); branch baseline (PR required, no force push, no deletion, admins included — required *checks* are ci-flow's); Dependabot alerts + security updates; secret scanning + push protection; private vulnerability reporting; SECURITY.md; Actions permissions (token read-only, allow-list + SHA pinning, fork PR policy) or Actions off when no workflows; artifact/log retention (≤ 14–30 days); environments and secret names (deploy repos); collaborators, deploy keys, webhooks, apps; licence and copyright level; starter files; local clone setup.

**Starter files** (new repo): README, SECURITY.md, LICENSE (+ headers per level), stack `.gitignore`, CODEOWNERS, PR template, and the six project documents of CLAUDE.md §3b as stubs (pointers or MISSING sections, rendered with render-docs).

**Local clone setup**: gitleaks pre-commit **added** to any existing hook (never overwrite), noreply commit email, Synology Drive exclusions for `.git` and `node_modules` (full-path entries, probe to verify), worktrees under `~/tmp/`.

## 7. Optimization pass (audit and fleet)

Each finding carries a measured number: repo size and LFS usage (and the fact that untracking never frees LFS storage); Actions cache total vs the 10 GB limit and per-PR copies (the lightfast lesson: 3.6 GB of unreachable caches); artifact storage and retention; stale branches/environments/secrets; minutes per repo against the owner's quota (account-level number — which *jobs* spend them is ci-flow's report); repos to archive (no push in N months). Billing usage is read per SKU (`Actions Linux` for minutes) and per repo where the API gives it; when the API returns an unreliable split (seen 2026-11-08: one row), the skill says so instead of guessing.

## 8. Ownership split (what moves)

| Today in ci-flow | Moves to repo-create | Stays in ci-flow |
|---|---|---|
| POLICY.md §0 owner decisions | Free personal account; Team org move rule; budget read live | add-ons declaration |
| POLICY.md §2 (all) | visibility, names, plans/privilege, always-on security, licensing, people/data, one-way doors, transfers | — |
| audit `--owner` mode | all of it (plan, counts, minutes, random name) | — |
| audit section 2 checks | plan-detected, plan-protection, plan-environments, plan-minutes, repo-name, merge-hygiene, dependabot-alerts, dependabot-security-updates, actions-token, actions-policy, fork-pr-policy, secret-scanning, private-vuln-reporting, security-policy, branch-baseline, deploy-keys, webhooks, collaborators, deploy-credential-scope, log-retention, commit-email-noreply, gitleaks-precommit, org-baseline, account-2fa | dependabot-ecosystems, dependabot-actions-grouped, alert-dismissal-reason (they read `dependabot.yml`), protection-live, protection-matches-declared, all CI checks |
| SKILL.md "Repository configuration" + plan table | moves | a pointer line |
| lib/plans.ts, lib/owner.ts | moves | ci-flow imports nothing from repo-create; the small `gh` helper is copied (owner chose two scripts) |
| hooks/trigger.sh | new repo-create trigger for `gh repo create/edit/rename/delete/archive/transfer` and settings `gh api` writes | ci-flow trigger keeps commit/push/pr and workflow-file edits |

**Branch protection has one writer per repo** (my call, keeps today's behaviour): a classic protection PUT replaces the whole object, so two writers would wipe each other. A repo **without CI**: repo-create writes the baseline (PR required, no force push, no deletion, admins included). A repo **with CI**: ci-flow's protect script writes the whole object (baseline + required checks); repo-create's `branch-baseline` reports n.a. "owned by ci-flow's protect script" and never writes protection. When a repo gains CI, the hand-off moves ownership to ci-flow.

**Plan facts have one source** (my call): `lib/plans.ts` (the plan × visibility capability table and quotas) lives in repo-create; ci-flow's audit imports it by path from the installed skill (`~/.claude/skills/repo-create/scripts/lib/plans.ts`) for `protIsBlocked` and the budget arithmetic, and fails closed with "repo-create not installed" if it is missing. Plan *detection* (the gh reads) runs in repo-create; ci-flow reads the same table, not a copy. repo-create may **read** `.github/workflows/` to decide whether a repo needs a gate or environments; it never writes there.

**No gap during the move** (my call): the ci-flow PR (§10 step 2) and the CLAUDE.md/AGENTS.md pointer edits (step 5) land together. ci-flow keeps `--owner` and `--config-only` for one release as shims that print "moved: use /repo-create …" and exit 2, then they are deleted.

**From global CLAUDE.md:** §3c's "Before `gh repo create`: audit --owner" and "repo create / rename / transfer / visibility / settings" trigger → a §3c line pointing at repo-create; §3e's storage rules (no media in git, LFS, untracking deletes in other checkouts, blocked-pull procedure) → repo-create (DNS/DMARC stay). The parallel-session/worktree rules stay in CLAUDE.md (they govern every task); repo-create's local-setup step points at them.

## 9. Constraints

- Read-only by default; every write needs approval, every one-way door its own confirm. Never `--admin` past protection.
- Secrets: names only; values live in 1Password (`op://`), never printed or written.
- Verify every write by GET read-back; verify DNS-like or plan facts at the source, not a cache.
- Unknown = FAIL (as ci-flow's audit), never PASS.
- Bun + TypeScript, like ci-flow; tests with negative controls; the audit prints fixes and never runs them — the apply step is separate code that runs only approved rows.
- Its own repo (owner decision): `personal_skills/repo-create`, public MIT like ci-flow, symlinked into `~/.claude/skills/repo-create`. First real use: creating its own GitHub repo.

## 10. Order of work (for the plan)

1. repo-create skeleton + moved code (plans, owner, config checks) + tests, passing on the same fixtures ci-flow uses today.
2. ci-flow PR removing the moved checks, sections and POLICY §2 — merged only after repo-create's audit is live, so no check is ever missing in between.
3. Apply step, interview, proposal table.
4. Modes: `--audit --all`, `--cleanup`, `--secrets`, `--launch`, `--transfer`, `--archive`.
5. CLAUDE.md + AGENTS.md mirrors: §3c/§3e pointer lines — landed together with step 2.
6. Hook registration in `~/.claude/settings.json` (tracked in claude-config): add repo-create's trigger beside ci-flow's (`PreToolUse`, `Bash|Write|Edit|MultiEdit`); narrow ci-flow's trigger to commit/push/PR and workflow files. OWNER-APPROVED item (see §12).

## 11. Left to the builder

File layout inside the skill; how the proposal table is rendered; the exact random-name word lists (reuse ci-flow's); test fixture shapes; how `--all` paginates and caches GETs within one run.

## 12. Owner decisions (2026-11-09)

- Two audit scripts, not one shared (ci-flow keeps CI checks; repo-create owns repo configuration).
- Code scan = stack detection + an offered claude-security scan.
- GitHub only; hosting platforms stay in their own skills.
- Own repo, public MIT like ci-flow, symlinked into `~/.claude/skills/repo-create`.
- Modes included: `--launch`, `--audit --all`, `--cleanup`, local clone setup, starter files, `--transfer`, `--archive`, `--secrets`, and the copyright-level choice.
- Hook: one claude-config PR edits `~/.claude/settings.json` — adds repo-create's trigger, narrows ci-flow's; backed up first, tested with a fake `gh repo create` that must fire; the owner merges.

## 13. Calls made by the designer (check while reading)

- One protection writer per repo (§8).
- Plan table lives in repo-create; ci-flow imports it by path and fails closed without it (§8).
- ci-flow PR and CLAUDE.md pointers land together; `--owner`/`--config-only` shims for one release (§8).
- Dependabot: `dependabot.yml` checks stay in ci-flow; the two repo settings (alerts, security updates) move.
- `plan-minutes` (account quota and budget) moves; per-job billed minutes stay in ci-flow.
- The product name chosen while a random name is in use is recorded where the owner chooses at runtime, never in the repo.
