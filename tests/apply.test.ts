// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// apply.ts: only approved rows run, as gh argv (never a shell), and a row is
// verified only when a second audit reads it `pass`. GitHub is the fake gh in
// fixture.ts, alone on PATH: the suite cannot reach the network.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CI, DEP, FREE_GH, GH_BASE, ISOLATED_TOOLS, ORG, PUB_GH, REPO, harness } from "./fixture";
import { argv, oneWay, readback, select } from "../skills/repo-create/scripts/lib/apply.ts";

const ROOT = mkdtempSync(join(tmpdir(), "repo-create-apply-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const { audit, apply } = harness(ROOT);

const PUB = { "SECURITY.md": "Report privately via GitHub private vulnerability reporting.\n" };
const NOCI = { [CI]: null, [DEP]: null, "README.md": "fixture\n" };
const NOT_PROTECTED = "gh: Branch not protected (HTTP 404)";
const RET = "repos/o/r/actions/permissions/artifact-and-log-retention";
const writeLines = (w: string) => w.split("\n").filter((l) => l.startsWith("WRITE "));

// One failing case per runnable row (the 11 that carry `apply`), as the audit emits them.
const RUNNABLE: [string, Record<string, string | null>, Record<string, unknown>][] = [
  ["merge-hygiene", {}, { repo: { ...REPO, allow_rebase_merge: true } }],
  ["dependabot-alerts", {}, { vuln: { __err: "gh: Not Found (HTTP 404)" } }],
  ["dependabot-security-updates", {}, { asf: { enabled: false } }],
  ["actions-token", {}, { wfperm: { default_workflow_permissions: "write", can_approve_pull_request_reviews: false } }],
  ["actions-policy", {}, { actperm: { enabled: true, allowed_actions: "all", sha_pinning_required: true } }],
  ["fork-pr-policy", {}, { forkpriv: { run_workflows_from_fork_pull_requests: true, send_write_tokens_to_workflows: false, send_secrets_and_variables: true } }],
  ["secret-scanning", PUB, { ...PUB_GH, repo: { ...PUB_GH.repo, security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "disabled" } } } }],
  ["private-vuln-reporting", PUB, { ...PUB_GH, pvr: { enabled: false } }],
  ["branch-baseline", NOCI, { protection: { __err: NOT_PROTECTED } }],
  ["log-retention", {}, { retention: { days: 90 } }],
  ["org-baseline", {}, { org: { ...ORG, members_can_create_public_repositories: true } }],
];
const rowOf = (files: Record<string, string | null>, gh: Record<string, unknown>, id: string) =>
  JSON.parse(audit(files, gh, ["--json"]).out).rows.find((x: any) => x.id === id);

