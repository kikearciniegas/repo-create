# repo-create

A Claude Code skill that owns repository creation and configuration: how a new
repository is created, how its settings are hardened, what each GitHub plan
gives a public or private repository, quotas, and the storage rules. A
read-only audit checks a repository's settings against that design. ci-flow
keeps the CI pipeline; this skill keeps everything about the repository
itself.

## Install

Symlink the skill directory (this folder is the single source of truth; there
is no second copy):

```sh
ln -s "$PWD/skills/repo-create" ~/.claude/skills/repo-create
```

## File map

| Path | Role |
|---|---|
| `skills/repo-create/POLICY.md` | the rules (owner decisions, repository configuration, storage), the one source CLAUDE.md points to |
| `skills/repo-create/SKILL.md` | the new-repo and existing-repo journeys, the plan table, the 24 audit check ids, the naming lifecycle |
| `skills/repo-create/hooks/trigger.sh` | PreToolUse reminder: repository create / settings actions → POLICY.md + the audit, once per session per repo |
| `skills/repo-create/scripts/audit.ts` | the audit (`bun`); `--json` for apply; parts in `scripts/lib/` (`gh.ts`, `plans.ts`, `owner.ts`, `deploy.ts`, `hooks.ts`) |
| `skills/repo-create/scripts/apply.ts` | the proposal table (`--propose`) and the approved writes with read-back (`--rows`); pure parts in `lib/apply.ts`, `lib/proposal.ts` |
| `skills/repo-create/scripts/scan.ts` | read-only stack detection of a working tree |
| `skills/repo-create/scripts/starter.ts` | a new repo's starter files, each written only when absent; copied from `templates/` |
| `skills/repo-create/scripts/local-setup.ts` | a clone's gitleaks pre-commit line and repo-local noreply email; prints the Synology Drive exclusions |
| `scripts/protect-main.sh` | this repository's own branch protection (ci-flow's protect script) |
| `tests/` | falsification suite: `fixture.ts` (the fake `gh`), one `*.test.ts` per script, plus the hook, the CI workflow, the protect script and the personal-data guard |
| `docs/*.md` | the six project documents (rendered `.html` beside each) |
| `docs/superpowers/` | the design spec and the implementation plan |
| `LICENSE`, `SECURITY.md` | MIT licence and security policy |

## Audit

```sh
bun ~/.claude/skills/repo-create/scripts/audit.ts <repo-path> [--ref <ref>] [--repo <owner/name>] [--strict]
bun ~/.claude/skills/repo-create/scripts/audit.ts --owner <login>    # before creating a repo
```

Reads repository and organization settings, plan and protection through
`gh api` GETs; writes nothing. Every fix is printed as a suggested command,
never run. Unknown is FAIL. Exit 0 unless `--strict` and something FAILED (exit 1); exit 2 when the ref cannot be read or `--repo` is not `owner/name`.

## Apply and the new-repo scripts

```sh
bun ~/.claude/skills/repo-create/scripts/apply.ts <repo-path> [--ref <ref>] [--repo <owner/name>] --propose
bun ~/.claude/skills/repo-create/scripts/apply.ts <repo-path> [--ref <ref>] [--repo <owner/name>] --rows <id,id,…>
bun ~/.claude/skills/repo-create/scripts/scan.ts <path> [--large-mb <n>] [--json]
bun ~/.claude/skills/repo-create/scripts/starter.ts <path> --slug <owner/name> --license mit|all-rights-reserved|none --level none|full [--gitignore <Template>] [--dry-run]
bun ~/.claude/skills/repo-create/scripts/local-setup.ts <repo-path> [--email <id>+<login>@users.noreply.github.com]
```

`--propose` prints the proposal table and writes nothing. `--rows` runs only
the named rows, then runs the audit again and prints a read-back table: exit
0 when every row reads `pass`, 1 when any reads `FAILED`, 2 when a row is
refused (nothing written). The order these run in, with the owner's
questions between them, is in `SKILL.md`.

## Tests

```sh
bun test tests/
```
