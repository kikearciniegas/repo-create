// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// Runs only the audit rows the owner approved, as `gh api` argv (never a shell,
// never --admin), then re-runs the audit: a row is verified only when the second
// audit reads it `pass` — its GETs are the read-back, never a write's exit code.
// --propose prints the proposal table (lib/proposal.ts) for the owner and writes nothing.
// Exit 0 every approved row verified; 1 any FAILED or UNVERIFIED (something was
// written); 2 only when nothing was written: usage, a refusal, an unreadable first audit.
// Reasons a row is refused or skipped: not approved, already pass, n.a., by hand,
// owner decision, org-wide, one-way door, unknown method, not this repo, not in the audit.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { argv as ghArgv, blocker, readback, select, type Row } from "./lib/apply.ts";
import { cell, renderProposal } from "./lib/proposal.ts";

function usage(): never {
  console.error("usage: bun apply.ts <repo-path> [--ref <git-ref>] [--repo <owner/name>] (--rows <id,id,…> | --propose)\n" +
    "  refused or skipped as: not approved, already pass, n.a., by hand, owner decision, org-wide, one-way door, unknown method, not this repo, not in the audit");
  process.exit(2);
}
const args = process.argv.slice(2);
let repoPath = "", ref = "", slugArg = "", ids: string[] = [], propose = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--ref") ref = args[++i] ?? usage();
  else if (a === "--repo") slugArg = args[++i] ?? usage();
  else if (a === "--propose") propose = true;
  else if (a === "--rows") ids = [...new Set((args[++i] ?? usage()).split(",").map((s) => s.trim()).filter(Boolean))];
  else if (a.startsWith("-") || repoPath) usage();
  else repoPath = a;
}
if (!repoPath || (propose ? ids.length : !ids.length)) usage();

type AuditJson = { slug: string; ci: string | null; rows: Row[] };
/** The audit's verdicts, or its error text when it cannot be read. */
function auditJson(): AuditJson | string {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "audit.ts"), repoPath, ...(ref ? ["--ref", ref] : []), ...(slugArg ? ["--repo", slugArg] : []), "--json"],
    { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) return r.stderr || `audit exited ${r.status}\n`;
  try { return JSON.parse(r.stdout); } catch { return "audit --json output not readable\n"; }
}

const before = auditJson();
if (typeof before === "string") { process.stderr.write(before); process.exit(2); }
if (propose) { console.log(renderProposal(before)); process.exit(0); } // read-only: no write is reachable from here
const { run, refused } = select(before.rows, ids, before.slug, before.ci);
if (refused.length) {
  console.error(`refused, nothing written: ${refused.map((r) => `${r.id} (${r.why})`).join(", ")}`);
  process.exit(2);
}
for (const { id, calls } of run) for (const c of calls) {
  const r = spawnSync("gh", ghArgv(c), { encoding: "utf8", ...(c.input === undefined ? {} : { input: JSON.stringify(c.input) }) });
  if (r.status !== 0) { console.error(`${id}: gh ${ghArgv(c).join(" ")}: ${(r.stderr || String(r.error ?? "failed")).trim()}`); break; } // the read-back reports the row
}

// From here on something may have been written: every outcome exits 0 or 1, never 2.
const after = auditJson();
console.log("## Read-back\n\n| row | before | after | verdict |\n|---|---|---|---|");
let ok = typeof after !== "string";
if (typeof after === "string") {
  process.stderr.write(after);
  for (const { id } of run) console.log(`| ${id} | fail | unknown | ${cell(`UNVERIFIED: read-back failed — ${after.trim().split("\n")[0]}`)} |`);
} else for (const x of readback(before.rows, after.rows, ids)) {
  const ev = after.rows.find((r) => r.id === x.id)?.ev ?? "not in the second audit";
  ok &&= x.ok;
  console.log(`| ${x.id} | ${x.before} | ${x.after} | ${x.ok ? "read back: pass" : cell(`FAILED: still ${x.after} — ${ev}`)} |`);
}
const skipped = before.rows.filter((r) => !ids.includes(r.id)).map((r) => `${r.id} (${blocker(r, before.slug, before.ci) || "not approved"})`);
console.log(`\nskipped: ${skipped.join(", ") || "none"}`);
process.exit(ok ? 0 : 1);
