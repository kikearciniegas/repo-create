// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// The proposal the owner chooses from before apply.ts writes anything: one row
// per audit check, rendered from `audit.ts --json`. No I/O here.
import { blocker, oneWay, type Row } from "./apply.ts";

/** Why each check exists and what it costs: `<POLICY bullet>; cost: <none | figure>; risk: <what the owner loses>`. */
export const IMPACT: Record<string, string> = {
  "plan-detected": "POLICY §1 Plans and privilege: know what the plan gives each visibility; cost: none; risk: protection that silently stops applying looks exactly like protection that works",
  "plan-protection": "POLICY §1 Plans and privilege: branch protection and rulesets on private repos need Pro or Team; cost: whichever option the owner picks in recommended (a Team org move, a Pro upgrade or going public), decided per repo (POLICY §0); risk: force-pushes, deletions and unreviewed merges on the default branch go unblocked",
  "plan-environments": "POLICY §1 Plans and privilege: environments on private repos need Pro or Team; cost: whichever option the owner picks in recommended (a Team org move, a Pro upgrade or going public), decided per repo (POLICY §0); risk: deploy credentials sit in repository secrets that every branch's workflows can read",
  "plan-minutes": "POLICY §0 Team org Actions budget: whatever plan-minutes reads live, Stop usage on; cost: about US$0.006 per Linux minute past the included minutes; risk: an overrun is billed up to the budget, then Actions stops",
  "repo-name": "POLICY §1 Visibility and names: a private repo under development gets a random name unrelated to the product, client or folder; cost: a rename, then git remote set-url in every clone, or a recreate (POLICY §1, a one-way door) when the label is also in the tracked tree or history; risk: the product or client name leaks through URLs, forks and notifications",
  "merge-hygiene": "POLICY §1 Default-branch hygiene: merged branches deleted automatically, one merge method per repo; cost: none; risk: stale branches pile up and history mixes merge commits with squashes",
  "dependabot-alerts": "POLICY §1 Always on, any visibility: Dependabot alerts; cost: none; risk: a known-vulnerable dependency goes unreported",
  "dependabot-security-updates": "POLICY §1 Always on, any visibility: Dependabot security updates; cost: none (a few PRs, each running CI minutes); risk: a known vulnerability stays unpatched until someone bumps it by hand",
  "actions-token": "POLICY §1 Least privilege: workflows get a read-only GITHUB_TOKEN and Actions cannot approve PRs; cost: none; risk: any workflow step can push code or approve its own PR",
  "actions-policy": "POLICY §1 Least privilege: third-party actions allow-listed and pinned to a full commit SHA, enforced in the Actions policy; cost: none; risk: a retagged or compromised action runs with the workflow's token and secrets",
  "fork-pr-policy": "POLICY §1 Least privilege: fork PRs get no write token and no secrets; cost: none; risk: a fork's PR reads the repo's secrets or writes to it",
  "secret-scanning": "POLICY §1 Plans and privilege: secret scanning and push protection, free on public repos; cost: none on public repos (a paid add-on on private ones, where gitleaks covers the gap); risk: a pushed secret is published unnoticed",
  "private-vuln-reporting": "POLICY §1 Public-repo extras: private vulnerability reporting enabled; cost: none; risk: outside reporters disclose in public issues",
  "security-policy": "POLICY §1 Public-repo extras: a SECURITY.md with a private reporting channel; cost: none; risk: outside reporters find no private channel and disclose in public",
  "branch-baseline": "POLICY §1 Default-branch hygiene: no force-push and no deletion on the default branch; cost: none; risk: a force-push or a deletion rewrites or erases the default branch",
  "deploy-keys": "POLICY §1 Collaborators, apps and keys: deploy keys read-only; cost: none; risk: whoever holds a writable key can push to the repo",
  "webhooks": "POLICY §1 Collaborators, apps and keys: webhooks on https with a secret; cost: none; risk: payloads readable in transit, and the receiver cannot tell a forged call from GitHub",
  "collaborators": "POLICY §1 Collaborators, apps and keys: the fewest members, apps and grants the work needs; cost: none; risk: a finished collaborator keeps read or write access to the code",
  "deploy-credential-scope": "POLICY §1 Least privilege: deploy credentials are environment secrets on an environment that allows the default branch only; cost: none; risk: any branch's workflow can reach the production deploy token",
  "log-retention": "POLICY §1 Always on: retention ≤ 30 days; cost: none (storage falls); risk: screenshots, traces and unredacted output readable for 90 days",
  "commit-email-noreply": "POLICY §1 Privacy of the content: commit author email is the GitHub noreply address; cost: none; risk: a personal email address is published in every commit",
  "gitleaks-precommit": "POLICY §1 Visibility and names: a secret that ever reached a commit is rotated, not just deleted; cost: none (a local hook, a second per commit); risk: a secret reaches a commit and must be rotated",
  "org-baseline": "POLICY §1 Org baseline: 2FA required, members cannot create public repositories, base permission read; cost: none; risk: one member's weak login or a public repo created by mistake exposes the org",
  "account-2fa": "POLICY §1 Org baseline: 2FA required; cost: none; risk: a stolen password alone takes over every repository on the account",
};

export const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " "); // as audit.ts's report cell

/** D6's recommended cell: keep, the runnable command, by hand, the owner's decision, or nothing. */
function recommended(r: Row, slug: string, ci: string | null): string {
  if (r.status === "pass") return r.fix ? `keep (suggestion: ${r.fix})` : "keep"; // a pass may carry a suggestion (repo-name, audit.ts:231); never runnable (R3)
  if (r.status === "n.a.") return "—";
  // No fix: the row came from check()'s catch (a failed read, or a thrown Blocked), so name the action instead.
  if (r.status === "blocked") return `owner decision: ${r.fix ?? r.ev}`;
  return blocker(r, slug, ci) ? `by hand: ${r.fix ?? "re-run the audit once the setting can be read"}` : r.fix!;
}

/** The 7-column proposal table (spec §6); IMPACT's sentence splits into why and cost / impact at "; cost:". */
export function renderProposal(a: { slug: string; ci: string | null; rows: Row[] }): string {
  const out = ["| setting | current | recommended | why | cost / impact | available on this plan | one-way door |", "|---|---|---|---|---|---|---|"];
  for (const r of a.rows) {
    const impact = IMPACT[r.id] ?? `no IMPACT entry for ${r.id}; cost: unknown`;
    const at = impact.indexOf("; cost:");
    out.push("| " + [r.id, `${r.status}: ${r.ev}`, recommended(r, a.slug, a.ci), impact.slice(0, at), impact.slice(at + 2),
      r.status === "blocked" ? "no (plan)" : r.status === "n.a." ? "n.a." : "yes",
      r.apply?.some((c) => oneWay(c)) ? "yes" : "no"].map(cell).join(" | ") + " |");
  }
  return out.join("\n");
}
