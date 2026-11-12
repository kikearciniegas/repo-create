# repo-create — plan 1 of 3: the split

Date: 2026-11-09. Status: DRAFT for the builder. Spec: `docs/superpowers/specs/2026-11-09-repo-create-design.md` (§8, §10, §12, §13).

> [!WARNING]
> **Codex did NOT challenge this plan.** `codex exec -s read-only` exited 1: "You've hit your usage limit … try again at Nov 12th, 2026 8:52 AM". The Open conflicts below are the author's own refutation only. Re-run the adversarial pass (the one-call `codex exec` from the planner brief) before the builder starts T1, or the owner accepts the plan as self-reviewed.

**Goal.** A working, tested `repo-create` skill that owns repository configuration — the 24 audit checks of design §8, `--owner` mode, the plan table and caps, POLICY §0 owner decisions (minus add-ons) + all of POLICY §2, the "Repository configuration" SKILL content, CLAUDE.md §3e storage rules — in its own public MIT repo (`kikearciniegas/repo-create`), symlinked into `~/.claude/skills/repo-create`. ci-flow loses those parts in one PR that lands together with the CLAUDE.md pointer PR; a claude-config PR then registers repo-create's trigger beside ci-flow's. **Audit only:** no apply, interview or proposal (plan 2), no extra modes (plan 3).

