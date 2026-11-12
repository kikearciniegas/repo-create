// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// Falsification suite for skills/repo-create/scripts/audit.ts:  bun test tests/
//
// A synthetic repository that implements the whole reference design must
// PASS every check; then each check gets a mutation of that repository which
// must flip exactly that check to FAIL. A check no mutation can fail is
// vacuous, and this file is where that would show. GitHub is a fake `gh` on
// PATH serving canned JSON, which also records every call so the suite can
// assert the audit never writes.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, CI, DEP, FREE_GH, GH_BASE, GITLEAKS_HOOK, ORG, PUB_GH, REPO, harness, type Opts, type Result } from "./fixture";

const ROOT = mkdtempSync(join(tmpdir(), "repo-create-audit-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const { audit, ownerAudit } = harness(ROOT);

describe("--owner (before creating a repo)", () => {
  test("Team org: plan, seats, counts, unlimited slots, the feature table, minutes and a random private name", () => {
    const r = ownerAudit({ whois: { type: "Organization" }, repolist: [
      { name: "a", visibility: "PRIVATE", isArchived: false }, { name: "b", visibility: "PRIVATE", isArchived: true }, { name: "c", visibility: "PUBLIC", isArchived: false }] });
    expect(r.status).toBe(0);
    for (const s of ["repo-create: before creating a repository under o (organization)", "Plan: team (GitHub), seats 1/1", "1 public, 2 private (1 archived); slots: unlimited on every plan",
      "| branch protection / rulesets | yes | yes |", "| environment reviewers / wait timers | **no** | yes |",
      "| Actions minutes (standard Linux) | 3000/month, shared by the org | free |", "org 600 of 3000 included Linux min (20%)",
      "after the first push: bun ~/.claude/skills/repo-create/scripts/audit.ts <clone>   # baseline + hardening commands"]) expect(r.out).toContain(s);
    expect(r.out).toMatch(/gh repo create o\/[a-z]+-[a-z]+-\d{3} --private/);
    expect(r.out).not.toContain("Team org instead");
    for (const l of r.calls.trim().split("\n")) expect(l).toMatch(/^(api [^ ]+|repo list o .*)$/);
  });
  test("slots: unlimited even when the plan carries a private_repos number (Free answers 10000)", () => {
    const r = ownerAudit({ whois: { type: "User" }, user: { login: "o", plan: { name: "free", private_repos: 10000 } },
      repolist: [{ name: "r", visibility: "PRIVATE", isArchived: false }] });
    expect(r.out).toContain("1 private (0 archived); slots: unlimited on every plan");
    expect(r.out).not.toContain("slot(s) left");
  });
  test("a list that hits gh repo list's 1000 cap says 1000+, not an exact count", () => {
    const repolist = Array.from({ length: 1000 }, (_, i) => ({ name: `r${i}`, visibility: "PUBLIC", isArchived: false }));
    const r = ownerAudit({ whois: { type: "Organization" }, repolist });
    expect(r.out).toContain("Repositories: 1000+ (counts below cover the first 1000): 1000 public");
    expect(ownerAudit({ whois: { type: "Organization" }, repolist: repolist.slice(1) }).out).not.toContain("1000+");
  });
  test("plan unreadable: only \"Branch not protected\" infers a paid plan; any other 404 leaves it unknown", () => {
    const repolist = [{ name: "r", visibility: "PRIVATE", isArchived: false, defaultBranchRef: { name: "main" } }];
    const run = (msg: string) => ownerAudit({ whois: { type: "User" }, user: { login: "o" }, protection: { __err: msg }, repolist }).out;
    expect(run("gh: Branch not protected (HTTP 404)")).toContain("Plan: pro (inferred from r's branch protection)");
    for (const msg of ["gh: Branch not found (HTTP 404)", "gh: Not Found (HTTP 404)"]) expect(run(msg)).toContain("Plan: unknown");
  });
  test("Free user, plan unreadable: inferred from a private repo's protection; private features shown missing", () => {
    const r = ownerAudit({ whois: { type: "User" }, user: { login: "o" }, protection: FREE_GH.protection,
      repolist: [{ name: "r", visibility: "PRIVATE", isArchived: false, defaultBranchRef: { name: "main" } }] });
    for (const s of ["Plan: free (inferred from r's branch protection)", "| branch protection / rulesets | **no** | yes |",
      "| Actions minutes (standard Linux) | 2000/month, shared by the account | free |", "create it under the Team org instead"]) expect(r.out).toContain(s);
    for (const l of r.calls.trim().split("\n")) expect(l).toMatch(/^(api [^ ]+|repo list o .*)$/);
  });
});

const VARIANTS = {
  base: { files: {} as Record<string, string | null>, gh: {} as Record<string, unknown> },
  pub: { files: { "SECURITY.md": "Report privately via GitHub private vulnerability reporting.\n" }, gh: PUB_GH },
  // No workflow at all; a README so the fixture commit is not empty.
  noci: { files: { [CI]: null, [DEP]: null, "README.md": "fixture\n" }, gh: {} },
};
type V = keyof typeof VARIANTS;
const auditV = (v: V, files: Record<string, string | null> = {}, gh: Record<string, unknown> = {}, opts: Opts = {}) =>
  audit({ ...VARIANTS[v].files, ...files }, { ...VARIANTS[v].gh, ...gh }, [], opts);
const REF: Record<V, Result> = { base: auditV("base"), pub: auditV("pub"), noci: auditV("noci") };
const base = REF.base;
// No plan field AND no protection answer: readable protection would itself answer the plan.
const NO_PLAN = { org: { ...ORG, plan: undefined }, protection: { __err: "gh: Server Error (HTTP 500)" } };

describe("baseline", () => {
  test("the reference fixtures fail nothing, report all 24 checks, and every check passes in at least one", () => {
    for (const r of Object.values(REF)) {
      expect(r.rows.size).toBe(24);
      expect([...r.rows].filter(([, s]) => s === "fail" || s === "blocked")).toEqual([]);
    }
    const ids = new Set(Object.values(REF).flatMap((r) => [...r.rows.keys()]));
    expect([...ids].filter((id) => !Object.values(REF).some((r) => r.rows.get(id) === "pass"))).toEqual([]);
    expect(base.out).toContain("repo-create audit: ");
    expect(base.out).toContain("## Repository configuration");
  });
  test("exit 0 without --strict even when a check fails; 1 with it; 2 on an unreadable ref or a bad --repo", () => {
    const bad = { retention: { days: 90 } };
    expect(audit({}, bad).status).toBe(0);
    expect(audit({}, bad, ["--strict"]).status).toBe(1);
    expect(audit({}, {}, ["--strict"]).status).toBe(0);
    expect(audit({}, {}, ["--ref", "no-such-ref"]).status).toBe(2);
    expect(audit({}, {}, ["--repo", "not a slug"]).status).toBe(2);
  });
  test("the audit only ever reads from GitHub", () => {
    for (const r of Object.values(REF)) {
      const lines = r.calls.trim().split("\n");
      expect(lines.length).toBeGreaterThan(3);
      for (const l of lines) expect(l).toMatch(/^api [^ ]+$/);
    }
  });
  test("keys, hooks and environments are read 100 per page", () => {
    for (const p of ["keys", "hooks", "environments"]) {
      expect(base.calls).toContain(`api repos/o/r/${p}?per_page=100\n`);
      expect(base.calls).not.toContain(`api repos/o/r/${p}\n`); // the check itself asked for the paged path, not only the prefetch
    }
  });
  test("a full page of 100 deploy keys or webhooks may be truncated: unknown, FAIL", () => {
    const keys = Array.from({ length: 100 }, (_, i) => ({ id: i, title: `k${i}`, read_only: true }));
    const hooks = Array.from({ length: 100 }, (_, i) => ({ id: i, config: (GH_BASE.hooks as any)[0].config }));
    const r = audit({}, { keys, hooks });
    for (const id of ["deploy-keys", "webhooks"]) expect(r.out).toMatch(new RegExp(`\\| ${id} \\| \\*\\*FAIL\\*\\* \\| could not determine: [^|]*may be truncated`));
    expect(audit({}, { keys: keys.slice(1), hooks: hooks.slice(1) }).rows.get("deploy-keys")).toBe("pass");
  });
  test("unknown is FAIL, never pass: no readable plan, an unreadable endpoint", () => {
    expect(audit({}, NO_PLAN).rows.get("plan-detected")).toBe("fail");
    const r = audit({}, { keys: { __err: "gh: Server Error (HTTP 500)" } });
    expect(r.rows.get("deploy-keys")).toBe("fail");
    expect(r.out).toContain("| deploy-keys | **FAIL** | could not determine: ");
  });
  test("branch-baseline: owned by ci-flow when the repo has a pull-request workflow; judged here when it has none", () => {
    expect(base.rows.get("branch-baseline")).toBe("n.a.");
    expect(base.out).toMatch(/\| branch-baseline \| n\.a\. \| owned by ci-flow's protect script \(\.github\/workflows\/ci\.yml runs on pull requests/);
    expect(REF.noci.rows.get("branch-baseline")).toBe("pass");
  });
  test("branch-baseline follows the pull_request trigger, not the file name", () => {
    const pr = auditV("noci", { ".github/workflows/checks.yml": BASE[CI] });
    expect(pr.out).toMatch(/\| branch-baseline \| n\.a\. \| owned by ci-flow's protect script \(\.github\/workflows\/checks\.yml runs on pull requests/);
    const manual = auditV("noci", { [CI]: BASE[CI].replace(/  pull_request:\n[^\n]*\n/, "  workflow_dispatch:\n") });
    expect(manual.rows.get("branch-baseline")).toBe("pass");
  });
  test("an unparseable workflow is unknown, not absent: the need-dependent rows FAIL and name the file", () => {
    const r = audit({ [CI]: BASE[CI] + "  bad: [unclosed\n" }, FREE_GH);
    expect(r.rows.size).toBe(24);
    for (const id of ["plan-protection", "branch-baseline"]) {
      expect(r.rows.get(id)).toBe("fail");
      expect(r.out).toMatch(new RegExp(`\\| ${id} \\| \\*\\*FAIL\\*\\* \\| could not determine: [^|]*\\.github/workflows/ci\\.yml`));
    }
  });
  test("--json: one object with the repo facts and all 24 rows; still read-only; exit codes unchanged", () => {
    const r = audit({}, {}, ["--json"]);
    const j = JSON.parse(r.out);
    expect(j.rows.length).toBe(24);
    expect(j.slug).toBe("o/r");
    expect(j.ci).toBe(".github/workflows/ci.yml");
    expect([j.visibility, j.plan, j.isOrg, j.defaultBranch]).toEqual(["private", "team", true, "main"]);
    for (const l of r.calls.trim().split("\n")) expect(l).toMatch(/^api [^ ]+$/);
    expect(audit({}, { retention: { days: 90 } }, ["--json", "--strict"]).status).toBe(1);
  });
  test("--json: exactly the 11 runnable fixes carry apply, and each call is the printed command", () => {
    const withApply = new Set<string>(), byHand = new Set<string>();
    for (const [id, files, gh, v = "base", opts] of MUTATIONS) {
      const j = JSON.parse(audit({ ...VARIANTS[v].files, ...files }, { ...VARIANTS[v].gh, ...(gh ?? {}) }, ["--json"], opts ?? {}).out);
      const row = j.rows.find((x: any) => x.id === id);
      expect(row.status).toBe("fail");
      if (row.apply) {
        withApply.add(id);
        // one source: every call's method, path, fields and input appear in the printed fix
        expect(row.fix.split("gh api ").length - 1).toBe(row.apply.length);
        for (const c of row.apply) {
          expect(row.fix).toContain(`gh api -X ${c.method} ${c.path}`);
          for (const [k, val] of Object.entries(c.fields ?? {})) for (const x of [val].flat()) expect(row.fix).toContain(`${k}=${x}`);
          if (c.input !== undefined) expect(row.fix).toContain(`--input - <<<'${JSON.stringify(c.input)}'`);
        }
      } else if (row.fix) byHand.add(id);
    }
    expect([...withApply].sort()).toEqual(["actions-policy", "actions-token", "branch-baseline", "dependabot-alerts", "dependabot-security-updates",
      "fork-pr-policy", "log-retention", "merge-hygiene", "org-baseline", "private-vuln-reporting", "secret-scanning"]);
    for (const id of ["deploy-keys", "webhooks", "collaborators", "deploy-credential-scope"]) expect(byHand.has(id)).toBe(true);
  }, 60_000); // one audit per mutation

  test("--json: log-retention's fix is the printed Hardening line, and its call is structured", () => {
    const bad = { retention: { days: 90 } };
    const line = /^- log-retention: (.*)$/m.exec(audit({}, bad).out)![1];
    const row = JSON.parse(audit({}, bad, ["--json"]).out).rows.find((x: any) => x.id === "log-retention");
    expect(row.fix).toBe(line);
    expect(row.apply[0]).toEqual({ method: "PUT", path: "repos/o/r/actions/permissions/artifact-and-log-retention", fields: { days: 14 } });
  });
  test("--json: branch-baseline's call is the full baseline without CI; with CI it is ci-flow's, with no call", () => {
    const row = (j: any) => j.rows.find((x: any) => x.id === "branch-baseline");
    const nb = { protection: { __err: "gh: Branch not protected (HTTP 404)" } };
    const c = row(JSON.parse(audit(VARIANTS.noci.files, nb, ["--json"]).out)).apply[0];
    expect([c.method, c.path]).toEqual(["PUT", "repos/o/r/branches/main/protection"]);
    expect(c.input.enforce_admins).toBe(true);
    expect(c.input.required_status_checks).toBe(null);
    const ci = row(JSON.parse(audit({}, {}, ["--json"]).out));
    expect(ci.apply).toBeUndefined();
    expect(ci.ev).toContain("owned by ci-flow's protect script");
    // the call carries the raw name (apply passes argv, no shell); only the printed string is quoted
    const evil = "x';touch pwn;'";
    const h = row(JSON.parse(audit(VARIANTS.noci.files, { ...nb, repo: { ...REPO, default_branch: evil } }, ["--json"]).out));
    expect(h.apply[0].path).toBe(`repos/o/r/branches/${evil}/protection`);
  });
  // [id, a field GitHub did not return (unknown), a known bad value (control), variant]
  const UNKNOWN: [string, Record<string, unknown>, Record<string, unknown>, V][] = [
    ["merge-hygiene", { repo: { ...REPO, allow_squash_merge: undefined } }, { repo: { ...REPO, allow_rebase_merge: true } }, "base"],
    ["merge-hygiene", { repo: { ...REPO, allow_merge_commit: undefined, allow_rebase_merge: undefined } }, { repo: { ...REPO, allow_rebase_merge: true } }, "base"], // was a PASS
    ["dependabot-security-updates", { asf: {} }, { asf: { enabled: false } }, "base"],
    ["actions-token", { wfperm: {} }, { wfperm: { default_workflow_permissions: "write", can_approve_pull_request_reviews: false } }, "base"],
    ["actions-policy", { actperm: { enabled: true, allowed_actions: "selected" } }, { actperm: { enabled: true, allowed_actions: "all", sha_pinning_required: true } }, "base"],
    ["actions-policy", { actperm: { enabled: true, sha_pinning_required: true } }, { actperm: { enabled: true, allowed_actions: "all", sha_pinning_required: true } }, "base"], // was a PASS
    ["fork-pr-policy", { forkpub: {} }, { forkpub: { approval_policy: "first_time_contributors_new_to_github" } }, "pub"],
    ["secret-scanning", { repo: { ...PUB_GH.repo, security_and_analysis: undefined } },
      { repo: { ...PUB_GH.repo, security_and_analysis: { secret_scanning: { status: "disabled" }, secret_scanning_push_protection: { status: "disabled" } } } }, "pub"],
    ["private-vuln-reporting", { pvr: {} }, { pvr: { enabled: false } }, "pub"],
    ["branch-baseline", { protection: { ...(GH_BASE.protection as any), allow_deletions: undefined } }, { protection: { ...(GH_BASE.protection as any), allow_force_pushes: { enabled: true } } }, "noci"],
    ["branch-baseline", { protection: { __err: "gh: Branch not found (HTTP 404)" } }, { protection: { __err: "gh: Branch not protected (HTTP 404)" } }, "noci"],
    ["branch-baseline", { rules: { __err: "gh: Server Error (HTTP 500)" }, protection: { __err: "gh: Branch not protected (HTTP 404)" } }, { protection: { __err: "gh: Branch not protected (HTTP 404)" } }, "noci"],
    ["branch-baseline", { rules: { __err: "gh: Server Error (HTTP 500)" }, protection: { ...(GH_BASE.protection as any), allow_force_pushes: { enabled: true } } }, { protection: { ...(GH_BASE.protection as any), allow_force_pushes: { enabled: true } } }, "noci"],
    ["log-retention", { retention: {} }, { retention: { days: 90 } }, "base"],
    ["org-baseline", { org: { ...ORG, two_factor_requirement_enabled: undefined } }, { org: { ...ORG, members_can_create_public_repositories: true } }, "base"],
    ["org-baseline", { org: { ...ORG, default_repository_permission: undefined } }, { org: { ...ORG, default_repository_permission: "write" } }, "base"],
  ];
  const jsonRow = (v: V, gh: Record<string, unknown>, id: string) =>
    JSON.parse(audit(VARIANTS[v].files, { ...VARIANTS[v].gh, ...gh }, ["--json"]).out).rows.find((x: any) => x.id === id);
  for (const [id, unknown, known, v] of UNKNOWN)
    test(`--json: ${id} FAILs on a field GitHub did not return, prints the same fix, and carries no apply`, () => {
      const u = jsonRow(v, unknown, id), k = jsonRow(v, known, id);
      expect(k.status).toBe("fail");
      expect(k.apply?.length).toBeGreaterThan(0); // control: a known bad value stays runnable
      expect(u.status).toBe("fail");
      expect(u.fix).toBe(k.fix);
      expect(u.apply).toBeUndefined();
    });
  test("unknown merge settings or allowed-actions policy: the evidence says it was not returned", () => {
    const merge = jsonRow("base", { repo: { ...REPO, allow_merge_commit: undefined, allow_rebase_merge: undefined } }, "merge-hygiene");
    expect(merge.ev).toBe("o/r: merge settings not returned (needs admin)");
    const pol = jsonRow("base", { actperm: { enabled: true, sha_pinning_required: true } }, "actions-policy");
    expect(pol.ev).toStartWith("allowed-actions policy not returned (unknown)");
  });
  test("branch-baseline: an unreadable rulesets list is named in the evidence; protection that passes alone still passes", () => {
    const err = { rules: { __err: "gh: Server Error (HTTP 500)" } };
    const r = jsonRow("noci", { ...err, protection: { __err: "gh: Branch not protected (HTTP 404)" } }, "branch-baseline");
    expect(r.ev).toBe("main is not protected; rulesets not readable (gh api repos/o/r/rules/branches/main: gh: Server Error (HTTP 500))");
    expect(jsonRow("noci", err, "branch-baseline").status).toBe("pass"); // classic protection proves it without the rulesets
  });
  test("printed fixes: a string field renders as -f, a boolean or a number as -F", () => {
    const out = audit({}, { retention: { days: 90 }, wfperm: { default_workflow_permissions: "write", can_approve_pull_request_reviews: false } }).out;
    expect(out).toContain("- log-retention: gh api -X PUT repos/o/r/actions/permissions/artifact-and-log-retention -F days=14\n");
    expect(out).toContain("- actions-token: gh api -X PUT repos/o/r/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false\n");
  });
});

describe("plan × visibility × project needs", () => {
  test("Free private WITH CI and deploy: protection and environments are blocked, with the options; --strict still exits 0", () => {
    const r = audit({}, FREE_GH, ["--strict"]);
    expect(r.out).toContain("plan free");
    for (const id of ["plan-protection", "plan-environments"]) expect(r.rows.get(id)).toBe("blocked");
    expect(r.rows.get("deploy-credential-scope")).toBe("n.a.");
    expect(r.rows.get("secret-scanning")).toBe("n.a.");
    expect([...r.rows].filter(([, s]) => s === "fail")).toEqual([]);
    expect(r.out).toContain("plan-protection (plan decision): (a) move the repo to the Team org");
    expect(r.status).toBe(0);
  });
  test("plan field unreadable, private repo's protection readable or 404: paid plan inferred (team for an org)", () => {
    for (const protection of [GH_BASE.protection, { __err: "gh: Branch not protected (HTTP 404)" }]) {
      const r = audit({}, { org: { ...ORG, plan: undefined }, protection });
      expect(r.out).toContain("| plan-detected | pass | team (inferred: protection is readable on this private repo)");
      for (const id of ["plan-protection", "plan-environments", "plan-minutes"]) expect(r.rows.get(id)).toBe("pass");
    }
  });
  test("plan field unreadable and any 404 other than \"Branch not protected\": the plan stays unknown (FAIL)", () => {
    for (const msg of ["gh: Branch not found (HTTP 404)", "gh: Not Found (HTTP 404)"]) {
      const r = audit({}, { org: { ...ORG, plan: undefined }, protection: { __err: msg } });
      expect(r.rows.get("plan-detected")).toBe("fail");
    }
  });
  test("Free private WITHOUT CI or deploy: the same missing features are n.a., not blocked", () => {
    const r = auditV("noci", {}, FREE_GH);
    expect(r.rows.get("plan-protection")).toBe("n.a.");
    expect(r.rows.get("plan-environments")).toBe("n.a.");
    expect(r.rows.get("branch-baseline")).toBe("n.a.");
  });
  test("past 80% of the included minutes the report states limit, remaining and budget left", () => {
    const r = audit({}, { usage: { usageItems: [{ sku: "Actions Linux", quantity: 2500, repositoryName: "r", netAmount: 0 }] } });
    expect(r.rows.get("plan-minutes")).toBe("pass"); // a budget is set, so the quota is not a stop
    expect(r.out).toMatch(/\*\*Actions minutes 83% used: 2500 of 3000 included .*500 remaining until \d{4}-\d{2}-01; at this pace \d+ by month end; budget US\$20, US\$0\.00 spent, US\$20\.00 left before Actions stops\*\*/);
    expect(base.out).not.toContain("Actions minutes 20% used");
  });
  test("Windows/macOS minutes are named as not counted; verdict and Linux sum unchanged", () => {
    const usage = { usageItems: [...(GH_BASE.usage as any).usageItems, { sku: "Actions macOS 3-core", quantity: 100, repositoryName: "r" }, { sku: "Actions Windows", quantity: 10, repositoryName: "r" }] };
    const r = audit({}, { usage });
    expect(r.rows.get("plan-minutes")).toBe("pass");
    expect(r.out).toMatch(/\| plan-minutes \| pass \| [^|]*600 of 3000 included Linux min[^|]*; 110 Windows\/macOS min not counted \(they use the quota at 2x\/10x\) \|/);
    expect(base.out).not.toContain("Windows/macOS");
  });
  test("an alert-only or non-org Actions budget is no stop: the quota is", () => {
    const usage = { usageItems: [{ sku: "Actions Linux", quantity: 2500, repositoryName: "r", netAmount: 0 }] };
    for (const b of [{ prevent_further_usage: false }, { budget_scope: "repository" }]) {
      const r = audit({}, { usage, budgets: { budgets: [{ ...(GH_BASE.budgets as any).budgets[0], ...b }] } });
      expect(r.out).not.toContain("left before Actions stops");
      expect(r.rows.get("plan-minutes")).toBe("fail");
    }
  });
  test("a public repo with a development name gets a rename-to-product suggestion; a folder label gets a random name", () => {
    const pub = auditV("pub", {}, { repo: { ...PUB_GH.repo, name: "amber-river-123" } });
    expect(pub.rows.get("repo-name")).toBe("pass");
    expect(pub.out).toContain("repo-name (suggestion): public now, so the product name can replace the development name: gh repo rename <product-name>");
    const lab = audit({}, { repo: { ...REPO, name: "acme-thing" } });
    expect(lab.out).toMatch(/repo-name: rename to a random development name: gh repo rename [a-z]+-[a-z]+-\d{3} -R o\/r/);
  });
  test("a folder label that also appears in tracked lines gets recreate first, rename only as a stopgap; absent, the rename fix is unchanged", () => {
    const lab = audit({ "notes.md": "ACME notes\nnothing\nfrom acme\n", "src/a.txt": "acme-thing\n" }, { repo: { ...REPO, name: "acme-thing" } });
    expect(lab.rows.get("repo-name")).toBe("fail");
    expect(lab.out).toContain("the label also appears in 3 tracked lines, and a rename leaves those and the history");
    expect(lab.out).toMatch(/- repo-name: recreate clean \(POLICY §1 'Recreating a repo clean', a one-way door the owner confirms\); rename only as a stopgap: rename to a random development name: gh repo rename [a-z]+-[a-z]+-\d{3} -R o\/r/);
    const none = audit({}, { repo: { ...REPO, name: "acme-thing" } });
    expect(none.out).not.toContain("tracked lines");
    expect(none.out).not.toContain("not checked");
    expect(none.out).toMatch(/- repo-name: rename to a random development name: gh repo rename /);
  });
  test("hardening fixes are printed, never run", () => {
    const r = audit({}, { retention: { days: 90 } });
    expect(r.out).toContain("- log-retention: gh api -X PUT repos/o/r/actions/permissions/artifact-and-log-retention -F days=14");
    for (const l of r.calls.trim().split("\n")) expect(l).toMatch(/^api [^ ]+$/);
  });
  test("core.hooksPath: a hook chained to .git/hooks/pre-commit counts; ~ is expanded; an unchained one fails", () => {
    const chain = '#!/bin/sh\nexec "$(git rev-parse --git-common-dir)/hooks/pre-commit" "$@"\n';
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", chain] }).rows.get("gitleaks-precommit")).toBe("pass");
    expect(audit({}, {}, [], { hooksPath: ["~/hk", "hk", GITLEAKS_HOOK], hook: null }).rows.get("gitleaks-precommit")).toBe("pass");
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", "#!/bin/sh\nexit 0\n"] }).rows.get("gitleaks-precommit")).toBe("fail");
    // an existing hook without gitleaks: the fix says ADD to it, never overwrite; a missing hook: create
    const has = audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", "#!/bin/sh\nexit 0\n"] }).out.split("## Hardening")[1] ?? "";
    expect(has).toMatch(/gitleaks-precommit: ADD a line running gitleaks git --pre-commit --staged --redact to the existing [^\n]*never overwrite/);
    const none = audit({}, {}, [], { hook: null }).out.split("## Hardening")[1] ?? "";
    expect(none).toMatch(/gitleaks-precommit: create [^\n]*--redact[^\n]*never overwrite/);
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", chain], hook: "#!/bin/sh\nexit 0\n" }).rows.get("gitleaks-precommit")).toBe("fail");
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", chain], hook: "#!/bin/sh\nexit 0\ngitleaks git --pre-commit --staged\n" }).rows.get("gitleaks-precommit")).toBe("fail");
    // naming hooks/pre-commit is not chaining to the default hook
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", '#!/bin/sh\nfor h in .githooks/pre-commit.d/*; do "$h" || exit 1; done\n'] }).rows.get("gitleaks-precommit")).toBe("fail");
  });
  test("gitleaks-precommit: a gitleaks line after a column-0 exit or an exec cannot run; one before it can", () => {
    const gl = "gitleaks git --pre-commit --staged";
    expect(audit({}, {}, [], { hook: `#!/bin/sh\nnpm test\nexit 0\n${gl}\n` }).rows.get("gitleaks-precommit")).toBe("fail");
    expect(audit({}, {}, [], { hook: `#!/bin/sh\nexec npm test\n${gl}\n` }).rows.get("gitleaks-precommit")).toBe("fail");
    expect(audit({}, {}, [], { hook: `#!/bin/sh\n${gl}\nexit 0\n` }).rows.get("gitleaks-precommit")).toBe("fail");
    expect(audit({}, {}, [], { hook: `#!/bin/sh\nif ! npm test; then\n  exit 1\nfi\n${gl}\n` }).rows.get("gitleaks-precommit")).toBe("fail");
  });
  test("gitleaks-precommit fails closed: any exit or exec before the gitleaks call fails; gitleaks first passes", () => {
    const gl = "gitleaks git --pre-commit --staged";
    const row = (body: string) => audit({}, {}, [], { hook: `#!/bin/sh\n${body}` }).rows.get("gitleaks-precommit");
    for (const stop of ["npm test; exit 0\n", "npm test && exit 0\n", "npm test\n\texit 0\n", "f() {\n  exit 0\n}\nf\n"]) expect(row(`${stop}${gl}\n`)).toBe("fail");
    expect(row(`${gl}\nnpm test; exit 0\n`)).toBe("fail");
    expect(row(`${gl}\nexec "$(git rev-parse --git-common-dir)/hooks/pre-commit.local" "$@"\n`)).toBe("fail");
    expect(row(`${gl} || exit 1\nnpm test\n`)).toBe("pass");
  });
  test("gitleaks-precommit: a leak must fail the hook: `|| exit N` (N≠0), the last live line, or after `set -e`", () => {
    const gl = "gitleaks git --pre-commit --staged";
    const row = (body: string) => audit({}, {}, [], { hook: `#!/bin/sh\n${body}` }).rows.get("gitleaks-precommit");
    // the false PASS from the review: status ignored, the hook exits with npm's
    expect(row(`${gl}\nnpm test\n`)).toBe("fail");
    expect(audit({}, {}, [], { hook: `#!/bin/sh\n${gl}\nnpm test\n` }).out).toContain("runs gitleaks, but its failure does not fail the hook");
    // (a) `|| exit N`
    expect(row(`${gl} || exit 1\nnpm test\n`)).toBe("pass");
    expect(row(`${gl} || exit 0\nnpm test\n`)).toBe("fail");
    expect(row(`${gl} || true\nnpm test\n`)).toBe("fail");
    expect(row(`${gl}; npm test || exit 1\n`)).toBe("fail");
    // (b) the last live line
    expect(row(`npm test\n${gl}\n\n# done\n`)).toBe("pass");
    expect(row(`npm test\n${gl} || true\n`)).toBe("fail");
    expect(row(`npm test\n${gl} | tee log\n`)).toBe("fail");
    // (c) after `set -e`
    expect(row(`set -eu\n${gl}\nnpm test\n`)).toBe("pass");
    expect(row(`${gl}\nset -e\nnpm test\n`)).toBe("fail");
    expect(row(`set -x\n${gl}\nnpm test\n`)).toBe("fail");
    // the chained default hook is judged the same way
    const chain = '#!/bin/sh\nexec "$(git rev-parse --git-common-dir)/hooks/pre-commit" "$@"\n';
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", chain], hook: `#!/bin/sh\n${gl}\nnpm test\n` }).rows.get("gitleaks-precommit")).toBe("fail");
    expect(audit({}, {}, [], { hooksPath: [".githooks", "repo/.githooks", chain], hook: `#!/bin/sh\n${gl} || exit 1\nnpm test\n` }).rows.get("gitleaks-precommit")).toBe("pass");
  });
  test("printed fixes quote a hostile branch name and drop a hostile action name", () => {
    const evil = "x';touch pwn;'";
    // No pull-request workflow, so branch-baseline prints its protection fix; a manual workflow still names the action.
    const tool = BASE[CI].replace(/  pull_request:\n[^\n]*\n/, "  workflow_dispatch:\n").replace("oven-sh/setup-bun@", "ev'il;touch pwn/x@");
    const r = auditV("noci", { ".github/workflows/tool.yml": tool },
      { repo: { ...REPO, default_branch: evil }, protection: { __err: "gh: Branch not protected (HTTP 404)" }, actperm: { enabled: true, allowed_actions: "all", sha_pinning_required: false } });
    expect(r.rows.get("actions-policy")).toBe("fail");
    expect(r.out).toContain("ev'il;touch pwn/x"); // the action was read, so dropping it below is the quoting, not a miss
    const fixes = r.out.split("## Hardening")[1];
    expect(fixes).not.toContain("touch pwn/x");
    const quoted = /branches\/(.+)\/protection --input/.exec(fixes)![1];
    expect(spawnSync("sh", ["-c", `printf %s ${quoted}`]).stdout.toString()).toBe(evil); // the shell reads back the exact name
  });
});

describe("deploy credentials in an environment open to any branch", () => {
  const openPreview = { environments: [...(GH_BASE.envs as any).environments, { name: "preview", deployment_branch_policy: null }] };
  test("an environment open to any branch is accepted while one account alone can push", () => {
    const r = auditV("base", {}, { envs: openPreview, collab: [{ login: "o", permissions: { admin: true, push: true } }] });
    expect(r.rows.get("deploy-credential-scope")).toBe("pass");
    expect(r.out).toContain("preview open to any branch, accepted while o is the only writer");
  });
  test("control: a second account with push access fails it", () => {
    const r = auditV("base", {}, { envs: openPreview, collab: [{ login: "o", permissions: { admin: true } }, { login: "x", permissions: { push: true } }] });
    expect(r.rows.get("deploy-credential-scope")).toBe("fail");
    expect(r.out).toContain("2 accounts can push a branch (o, x)");
  });
  // Fail closed: any provider word is deploy-like; only named non-secret ids are not.
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "KUBECONFIG", "AZURE_WEBAPP_PUBLISH_PROFILE", "VERCEL_DEPLOY_HOOK", "SSH_PRIVATE_KEY"])
    test(`deploy-like: ${name}`, () => expect(auditV("base", {}, { secrets: { secrets: [{ name }] } }).rows.get("deploy-credential-scope")).toBe("fail"));
  for (const name of ["AWS_REGION", "GOOGLE_ANALYTICS_ID", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"])
    test(`not deploy-like: ${name}`, () => expect(auditV("base", {}, { secrets: { secrets: [{ name }] } }).rows.get("deploy-credential-scope")).toBe("pass"));
  test("control: a read-only collaborator is not a writer", () => {
    const r = auditV("base", {}, { envs: openPreview, collab: [{ login: "o", permissions: { admin: true } }, { login: "x", permissions: { pull: true } }] });
    expect(r.rows.get("deploy-credential-scope")).toBe("pass");
  });
});

const MUTATIONS: [string, Record<string, string | null>, Record<string, unknown>?, V?, Opts?][] = [
  // A plan that cannot be read is an unknown, and unknown is FAIL.
  ["plan-detected", {}, NO_PLAN],
  ["plan-protection", {}, NO_PLAN],
  ["plan-environments", {}, NO_PLAN],
  ["plan-minutes", {}, { usage: { usageItems: [{ sku: "Actions Linux", quantity: 2900, repositoryName: "r" }] }, budgets: { budgets: [] } }],
  ["plan-minutes", {}, { usage: { __err: "gh: Not Found (HTTP 404)" } }],
  ["repo-name", {}, { repo: { ...REPO, name: "acme-thing" } }],
  ["merge-hygiene", {}, { repo: { ...REPO, allow_rebase_merge: true } }],
  ["merge-hygiene", {}, { repo: { ...REPO, delete_branch_on_merge: false } }],
  ["dependabot-alerts", {}, { vuln: { __err: "gh: Not Found (HTTP 404)" } }],
  ["dependabot-security-updates", {}, { asf: { enabled: false } }],
  ["actions-token", {}, { wfperm: { default_workflow_permissions: "write", can_approve_pull_request_reviews: false } }],
  ["actions-token", {}, { wfperm: { default_workflow_permissions: "read", can_approve_pull_request_reviews: true } }],
  ["actions-policy", {}, { actperm: { enabled: true, allowed_actions: "all", sha_pinning_required: true } }],
  ["actions-policy", {}, { actperm: { enabled: true, allowed_actions: "selected" } }],
  ["actions-policy", {}, { selacts: { github_owned_allowed: true, verified_allowed: false, patterns_allowed: ["*"] } }], // "selected" that allows everything
  ["actions-policy", {}, { selacts: { github_owned_allowed: true, verified_allowed: false, patterns_allowed: ["oven-sh/setup-bun@*", "*/*@v*"] } }], // any owner's action at a v* ref
  ["actions-policy", {}, { selacts: { github_owned_allowed: true, verified_allowed: true, patterns_allowed: [] } }],
  ["fork-pr-policy", {}, { forkpriv: { run_workflows_from_fork_pull_requests: true, send_write_tokens_to_workflows: false, send_secrets_and_variables: true } }],
  ["fork-pr-policy", {}, { forkpub: { approval_policy: "first_time_contributors_new_to_github" } }, "pub"],
  ["fork-pr-policy", {}, { forkpriv: {} }], // a shape-less answer is an unknown, and unknown is FAIL
  ["secret-scanning", {}, { repo: { ...PUB_GH.repo, security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "disabled" } } } }, "pub"],
  ["private-vuln-reporting", {}, { pvr: { enabled: false } }, "pub"],
  ["security-policy", { "SECURITY.md": null }, {}, "pub"],
  ["branch-baseline", {}, { protection: { ...(GH_BASE.protection as any), allow_force_pushes: { enabled: true } } }, "noci"],
  ["branch-baseline", {}, { protection: { __err: "gh: Branch not protected (HTTP 404)" } }, "noci"],
  ["deploy-keys", {}, { keys: [{ id: 1, title: "old deploy", read_only: false }] }],
  ["webhooks", {}, { hooks: [{ id: 2, config: { url: "http://hooks.example.invalid/x", insecure_ssl: "0", secret: "********" } }] }],
  ["webhooks", {}, { hooks: [{ id: 2, config: { url: "https://hooks.example.invalid/x", insecure_ssl: "0" } }] }],
  ["collaborators", {}, { collab: [{ login: "x", permissions: { admin: true } }] }],
  ["deploy-credential-scope", {}, { secrets: { secrets: [{ name: "VERCEL_TOKEN" }] } }],
  ["deploy-credential-scope", {}, { secrets: { secrets: [{ name: "AWS_REGION" }, { name: "AWS_SECRET_ACCESS_KEY" }] } }],
  ["deploy-credential-scope", {}, { envs: {} }],
  ["deploy-credential-scope", {}, { envs: { ...(GH_BASE.envs as any), total_count: 101 } }], // more than one page: the rest is unknown
  ["deploy-credential-scope", {}, { envs: { environments: [{ name: "preview", deployment_branch_policy: null }] }, collab: [{ login: "a", permissions: { push: true } }, { login: "b", permissions: { push: true } }] }],
  ["log-retention", {}, { retention: { days: 90 } }],
  ["commit-email-noreply", {}, {}, "base", { email: "t@example.invalid" }],
  ["gitleaks-precommit", {}, {}, "base", { hook: null }],
  ["gitleaks-precommit", {}, {}, "base", { hook: "#!/bin/sh\n# gitleaks git --pre-commit --staged (a comment is not a call)\nexit 0\n" }],
  ["org-baseline", {}, { org: { ...ORG, members_can_create_public_repositories: true } }],
  ["org-baseline", {}, { org: { ...ORG, two_factor_requirement_enabled: false } }],
  ["account-2fa", {}, { user: { ...PUB_GH.user, two_factor_authentication: false } }, "pub"],
  ["account-2fa", {}, { user: { login: "o", plan: { name: "free" } } }, "pub"],
];

describe("each check can fail", () => {
  for (const [id, files, gh, v = "base", opts] of MUTATIONS) {
    test(`${id} flips to FAIL (${v})`, () => {
      expect(REF[v].rows.get(id)).toBe("pass");
      expect(auditV(v, files, gh ?? {}, opts ?? {}).rows.get(id)).toBe("fail");
    });
  }
  test("every check a reference fixture reports has at least one mutation", () => {
    const covered = new Set(MUTATIONS.map(([id]) => id));
    const ids = new Set(Object.values(REF).flatMap((r) => [...r.rows.keys()]));
    expect(ids.size).toBe(24);
    expect([...ids].filter((id) => !covered.has(id))).toEqual([]);
  });
});