describe("lib/apply.ts", () => {
  test("oneWay names visibility, delete, transfer and rename; every call the 11 runnable rows emit is two-way", () => {
    expect(oneWay({ method: "DELETE", path: "repos/o/r" } as any)).not.toBe("");
    expect(oneWay({ method: "POST", path: "repos/o/r/transfer", fields: { new_owner: "x" } } as any)).not.toBe("");
    expect(oneWay({ method: "PATCH", path: "repos/o/r", fields: { private: false } })).not.toBe("");
    expect(oneWay({ method: "PATCH", path: "repos/o/r", input: { visibility: "public" } })).not.toBe("");
    expect(oneWay({ method: "PATCH", path: "repos/o/r", fields: { name: "x" } })).not.toBe("");
    expect(oneWay({ method: "PATCH", path: "repos/o/r", input: { archived: true } })).not.toBe("");
    const seen: string[] = [];
    for (const [id, files, gh] of RUNNABLE) {
      const row = rowOf(files, gh, id);
      expect(row.apply?.length).toBeGreaterThan(0);
      for (const c of row.apply) expect(oneWay(c)).toBe("");
      seen.push(id);
    }
    expect(seen.length).toBe(11);
  }, 30_000);

  const row = (id: string, status: any, apply?: any[]) => ({ id, status, ev: "e", ...(apply ? { apply } : {}) });
  const ret = { method: "PUT" as const, path: RET, fields: { days: 14 } };
  test("select runs an approved failing row with calls, and refuses everything else with a reason", () => {
    const rows = [row("log-retention", "fail", [ret]), row("deploy-keys", "fail"), row("x-pass", "pass", [ret]), row("x-na", "n.a.", [ret]),
      row("x-blocked", "blocked", [ret]), row("branch-baseline", "fail", [{ method: "PUT", path: "repos/o/r/branches/main/protection", input: {} }]),
      row("org-baseline", "fail", [{ method: "PATCH", path: "orgs/o", fields: { default_repository_permission: "read" } }]),
      row("other", "fail", [{ method: "PUT", path: "repos/o/r2/vulnerability-alerts" }]),
      row("dotdot", "fail", [{ method: "PUT", path: "repos/o/r/branches/../../../r2/protection" }]),
      row("door", "fail", [{ method: "PATCH", path: "repos/o/r", fields: { private: false } }])];
    expect(select(rows, ["log-retention"], "o/r", ".github/workflows/ci.yml")).toEqual({ run: [{ id: "log-retention", calls: [ret] }], refused: [] });
    const why = (id: string, ci: string | null = null) => {
      const s = select(rows, [id], "o/r", ci);
      expect(s.run).toEqual([]);
      return s.refused.map((r) => `${r.id} (${r.why})`).join();
    };
    expect(why("nope")).toBe("nope (not in the audit)");
    expect(why("deploy-keys")).toBe("deploy-keys (by hand)");
    expect(why("x-pass")).toBe("x-pass (already pass)");
    expect(why("x-na")).toBe("x-na (n.a.)");
    expect(why("x-blocked")).toBe("x-blocked (owner decision)"); // a plan decision (D6's words); and defence in depth: only `fail` runs, whatever it carries
    expect(why("branch-baseline", ".github/workflows/ci.yml")).toBe("branch-baseline (n.a.)"); // ci-flow's protect script owns it
    expect(select(rows, ["branch-baseline"], "o/r", null).run.length).toBe(1); // control: without CI it runs
    expect(why("org-baseline")).toBe("org-baseline (org-wide)");
    expect(why("other")).toBe("other (not this repo)");
    expect(why("dotdot")).toBe("dotdot (not this repo)");
    expect(why("door")).toBe("door (one-way door)");
    // one refusal refuses the whole set: nothing runs
    expect(select(rows, ["log-retention", "deploy-keys"], "o/r", null).run).toEqual([]);
  });
  test("method allowlist: only PUT, PATCH and POST, uppercase, run; DELETE is a one-way door, anything else unknown", () => {
    const why = (method: string) => {
      const s = select([row("x", "fail", [{ method, path: "repos/o/r/x" }])], ["x"], "o/r", null);
      return s.run.length ? "" : s.refused[0].why;
    };
    for (const m of ["PUT", "PATCH", "POST"]) expect(why(m)).toBe(""); // control
    for (const m of ["DELETE", "delete", "Delete"]) expect(why(m)).toBe("one-way door");
    for (const m of ["GET", "put", "Patch", "HEAD", ""]) expect(why(m)).toBe("unknown method");
    expect(oneWay({ method: "delete", path: "repos/o/r" })).not.toBe("");
    expect(oneWay({ method: "POST", path: "repos/o/r/transfer/" })).not.toBe("");
  });
  test("path guards: encoded, query, fragment, backslash, empty and dot segments are not this repo", () => {
    const why = (path: string) => {
      const s = select([row("x", "fail", [{ method: "PUT", path }])], ["x"], "o/r", null);
      return s.run.length ? "" : s.refused[0].why;
    };
    for (const p of ["repos/o/r", "repos/o/r/branches/main/protection", "repos/o/r/branches/a-b.c_d/protection"]) expect(why(p)).toBe(""); // control
    for (const p of ["repos/o/r/./x", "repos/o/r/branches/%2e%2e/%2e%2e/%2e%2e/r2/protection", "repos/o/r/x?y=1", "repos/o/r/branches/x#/protection",
      "repos/o/r/branches/x\\..\\y", "repos/o/r//x", "repos/o/r/"]) expect(`${p}: ${why(p)}`).toBe(`${p}: not this repo`);
  });
  test("oneWay reads a field's name before any [suffix]: private[] is still visibility", () => {
    expect(oneWay({ method: "PATCH", path: "repos/o/r", fields: { "private[]": "x" } })).not.toBe("");
    expect(oneWay({ method: "PATCH", path: "repos/o/r", fields: { "visibility[x]": "public" } })).not.toBe("");
    expect(oneWay({ method: "PATCH", path: "repos/o/r", fields: { "security_and_analysis[secret_scanning][status]": "enabled" } })).toBe(""); // control
  });
  test("argv: -F for numbers and booleans, -f with the raw string (no quoting: it is argv), one -f per array element, --input - for a body", () => {
    expect(argv(ret)).toEqual(["api", "-X", "PUT", RET, "-F", "days=14"]);
    expect(argv({ method: "PUT", path: "repos/o/r/x", fields: { a: "it's $(x) *", b: false } })).toEqual(["api", "-X", "PUT", "repos/o/r/x", "-f", "a=it's $(x) *", "-F", "b=false"]);
    expect(argv({ method: "PUT", path: "p", fields: { "patterns_allowed[]": ["a/b@*", "c/d@*"] } })).toEqual(["api", "-X", "PUT", "p", "-f", "patterns_allowed[]=a/b@*", "-f", "patterns_allowed[]=c/d@*"]);
    expect(argv({ method: "PUT", path: "p", input: { a: 1 } })).toEqual(["api", "-X", "PUT", "p", "--input", "-"]);
  });
  test("readback: verified only when the after-run reads pass; a missing row is not verified", () => {
    const before = [row("a", "fail"), row("b", "fail"), row("c", "fail")];
    const after = [row("a", "pass"), row("b", "fail")];
    expect(readback(before, after, ["a", "b", "c"])).toEqual([
      { id: "a", before: "fail", after: "pass", ok: true }, { id: "b", before: "fail", after: "fail", ok: false }, { id: "c", before: "fail", after: "missing", ok: false }]);
  });
});

