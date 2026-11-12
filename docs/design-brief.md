# Design Brief: repo-create

> [!NOTE]
> repo-create has no visual interface. The design maps onto what a user meets: the audit's terminal report, the `--owner` report, the hook's one-line reminder, and the skill's written text. The source of truth for every string below is the code: [`scripts/audit.ts`](../skills/repo-create/scripts/audit.ts) (report section), [`scripts/lib/owner.ts`](../skills/repo-create/scripts/lib/owner.ts) and [`hooks/trigger.sh`](../skills/repo-create/hooks/trigger.sh). Design intent: [`docs/superpowers/specs/2026-11-09-repo-create-design.md`](superpowers/specs/2026-11-09-repo-create-design.md).

## Brand

- An internal tool, published as a public MIT repository. No logo, no colour, no name beyond `repo-create`.
- It continues ci-flow's audit output: same table shape, same verdict words, so the two reports read as one family.

## Tone

- Terse and factual. One row per check: the verdict, then the evidence that produced it.
- Says what it could not determine rather than guessing: `could not determine: …`.
- Names the cost or risk when it blocks: a `blocked` row ends "Without it: …" and lists the options.
- Never a decoration that hides a FAIL; never a success word for something unproven (the `gitleaks-precommit` pass reads "present, not proven by a blocked commit").

## Visual system (terminal output)

The audit report is Markdown printed to stdout, readable raw in a terminal and rendered in a PR or chat.

| Element | Convention |
|---|---|
| Header | `repo-create audit: <path> @ <ref> (<owner/name>)`, then `<visibility> repository, <user\|organization>-owned, plan <plan>` |
| Table | `## Repository configuration`, columns `check \| result \| evidence`, one row per check id in a fixed order |
| Verdict words | `pass`, `**FAIL**`, `**blocked**`, `n.a.`; only the two that need action are bold |
| Counts line | `N pass, N fail, N blocked by plan, N n.a.` |
| Minutes warning | a bold line of its own, only from 80% of the included minutes |
| Fixes | `## Hardening — suggested, NOT applied; read each before running it`, one bullet per row: `- <id>: <command>`, tagged `(plan decision)` for a `blocked` row and `(suggestion)` for a passing row that still carries advice |
| Quoting | values from the tree or the API are shell-quoted before they enter a printed command; `\|` in evidence is escaped so the table holds |
| Redaction | secrets by name only; webhook URLs as host only; commit emails as domains only |

The `--owner` report uses the same vocabulary: a capability table with `yes` and a bold `**no**`, a minutes line, and "Suggested (nothing was created)".

The hook emits one sentence as `additionalContext`, naming the action it saw and the repository root, and the two commands to run.

## Accessibility

- Plain text: no colour, no emoji, no box drawing. A verdict is a word, so a screen reader or a `grep` reads it.
- Bold marks only FAIL, blocked and the minutes warning, so it never carries meaning alone: the word does.
- These documents are Markdown with an HTML render (light and dark, printable) and diagrams as inline SVG.
- TBD: no measured target (contrast ratio, screen-reader test) for the rendered HTML; the renderer is shared across projects and owns that.

## References

- ci-flow's audit output, which this report continues.
- GitHub's own docs for each setting the evidence names (for example [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).

| Item | Status |
|---|---|
| Audit and `--owner` report format | DONE |
| Hook reminder text | DONE |
| Proposal table layout (plan 2) | OPEN |
