// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// The proposal table (spec §6, D6): one row per audit check, rendered from
// `audit.ts --json`; `apply.ts --propose` prints it and writes nothing.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREE_GH, ORG, PUB_GH, harness } from "./fixture";
import { IMPACT, renderProposal } from "../skills/repo-create/scripts/lib/proposal.ts";

const ROOT = mkdtempSync(join(tmpdir(), "repo-create-proposal-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const { audit, apply } = harness(ROOT);

const HEADER = ["setting", "current", "recommended", "why", "cost / impact", "available on this plan", "one-way door"];
const RET_CMD = "gh api -X PUT repos/o/r/actions/permissions/artifact-and-log-retention -F days=14";
// Free private repo: plan rows blocked, retention 90 days and alerts off (runnable), a writable deploy key (by hand).
const GH = { ...FREE_GH, retention: { days: 90 }, vuln: { __err: "gh: Not Found (HTTP 404)" }, keys: [{ id: 1, title: "push", read_only: false }] };
/** Cells of a markdown row, split on unescaped pipes. */
const cells = (line: string) => line.split(/(?<!\\)\|/).slice(1, -1).map((s) => s.trim());
const table = (md: string) => {
  const lines = md.split("\n").filter((l) => l.startsWith("| "));
  return { header: cells(lines[0]), rows: new Map(lines.slice(1).map((l) => [cells(l)[0], cells(l)])) };
};

describe("proposal", () => {
  test("IMPACT has exactly the audit's check ids, both directions", () => {
    const ids = JSON.parse(audit({}, {}, ["--json"]).out).rows.map((r: any) => r.id).sort();
    expect(ids.length).toBe(24);
    expect(Object.keys(IMPACT).sort()).toEqual(ids);
    for (const v of Object.values(IMPACT)) expect(v).toMatch(/^POLICY §\d [^;]+; cost: [^;]+; risk: [^;]+$/);
  });

  test("renderProposal: 7 columns in spec §6 order, one cell per D6 rule", () => {
    const j = JSON.parse(audit({}, GH, ["--json"]).out);
    const { header, rows } = table(renderProposal(j));
    expect(header).toEqual(HEADER);
    expect(rows.size).toBe(24);
    const col = (id: string, c: string) => rows.get(id)![HEADER.indexOf(c)];
    // runnable → the cmd itself
    expect(col("log-retention", "recommended")).toBe(RET_CMD);
    expect(col("dependabot-alerts", "recommended")).toBe("gh api -X PUT repos/o/r/vulnerability-alerts");
    expect(col("log-retention", "current")).toMatch(/^fail: artifacts and logs kept 90 days/);
    // blocked → the owner's decision, not on this plan
    expect(col("plan-protection", "recommended")).toMatch(/^owner decision: \(a\) move the repo to the Team org/);
    expect(col("plan-protection", "available on this plan")).toBe("no (plan)");
    // pass → keep
    expect(col("merge-hygiene", "recommended")).toBe("keep");
    expect(col("merge-hygiene", "available on this plan")).toBe("yes");
    // fail with no calls → by hand
    expect(col("deploy-keys", "current")).toMatch(/^fail: /);
    expect(col("deploy-keys", "recommended")).toMatch(/^by hand: \S/);
    // n.a.
    expect(col("secret-scanning", "recommended")).toBe("—");
    expect(col("secret-scanning", "available on this plan")).toBe("n.a.");
    // why / cost come from IMPACT, split at "; cost:"
    expect(col("log-retention", "why")).toBe("POLICY §1 Always on: retention ≤ 30 days");
    expect(col("log-retention", "cost / impact")).toBe("cost: none (storage falls); risk: screenshots, traces and unredacted output readable for 90 days");
    for (const r of rows.values()) expect(r[6]).toBe("no");
  }, 30_000);

  test("an org-wide fix apply refuses (R3) is offered by hand, not as a runnable command", () => {
    const j = JSON.parse(audit({}, { org: { ...ORG, members_can_create_public_repositories: true } }, ["--json"]).out);
    expect(j.rows.find((r: any) => r.id === "org-baseline").apply?.length).toBeGreaterThan(0);
    expect(table(renderProposal(j)).rows.get("org-baseline")![2]).toMatch(/^by hand: .*orgs\/o/);
  });

  test("a pass that carries a suggestion shows it beside keep, never as a runnable command", () => {
    const gh = { ...PUB_GH, repo: { ...PUB_GH.repo, name: "ab-1234567" } };
    const j = JSON.parse(audit({ "SECURITY.md": "Report privately via GitHub private vulnerability reporting.\n" }, gh, ["--json"]).out);
    const r = j.rows.find((x: any) => x.id === "repo-name");
    expect(r.status).toBe("pass");
    expect(table(renderProposal(j)).rows.get("repo-name")![2]).toBe(`keep (suggestion: ${r.fix})`);
    expect(r.fix).toContain("gh repo rename <product-name>");
  });

  test("a failed read with no fix names the action: re-run the audit", () => {
    const j = JSON.parse(audit({}, { retention: { __err: "gh: boom (HTTP 500)" } }, ["--json"]).out);
    const r = j.rows.find((x: any) => x.id === "log-retention");
    expect([r.status, r.fix]).toEqual(["fail", undefined]);
    expect(table(renderProposal(j)).rows.get("log-retention")![2]).toBe("by hand: re-run the audit once the setting can be read");
  });

  test("a blocked row with no fix names the owner's decision by its evidence", () => {
    const j = JSON.parse(audit({}, { retention: { __err: FREE_GH.protection.__err } }, ["--json"]).out);
    const r = j.rows.find((x: any) => x.id === "log-retention");
    expect([r.status, r.fix]).toEqual(["blocked", undefined]);
    expect(table(renderProposal(j)).rows.get("log-retention")![2]).toBe(`owner decision: ${r.ev.replace(/\|/g, "\\|").replace(/\n/g, " ")}`);
    expect(r.ev).toContain("Upgrade to GitHub Pro");
  });

  const row = (over: object) => ({ slug: "o/r", ci: null, rows: [{ id: "log-retention", status: "fail" as const, ev: "e", fix: "f", ...over }] });
  test("a call that is a one-way door reads yes", () => {
    const md = renderProposal(row({ apply: [{ method: "PATCH", path: "repos/o/r", fields: { private: false } }] }));
    expect(table(md).rows.get("log-retention")![6]).toBe("yes");
  });

  test("a pipe or a newline in a cell is escaped like audit.ts's report", () => {
    const md = renderProposal(row({ ev: "a|b\nc", fix: "x | y" }));
    const lines = md.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[2]).toContain("| fail: a\\|b c |");
    expect(cells(lines[2]).length).toBe(7);
  });

  test("apply.ts --propose prints the table, writes nothing, exits 0", () => {
    const r = apply({}, GH, ["--propose"]);
    expect(r.status).toBe(0);
    expect(r.writes).toBe("");
    expect(r.calls).not.toMatch(/ -X /);
    expect(r.out).not.toContain("Read-back");
    const { header, rows } = table(r.out);
    expect(header).toEqual(HEADER);
    expect(rows.size).toBe(24);
    expect(rows.get("log-retention")![2]).toBe(RET_CMD);
  });

  test("--propose with --rows is a usage error, nothing written", () => {
    const r = apply({}, GH, ["--propose", "--rows", "log-retention"]);
    expect(r.status).toBe(2);
    expect(r.writes).toBe("");
  });
});
