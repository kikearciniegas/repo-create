# repo-create — plan 2 of 3: apply, interview, proposal

Date: 2026-11-10. Status: DRAFT for the builder. Spec: `docs/superpowers/specs/2026-11-09-repo-create-design.md` (§2 anti-goals, §4, §5, §6, §8 single writer, §9, §12, §13). Plan 1 (format, conventions, measured baseline): `docs/superpowers/plans/2026-11-09-repo-create-split.md`. Code measured at `main` **88df8cf**.

> [!WARNING]
> **Codex did NOT challenge this plan.** `codex exec -s read-only` exited 1 on 2026-11-10: "You've hit your usage limit … try again at Nov 12th, 2026 8:52 AM" (same limit plan 1 hit). The Acordado / En disputa blocks at the end are the author's own refutation only. Re-run the one-call `codex exec` from the planner brief before the builder starts T0, or the owner accepts the plan as self-reviewed.

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (with `subagent-driven-development-extras`) or `superpowers:executing-plans`. Steps use `- [ ]`. Report any figure you measure that disagrees with this plan instead of adjusting code to match it.

**Goal.** `/repo-create` and `/repo-create --audit <path>` go from read-only report to: interview → scan → proposal table → owner approval → apply (approved rows only) → GET read-back table → one-line skip summary → hand-off to ci-flow. Plus starter files and local clone setup for a new repo. **Out of scope (plan 3):** `--audit --all`, `--cleanup`, `--secrets`, `--launch` (visibility flip, rename to product name, history gitleaks before the flip), `--transfer`, `--archive`.

