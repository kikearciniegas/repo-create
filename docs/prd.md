# Product Requirements: repo-create

> [!NOTE]
> The rules live in [`skills/repo-create/POLICY.md`](../skills/repo-create/POLICY.md); the design is [`docs/superpowers/specs/2026-11-09-repo-create-design.md`](superpowers/specs/2026-11-09-repo-create-design.md). This document says what the product is, for whom and why; it never restates a rule.

## What it is

A Claude Code skill that owns **the repository itself**: how it is created, how its settings are hardened, what each GitHub plan gives a public or private repository, quotas, licences and storage. Its sibling skill, ci-flow, keeps the CI pipeline (workflows, required checks, deploy). The split and its reasons are in the design spec §1 and §8.

What ships today:

| Part | File | Role |
|---|---|---|
| Policy | [`POLICY.md`](../skills/repo-create/POLICY.md) | the one source of repository rules; CLAUDE.md points here |
| Skill entry | [`SKILL.md`](../skills/repo-create/SKILL.md) | the plan table, the 24 audit check ids, the naming lifecycle |
| Audit | [`scripts/audit.ts`](../skills/repo-create/scripts/audit.ts) | read-only check of one repository, or `--owner` before creating one |
| Reminder hook | [`hooks/trigger.sh`](../skills/repo-create/hooks/trigger.sh) | points an agent at POLICY and the audit before a repository settings command |
| Tests | [`tests/`](../tests/) | falsification suite: every check has a mutation that must flip it to FAIL |

## Why

- Repository settings live outside the tree, so nothing reviews them unless a rule names them (POLICY §1).
- Before the split, creating a repo meant loading a long CI policy and a long CI audit, and the overlap drifted (design spec §1).
- What a private repo can be protected with depends on the owner's plan; protection that silently stops applying looks exactly like protection that works (POLICY §1, "Plans and privilege").

## For whom

| User | Need |
|---|---|
| The owner (a personal account and a Team org) | One place for repository rules; a fast, trustworthy answer to "is this repo set up right, and what does my plan allow?" |
| AI coding agents | A rule to read before creating or reconfiguring a repository, a check to run before and after, and a reminder when they forget |

## Scope

| Item | Status |
|---|---|
| POLICY, plan table, naming lifecycle | DONE |
| Read-only audit: 24 checks, `--ref`, `--repo`, `--strict` | DONE |
| `--owner` pre-create report: plan, what a new repo gets, counts, minutes, random name | DONE |
| Reminder hook and its tests | DONE |
| Hook registration in the owner's Claude Code settings | IN PROGRESS (see the [implementation plan](implementation-plan.md)) |
| Interview, scan, proposal table, apply with read-back (plan 2) | OPEN |
| Modes `--audit --all`, `--launch`, `--transfer`, `--archive`, `--secrets`, `--cleanup` (plan 3) | OPEN |

## Success measures

- A compliant repository audits with no FAIL. DONE: the live audit of this repository during the whole-codebase pass read 22 pass, 0 fail, 2 n.a. (PR #2).
- Every check can fail: the suite holds at least one mutation per check id, and a coverage test lists none missing. DONE.
- The audit never writes: a test asserts every GitHub call it makes is a bare `gh api <path>` GET. DONE.
- No repository rule is restated outside `POLICY.md`. Checked by review, not by a test.
- TBD: no measured baseline of use (how often the hook fires, how many repos are audited) exists yet.

## Non-goals

- CI pipelines, workflows, required checks, deploy (ci-flow).
- Hosting platforms (Vercel, Cloudflare) and DNS: GitHub only (design spec §2, owner decision 2026-11-09).
- Enforcement: the hook only reminds; enforcement is server-side (protection, rulesets, Actions policy).
- Writing settings: the audit prints fixes and never runs them. A separate apply step is plan 2, and runs only owner-approved rows.