describe("apply.ts end to end", () => {
  test("network isolation: the only gh on apply's PATH is the fake; without it there is no gh at all", () => {
    const r = apply({}, {}, ["--rows", "log-retention"]);
    const which = (PATH: string) => spawnSync("/bin/sh", ["-c", "command -v gh"], { env: { PATH }, encoding: "utf8" });
    const bin = r.path;
    expect(bin.includes(":")).toBe(false); // one private dir: nothing inherited, no /usr/bin (where Linux runners install gh)
    expect(readdirSync(bin).sort()).toEqual(["gh", ...ISOLATED_TOOLS].sort());
    expect(which(bin).stdout.trim()).toBe(join(bin, "gh"));
    // negative control: the same bin without the fake (same links, same targets) finds no gh at all
    const bare = mkdtempSync(join(ROOT, "bare-"));
    for (const t of ISOLATED_TOOLS) symlinkSync(readlinkSync(join(bin, t)), join(bare, t));
    expect(which(bare).status).not.toBe(0);
    expect(r.calls.trim().split("\n").length).toBeGreaterThan(10); // the audit's GETs reached the fake and were logged
  });
  test("(1) approved log-retention: one argv write, then a second audit reads it back as pass", () => {
    const r = apply({}, { retention: { days: 90, __after: { days: 14 } } }, ["--rows", "log-retention"]);
    expect(r.status).toBe(0);
    expect(writeLines(r.writes)).toEqual([`WRITE PUT ${RET} -F days=14`]);
    expect(r.out).toContain("## Read-back\n\n| row | before | after | verdict |\n|---|---|---|---|\n| log-retention | fail | pass | read back: pass |");
    const calls = r.calls.trim().split("\n");
    const put = calls.indexOf(`api -X PUT ${RET} -F days=14`), gets = calls.flatMap((l, i) => (l === `api ${RET}` ? [i] : []));
    expect(put).toBeGreaterThan(-1);
    expect(gets.length).toBeGreaterThanOrEqual(2); // two audit runs
    expect(gets.at(-1)!).toBeGreaterThan(put); // the read-back GET comes after the write
    expect(gets[0]).toBeLessThan(put);
  });
  test("(2) exit code is not verification: the write exits 0 but the server did not change → FAILED, exit 1", () => {
    const r = apply({}, { retention: { days: 90 } }, ["--rows", "log-retention"]);
    expect(r.status).toBe(1);
    expect(writeLines(r.writes).length).toBe(1);
    expect(r.out).toContain("| log-retention | fail | fail | FAILED: still fail — ");
  });
  test("(2b) a write lands, then the read-back audit cannot be read: exit 1 (never 2), the write listed as UNVERIFIED", () => {
    const r = apply({}, { retention: { days: 90, __wbreak: true } }, ["--rows", "log-retention"]);
    expect(writeLines(r.writes)).toEqual([`WRITE PUT ${RET} -F days=14`]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("## Read-back\n\n| row | before | after | verdict |\n|---|---|---|---|\n| log-retention | fail | unknown | UNVERIFIED: read-back failed — cannot read HEAD in ");
    expect(r.out).toMatch(/^skipped: .*dependabot-alerts \(already pass\)/m);
  });
  test("(2c) a write that gh refuses: the read-back still runs, exit 1, and the table shows each row's real state", () => {
    const r = apply({}, { retention: { days: 90, __after: { days: 14 } }, vuln: { __err: "gh: Not Found (HTTP 404)", __wfail: "gh: Forbidden (HTTP 403)" } },
      ["--rows", "log-retention,dependabot-alerts"]);
    expect(r.status).toBe(1);
    expect(writeLines(r.writes)).toEqual([`WRITE PUT ${RET} -F days=14`, "WRITE PUT repos/o/r/vulnerability-alerts "]);
    expect(r.out).toContain("dependabot-alerts: gh api -X PUT repos/o/r/vulnerability-alerts: gh: Forbidden (HTTP 403)");
    expect(r.out).toContain("| log-retention | fail | pass | read back: pass |");
    expect(r.out).toContain("| dependabot-alerts | fail | fail | FAILED: still fail — Dependabot alerts off |");
  });
  test("(3) only approved rows run: a failing runnable row not approved is skipped, and named", () => {
    const r = apply({}, { retention: { days: 90, __after: { days: 14 } }, vuln: { __err: "gh: Not Found (HTTP 404)" } }, ["--rows", "log-retention"]);
    expect(r.status).toBe(0);
    expect(r.writes).not.toContain("vulnerability-alerts");
    expect(writeLines(r.writes).length).toBe(1);
    const skip = /^skipped: (.*)$/m.exec(r.out)![1];
    expect(skip).toContain("dependabot-alerts (not approved)");
    expect(skip).toContain("deploy-keys (already pass)");
    expect(skip).not.toContain("log-retention");
  });
  test("(4) an id the audit does not have: exit 2, nothing written", () => {
    const r = apply({}, { retention: { days: 90 } }, ["--rows", "nope"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("nope (not in the audit)");
  });
  test("(5) a by-hand row approved: exit 2, nothing written, even beside a runnable one", () => {
    const r = apply({}, { retention: { days: 90 }, keys: [{ id: 1, title: "old deploy", read_only: false }] }, ["--rows", "log-retention,deploy-keys"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("deploy-keys (by hand)");
  });
  test("(6) branch-baseline without CI: the body goes on stdin as --input -, and reads back pass", () => {
    const r = apply(NOCI, { protection: { __err: NOT_PROTECTED, __after: GH_BASE.protection } }, ["--rows", "branch-baseline"]);
    expect(r.status).toBe(0);
    expect(writeLines(r.writes)).toEqual(["WRITE PUT repos/o/r/branches/main/protection --input -"]);
    const body = JSON.parse(r.writes.split("\n")[1]);
    expect(body.enforce_admins).toBe(true);
    expect(body.required_status_checks).toBe(null);
    expect(r.out).toContain("| branch-baseline | fail | pass | read back: pass |");
  });
  test("(7) single writer: with CI, branch-baseline belongs to ci-flow's protect script → exit 2, nothing written", () => {
    const r = apply({}, { protection: { __err: NOT_PROTECTED } }, ["--rows", "branch-baseline"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("branch-baseline (n.a.)");
  });
  test("a row the plan blocks is refused as an owner decision, never run", () => {
    const r = apply({}, FREE_GH, ["--rows", "plan-protection"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("plan-protection (owner decision)");
  });
  test("a row the plan blocks is skipped as an owner decision when another row runs", () => {
    const r = apply({}, { ...FREE_GH, retention: { days: 90, __after: { days: 14 } } }, ["--rows", "log-retention"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^skipped: .*plan-protection \(owner decision\)/m);
    expect(r.out).not.toContain("plan-protection (by hand)");
  });
  test("(8) everything passing: approving a row writes nothing (already pass → exit 2)", () => {
    const r = apply({}, {}, ["--rows", "log-retention"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("log-retention (already pass)");
  });
  test("org-wide is refused: base is org-owned, so actions-policy's calls target orgs/o", () => {
    const r = apply({}, { actperm: { enabled: true, allowed_actions: "all", sha_pinning_required: true } }, ["--rows", "actions-policy"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("actions-policy (org-wide)");
  });
  test("a hostile default branch is passed as one argv element, never through a shell", () => {
    const evil = "x';touch pwn;'";
    const r = apply(NOCI, { repo: { ...REPO, default_branch: evil }, protection: { __err: NOT_PROTECTED } }, ["--rows", "branch-baseline"]);
    expect(writeLines(r.writes)).toEqual([`WRITE PUT repos/o/r/branches/${evil}/protection --input -`]);
    expect(existsSync(join(process.cwd(), "pwn"))).toBe(false); // apply runs with this cwd; a shell would have created it here
  });
  test("usage: no --rows, or an empty list → exit 2, nothing written", () => {
    for (const extra of [[], ["--rows", ""], ["--rows"]]) {
      const r = apply({}, { retention: { days: 90 } }, extra);
      expect(r.status).toBe(2);
      expect(r.writes).toBe("");
    }
  });
  test("an unreadable ref: the audit exits 2, apply exits 2 with the audit's message, nothing written", () => {
    const r = apply({}, { retention: { days: 90 } }, ["--rows", "log-retention", "--ref", "no-such-ref"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
    expect(r.out).toContain("cannot read no-such-ref");
  });
});