**Architecture.** The audit stays the single judge. It gains structured fixes (`Row.apply`, the `gh api` call behind each printed command) and a `--json` output; nothing else in its 24 checks changes. A new `scripts/apply.ts` has two modes: `--propose` renders the 7-column proposal from `audit.ts --json`; `--rows <ids>` runs the approved rows' calls as `gh` argv (never through a shell), then re-runs `audit.ts --json` and reports each approved row verified only if its status is now `pass` — the audit's own GETs are the read-back. Three small read-only-or-additive scripts: `scan.ts` (stack detection of a working tree), `starter.ts` (writes only files that do not exist), `local-setup.ts` (adds a gitleaks line to the clone's pre-commit hook, never replaces it; repo-local noreply email). The interview, the one-way-door confirmations, `gh repo create`, the claude-security offer and the Synology/worktree steps are SKILL.md prose the agent follows with `AskUserQuestion`.

**Tech stack.** bun 1.4.4, TypeScript, `gh` CLI, bash hooks; `bun:test` with the existing fake `gh` on PATH (extended to record writes). `bun ~/.claude/scripts/render-docs.ts` for the six docs (exists, measured `ls`).

## Global constraints (spec §9 + CLAUDE.md; every task inherits them)

- Nothing is written to GitHub before the owner approves; only approved rows run; a one-way door (visibility, delete, transfer, recreate) gets its own confirmation and **none of them is reachable from `apply.ts`** (guard in T2).
- Every write is verified by a GET read-back, never by an exit code. "Verified" = the audit row reads `pass` after the write.
- **Never `--admin`** past protection. Branch protection: `apply.ts` writes the baseline only when the audit judged `branch-baseline` itself (no PR-triggered workflow); with CI the row is n.a. "owned by ci-flow's protect script" and apply refuses it (spec §8).
- Never overwrite a local file: hooks, configs, README, LICENSE, docs are created when absent or appended to; an existing file is left byte-identical unless the task says "append".
- Secrets: names only; values live in 1Password (`op://`); no script prints a value or an env-file line past the `=`.
- Unknown = FAIL (audit) and unknown = not verified (apply); exit 1 on any unverified approved row.
- Read-only by default; `scan.ts` and `--propose` write nothing; the test suite asserts it.
- Verify every push by sha: `git merge-base --is-ancestor $(git rev-parse HEAD) origin/main`.
- Headers `// SPDX-License-Identifier: MIT` + `// Copyright (c) 2026 Rafael Arciniegas` in every new `.ts`/`.sh`; none in `.md`, JSON, templates that are copied into other repos verbatim (the LICENSE template, docs stubs).
- Work in a `~/tmp/repo-create-apply` worktree off `origin/main`; one PR per task group (T1–T3 apply; T4–T6 new-repo scripts; T7 prose/docs), draft → `bun test tests/` green → CI green → **owner merges**. Folder-prefix labels never appear in any file.
- Surgical: `audit.ts` fix strings stay byte-identical except where a task lists the change; tests that assert them (`tests/audit.test.ts:377, 379, 383, 393, 395`, measured) stay as they are.

## Measured figures (repo-create @ 88df8cf, 2026-11-10; command beside each)

| Figure | Value | Command |
|---|---|---|
| Suite | **159 pass, 0 fail**, 4 files, 12.1 s | `bun test tests/` (output in the scratchpad `bun-test-88df8cf.txt`) |
| Checks | **24** `check("…")` calls; ids: plan-detected plan-protection plan-environments plan-minutes repo-name merge-hygiene dependabot-alerts dependabot-security-updates actions-token actions-policy fork-pr-policy secret-scanning private-vuln-reporting security-policy branch-baseline deploy-keys webhooks collaborators deploy-credential-scope log-retention commit-email-noreply gitleaks-precommit org-baseline account-2fa | `grep -c '^check("'`, `grep -o '^check("[a-z0-9-]*"'` |
| CLI flags | `--ref`, `--repo`, `--strict`, `--owner`, `-h/--help`; **no `--json`, no `--config-only`, no `--audit`** (0 occurrences each) | `audit.ts:22–34`; `grep -c -- --json` = 0 |
| Fix sites with `gh api -X` | **17 lines**: 225 231 236 243 261 262 269 276 284 290 305 320 330 339 358 365 406 | `grep -n 'gh api -X' audit.ts` |
| …of which carry a `<placeholder>` (by hand) | **4**: 320 deploy-keys, 330 webhooks, 339 collaborators, 358 deploy-credential-scope | `grep -n 'gh api -X[^\`]*<[a-z]'` |
| Rows apply can run (structured in T1) | **11**: merge-hygiene (225), dependabot-alerts (231), dependabot-security-updates (236), actions-token (243), actions-policy (261–262, two calls), fork-pr-policy (269 public / 276 private), secret-scanning (284), private-vuln-reporting (290), branch-baseline (305), log-retention (365), org-baseline (406) | the 17 lines minus the 4, grouped by row |
| Rows with prose/URL/local fixes | **9**: plan-detected, plan-protection, plan-environments, plan-minutes, repo-name, security-policy, commit-email-noreply, gitleaks-precommit, account-2fa; 11 + 4 + 9 = 24 | by reading each `fail(`/`na(` |
| Fake `gh` refuses writes | `[ "$1" = api ] && [ $# -eq 2 ] \|\| exit 9` | `tests/audit.test.ts:97` |
| Read-only assertions | lines 204, 229, 280, 384 match `^api [^ ]+$` | `grep -n '\^api'` |
| Code anchors in `audit.ts` | `Row` 16, argv 22–34, `fail` 111, `check` 114, `shq` 79, report 419–436, `na` text for CI at 299 | file read |
| "ci-flow's protect script" | a **per-repo** `scripts/protect-main.sh` (this repo: 90 lines, PUT + normalised read-back); ci-flow's skill dir holds `audit.ts` and `lib` only; pattern described at `~/.claude/skills/ci-flow/SKILL.md:85` | `ls ~/.claude/skills/ci-flow/scripts` |
| GitHub template endpoints | `gh api gitignore/templates/Node` → `Node`; `gh api licenses/mit` body 1,069 chars (live, read-only, 2026-11-10) | the two commands |
| Header shape in this repo | lines 1–2 of every `.ts`/`.sh`: SPDX + Copyright; LICENSE line 3 = `Copyright (c) 2026 Rafael Arciniegas` | `sed -n 3p LICENSE` |
| `SKILL.md` | 37 lines, **0** mentions of `AskUserQuestion` | `grep -c` |
| Not re-measured today | `gh auth status` scopes (plan 1: `repo user admin:org delete_repo workflow gist`); the claude-security scan's cost (spec says "minutes to hours, tokens" — no measurement exists) | — |

## Decisions the builder cannot make alone (made here; each checkable)

- **D1 structured fixes, one source.** `audit.ts` gets `type Call = { method: "PUT" | "PATCH" | "POST"; path: string; fields?: Record<string, string | boolean | number>; input?: unknown }` and `const W = (method, path, fields?, input?): Fix` with `Fix = { cmd: string; calls: Call[] }`; `fail(ev, fix: string | Fix)`; `Row` gains `apply?: Call[]`. `cmd` renders `gh api -X <M> <path>` + ` -F k=v` for boolean/number values, ` -f k=v` for strings, ` --input - <<<'<json>'` for `input`; a `k=v` token is wrapped in single quotes only when it contains a character outside `[A-Za-z0-9_.\/=@*:,-]` (so `-f allowed_actions=selected` stays bare and `-f 'patterns_allowed[]=x@*'` stays quoted, as today). Two fixes concatenate with ` && `; a prose prefix/suffix (actions-policy's org warning, org-baseline's `# if Team refuses…`, branch-baseline's `# a PUT replaces the whole rule`) is kept around `cmd`. **Byte-identity is required where a test asserts the string** (`tests/audit.test.ts:383` log-retention; 304/309/377/379/393/395 are untouched rows); other runnable rows may change only in `-f` quoting, and the task diffs the full Hardening section before/after to show exactly that. The 11 sites above call `W`; the other 13 fixes stay strings.
- **D2 `--json`.** `audit.ts <path> … --json` prints one object `{ slug, visibility, plan, isOrg, defaultBranch, ci: CI?.path ?? null, rows: Row[] }` instead of the report; exit codes unchanged.
- **D3 apply never parses shell and never spawns one.** It builds `["api", "-X", m, path, ...("-F"|"-f" k=v)…, ...(input ? ["--input", "-"] : [])]` from `Call` and runs `gh` with `spawnSync(..., { input: JSON.stringify(input) })`. The hostile-name test at `tests/audit.test.ts:400–412` keeps protecting the printed string; argv protects the executed one.
- **D4 read-back = the audit again.** After all approved writes, apply spawns `audit.ts --json` a second time and compares each approved row before/after. This IS a GET per setting (the audit GETs every endpoint it judges) and reuses the judgement rather than a second normaliser per endpoint. A row still `fail`/`blocked`/unknown after the write → `FAILED`, exit 1, no retry.
- **D5 apply's refusal list (exit 2, zero writes):** an id not in the before-run; a row with no `apply` (by hand / prose / n.a. / pass); a `Call` that is a one-way door (`method === "DELETE"`, path ending `/transfer`, any top-level field or input key in `private, visibility, name, archived`); a path not under `repos/<slug>` (org-wide: `orgs/<o>` — OPEN-4). None of the 11 runnable fixes trips the guard today (measured: paths are all `repos/${slug}/…` or `repos/${slug}` except org-baseline `orgs/${owner}` and actions-policy's org variant `orgs/${owner}/…`).
- **D6 who renders the proposal.** `apply.ts --propose` (code), from `--json`; the agent shows it verbatim. Columns: setting · current (`status: ev`) · recommended (`pass` → `keep` or the suggestion when `fix` exists; runnable → `cmd`; by hand → `by hand: <fix>`; `blocked` → `owner decision: <fix>`; `n.a.` → `—`) · why / cost-impact (`IMPACT[id]`, a 24-entry map in `lib/proposal.ts`, parity-tested) · available on this plan (`blocked` → `no (plan)`, `n.a.` → `n.a.`, else `yes`) · one-way door (`no` for all 24 rows; visibility is decided in the interview and flips are plan 3 — the column exists so plan 3 adds `yes` rows without changing the table).
- **D7 prose vs code.** Prose (SKILL.md + `AskUserQuestion`): the interview, plan confirmation, visibility confirmation (one-way), `gh repo create` + its `gh repo view --json` read-back, the claude-security offer with its cost sentence, the history gitleaks gate before pushing existing history (C2), approval of the proposal, the Synology Drive exclusions and the worktree pointer, the "prove the hook with one blocked fake-secret commit" step. Code: `audit.ts --json`, `apply.ts`, `scan.ts`, `starter.ts`, `local-setup.ts`.
- **D8 the fake `gh` learns writes but stays local.** `tests/fixture.ts` (extracted from `tests/audit.test.ts`, no behaviour change: `FAKE_GH`, `GH_BASE`, `REPO`, `ORG`, `PUB_GH`, `FREE_GH`, `writeGh`, `audit()`, `ownerAudit()`) gets one write branch: `api -X <M> <path> …` logs `WRITE <M> <path> <rest>` + stdin to `$GH_DIR/writes.log` and, **only if** `$GH_DIR/<key>.after.json` exists, copies it over `<key>.json` (the server state changes only when the test says so). A write with no `.after.json` is the negative control for "exit code is not verification".

## Review focus (each pinned to a test)

1. A write that returns 0 but changes nothing must read as FAILED → T2 test "exit code is not verification".
2. `branch-baseline` must never be written on a repo with a PR-triggered workflow → T2 test "single writer".
3. An approved row runs; an unapproved failing row does not; an unknown id writes nothing → T2 tests 3–4.
4. `starter.ts` and `local-setup.ts` never truncate an existing file → T5/T6 byte-identical controls.
5. `scan.ts` never prints an env value → T4 test "names only".

## Spec / code / brief conflicts found (owner decides; the plan does not resolve them)

- **C1 licence levels vs POLICY.** Spec §4 offers four levels (none · LICENSE only · LICENSE + manifest · LICENSE + manifest + headers). POLICY.md "Licensing" (lines 75–80) says an MIT LICENSE → an SPDX header in **every** source file, and an "All rights reserved" LICENSE → a copyright header in every source file. The two middle levels create a repo POLICY calls non-compliant. No test enforces the header rule (prose only). → OPEN-8.
- **C2 history gitleaks on the existing-code path.** The brief defers the full-history scan to `--launch` (plan 3); spec §5 also requires it "before pushing existing history to a new remote", which is plan 2's new-repo-with-existing-code path. The plan keeps a one-line prose gate there (cost: one `gitleaks git` run, minutes) and defers only the pre-flip scan. → OPEN-9.
- **C3 "ci-flow's protect script" is per repo**, not a skill script (measured). The n.a. text at `audit.ts:299` is fine; SKILL prose must say "the repository's own protect script, per ci-flow's `[protect-script]`", never a path under `~/.claude/skills/ci-flow/`.
- **C4 per-row approval vs the question tool.** `AskUserQuestion` holds 2–4 options per question (CLAUDE.md §2); up to 11 runnable rows do not fit one multi-select. → OPEN-1 shapes the question.
- **C5 the one-way column is constant in plan 2** (D6). The spec's table keeps it; no row of the 24 is a one-way door.

## OPEN owner decisions (needed before T3 and T7; the builder stops at the first one that blocks a task)

- **OPEN-1 approval shape.** (a) one question: `Apply all N applicable rows (Recommended)` / `Choose rows` (free text: ids) / `Apply none`; (b) per-row questions, four rows at a time; (c) always all. Cost of (a): a typed id list; of (b): up to three questions per repo.
- **OPEN-2 where the private product name is recorded** when a random development name is used (spec §4.3, §13 "where the owner chooses at runtime"): a 1Password note (consistent with the secrets rule), a local file outside any repo (e.g. `~/.config/repo-create/names`, like the prefixes file), claude-mem, or asked every time. The plan writes nothing until decided; T7's prose asks at runtime with these options.
- **OPEN-3 edited rows.** (a) the agent runs the edited `gh api` by hand after approval and re-runs the audit for the read-back (no code; Recommended for plan 2); (b) `apply.ts --set <id>:<key>=<value>` overriding one field.
- **OPEN-4 org-wide writes.** `org-baseline` (PATCH `orgs/<o>`) and `actions-policy`'s org variant (PUT `orgs/<o>/actions/permissions…`, affects every repo in the org) — refused by apply and shown as `by hand (org-wide)` (plan default), or allowed behind their own confirmation.
- **OPEN-5 `repo-name`'s rename fix** (`gh repo rename` + `git remote set-url` in every clone): stays a printed fix in plan 2 (default; the launch rename is plan 3), or runs in apply with its own confirmation.
- **OPEN-6 large-file threshold** for `scan.ts` (POLICY §2 names no number). Default in code: 5 MB, printed in the scan header as the threshold used; `--large-mb <n>` overrides.
- **OPEN-7 commit email**: `local-setup.ts` sets repo-local `user.email` only (default; the audit's printed fix says `--global`, which touches every repo of the user), or `--global` when the global value is not a noreply address.
- **OPEN-8** = C1. **OPEN-9** = C2.
- **OPEN-10 rehearsal repo (T8):** delete it afterwards (one-way door, `delete_repo` scope, own confirmation) or archive it.

## File structure

- Modify `skills/repo-create/scripts/audit.ts`: `Row`/`Call`/`Fix` types (16), `W` beside `shq` (79), `fail` (111), the 11 fix sites, argv (22–34: `--json`), report (419–436: json branch).
- Create `skills/repo-create/scripts/lib/apply.ts` — pure functions, no I/O: `oneWay(c: Call): string`, `select(rows: Row[], ids: string[], slug: string, ci: string | null): { run: { id: string; calls: Call[] }[]; refused: { id: string; why: string }[] }`, `readback(before: Row[], after: Row[], ids: string[]): { id: string; before: Status; after: Status; ok: boolean }[]`, `argv(c: Call): string[]`.
- Create `skills/repo-create/scripts/apply.ts` — CLI: `apply.ts <repo-path> [--ref <r>] [--repo <slug>] (--propose | --rows <id,id,…>)`; spawns `bun audit.ts … --json`; exit 0 verified / 1 any FAILED / 2 usage, refusal, audit unreadable.
- Create `skills/repo-create/scripts/lib/proposal.ts` — `IMPACT: Record<string, string>` (24 entries: the POLICY §1 bullet the row enforces, then `cost: none` or the minutes/storage/US$ figure, then the risk) and `renderProposal(j: AuditJson): string`.
- Create `skills/repo-create/scripts/scan.ts`, `scripts/starter.ts`, `scripts/local-setup.ts`; `skills/repo-create/templates/{README.md,SECURITY.md,LICENSE-MIT,LICENSE-ARR,CODEOWNERS,pull_request_template.md,docs/*.md}`.
- Tests: `tests/fixture.ts` (extracted), `tests/audit.test.ts` (imports it; + 2 tests), `tests/apply.test.ts`, `tests/proposal.test.ts`, `tests/scan.test.ts`, `tests/starter.test.ts`, `tests/local-setup.test.ts`.
- Prose: `skills/repo-create/SKILL.md`, `POLICY.md` ("Run first" only), `README.md`, `docs/app-flow.md`, `docs/implementation-plan.md` (+ rendered `.html`).

## Tasks

Order: T0 → T1 → T2 → T3 (PR A) → T4 ∥ T5 ∥ T6 (PR B) → T7 (PR C, needs OPEN-1/2/8/9) → T8 rehearsal.

### T0 — Extract the test fixture (no behaviour change)

**Files:** create `tests/fixture.ts`; modify `tests/audit.test.ts:17–191` (move `AUDIT ROOT ENV SHA CI DEP BASE REPO ORG GH_BASE FAKE_GH writeGh audit ownerAudit FREE_GH PUB_GH` out; keep `afterAll` in the test file).
- [ ] Move. `fixture.ts` exports the constants and `harness(root: string): { audit, ownerAudit }` — each test file keeps its own `ROOT = mkdtempSync(…)` and its own `afterAll(rmSync)`, so two test files importing the fixture never delete each other's temp dir (bun runs the files in one process). `tests/audit.test.ts` becomes `const { audit, ownerAudit } = harness(ROOT)`; call sites unchanged.
- [ ] Run `bun test tests/` → **159 pass** — the count, not the colour (a moved describe that stops running still passes). Commit `test: extract the fake-gh fixture`.

### T1 — Structured fixes and `--json` in `audit.ts`

**Files:** `skills/repo-create/scripts/audit.ts`, `tests/audit.test.ts`.
**Produces:** `Call`, `Fix`, `Row.apply`, `W(method, path, fields?, input?): Fix`, the `--json` object of D2.
- [ ] Tests first (append to `describe("baseline")`): (1) `--json` on `base`: `JSON.parse(out).rows.length === 24`, `slug === "o/r"`, `ci === ".github/workflows/ci.yml"`, and `calls` still all `^api [^ ]+$`; (2) for every `MUTATIONS` row run `--json` and collect ids whose failing row has `apply`: the set equals exactly `{merge-hygiene, dependabot-alerts, dependabot-security-updates, actions-token, actions-policy, fork-pr-policy, secret-scanning, private-vuln-reporting, branch-baseline, log-retention, org-baseline}` (11) and `deploy-keys`, `webhooks`, `collaborators`, `deploy-credential-scope` have `fix` but **no** `apply`; (3) for `retention: { days: 90 }`, the table run's Hardening line `- log-retention: <cmd>` equals `--json`'s `rows[].fix` for that id, and `apply[0]` deep-equals `{ method: "PUT", path: "repos/o/r/actions/permissions/artifact-and-log-retention", fields: { days: 14 } }`; (4) `noci` + `protection: {__err: "gh: Branch not protected (HTTP 404)"}`: `branch-baseline.apply[0].input.enforce_admins === true` and `required_status_checks === null`; `base` (CI): the row has no `apply` and `ev` contains `owned by ci-flow's protect script`.
- [ ] Run → **FAIL** (`--json` is usage(2)).
- [ ] Implement D1 + D2. Keep every printed string byte-identical (the existing assertions at 304, 309, 377, 379, 383, 393, 395 are the controls; also diff the full Hardening section of `base` with `retention: 90` + `vuln` 404 before/after the change and attach it to the commit).
- [ ] Run `bun test tests/audit.test.ts` → all pass; record the count (expected 159 + 4; the measured line goes in the commit). Commit `feat(audit): structured fixes and --json`.

### T2 — `apply.ts`: approved rows, argv writes, read-back by re-audit

**Files:** `skills/repo-create/scripts/lib/apply.ts`, `scripts/apply.ts`, `tests/fixture.ts` (write branch, D8), `tests/apply.test.ts`.
**Consumes:** T1's `--json`. **Produces:** the CLI above; output = `## Read-back` table `| row | before | after | verdict |` (verdict `read back: pass` or `FAILED: still <status> — <ev>`), then one line `skipped: <id> (<why>)[, …]` (why ∈ `not approved`, `by hand`, `n.a.`, `already pass`, `org-wide`, `one-way door`).
- [ ] Fixture: add the write branch to `FAKE_GH` exactly as D8; `writeGh` also writes `<key>.after.json` for entries given as `{ __after: value }`; the GET branch is unchanged (existing read-only assertions must keep passing: they match `calls.log`, writes go to `writes.log` too — assert both).
- [ ] Unit tests on `lib/apply.ts` (import directly): `oneWay` is non-empty for `{method:"DELETE"}`, path `repos/o/r/transfer`, `fields.private`, `input.visibility`, and empty for every `apply` the 11 rows emit (take them from a `--json` run over the mutations); `select` refuses an unknown id, a row without `apply`, `branch-baseline` when `ci !== null`, a path not under `repos/o/r`; `argv` of the log-retention call is `["api","-X","PUT","repos/o/r/actions/permissions/artifact-and-log-retention","-F","days=14"]` and of a string field is `-f k=v` with the raw value (no quoting — it is argv).
- [ ] End-to-end tests (spawn `apply.ts` like `audit()` does): (1) `retention: {days: 90, __after: {days: 14}}`, `--rows log-retention` → status 0, `writes.log` has exactly one `WRITE PUT repos/o/r/actions/permissions/artifact-and-log-retention -F days=14`, stdout has `| log-retention | fail | pass | read back: pass |`, and in `calls.log` a GET of that path appears **after** the write (count GETs of it: ≥ 2 runs); (2) **exit code is not verification:** same without `__after` → status 1, one write, `FAILED: still fail`; (3) `retention` 90 and `vuln` 404, `--rows log-retention` → no `vulnerability-alerts` write, skip line names `dependabot-alerts (not approved)`; (4) `--rows nope` → status 2, `writes.log` empty; (5) `--rows deploy-keys` with a writable key → status 2, empty `writes.log`, message `by hand`; (6) `noci` + `Branch not protected` + `protection: { __after: GH_BASE.protection }`, `--rows branch-baseline` → status 0, the write line carries `--input -` and the body has `"enforce_admins":true`; (7) **single writer:** `base` (CI present), `--rows branch-baseline` → status 2, empty `writes.log`; (8) `--propose` and `--rows` with everything passing → `writes.log` empty.
- [ ] Run → **FAIL** (script missing). Implement: `lib/apply.ts` pure; `apply.ts` spawns `bun <audit.ts> <path> --ref <r> --repo <slug> --json` (same `--ref`/`--repo` it was given; audit exit 0 = readable, 2 = unreadable → apply exits 2 with the audit's stderr; `--strict` is never passed), runs `select`, executes `argv(c)` per call with `run("gh", …)`/`spawnSync` and the input on stdin, re-spawns the audit, prints `readback` + the skip line, exits per D4.
- [ ] Run `bun test tests/apply.test.ts` and `bun test tests/` → green; record counts. Commit `feat(apply): approved rows, argv writes, read-back by re-audit`.

### T3 — The proposal table

**Files:** `skills/repo-create/scripts/lib/proposal.ts`, `scripts/apply.ts` (`--propose`), `tests/proposal.test.ts`.
- [ ] Tests: (1) parity: `Object.keys(IMPACT)` sorted equals the 24 ids read from a `--json` run (both directions); (2) `renderProposal` on `base` with `retention: 90`, `vuln` 404 and `FREE_GH`-style blocked rows: header has the 7 columns in spec §6 order; the `log-retention` row's recommended cell is the `cmd`; `plan-protection` shows `owner decision:` and `no (plan)`; a passing row shows `keep`; `deploy-keys` with a writable key shows `by hand:`; every row's one-way cell is `no`; (3) `apply.ts --propose` writes nothing (`writes.log` empty) and exits 0; (4) negative: a cell containing `|` or a newline is escaped like `audit.ts:420`'s `cell`.
- [ ] Run → FAIL. Implement D6; `IMPACT` entries are one sentence each: `<POLICY §1 bullet>; cost: <none | figure>; risk: <what the owner loses>` (example: `"log-retention": "POLICY §1 Always on: retention ≤ 30 days; cost: none (storage falls); risk: screenshots, traces and unredacted output readable for 90 days"`).
- [ ] Run → green. Commit `feat(proposal): 7-column table from the audit`. Open PR A (T0–T3) as draft; CI green → ready → **owner merges**; read back by sha; remove the worktree.

### T4 — `scan.ts`: read-only stack detection of a working tree

**Files:** `skills/repo-create/scripts/scan.ts`, `tests/scan.test.ts`.
**CLI:** `scan.ts <path> [--large-mb <n>] [--json]`. Walks the working tree (a new project may not be a git repo), skipping `.git node_modules .venv target dist build`. Output (JSON or a short table): `manifests` (`package.json`→`npm`, `pyproject.toml|requirements.txt`→`pip`, `Cargo.toml`→`cargo`, `go.mod`→`gomod`, `.github/workflows/*.yml`→`github-actions`), `lockfiles`, `deployConfig` (`vercel.json wrangler.toml fly.toml netlify.toml`), `large` (`{path, mb}` above the threshold, OPEN-6), `envFiles` (paths of `.env*`) and `secretNames` (`KEY` names from `KEY=` lines in them — **names only**), `licence` (`LICENSE*` file and whether line 1 says `MIT`), `headers` (source files per POLICY's definition; how many carry `SPDX-License-Identifier` or `Copyright (c)` in the first 3 lines), `suggest: { dependabot: string[], needsEnvironments: boolean, lfs: boolean, gitignore: "Node"|"Python"|"Rust"|"Go"|null }`.
- [ ] Tests on fixture dirs: `package.json` + `bun.lock` → `npm`, gitignore `Node`; `vercel.json` → `needsEnvironments`; a 6 MB file → in `large` at 5 MB and not at `--large-mb 10`; `.env` with `TOKEN=abc123xyz` → output contains `TOKEN` and **not** `abc123xyz`; a `.ts` with and without a header → `headers.withHeader` counts 1 of 2; `node_modules/x/package.json` ignored; empty dir → every list empty, exit 0; the fixture dir is unchanged after the run (mtime/listing).
- [ ] Run → FAIL; implement; run → green. Commit `feat(scan): stack detection, read-only`.

### T5 — `starter.ts`: starter files, written only when absent

**Files:** `skills/repo-create/scripts/starter.ts`, `templates/*`, `tests/starter.test.ts`.
**CLI:** `starter.ts <path> --slug <owner/name> --license mit|all-rights-reserved|none --level 0|1|2|3 [--gitignore <Template>] [--dry-run]`. Writes, each only if the file does not exist: `README.md` (title = the slug's repo name — never the folder name), `SECURITY.md` (this repo's text), `LICENSE` (level ≥ 1: `templates/LICENSE-MIT` with the year, or the POLICY "All rights reserved" line), `.gitignore` from `gh api gitignore/templates/<T> --jq .source` (GET; skipped without `--gitignore`), `CODEOWNERS` (`* @<owner>`), `.github/pull_request_template.md`, the six `docs/*.md` stubs (title, pointer line, `MISSING` sections) then `bun ~/.claude/scripts/render-docs.ts <path>` when that script exists (else one line saying so). Level 2: add `"license"` to `package.json` only when the file exists and lacks the key (`shortcut: rewrites with 2-space JSON.stringify, upgrade to a format-preserving edit if a repo complains`; other manifests are listed as by hand). Level 3: `--headers` pass — list (dry run) then prepend the header to each source file (POLICY definition; skip third-party dirs; after a shebang line) that lacks `SPDX-License-Identifier`/`Copyright (c)` in its first 3 lines; holder and year read from the LICENSE's `Copyright (c)` line; leader `//` for ts/js, `#` for sh/py/yml.
- [ ] Tests: fresh dir → the file list printed equals the files created; an existing `README.md` with content `X` stays `X` byte-for-byte and is reported `kept`; `--dry-run` creates nothing; the folder name (`acme_widget`) appears in no written file; `LICENSE` for `mit` contains the MIT grant line and the current year; `package.json` with `license` already → byte-identical; headers: `a.ts` gains the two lines, `b.ts` (already headed) and `c.md`/`d.json` unchanged, `e.sh` keeps its shebang on line 1; fake `gh` serving `gitignore/templates/Node` → `.gitignore` equals the fixture's `source`.
- [ ] Run → FAIL; implement; run → green. Commit `feat(starter): starter files, never overwriting`.

### T6 — `local-setup.ts`: hook added, email repo-local

**Files:** `skills/repo-create/scripts/local-setup.ts`, `tests/local-setup.test.ts`.
**CLI:** `local-setup.ts <repo-path> [--email <id>+<login>@users.noreply.github.com]`. Hook dir resolved as `audit.ts:381–385` does (`core.hooksPath`, else `git-common-dir/hooks`). Pre-commit: absent → create `#!/bin/sh\ngitleaks git --pre-commit --staged --redact\n` mode 0755; present without `gitleaks (git|protect|detect)` and without a line starting `exec` → **append** `\ngitleaks git --pre-commit --staged --redact\n` (mode kept); present with gitleaks → no write; present with an `exec` line → no write, print `by hand: this hook execs another; add the gitleaks line before the exec or in its target`, exit 1. Email: when the effective `git config --get user.email` does not match `audit.ts:372`'s regex and `--email` is given → `git config user.email <value>` (repo-local, OPEN-7); without `--email` print the fix. Then print the two Synology exclusion paths (`<abs>/.git`, `<abs>/node_modules`) with the probe (create a file under `.git`, confirm the client does not sync it) and the worktree pointer (`CLAUDE.md §3`, `~/tmp/<repo>-<task>`). No other writes.
- [ ] Tests: hook with 3 lines → 4 lines, the first 3 byte-identical, mode unchanged; absent → created, executable; already gitleaks → byte-identical (and `audit()`'s `gitleaks-precommit` reads `pass` on the result); `exec` hook → unchanged, exit 1; `core.hooksPath` set → the hook lands there, `.git/hooks` untouched; email `t@example.invalid` + `--email` → repo-local value set, global untouched (`GIT_CONFIG_GLOBAL=/dev/null` as the audit tests do); no `--email` → no config write.
- [ ] Run → FAIL; implement; run → green. Commit `feat(local-setup): gitleaks hook added, noreply email`. Open PR B (T4–T6) draft → CI → **owner merges**; read back by sha.

### T7 — SKILL.md prose: interview, flow, one-way doors, hand-off (needs OPEN-1, 2, 8, 9)

**Files:** `skills/repo-create/SKILL.md`, `POLICY.md` (one "Run first" bullet: `apply.ts --propose` before, the read-back after), `README.md` (usage + file map), `docs/app-flow.md` (the two journeys below with their error paths), `docs/implementation-plan.md` (plan 2 rows → DONE/IN PROGRESS with evidence), rendered `.html`.
- [ ] **New repo journey**, as numbered prose with the exact commands: (1) `audit.ts --owner <login>` → plan, counts, minutes, a random name (an undetectable plan is asked, never assumed). (2) `AskUserQuestion` batch 1: owner (personal / `arcmen`) with the detected plan shown for confirmation. Batch 2 (independent): visibility (private default; what each gives on that plan — the SKILL's plan table), existing code path or none, purpose signals (deploys? CI? client or personal data? public product or internal?). Batch 3 (depends on 2): name (random development name default while private; product name recorded per OPEN-2), copyright level (per OPEN-8; recommendation stated from visibility and intent). (3) Existing code: `scan.ts <path>`; show the facts; **offer** the claude-security scan in its own question with the cost sentence `minutes to hours and a large token spend; not measured` — run only on yes; findings reported, never auto-fixed. If the path has history: `gitleaks git <path> --redact` before any push (OPEN-9); a hit blocks the push until rotated. (4) **Public is a one-way door:** its own question, naming the full-history publication; then `gh repo create <owner>/<name> --private|--public [--source <path> --remote origin --push]`; read back `gh repo view <slug> --json name,visibility,owner` and show it. (5) `starter.ts` with the interview's answers, `local-setup.ts`, commit, push, verify by sha; the owner proves the hook with one blocked fake-secret commit. (6) `apply.ts <path> --propose` → the table verbatim → approval per OPEN-1 (edits per OPEN-3) → `apply.ts <path> --rows …` → read-back table and skip line verbatim; any `FAILED` row is reported, never retried blindly. (7) Hand-off: the repo will have CI → load ci-flow with the scan's Dependabot ecosystems; protection then belongs to the repository's own protect script (C3).
- [ ] **Existing repo journey** (`/repo-create --audit <path>`): steps 6 and, when asked, 3; no interview. State that `--audit` is prose routing, not an `audit.ts` flag (measured).
- [ ] Constraints restated once, in the "Before anything else" section: approval before any write, one-way doors confirmed on their own, read-back never exit code, never `--admin`, add never overwrite, secrets names only, the sandbox TLS note.
- [ ] Verify: `grep -c AskUserQuestion SKILL.md` ≥ 3; `bun ~/.claude/scripts/render-docs.ts . --check` exits 0; `comm -12 <(sort POLICY.md) <(sort ~/.claude/skills/ci-flow/POLICY.md)` reviewed — no new shared rule line (anti-goal: duplication). PR C draft → CI → **owner merges**.

### T8 — Rehearsal with real data (the interface is not verified until someone passes through it)

- [ ] With the owner in the session, run the new-repo journey end to end on a throwaway **private** repo under the personal account (Free: `branch-baseline` and environments will read blocked/n.a. — expected; record it), from an empty folder with one `package.json`. Owner gates: the create, the approval, and OPEN-10 at the end.
- [ ] Record: the proposal as rendered, the ids approved, the read-back table, the skip line, `audit.ts` before/after, and anything the owner could not answer from what the question showed (that is a prose defect, fixed in SKILL.md before closing).
- [ ] Close: `docs/implementation-plan.md` plan 2 row → DONE with the rehearsal evidence; re-render; PR; owner merges; sha read back.

## Acordado / En disputa / Recomendación (author's self-refutation; Codex unavailable, see the banner)

**Acordado** (held after refutation)
- The audit re-run is a GET read-back per setting and the only judge; no second normaliser (D4). The negative control (write returns 0, state unchanged → FAILED) is what makes it non-vacuous.
- Writes go out as `gh` argv, never through a shell (D3); the printed command and the executed call come from one `Fix` (D1).
- Branch protection has one writer: apply refuses `branch-baseline` whenever the audit saw a PR-triggered workflow (D5, T2 test 7).
- Prose where the agent asks, code where a write must be exact (D7).

**En disputa** (each with the check that decides it)
- *Byte-identical fix strings.* Refuted in part: today's quoting differs per site (`-f allowed_actions=selected` bare, `-f 'patterns_allowed[]=…'` quoted), so one render rule cannot reproduce every string byte for byte. Decided by: `grep -n "gh api -X" audit.ts` + the test list at 383/304/309/377/379/393/395 (measured) — only 383 asserts a runnable row's string. Resolution written into D1: identity where asserted, quoting-only drift elsewhere, shown by a diff in the commit.
- *A re-audit "pass" proves the write landed.* Partly: a row can pass by another route (e.g. `actions-policy` passes when Actions is disabled; `branch-baseline` checks four fields, the PUT sends eleven). Check: compare the PUT body with the GET after T8's rehearsal for `branch-baseline`; if fields the audit ignores differ, add them to the check, not to apply. OPEN for the owner only if that comparison shows drift.
- *Read-after-write consistency.* Not measured; if GitHub answers stale once, apply reports FAILED and the owner re-proposes. Check: T8's rehearsal (one real apply); a FAILED row that passes on `--propose` seconds later is the evidence.
- *Shared fixture under one bun process.* `afterAll` in one file could delete a `ROOT` another file still uses. Resolved in T0 by per-file roots; check: `bun test tests/` count after T2 equals the sum of the per-file counts.
- *The trigger hook does not fire on `bun apply.ts`* (its command word is `bun`, not `gh`; measured `trigger.sh:14, 26`). Harmless — the skill is already loaded when apply runs — but the owner may want the hook to name `apply.ts` too. Check: `printf '{"tool_name":"Bash","tool_input":{"command":"bun ~/.claude/skills/repo-create/scripts/apply.ts . --rows x"},"session_id":"t","cwd":"."}' | bash skills/repo-create/hooks/trigger.sh` prints nothing. Left as is (reminder, not enforcement).

**Recomendación**
- Execute T0–T3 first (PR A): they need no OPEN answer beyond the defaults stated (OPEN-4/6/7 defaults are in code and flippable). Ask OPEN-1, 2, 8, 9 before T7, in one `AskUserQuestion` batch. Run the Codex pass when the limit lifts (Nov 12) and fold its objections into T7's prose, which is the part no test checks.

## Risks

- D4 re-runs the whole audit for the read-back: ~20 GETs twice per apply; acceptable, and it is why no second normaliser exists. If GitHub caches a setting for a moment after a write (not observed; not measured), a row can read FAILED once — the owner re-runs `apply.ts --propose`, never a blind retry.
- `starter.ts`'s level-2 `package.json` rewrite can reformat the file (declared shortcut).
- The `AskUserQuestion` 4-option limit shapes approval (OPEN-1); a wrong shape turns per-row approval into free text.
- T7 depends on four OPEN answers; writing it before them bakes a guess into prose that the owner then reads as the rule.

## Unverified

- The claude-security scan's actual cost (no measurement anywhere; the prose says so).
- GitHub's read-after-write consistency for repository settings (D4 risk).
- Post-change test counts (estimates: 159 + ~4 audit + ~16 apply + ~4 proposal + ~8 scan + ~9 starter + ~7 local-setup); the gate is 0 fail plus every new script having its negative controls above.
- `gh auth` scopes today (`delete_repo` matters only for OPEN-10).

## Owner decisions (2026-11-10, recorded by the controller)

- OPEN-1 DECIDED: (a) one question: apply all N / choose rows (typed ids) / apply none.
- OPEN-2 DECIDED: ask every time; nothing is stored by the skill.
- OPEN-8 (C1) DECIDED: POLICY wins. Two levels only: none, or LICENSE + manifest `license` + a header in every source file. The spec §4 item 6 gets a one-line correction in T7.
- OPEN-10 DECIDED: delete the rehearsal repo afterwards (one-way door, own confirmation, needs `delete_repo` scope refresh by the owner).
- Controller rulings (defaults kept): OPEN-3 (a) hand-run edited rows + re-audit read-back; OPEN-4 org-wide writes refused, shown "by hand (org-wide)"; OPEN-5 rename stays a printed fix (plan 3 `--launch`); OPEN-6 5 MB, `--large-mb` overrides; OPEN-7 repo-local `user.email`; OPEN-9 (C2) keep the spec's history gitleaks gate before pushing existing history to a new remote (spec is the authority).