**Architecture.** Two audit scripts, nothing shared at runtime (owner decision, design §12). repo-create: `skills/repo-create/scripts/audit.ts` (tree at `--ref` via `git show`, `gh api` GETs, a small workflow reader that only answers "is there a PR-triggered workflow / a deploy workflow / which actions are used"), `scripts/lib/{gh,plans,owner}.ts` (gh and plans verbatim copies of ci-flow's, owner with its strings adapted), `hooks/trigger.sh`, `POLICY.md`, `SKILL.md`; `tests/` at the repo root. ci-flow keeps every CI check plus the three checks that read `dependabot.yml` / dismissed alerts. **One protection writer per repo** (design §8): repo-create's `branch-baseline` judges a repo with no PR-triggered workflow and reports n.a. "owned by ci-flow's protect script" when one exists.

**Tech stack.** bun 1.4.4 (local `bun --version` = ci-flow's CI pin, measured), TypeScript, `gh` CLI (logged in as `kikearciniegas`, scopes `repo user admin:org delete_repo workflow gist`, measured `gh auth status`), bash for the hook, `bun ~/.claude/scripts/render-docs.ts` for the six project docs.

## Global constraints

- Read-only audit; every fix is PRINTED under "Hardening", never run; unknown = FAIL, never pass; plan refusals = `blocked` (design §9; ci-flow's audit behaviour today).
- Every setting that is applied by hand during T7 is verified by a `gh api` GET read-back, never by the PUT's exit code.
- Secrets: names only; no value is printed or written. Webhook URLs print host only (as today).
- Never `--admin` past protection. One-way doors (public visibility at T7) get the owner's explicit confirmation in the session.
- Worktrees under `~/tmp/<repo>-<task>` off `origin/main` (CLAUDE.md §3); `~/.claude` is a checkout with 183 dirty entries (measured `git -C ~/.claude status --short | wc -l`) — never edited in place, never stashed.
- Every PR follows ci-flow's POLICY §1 procedure: draft → local `bun test tests/` green → push → mark ready once → CI green → **the owner merges** → read back with `git merge-base --is-ancestor <sha> origin/main`. Both repos are public: Actions minutes are free (no quota cost to name).
- Headers: `// SPDX-License-Identifier: MIT` + `// Copyright (c) 2026 Rafael Arciniegas` in every `.ts`, `.sh`, workflow `.yml` (POLICY "Licensing"); none in `.md`, JSON, fixtures.
- Surgical: moved code keeps its error handling and strings except the edits listed under "Edits to moved code". No new abstractions; copies are copies.
- Folder-prefix labels never appear in any file (POLICY §2); the test fixture keeps the fake `acme_` prefix.

## Review focus (each pinned to a test)

1. No moved check is vacuous: `tests/audit.test.ts` "each check can fail" — every one of the 24 ids has ≥1 mutation row and the coverage test lists none missing.
2. The audit never writes: baseline test "only ever reads from GitHub" (`calls.log` lines match `^api [^ ]+$|^repo list`).
3. One protection writer: the two `branch-baseline` tests — n.a. with a PR workflow, judged without one.
4. The two triggers partition the commands: repo-create `tests/trigger.test.ts` fires on `gh repo create` and is silent on `git commit`; ci-flow's (post-T8) the reverse.
5. ci-flow after the cut still fails each remaining check: its "every check has a mutation" test and the `> 40` row threshold (E1 below).

## Measured figures (ci-flow @ main 9cb6823, 2026-11-09; command beside each)

| Figure | Value | Command |
|---|---|---|
| ci-flow suite | **205 pass, 0 fail** in 45 s: audit 150, trigger 48, ci-workflow 7 | `bun test tests/`; per file `bun test <file>` |
| `check()` calls in `audit.ts` | 39 explicit + 2 looped CI = **41**; config section **27** → **68 rows** per run (each call pushes one row) | `awk '/^section = "config"/{s=1} /^check\("/…'` |
| Moving to repo-create | **24** of the 27 config checks; ci-flow keeps `dependabot-ecosystems`, `dependabot-actions-grouped`, `alert-dismissal-reason` → **44 rows** after | design §8 vs the awk list |
| `MUTATIONS` rows | **89**; **35** on moved ids (plan-detected 1, plan-protection 1, plan-environments 1, plan-minutes 2, repo-name 1, merge-hygiene 2, dependabot-alerts 1, dependabot-security-updates 1, actions-token 2, actions-policy 2, fork-pr-policy 2, secret-scanning 1, private-vuln-reporting 1, security-policy 1, branch-baseline 2, deploy-keys 1, webhooks 2, collaborators 1, deploy-credential-scope 2, log-retention 1, commit-email-noreply 1, gitleaks-precommit 2, org-baseline 2, account-2fa 2) at `tests/audit.test.ts:603–637` | `sed -n '545,638p' … \| grep -c '^  \["<id>"'` per id |
| Other test lines naming a moved id | **19** lines in 8 tests: 416, 453–455, 462–464, 468, 474, 486–496, 515, 714–724 | `grep -n '"<id>"' tests/audit.test.ts` outside 545–638 |
| `--owner` / `--config-only` / `cfg` in tests | lines 368–375 (ownerAudit), 398, 403, 413–418, 461, 513, 523–541, 622–623, 834, 839, 845 | `grep -n -e '--owner' -e ownerAudit -e '--config-only' -e '"cfg"'` |
| `configOnly` in `audit.ts` | lines 47, 53, 272, 273, 303, 893, 914, 1045 | `grep -n configOnly` |
| `plans.ts` consumers in `audit.ts` outside the moved block 736–1034 | **only the import, line 36** (`capsFor minutesOf planOf QUOTA randomName`) | `grep -n -e capsFor -e QUOTA -e minutesOf -e planOf -e randomName audit.ts \| awk '$1<736\|\|$1>1034'` |
| Helpers used inside 736–1034 (occurrences) | needRepo 22, isPublic 16, isOrg 16, must 14, `R(` 14, protection 12, refuse 6, CAPS 6, defaultBranch 6, deploySecrets 5, ownerRes 5, ownerData 5, `git(` 4, PREFIX 4, DEPLOY 4, visibility 4, planRow 3, needsGate 3, repoSecrets 3, secRes 3, shq 3, randomName 3, RANDOMISH 3, renameFix 3, usedActions 3, ghGet 3, Blocked 3, needsEnv 2, OPTIONS 2, heavy 2, protIsBlocked 2, configOnly 2, `CI!` 1, `!!CI` 1, ciJobs 1, USES 1, FILES 1, firstN 1, ghError 1, protRes 1; `show(` 0, TRACKED 0, prefetch 0 | `sed -n '736,1034p' audit.ts \| grep -cF <name>` |
| settings.json ci-flow hook entry | `{"matcher":"Bash\|Write\|Edit\|MultiEdit","hooks":[{"type":"command","command":"bash \"$HOME/.claude/skills/ci-flow/hooks/trigger.sh\"","timeout":5}]}`; 10 `PreToolUse` entries | `jq -c '.hooks.PreToolUse[]\|select(tostring\|test("ci-flow"))' ~/.claude/settings.json` |
| CLAUDE.md anchors | §3c = lines 134–140 (`Before gh repo create` at 138); §3e = 142–147 (storage 143–145, DNS 146–147); mirrors differ from CLAUDE.md in §3c–3e by 4 lines each (Codex wording) | `grep -n` / `diff <(sed -n '/^## 3c/,/^## 3f/p' …)` |
| Mirror tracking | `~/.claude/AGENTS.md` **untracked, not ignored** in claude-config; `~/AGENTS.md` **outside any git repo**; `CLAUDE.md` and `settings.json` tracked | `git -C ~/.claude ls-files`, `check-ignore -v` (rc 1), `git -C ~ rev-parse` (fatal) |
| GitHub | `kikearciniegas/repo-create` does not exist; ci-flow origin `https://github.com/kikearciniegas/ci-flow.git` | `gh repo view …` (GraphQL: could not resolve) |
| Existing symlink shape | `~/.claude/skills/ci-flow -> …/ci-flow/skills/ci-flow` | `ls -la ~/.claude/skills` |

Also measured: `references/lessons.md` has **0** lines matching `--owner|--config-only|§2` (`grep -c`), so T8 does not touch it. Unverified (not measured): exact post-move test counts (estimates below); the fixture's row count in a run (derived from the `check()` count, not printed).

## What moves, what is copied, what stays (`skills/ci-flow/scripts/audit.ts`)

**Moves (cut from ci-flow, pasted into repo-create):** lines 736–1034 — the block comment, `PREFIX_WORDS`/`PREFIX` (744–751), `isPublic visibility owner isOrg needRepo refuse must R`, `ownerRes ownerData plan planSource CAPS minutesWarn`, `DEPLOYISH secRes repoSecrets deploySecrets needsGate needsEnv OPTIONS`, `planRow`, `RANDOMISH renameFix`, and the 24 `check(...)` calls. Also: import line 36; `lib/plans.ts`, `lib/owner.ts` (whole files); the `--owner` call at 63; `--config-only` flag (47, 53) and `check()`'s skip at 303; `minutesWarn` prints (1076); the plan header line (1065, which prints `plan`).

**Copied (repo-create gets a copy; ci-flow keeps its own):** `lib/gh.ts` (verbatim); `run`-based `git()` (61), `show()` cache (72–76), `base()` (77), `shq` (256), `firstN` (136); slug resolution + `--repo` validation (250–254); `repoJson/defaultBranch/protRes/protection/ghError` fetch and `protIsBlocked` (257–279, with the prefetch list reduced to the moved endpoints + `branches/<d>/protection` + `rules/branches/<d>` + `orgs/<o>|user`); `Row/Status/Verdict/pass/fail/na/check()` (38–40, 282–311 without `ADDONS/DECL/declared/addonOf`); the report (1062–1087, one section); the workflow reader subset: `WFS` parse with the `on` normalisation (94–104), `jobsOf/stepsOf/ifOf` (106–109), `USES` (133–134), `CI`/`DEPLOY` selection (138–139). Tests: `FAKE_GH`, `writeGh`, `audit()`, `ownerAudit()`, `mut()`, `GH_BASE`/`REPO`/`ORG`/`PUB_GH`/`FREE_GH`.

**Dropped from the moved code (deliberate, each verified):** `heavy` (778; the "expensive jobs: …" suffix on `plan-minutes` — per-job cost is ci-flow's, design §13; `grep -c 'expensive jobs' tests/audit.test.ts` = **0** (measured 2026-11-09), so no assertion depends on it); `HAS_MANIFEST/HAS_ACTIONS` (not used by moved checks).

**Edits to moved code (the only string/logic changes):**
1. `secret-scanning` n.a. text: `… gitleaks stands in (gitleaks-precommit; ci-flow's cheap-secret-scan when the repo has CI)` — the `configOnly` ternary goes.
2. `branch-baseline`: `if (!configOnly) return na("judged by protection-live")` → `if (CI) return na(\`owned by ci-flow's protect script (${CI.path} runs on pull requests; see ci-flow's protection-live)\`)`.
3. `plan-minutes`: no `heavy` suffix (above).
4. Report header: `repo-create audit: <path> @ <ref> (<slug>)` + the visibility/plan line; one table titled `## Repository configuration`.
5. Prefix file env var: `REPO_CREATE_PREFIXES_FILE`, default path unchanged (`~/.config/ci-flow/private-prefixes` — the owner's data stays where POLICY names it; renaming the file is a separate owner decision).
6. `owner.ts` strings: `repo-create: before creating…`; the "after the first push" line → `bun ~/.claude/skills/repo-create/scripts/audit.ts <clone>`; everything else verbatim.

## Enforced-constraint conflicts, resolved in this plan (imported-decision check)

- **E1** `tests/audit.test.ts:408` asserts `base.rows.size > 55`; ci-flow will have 44 rows → T8 sets it to `> 40` (44 measured by `check()` count) and repo-create's copy asserts `=== 24` (exact, since the set is now small and fixed).
- **E2** `tests/trigger.test.ts:31` asserts `gh repo create|rename|edit` fire ci-flow; design §8 moves them → T8 moves those three cases to "does not fire"; repo-create's suite asserts they fire.
- **E3** `tests/audit.test.ts:834/839/845` pass `--config-only` but assert only Dependabot rows (checks that stay) → T8 drops the flag there (CI rows then FAIL unasserted; exit 0 without `--strict`).
- **E4** `VARIANTS.cfg` (398) and the "--config-only reports configuration only" test (413–418) exist only for moved checks → T8 removes them and adds one shim test (exit 2, message on stderr, zero `gh` calls) for both `--owner` and `--config-only`.
- **E5** `plan free` in the "Free private WITH CI" test (452) comes from the plan header line that moves → T8 keeps that test's `protection-live`/`protection-matches-declared` = blocked and `--strict` exit 0 assertions, drops the four moved-row assertions and the `OPTIONS` text.
- **E6** `protBlocked()`'s message (529) says "see plan-protection", a row ci-flow will no longer print → `see repo-create's plan-protection`.

## Open conflicts (owner decides; the plan does not resolve them)

- **OPEN-1 — the path import of `plans.ts` has no consumer.** Design §8/§13 say ci-flow imports `plans.ts` from the installed repo-create "for `protIsBlocked` and the budget arithmetic" and fails closed without it. Measured: `protIsBlocked` reads `protRes.kind` (gh.ts), not the plan table; the budget arithmetic is `plan-minutes`/`minutesOf`, which moves; after the cut **no line of ci-flow's audit references `capsFor/QUOTA/minutesOf/planOf/randomName`** (only the import at line 36). Options: (a) no import — ci-flow keeps `gh.ts` only, zero runtime coupling (T8 as written); (b) the import as designed — a fail-closed `await import(…)` whose exports nothing uses, one more way ci-flow's audit can refuse to run. Cost of (a): §8/§13 wording changes in the design. Cost of (b): dead coupling.
- **OPEN-2 — which `gh api` writes stay with ci-flow's trigger.** The brief narrows ci-flow to "commit/push/pr and workflow/CI files"; `tests/trigger.test.ts:32` asserts `gh api -X PUT …/branches/main/protection` fires ci-flow, and ci-flow's protect script is the protection writer for CI repos (design §8). Default written into T4/T8: ci-flow keeps `gh api` writes whose path matches `/branches/<b>/protection` or `/rulesets?`, and graphql mutations; repo-create takes `gh repo …` and every other `gh api` write (PATCH repos, environments, transfer, …). Alternative: both triggers fire on every `gh api` write (two reminder lines, 6 fewer regex edits). Proof either way: the two trigger suites' fire / no-fire lists.
- **OPEN-3 — the AGENTS.md mirrors cannot land by PR.** `~/.claude/AGENTS.md` is untracked (and `~/.claude` is a dirty checkout, 183 entries); `~/AGENTS.md` is outside any repo. The pointer edits there are direct edits of files this session does not own. T9 writes the CLAUDE.md change by PR and lists the two mirror edits as an owner step (backup to `~/.claude-backups/` first, `stat` it). If the owner prefers, this session edits both after an explicit go-ahead.
- **OPEN-4 — "no gap" depends on `~/.claude` being pulled.** The hook (T10) and the CLAUDE.md pointer (T9) take effect only when `~/.claude`'s checkout is at the merged commit; this session must not pull that checkout. The owner pulls, or accepts the gap until they do.

## Tasks

Dependency order: T1 → T2 → T3 → T4 → T5 → T6 → T7 (repo-create live and green) → T8 ∥ T9 (ready together, merged together) → T10. T1–T6 commit on repo-create's local `main` (no remote exists yet; this is a new repo this session creates, not another session's checkout). From T7 on, every change to any repo goes through a `~/tmp` worktree and a PR.

### T1 — Skeleton and licence

**Files:** `README.md`, `LICENSE` (byte-identical copy of ci-flow's), `SECURITY.md` (copy), `.gitignore` (`node_modules/`, `.DS_Store`), `skills/repo-create/`, `tests/`, `docs/`.
- [ ] `git init -q` in `/Users/user/SynologyDrive/code/ai/personal_skills/repo-create`; `git -C . config user.email` is the noreply address (`commit-email-noreply` will judge this repo).
- [ ] Copy `LICENSE` and `SECURITY.md`; verify `cmp LICENSE ../ci-flow/LICENSE` exits 0.
- [ ] README: purpose (one paragraph), install (`ln -s "$PWD/skills/repo-create" ~/.claude/skills/repo-create`), file map, audit usage — same shape as ci-flow's README.
- [ ] Commit `chore: skeleton, MIT licence`. Verify: `git log --oneline | wc -l` = 1; `gitleaks git --pre-commit --staged` ran (the global hook) — if the hook is absent, say so, do not proceed silently.

### T2 — `lib/`: gh, plans, owner + `--owner` mode

**Files:** `skills/repo-create/scripts/lib/gh.ts`, `lib/plans.ts`, `lib/owner.ts`, `tests/audit.test.ts` (harness + the `--owner` describe only).
**Interfaces (unchanged from ci-flow):** `run(cmd, args) → {ok,out,err}`; `prefetch(paths): Promise<void>`; `ghGet(path): GhRes` with `GhRes = {ok:true,data} | {ok:false,kind:"blocked"|"missing"|"error",msg}`; `class Blocked`; `type Plan`; `planOf(n): Plan|undefined`; `QUOTA`, `PACKAGES_GB`; `capsFor(plan, pub)`; `minutesOf(owner, isOrg, plan)`; `randomName(): string`; `ownerReport(login): never` (prints, exits 0; exit 2 when `users/<login>` is unreadable).
- [ ] Write `tests/audit.test.ts` with the harness copied from ci-flow (`ENV` stripping `GIT_*`, `FAKE_GH`, `writeGh`, `ownerAudit`) pointing `AUDIT` at `../skills/repo-create/scripts/audit.ts`, and the two `--owner` tests (Team org table + minutes + random private name + read-only calls; Free user inferred from a private repo's protection). Expected strings: `repo-create: before creating a repository under o (organization)`, the table rows, `gh repo create o/<adj>-<noun>-NNN --private`, `create it under the Team org instead`.
- [ ] Run `bun test tests/audit.test.ts` → **FAIL** (audit.ts missing).
- [ ] Copy `gh.ts`, `plans.ts` verbatim; `owner.ts` with edit 6 only. Write `audit.ts` with the argv parser and `if (ownerArg) ownerReport(ownerArg)` only (the rest lands in T3).
- [ ] Run → **2 pass** (measured by the run's summary line). Commit `feat(lib): gh, plans, owner — moved from ci-flow`.

### T3 — The 24 configuration checks

**Files:** `skills/repo-create/scripts/audit.ts`, `tests/audit.test.ts`.
**CLI:** `bun audit.ts <repo-path> [--ref <git-ref>] [--repo <owner/name>] [--strict]` | `bun audit.ts --owner <login>`. Exit 0 (a report); `--strict` → 1 on any FAIL; 2 on usage / unreadable ref / bad `--repo`. Output: header line, `## Repository configuration` table `| check | result | evidence |`, `N pass, N fail, N blocked by plan, N n.a.`, optional bold minutes warning, `## Hardening — suggested, NOT applied; read each before running it`. Slug-only targets (`owner/repo` without a clone) are plan 3's `--audit --all` concern, not this task.
**Fixture:** `BASE` = `.github/workflows/ci.yml` (pull_request trigger, one draft-gated job, `uses:` with one third-party action), `.github/workflows/deploy.yml` (so `needsEnv` is true), nothing else; `GH_BASE` without `completed/success/jobs/alerts`. Variants: `base` (private, Team org, CI), `pub` (public, user on Free, `SECURITY.md`), `noci` (`ci.yml` and `deploy.yml` null — replaces ci-flow's `cfg`).
- [ ] Port the tests first: baseline (reference fixtures fail nothing and every id passes in ≥1 variant, `rows.size === 24`; exit codes; read-only calls; unknown = FAIL via `plan-detected` with no plan and `deploy-keys` with a `keys.err`), the 35 mutation rows (variant `cfg` → `noci`), the coverage test, the moved describes (Free private with/without CI; 80 % minutes line; repo-name suggestion; hardening printed never run; `core.hooksPath` cases; hostile branch/action names; the three `deploy-credential-scope` open-environment tests), plus two new ones: `branch-baseline` = n.a. containing `owned by ci-flow's protect script` in `base`, = pass in `noci`, and the `noci` mutation at `protection.__err 404` = fail. Expected ≈ **55 tests** (estimate; the measured number is the run's summary line and goes into the commit message).
- [ ] Run → **FAIL** (no rows).
- [ ] Implement: the copied plumbing, the workflow reader subset, the moved block with edits 1–5. Keep `check()` exactly (Blocked → `blocked`, any throw → `fail could not determine`).
- [ ] Run → all pass, 0 fail; (`expensive jobs` has 0 references in ci-flow's tests, measured, so dropping `heavy` breaks no ported assertion). Commit `feat(audit): repository configuration checks — moved from ci-flow`.

### T4 — Trigger hook

**Files:** `skills/repo-create/hooks/trigger.sh`, `tests/trigger.test.ts`.
**Interface:** stdin JSON `{tool_name, tool_input:{command|file_path}, session_id, cwd}` → stdout `{hookSpecificOutput:{hookEventName:"PreToolUse", additionalContext}}` or nothing; exit 0 always; markers in `${TMPDIR:-$HOME/.cache}/repo-create-trigger/<safe sid>/<cksum of root>`; message starts `repo-create applies (<what> in <root>): load the repo-create skill and follow ~/.claude/skills/repo-create/POLICY.md. Before gh repo create: bun ~/.claude/skills/repo-create/scripts/audit.ts --owner <login>; after any settings change: audit.ts <root>.`
**Fires (OPEN-2 default):** `gh repo (create|edit|rename|delete|archive|transfer)`; `gh api` with `-X/--method PUT|POST|PATCH|DELETE`, or `-f/-F/--field/--raw-field/--input` outside graphql — **except** paths matching `/branches/[^/ ]+/protection` or `/rulesets?` (ci-flow's). **Silent:** `git commit|push`, `gh pr *`, `gh api` GETs, graphql queries and mutations, any Write/Edit (no file edit is repo-create's).
- [ ] Port `tests/trigger.test.ts` from ci-flow: fires list (6 `gh repo` + 4 `gh api` write cases incl. `POST repos/o/r/transfer`), does-not-fire list (`git commit -m x`, `git push`, `gh pr create --draft`, `gh api -X PUT repos/o/r/branches/main/protection --input -`, `gh api graphql … mutation`, `gh repo view`, `gh api repos/o/r`, Write `.github/workflows/ci.yml`), once-per-session, hostile sid, `/`-vs-`_` roots, relative cwd, symlinked marker dir. Expected ≈ **22 tests** (estimate).
- [ ] Run → **FAIL** (hook missing). Copy ci-flow's `trigger.sh`, change the two regex lines, the exclusion, the marker dir name and the message; drop the Write/Edit case.
- [ ] Run → all pass. Commit `feat(hook): repo-create trigger`.

### T5 — POLICY.md, SKILL.md, README, project docs

**Files:** `skills/repo-create/POLICY.md`, `skills/repo-create/SKILL.md`, `README.md`, `docs/{prd,trd,app-flow,design-brief,backend-schema,implementation-plan}.md` + rendered `.html`.
- [ ] `POLICY.md`: header ("the one source for repository configuration; CLAUDE.md §3c/§3e point here; ci-flow's POLICY keeps CI"); "When this applies" = repo create / edit / rename / delete / archive / transfer / visibility / settings writes; "Run first" = `audit.ts --owner <login>` before `gh repo create`, `audit.ts <repo-path>` before and after a settings change; **§0 Owner decisions** = ci-flow POLICY lines 21–23 verbatim (Free personal account; Team-org move rule; budget read live) — not the add-ons bullet; **§1 Repository configuration** = ci-flow POLICY §2 lines 128–230 verbatim, with "Run `audit.ts`" pointing at this skill's script and "§1 gitleaks covers the gap" → "ci-flow's POLICY §1 (gitleaks in CI) covers the gap"; **§2 Storage** = CLAUDE.md §3e lines 143–145 verbatim (media out of git, untracking deletes elsewhere, blocked-pull procedure). Verify no duplication: `comm -12 <(sort ci-flow/POLICY.md) <(sort repo-create/POLICY.md) | grep -v '^\s*$' | grep -vc '^- \*\*'` is reviewed line by line — after T8 the overlap must be only blank/structural lines.
- [ ] `SKILL.md`: frontmatter `name: repo-create`, description = the repository half of ci-flow's current description (creating a repository, renaming, visibility, repository or organization settings, plan / quota questions, licences, storage); "Before anything else" (audit first and last, `--owner` before create, an unknown is FAIL, in a sandboxed shell `gh` fails TLS → re-run outside); the "Repository configuration" section = ci-flow SKILL lines 125–147 verbatim (plan table, blocked/n.a./FAIL rule, plan detection, the 24 check ids with `branch-baseline (n.a. when ci-flow's protect script owns protection)`, naming lifecycle, minutes); hand-off line: "a repo that gains CI: load ci-flow; protection moves to its protect script".
- [ ] `docs/*.md`: six short documents in the ci-flow pattern (each a pointer to the design spec and to POLICY/SKILL, with `MISSING` for what plan 2/3 will add); `bun ~/.claude/scripts/render-docs.ts . && bun ~/.claude/scripts/render-docs.ts . --check` exits 0.
- [ ] Commit `docs: POLICY §0–§2, SKILL, README, project documents`.

### T6 — Own CI, Dependabot, protect script

**Files:** `.github/workflows/ci.yml` (copy of ci-flow's: range gitleaks pinned + sha256, setup-bun 1.4.4, `bun test tests/`), `.github/required-checks.json` (`["checks"]`), `.github/ci-flow.json` (`{"addons": []}`), `.github/dependabot.yml` (github-actions, grouped, weekly), `scripts/protect-main.sh` (`REPO=kikearciniegas/repo-create`), `tests/ci-workflow.test.ts` (copy; 7 tests measured in ci-flow).
- [ ] Copy, edit the repo slug, run `bun test tests/` → all three files green (count recorded). Commit `ci: cheap job, dependabot, protect script`.
- [ ] `bun ~/.claude/skills/ci-flow/scripts/audit.ts . --ref HEAD --repo kikearciniegas/repo-create` — the CI section is judged from the tree; GitHub rows FAIL until T7 (expected; record the CI-section FAILs, fix any that are tree-side).

### T7 — Create the GitHub repo: the skill's first real use

- [ ] Symlink: `test -e ~/.claude/skills/repo-create && echo EXISTS || ln -s "$PWD/skills/repo-create" ~/.claude/skills/repo-create`; verify `readlink`. (An add under `~/.claude`, like the ci-flow symlink; nothing replaced.)
- [ ] `bun ~/.claude/skills/repo-create/scripts/audit.ts --owner kikearciniegas` outside the sandbox; keep the output in the PR body later (plan, counts, minutes line, the suggested private name). The product name `repo-create` is used because the repo is public from day one (POLICY naming lifecycle) — state this.
- [ ] **Owner confirms** in the session: public, MIT, name `repo-create` (visibility is a one-way door). Then `gh repo create kikearciniegas/repo-create --public --source . --remote origin --push --description "…"`; read back `gh repo view kikearciniegas/repo-create --json visibility,licenseInfo,defaultBranchRef`.
- [ ] CI run on the `main` push green (`gh run list -R kikearciniegas/repo-create -L 1`). Then `scripts/protect-main.sh --dry-run` → owner OK → `--apply` → the script's read-back exits 0.
- [ ] Both audits on the live repo, outside the sandbox: `bun ~/.claude/skills/repo-create/scripts/audit.ts .` and `bun ~/.claude/skills/ci-flow/scripts/audit.ts .`. Expected FAILs on a fresh public repo (plan 1 has no apply step): `merge-hygiene`, `actions-token`, `actions-policy`, `fork-pr-policy`, `secret-scanning`, `private-vuln-reporting`, `log-retention`. The owner runs each printed Hardening command; each is read back by GET; the audit is re-run until the only non-pass rows are ones the owner recorded.
- [ ] Gate for T8/T9: repo-create's suite green locally and in CI; its audit on itself reports 0 FAIL (or recorded decisions). Verify push by sha: `git merge-base --is-ancestor $(git rev-parse HEAD) origin/main`.

### T8 — ci-flow PR: remove the moved parts (lands together with T9)

**Worktree:** `git -C …/ci-flow fetch && git worktree add ~/tmp/ci-flow-split -b split/repo-create origin/main`.
**Files:** `skills/ci-flow/scripts/audit.ts`, `scripts/lib/{plans,owner}.ts` (deleted — OPEN-1 (a)), `POLICY.md`, `SKILL.md`, `hooks/trigger.sh`, `README.md`, `docs/prd.md` (+ html), `tests/{audit,trigger}.test.ts`, `references/lessons.md` — no edit (0 matching lines, measured).
- [ ] Tests first (E1–E6): threshold `> 40`; delete rows 603–637 and lines 24–26, 368–375, 398, 413–418, 460–478, 484–497, 511–541, 711–725; drop `--config-only` at 834/839/845; `REF = {base, pub}`; the "WITH CI" test keeps blocked + exit assertions only; "hardening printed, never run" re-pointed at `dependabot-ecosystems` with `{".github/dependabot.yml": null}` (fix string `add .github/dependabot.yml: github-actions (grouped, weekly) plus …`); new test: `--owner x` and `--config-only` → exit 2, stderr contains `moved: use bun ~/.claude/skills/repo-create/scripts/audit.ts`, `calls.log` empty. `trigger.test.ts`: move `gh repo create|rename|edit`, `gh api --method PATCH repos/o/r -F …`, `gh api … deployment-branch-policies -f …`, `gh api -X POST …/transfer` to "does not fire"; keep the protection PUT and the graphql mutation in "fires" (OPEN-2 default).
- [ ] Run `bun test tests/` → **FAIL** (moved rows still present; shim missing).
- [ ] Cut `audit.ts`: lines 736–1034, 744–751 inside them, import 36, line 63 and the flags at 47/53 → shims (`console.error("moved: use bun ~/.claude/skills/repo-create/scripts/audit.ts …"); process.exit(2)`), `check()` skip at 303, `heavy` 778, `minutesWarn` 770/814/1076, header 1065, prefetch list 266–274 reduced to protection + dismissed alerts + runs; `protBlocked` message (E6); docstring 15–20 and usage 43; second table title → `Dependabot`. Delete `lib/plans.ts`, `lib/owner.ts`. `trigger.sh`: `gh_re` loses `repo (…)`; the api regexes keep only protection/rulesets paths and graphql mutations; message loses "Before gh repo create: audit.ts --owner".
- [ ] `POLICY.md`: lines 8–17 narrowed (repo create/rename/transfer/visibility/settings removed from "When this applies"; "Run first" keeps the audit line without `--config-only`, loses the `--owner` line); §0 lines 21–23 → one line "Owner decisions on plan, account and budget: repo-create's POLICY §0"; §2 (127–230) → one pointer line. `SKILL.md`: description trimmed, lines 26–30 (`--config-only`, `--owner`) → pointer, 125–147 → pointer. README usage + file map. `docs/prd.md` "configuration hardened" → re-render, `--check` 0.
- [ ] Run `bun test tests/` → green; expected ≈ **106 audit + 48 trigger + 7 ci-workflow** (estimate; record the real line). `bun skills/ci-flow/scripts/audit.ts . --ref HEAD` on the worktree: 44 rows, CI section unchanged from main's.
- [ ] Commit per step (tests, audit cut, policy/skill/docs, trigger). Draft PR; body carries the measured counts, the audit before/after, and OPEN-1/OPEN-2 as decided. CI green → ready → **owner merges together with T9** → read back sha on `origin/main`. Remove the worktree and branch.

### T9 — claude-config PR: CLAUDE.md pointers (lands together with T8)

**Worktree:** `git -C ~/.claude fetch && git worktree add ~/tmp/claude-config-repo-create-pointers -b repo-create/pointers origin/main`.
- [ ] `CLAUDE.md` §3c (134–140): line 137 drops "repo create / rename / transfer / visibility / settings,"; new bullet "Repository creation, settings, plans and storage: `~/.claude/skills/repo-create/POLICY.md`; load `repo-create` before `gh repo create|edit|rename|delete|archive|transfer` and any settings-writing `gh api`"; line 138 → `bun ~/.claude/skills/repo-create/scripts/audit.ts --owner <login>`; line 139 `(--config-only without CI)` → "(a repo with no CI: repo-create's `audit.ts <repo-path>`)". §3e: lines 143–145 → one pointer line to repo-create POLICY §2 Storage; heading and DNS/DMARC lines 146–147 stay.
- [ ] Verify: `grep -c 'ci-flow/scripts/audit.ts --owner' CLAUDE.md` = 0; `grep -c 'repo-create' CLAUDE.md` ≥ 3; `grep -c 'Verify a DNS change' CLAUDE.md` = 1.
- [ ] Draft PR, CI (whatever claude-config runs) green, ready, **owner merges with T8**, read back. Remove worktree.
- [ ] Mirrors (OPEN-3): the same edits in `~/.claude/AGENTS.md` and `~/AGENTS.md`, keeping their Codex wording; backup each to `~/.claude-backups/AGENTS.md-<which>-2026-11-09` and `stat` it first. Owner step unless they tell this session to do it. Verify after: the §3c–3e diff against CLAUDE.md stays at the 4 known Codex lines.

### T10 — claude-config PR: register repo-create's trigger (owner-approved item, design §12)

**Worktree:** `git -C ~/.claude fetch && git worktree add ~/tmp/claude-config-repo-create-hook -b repo-create/hook origin/main` (after T8 and T9 merged).
- [ ] Backup: `cp ~/.claude/settings.json ~/.claude-backups/settings.json-2026-11-09 && stat ~/.claude-backups/settings.json-2026-11-09`.
- [ ] In the worktree, add beside the ci-flow entry (shape measured above): `{"matcher":"Bash|Write|Edit|MultiEdit","hooks":[{"type":"command","command":"bash \"$HOME/.claude/skills/repo-create/hooks/trigger.sh\"","timeout":5}]}`. Verify `jq -e '.hooks.PreToolUse | map(select(.hooks[0].command|test("repo-create"))) | length == 1' settings.json` and that the ci-flow entry is unchanged (`jq -c` diff against `origin/main`).
- [ ] Negative/positive controls through the real scripts: a payload `{"tool_name":"Bash","tool_input":{"command":"gh repo create o/x --public"},"session_id":"t1","cwd":"<a repo>"}` → repo-create's hook prints `repo-create applies`, ci-flow's (merged main) prints nothing; `git commit -m x` → ci-flow prints `ci-flow applies`, repo-create prints nothing. Both exit 0.
- [ ] Draft PR → ready → **owner merges**; then the owner pulls `~/.claude` (OPEN-4) and the next session gets the reminder. Read back: `git -C ~/.claude log -1 --format=%H` equals the merged sha only after that pull — report it as *not checked* until then.

## Risks

- `~/.claude` is live config and a dirty checkout: every edit there goes through a worktree and the owner's pull; the symlink in T7 is the one direct add (same as ci-flow's install).
- Between T7 and T8's merge both audits report the 24 checks (duplicate, harmless); between T8's merge and the owner's `~/.claude` pull the pointer and hook are not live (OPEN-4).
- The repo-create repo's `commit-email-noreply` row judges this session's commits: set the noreply email before the first commit.
- T7 makes a public repo: history starts at T1, so the gitleaks pre-commit hook must have run on every commit (T1 check).

## Unverified

- Post-move test counts (estimates: repo-create ≈ 55 + 22 + 7; ci-flow ≈ 106 + 48 + 7). The gate is "0 fail + every id has a mutation", not the count.
- Whether claude-config runs CI on PRs (check `gh run list -R kikearciniegas/claude-config -L 3` at T9).
- `render-docs.ts` behaviour on a repo whose docs are pointers only (run at T5).

## Open conflicts — resolved by the parent (2026-11-09)

- **OPEN-1 → (a):** the design's path import was a designer's call made before measuring; with no consumer it would be dead code. ci-flow deletes `plans.ts`/`owner.ts` and imports nothing from repo-create. Design §13 call 2 is superseded by this measurement.
- **OPEN-2 → default:** ci-flow's trigger keeps `/branches/*/protection`, `/rulesets` and graphql mutations; repo-create's fires on the rest. Both are reminders, so a protection write firing ci-flow on a no-CI repo costs one line, nothing more.
- **OPEN-3 → direct edit with backup:** both AGENTS.md mirrors get the same pointer edit as CLAUDE.md, each backed up to `~/.claude-backups/repo-create-pointers-<date>/` and compared with `cmp` before and after. Owner approved the pointer edits in the design (§10 step 5).
- **OPEN-4 → pull when clean:** after T9/T10 merge, fast-forward `~/.claude` only when no incoming file collides with a local change (same check used 2026-11-09); otherwise report the gap and stop.
