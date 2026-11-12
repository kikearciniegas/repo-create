// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// Read-only audit of a repository's GitHub configuration. Prints, never applies.
//
// Reads the tree at <ref> (default origin/main) through `git show` — never the
// working tree — plus `gh api` GETs. Anything it cannot determine is FAIL, never
// PASS; a feature the plan × visibility lacks is `blocked` when the project needs
// it, and --strict ignores `blocked`. Exit 0 always (a report); --strict exits 1
// on any FAIL; 2 on usage, an unreadable ref or a bad --repo.
import { readFileSync } from "node:fs";
import { Blocked, ghGet, prefetch, run, type GhRes } from "./lib/gh.ts";
import { DEPLOYISH } from "./lib/deploy.ts";
import { GITLEAKS as GL, NOREPLY, gates, hookDir, live, reachable } from "./lib/hooks.ts";
import { ownerReport } from "./lib/owner.ts";
import { budgetsPath, capsFor, minutesOf, planOf, QUOTA, randomName, usagePath } from "./lib/plans.ts";

type Status = "pass" | "fail" | "n.a." | "blocked";
/** A write a runnable fix makes; apply.ts executes it as argv, never through a shell. A string[] value repeats the field. */
type Call = { method: "PUT" | "PATCH" | "POST"; path: string; fields?: Record<string, string | boolean | number | string[]>; input?: unknown };
type Fix = { cmd: string; calls: Call[] };
type Row = { id: string; status: Status; ev: string; fix?: string; apply?: Call[] };

function usage(code: number): never {
  console.error("usage: bun audit.ts <repo-path> [--ref <git-ref>] [--repo <owner/name>] [--strict] [--json]\n       bun audit.ts --owner <login>   # before creating a repo: plan, limits, counts, minutes");
  process.exit(code);
}
const argv = process.argv.slice(2);
let repoPath = "", ref = "origin/main", slugArg = "", strict = false, ownerArg = "", json = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--ref") ref = argv[++i] ?? usage(2);
  else if (a === "--repo") slugArg = argv[++i] ?? usage(2);
  else if (a === "--strict") strict = true;
  else if (a === "--json") json = true;
  else if (a === "--owner") ownerArg = argv[++i] ?? usage(2);
  else if (a === "-h" || a === "--help") usage(0);
  else if (!repoPath) repoPath = a;
  else usage(2);
}
if (!repoPath && !ownerArg) usage(2);

const git = (...a: string[]) => run("git", ["-C", repoPath, ...a]);

if (ownerArg) ownerReport(ownerArg);

const ls = git("ls-tree", "-r", "--name-only", ref);
if (!ls.ok) { console.error(`cannot read ${ref} in ${repoPath}: ${ls.err.trim()}`); process.exit(2); }
const FILES = ls.out.split("\n").filter(Boolean);
const cache = new Map<string, string | null>();
const show = (p: string): string | null => {
  if (!cache.has(p)) { const r = git("show", `${ref}:${p}`); cache.set(p, r.ok ? r.out : null); }
  return cache.get(p)!;
};
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// ---------------------------------------------------------------- workflows
type WF = { path: string; y: any; on: Record<string, any> };
const parseErrors: string[] = [];
const WFS: WF[] = FILES.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).flatMap((path) => {
  const text = show(path) ?? "";
  try {
    const y = Bun.YAML.parse(text) as any;
    const o = y?.on ?? y?.true; // YAML 1.1 parsers read a bare `on` as true
    const on = typeof o === "string" ? { [o]: null } : Array.isArray(o) ? Object.fromEntries(o.map((k) => [k, null])) : (o ?? {});
    return [{ path, y, on }];
  } catch (e) { parseErrors.push(`${path}: ${(e as Error).message}`); return []; }
});
type Job = { id: string; j: any; wf: WF };
const jobsOf = (wf?: WF): Job[] => (wf ? Object.entries(wf.y?.jobs ?? {}).map(([id, j]) => ({ id, j, wf })) : []);
const stepsOf = (j: any): any[] => (Array.isArray(j?.steps) ? j.steps : []);
/** Every remote action a workflow uses (local ./ and docker:// excluded). */
const USES = WFS.flatMap((w) => jobsOf(w).flatMap((x) => [x.j?.uses, ...stepsOf(x.j).map((s) => s?.uses)])
  .filter((u): u is string => typeof u === "string" && !/^(\.\/|docker:\/\/)/.test(u)));

const CI = WFS.filter((w) => "pull_request" in w.on).sort((a, b) => jobsOf(b).length - jobsOf(a).length)[0];
const DEPLOY = WFS.find((w) => w !== CI && (/deploy/i.test(base(w.path)) || /deploy/i.test(String(w.y?.name ?? ""))));

// ------------------------------------------------------------------ GitHub
const slug = slugArg || (() => {
  const u = git("remote", "get-url", "origin").out.trim();
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(u)?.[1] ?? "";
})();
if (slug && !/^[\w.-]+\/[\w.-]+$/.test(slug)) { console.error(`--repo must be owner/name: ${slug}`); process.exit(2); }
// Values from the tree or the API go into printed commands the owner may paste: quote them.
const shq = (s: string) => /^[\w.\/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
const sq = (t: string) => /^[A-Za-z0-9_.\/=@*:,-]+$/.test(t) ? t : `'${t.replace(/'/g, `'\\''`)}'`;
/** A runnable fix: the printed command and the structured call are built from one source. */
const W = (method: Call["method"], path: string, fields?: Call["fields"], input?: unknown): Fix => ({
  cmd: `gh api -X ${method} ${path.split("/").map(shq).join("/")}` +
    Object.entries(fields ?? {}).flatMap(([k, v]) => [v].flat().map((x) => ` ${typeof x === "string" ? "-f" : "-F"} ${sq(`${k}=${x}`)}`)).join("") +
    (input === undefined ? "" : ` --input - <<<'${JSON.stringify(input).replace(/'/g, `'\\''`)}'`),
  calls: [{ method, path, ...(fields ? { fields } : {}), ...(input === undefined ? {} : { input }) }],
});
let ghError = slug ? "" : "no GitHub slug (origin is not a github.com URL; pass --repo)";
let defaultBranch = /\/([\w.-]+)$/.exec(ref)?.[1] ?? "main";
if (defaultBranch === "HEAD") defaultBranch = "main";
let protection: any, repoJson: any, protRes: GhRes | undefined;
if (slug) {
  const r = ghGet(`repos/${slug}`);
  if (r.ok) { repoJson = r.data; defaultBranch = repoJson?.default_branch ?? defaultBranch; } else ghError = r.msg;
}
const isPublic = repoJson?.private === false;
const owner: string = repoJson?.owner?.login ?? slug.split("/")[0] ?? "";
const isOrg = repoJson?.owner?.type === "Organization";
// Only what the checks below read for this visibility and tree.
if (repoJson) await prefetch([
  `branches/${defaultBranch}/protection`, ...(CI ? [] : [`rules/branches/${defaultBranch}`]), "actions/secrets?per_page=100",
  "vulnerability-alerts", "automated-security-fixes", "actions/permissions", "actions/permissions/workflow",
  ...(isPublic ? ["actions/permissions/fork-pr-contributor-approval", "private-vulnerability-reporting"] : ["actions/permissions/fork-pr-workflows-private-repos"]),
  "actions/permissions/artifact-and-log-retention", "keys?per_page=100", "hooks?per_page=100", "environments?per_page=100",
  `collaborators?affiliation=${isOrg ? "outside" : "direct"}&per_page=100`,
].map((p) => `repos/${slug}/${p}`).concat(isOrg ? `orgs/${owner}` : "user",
  isPublic ? [] : [usagePath(owner, isOrg), ...(isOrg ? [budgetsPath(owner)] : [])]));
if (slug) {
  protRes = ghGet(`repos/${slug}/branches/${defaultBranch}/protection`);
  if (protRes.ok) protection = protRes.data;
}
const protIsBlocked = protRes?.ok === false && protRes.kind === "blocked";

// ------------------------------------------------------------------ checks
const rows: Row[] = [];
type Verdict = [Status, string, (string | Fix)?];
const pass = (ev: string): Verdict => ["pass", ev];
/** `fix` is a suggested command or action, printed under Hardening; the audit never runs it. */
const fail = (ev: string, fix?: string | Fix): Verdict => ["fail", ev, fix];
const na = (ev: string): Verdict => ["n.a.", ev];
/** A row judged on a field GitHub did not return still prints its fix, but carries no apply: nothing is written on a guess. */
const known = (ok: boolean, fix: Fix): string | Fix => (ok ? fix : fix.cmd);
/** Every check needs the repository unless it passes `repoNeeded = false`. */
function check(id: string, fn: () => Verdict, repoNeeded = true) {
  try { if (repoNeeded) needRepo(); const [status, ev, fix] = fn(); rows.push({ id, status, ev, ...(typeof fix === "object" ? { fix: fix.cmd, apply: fix.calls } : { fix }) }); }
  catch (e) {
    if (e instanceof Blocked) rows.push({ id, status: "blocked", ev: e.message });
    else rows.push({ id, status: "fail", ev: `could not determine: ${(e as Error).message}` });
  }
}

// ------------------------------------------------- repository configuration
// Settings live outside the tree (POLICY.md §1). Each row is judged against
// what the owner's PLAN gives a repo of this VISIBILITY (GitHub docs, checked
// 2026-11-02) and against what the PROJECT needs, read from its tree:
//   plan × visibility lacks it, project needs it  -> blocked, naming the options
//   plan × visibility lacks it, project does not  -> n.a., saying why
//   available but not set                         -> FAIL, with the fix command
// The owner's private folder labels (POLICY.md §1), one per line, kept outside any repo. No file: nothing matches.
const PREFIX_WORDS = (() => {
  try {
    return readFileSync(process.env.REPO_CREATE_PREFIXES_FILE ?? `${process.env.HOME}/.config/ci-flow/private-prefixes`, "utf8").split("\n").map((s) => s.trim().replace(/[-_]$/, "")).filter(Boolean);
  } catch {
    return [];
  }
})();
const PREFIX = PREFIX_WORDS.length ? new RegExp(`^(${PREFIX_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[-_]`, "i") : /(?!)/;
const visibility = repoJson ? (isPublic ? "public" : "private") : "unknown";
const needRepo = () => { if (!repoJson) throw new Error(ghError || "repository not readable"); };
const refuse = (r: GhRes & { ok: false }): never => { if (r.kind === "blocked") throw new Blocked(r.msg); throw new Error(r.msg); };
const must = (r: GhRes) => (r.ok ? r.data : refuse(r));
const R = (p: string) => ghGet(`repos/${slug}/${p}`);

// The plan of a user account is readable only by that user with the `user` scope;
// a private repo refused protection "with an upgrade message" is on Free.
const ownerRes = !repoJson ? undefined : isOrg ? ghGet(`orgs/${owner}`) : ghGet("user");
const ownerData = ownerRes?.ok && (isOrg || ownerRes.data?.login === owner) ? ownerRes.data : undefined;
let plan = planOf(ownerData?.plan?.name), planSource = plan ? (isOrg ? `orgs/${owner}` : "the account's own plan") : "";
if (!plan && !isPublic && protIsBlocked) {
  plan = "free"; planSource = "inferred: GitHub refuses protection on this private repo with an upgrade message";
} else if (!plan && repoJson && !isPublic && protRes && (protRes.ok || (protRes.kind === "missing" && /Branch not protected/i.test(protRes.msg)))) {
  // Only GitHub's "Branch not protected" 404 says the feature exists; any other 404 (no such branch, no access) stays unknown.
  // Same rule and assumption as lib/owner.ts: Free answers a private repo's protection with an upgrade message, never 200 or 404.
  plan = isOrg ? "team" : "pro"; planSource = "inferred: protection is readable on this private repo";
}
const CAPS = capsFor(plan, isPublic);
let minutesWarn = "";

// What the project needs, from its tree and its secrets (DEPLOYISH: lib/deploy.ts).
const secRes = repoJson ? R("actions/secrets?per_page=100") : undefined;
const repoSecrets: string[] = secRes?.ok ? (secRes.data?.secrets ?? []).map((s: any) => String(s.name)) : [];
const deploySecrets = repoSecrets.filter((n) => DEPLOYISH.test(n));
const needsGate = !!CI, needsEnv = !!DEPLOY || deploySecrets.length > 0;
const OPTIONS = isOrg
  ? `upgrade the ${owner} org to Team`
  : "(a) move the repo to the Team org — owner rule: when it gains a deploy credential or an expensive required job; " +
    "(b) Pro, US$4/month, covers every private repo of this account; (c) make it public — a one-way door " +
    "(POLICY.md §1: full-history gitleaks, no client data); (d) accept the risk this row names";

check("plan-detected", () => {
  const mins = isPublic ? "free on standard runners" : plan ? `${QUOTA[plan]} Linux min/month${isOrg ? " shared by the org" : ""}` : "?";
  const caps = `protection ${CAPS.protection ? "yes" : "no"}, environments ${CAPS.environments ? "yes" : "no"}, secret scanning ${CAPS.secretScanning}, CodeQL ${CAPS.codeql}, Actions ${mins}`;
  if (plan) return pass(`${plan} (${planSource}); a ${visibility} repo gets: ${caps}`);
  if (isPublic) return pass(`plan not readable; a public repo gets: ${caps}`);
  return fail(`plan not readable for a private repo (${ownerRes && !ownerRes.ok ? ownerRes.msg : "no plan field"})`,
    isOrg ? `read orgs/${owner} with an org-owner token` : "gh auth refresh -h github.com -s user");
});
const planRow = (has: boolean, need: boolean, what: string, why: string, risk: string): Verdict => {
  if (!isPublic && !plan) throw new Error("plan unknown — see plan-detected");
  const on = isPublic ? "public repos" : `${plan} private repos`;
  if (has) return pass(`${what}: available on ${on}`);
  if (parseErrors.length) throw new Error(`workflow not parsed, so the project's needs are unknown: ${parseErrors.join("; ")}`);
  if (!need) return na(`${what}: not on ${on}; not needed (${why})`);
  return ["blocked", `${what}: not on ${on}, and needed (${why}). Without it: ${risk}`, OPTIONS];
};
check("plan-protection", () => planRow(CAPS.protection, needsGate, "branch protection / rulesets",
  needsGate ? `${CI!.path} runs on pull requests` : "no pull-request workflow to gate merges on",
  "CI only reports, merges never wait for it, the default branch can be force-pushed or deleted, and a main-push rerun finds a broken merge only after it lands"));
check("plan-environments", () => planRow(CAPS.environments, needsEnv, "environments + environment secrets",
  DEPLOY ? `${DEPLOY.path} deploys` : deploySecrets.length ? `deploy-like repository secret(s): ${deploySecrets.join(", ")}` : "no deploy workflow or deploy-like secret",
  "deploy credentials are repository secrets that a workflow on any branch can read"));
check("plan-minutes", () => {
  if (isPublic) return pass("public repo: standard GitHub-hosted runners are free");
  if (!plan) throw new Error("plan unknown — see plan-detected");
  const u = minutesOf(owner, isOrg, plan);
  const ev = `${u.month}: this repo ${u.byRepo(repoJson.name)} min, ${u.line}`;
  minutesWarn = u.warn;
  if (u.warn && !(Number(u.budget) > 0))
    return fail(`${ev} — Actions stops at the quota`, isOrg
      ? `set an Actions budget with stop-usage on: https://github.com/organizations/${owner}/settings/billing/budgets (an excess Linux minute costs about US$0.006)`
      : "gate expensive jobs to ready PRs and skip docs-only changes (SKILL.md), or Pro for 3,000 min");
  return pass(ev);
});

// Naming lifecycle: see randomName in lib/plans.ts.
// shortcut: a name is "random-looking" by shape only (adjective-noun-digits, or a
// letters-hex id); a meaningful private name that is not a folder label passes —
// whether it leaks the product is the owner's call, not a regex's.
const RANDOMISH = /^[a-z]+-[a-z]+-\d{2,4}$|^[a-z]{1,4}-[0-9a-f]{6,}$/i;
const renameFix = (to: string, why: string) =>
  `${why}: gh repo rename ${to} -R ${slug} && git -C ${shq(repoPath)} remote set-url origin https://github.com/${owner}/${to}.git  # every other clone too; GitHub redirects the old name, do not rely on it`;
check("repo-name", () => {
  const r = repoJson;
  if (PREFIX.test(r.name)) return fail(`${slug}: the name carries a private folder label`, renameFix(randomName(), "rename to a random development name"));
  if (isPublic && RANDOMISH.test(r.name)) return ["pass", `${r.name}: public with a development name`, renameFix("<product-name>", "public now, so the product name can replace the development name")];
  return pass(isPublic ? `${r.name} (public: the product name is fine)` : RANDOMISH.test(r.name) ? `${r.name}: random development name` : `${r.name} — private: keep product, client and folder names out until launch (${randomName()} would do)`);
});
check("merge-hygiene", () => {
  const r = repoJson;
  const fix = W("PATCH", `repos/${slug}`, { delete_branch_on_merge: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false });
  // GitHub returns these to admins only; absent is unknown, never "off".
  if (!["delete_branch_on_merge", "allow_squash_merge", "allow_merge_commit", "allow_rebase_merge"].every((k) => typeof r[k] === "boolean"))
    return fail(`${slug}: merge settings not returned (needs admin)`, fix.cmd);
  const methods = ["allow_squash_merge", "allow_merge_commit", "allow_rebase_merge"].filter((k) => r[k] === true);
  const m = [r.delete_branch_on_merge === true ? "" : "merged branches are not deleted", methods.length === 1 ? "" : `${methods.length} merge methods enabled`].filter(Boolean);
  return m.length
    ? fail(`${slug}: ${m.join(", ")}`, fix)
    : pass(`branches deleted on merge, one merge method (${methods[0].replace(/^allow_|_merge$/g, "")})`);
});
check("dependabot-alerts", () => {
  const r = R("vulnerability-alerts"); // 204 = on, 404 = off (documented)
  if (r.ok) return pass("Dependabot alerts on");
  return r.kind === "missing" ? fail("Dependabot alerts off", W("PUT", `repos/${slug}/vulnerability-alerts`)) : refuse(r);
});
check("dependabot-security-updates", () => {
  const d = must(R("automated-security-fixes"));
  return d?.enabled === true && d?.paused !== true ? pass("on")
    : fail(`Dependabot security updates ${d?.enabled ? "paused" : "off"}`, known(typeof d?.enabled === "boolean", W("PUT", `repos/${slug}/automated-security-fixes`)));
});
check("actions-token", () => {
  const d = must(R("actions/permissions/workflow"));
  const m = [d?.default_workflow_permissions === "read" ? "" : `default GITHUB_TOKEN is ${d?.default_workflow_permissions}`,
    d?.can_approve_pull_request_reviews === false ? "" : "Actions can approve pull requests"].filter(Boolean);
  return m.length
    ? fail(m.join(", "), known(typeof d?.default_workflow_permissions === "string" && typeof d?.can_approve_pull_request_reviews === "boolean",
      W("PUT", `repos/${slug}/actions/permissions/workflow`, { default_workflow_permissions: "read", can_approve_pull_request_reviews: false })))
    : pass("read-only GITHUB_TOKEN, Actions cannot approve PRs");
});
const usedActions = [...new Set(USES.map((u) => u.split("@")[0].split("/").slice(0, 2).join("/")))].sort();
check("actions-policy", () => {
  const d = must(R("actions/permissions"));
  if (d?.enabled === false) return pass("Actions disabled for this repo");
  // "selected" can still allow everything: a wildcard-only pattern, or every verified creator's actions.
  const sel = d?.allowed_actions === "selected" ? must(R("actions/permissions/selected-actions")) : undefined;
  if (sel && (typeof sel.verified_allowed !== "boolean" || !Array.isArray(sel.patterns_allowed))) throw new Error("selected-actions policy not returned (unknown)");
  const wild = sel?.patterns_allowed.find((p: string) => /^\*+([\/@]|$)/.test(p)); // owner part is a wildcard: *, */*, */*@v*
  const m = [typeof d?.allowed_actions !== "string" ? "allowed-actions policy not returned (unknown)" : d.allowed_actions === "all" ? "any action from any owner may run" : "",
    wild ? `selected, but pattern ${wild} allows any action` : "",
    sel?.verified_allowed ? "selected, but every verified creator's actions are allowed" : "",
    d?.sha_pinning_required === true ? "" : d?.sha_pinning_required === undefined ? "SHA-pinning policy not returned (unknown)" : "full-SHA pinning not enforced"].filter(Boolean);
  const third = usedActions.filter((a) => /^[\w.-]+\/[\w.-]+$/.test(a) && !/^(actions|github)\//.test(a));
  const scope = isOrg ? `orgs/${owner}` : `repos/${slug}`;
  const perm = W("PUT", `${scope}/actions/permissions`, { ...(isOrg ? { enabled_repositories: "all" } : { enabled: true }), allowed_actions: "selected", sha_pinning_required: true });
  const allow = W("PUT", `${scope}/actions/permissions/selected-actions`, { github_owned_allowed: true, verified_allowed: false, ...(third.length ? { "patterns_allowed[]": third.map((a) => `${a}@*`) } : {}) });
  const fix: Fix = { cmd: `${isOrg ? "ORG-WIDE — pin every repo's actions to SHAs first (actions-sha-pinned), or their CI stops: " : ""}${perm.cmd} && ${allow.cmd}`, calls: [...perm.calls, ...allow.calls] };
  return m.length ? fail(`${m.join(", ")} (workflows use: ${usedActions.join(", ") || "none"})`, known(typeof d?.allowed_actions === "string" && typeof d?.sha_pinning_required === "boolean", fix)) : pass(`allowed: ${d.allowed_actions}, full-SHA pinning enforced`);
});
check("fork-pr-policy", () => {
  if (isPublic) {
    const raw = must(R("actions/permissions/fork-pr-contributor-approval"))?.approval_policy, p = String(raw);
    return ["first_time_contributors", "all_external_contributors"].includes(p) ? pass(`public: fork PR workflows wait for approval (${p})`)
      : fail(`public: most outside contributors' workflows run without approval (${p})`, known(typeof raw === "string", W("PUT", `repos/${slug}/actions/permissions/fork-pr-contributor-approval`, { approval_policy: "all_external_contributors" })));
  }
  const d = must(R("actions/permissions/fork-pr-workflows-private-repos"));
  const keys = ["run_workflows_from_fork_pull_requests", "send_write_tokens_to_workflows", "send_secrets_and_variables"];
  if (keys.some((k) => typeof d?.[k] !== "boolean")) throw new Error("private fork PR policy not returned (unknown)");
  const m = [d?.send_write_tokens_to_workflows ? "fork PRs get a write token" : "", d?.send_secrets_and_variables ? "fork PRs get secrets" : ""].filter(Boolean);
  return m.length
    ? fail(`private: ${m.join(", ")}`, W("PUT", `repos/${slug}/actions/permissions/fork-pr-workflows-private-repos`, { run_workflows_from_fork_pull_requests: false, send_write_tokens_to_workflows: false, send_secrets_and_variables: false, require_approval_for_fork_pr_workflows: true }))
    : pass(`private: fork PR workflows ${d?.run_workflows_from_fork_pull_requests ? "run without a write token or secrets" : "do not run"}`);
});
check("secret-scanning", () => {
  const r = repoJson;
  if (!isPublic) return na(`private: GitHub secret scanning is ${CAPS.secretScanning} on ${plan ?? "this plan"}; gitleaks stands in (gitleaks-precommit; ci-flow's cheap-secret-scan when the repo has CI)`);
  const s = r.security_and_analysis ?? {};
  const keys = ["secret_scanning", "secret_scanning_push_protection"], off = keys.filter((k) => s[k]?.status !== "enabled");
  return off.length ? fail(`public: off: ${off.join(", ")}`, known(keys.every((k) => typeof s[k]?.status === "string"),
      W("PATCH", `repos/${slug}`, Object.fromEntries(off.map((k) => [`security_and_analysis[${k}][status]`, "enabled"])))))
    : pass("public: secret scanning and push protection on");
});
check("private-vuln-reporting", () => {
  if (!isPublic) return na("private repo: GitHub offers private vulnerability reporting on public repos only");
  const on = must(R("private-vulnerability-reporting"))?.enabled;
  return on === true ? pass("public: on")
    : fail("public: private vulnerability reporting off", known(typeof on === "boolean", W("PUT", `repos/${slug}/private-vulnerability-reporting`)));
});
check("security-policy", () => {
  if (!isPublic) return na("private repo: no outside reporters");
  const f = FILES.find((p) => /^(\.github\/|docs\/)?SECURITY\.md$/i.test(p));
  return f ? pass(f) : fail("public repo without SECURITY.md", "add SECURITY.md pointing reporters at GitHub private vulnerability reporting");
});
// Default-branch hygiene for every repo; a repo with CI is judged by the stricter protection-live.
check("branch-baseline", () => {
  if (CI) return na(`owned by ci-flow's protect script (${CI.path} runs on pull requests; see ci-flow's protection-live)`);
  if (parseErrors.length) throw new Error(`workflow not parsed, so the project's needs are unknown: ${parseErrors.join("; ")}`);
  if (protIsBlocked) return na("no protection on this plan for a private repo — see plan-protection");
  const rules = ghGet(`repos/${slug}/rules/branches/${defaultBranch}`);
  const types = new Set(rules.ok ? (rules.data ?? []).map((x: any) => x.type) : []);
  if (["deletion", "non_fast_forward", "pull_request"].every((t) => types.has(t))) return pass(`${defaultBranch}: rulesets block deletion and force-push and require a PR`);
  const put = W("PUT", `repos/${slug}/branches/${defaultBranch}/protection`, undefined,
    { required_status_checks: null, enforce_admins: true, required_pull_request_reviews: { required_approving_review_count: 0 }, restrictions: null, allow_force_pushes: false, allow_deletions: false });
  const fix: Fix = { ...put, cmd: `${put.cmd}  # a PUT replaces the whole rule` };
  // An unreadable rulesets list is unknown, not empty: the verdict rests on classic protection alone, and nothing is applied.
  const rulesNote = rules.ok ? "" : `; rulesets not readable (${rules.msg})`;
  if (!protection) {
    if (protRes && !protRes.ok && protRes.kind !== "missing") throw new Error(protRes.msg);
    return fail(`${defaultBranch} is not protected${rulesNote}`, known(rules.ok && !!protRes && !protRes.ok && /Branch not protected/i.test(protRes.msg), fix));
  }
  const p = protection;
  const m = [p.allow_force_pushes?.enabled === false ? "" : "force-push allowed", p.allow_deletions?.enabled === false ? "" : "deletion allowed",
    p.required_pull_request_reviews ? "" : "no PR required", p.enforce_admins?.enabled ? "" : "admins exempt"].filter(Boolean);
  return m.length ? fail(`${defaultBranch}: ${m.join(", ")}${rulesNote}`, known(rules.ok && [p.allow_force_pushes, p.allow_deletions, p.enforce_admins].every((x) => typeof x?.enabled === "boolean"), fix)) : pass(`${defaultBranch}: PR required, no force-push or deletion, admins included`);
});
check("deploy-keys", () => {
  const ks: any[] = must(R("keys?per_page=100")) ?? [];
  if (ks.length >= 100) throw new Error(`${ks.length} deploy keys on one page: the list may be truncated (unknown)`); // a plain array: no total_count
  const rw = ks.filter((k) => k.read_only === false);
  return rw.length
    ? fail(`${rw.length} of ${ks.length} deploy key(s) can WRITE: ${rw.map((k) => `#${k.id} ${k.title}`).join(", ")}`, `replace each with a read-only key, then: gh api -X DELETE repos/${slug}/keys/<id>`)
    : pass(ks.length ? `${ks.length} deploy key(s), all read-only: ${ks.map((k) => k.title).join(", ")}` : "no deploy keys");
});
check("webhooks", () => {
  const hs: any[] = must(R("hooks?per_page=100")) ?? [];
  if (hs.length >= 100) throw new Error(`${hs.length} webhooks on one page: the list may be truncated (unknown)`);
  const host = (u: string) => { try { return new URL(u).host; } catch { return "?"; } }; // never print a URL's path or query: tokens live there
  const bad = hs.filter((h) => !/^https:/.test(String(h.config?.url ?? "")) || String(h.config?.insecure_ssl) === "1" || !h.config?.secret)
    .map((h) => `#${h.id} ${host(h.config?.url ?? "")}`);
  return bad.length
    ? fail(`webhook(s) without https, TLS verification or a secret: ${bad.join(", ")}`, `gh api -X PATCH repos/${slug}/hooks/<id> -f 'config[secret]=<random>' -f 'config[insecure_ssl]=0' (or delete a hook nothing uses)`)
    : pass(hs.length ? `${hs.length} webhook(s), https + secret: ${hs.map((h) => host(h.config?.url ?? "")).join(", ")}` : "no webhooks");
});
check("collaborators", () => {
  const kind = isOrg ? "outside" : "direct";
  const cs: any[] = must(R(`collaborators?affiliation=${kind}&per_page=100`)) ?? [];
  const others = cs.filter((c) => c.login !== owner);
  const high = others.filter((c) => c.permissions?.admin || c.permissions?.maintain);
  return high.length
    ? fail(`${kind} collaborator(s) with admin/maintain: ${high.map((c) => c.login).join(", ")}`, `gh api -X PUT repos/${slug}/collaborators/<login> -f permission=push, or remove those whose work is done`)
    : pass(others.length ? `${others.length} ${kind} collaborator(s), none above write: ${others.map((c) => c.login).join(", ")}` : `no ${isOrg ? "outside" : "other"} collaborators`);
});
check("deploy-credential-scope", () => {
  if (!CAPS.environments) return na("no environments on this plan for a private repo — see plan-environments");
  if (!secRes?.ok) throw new Error(secRes?.msg ?? "secrets not readable");
  const envRes = must(R("environments?per_page=100")), envs = envRes?.environments;
  if (!Array.isArray(envs)) throw new Error("environments list not returned (unknown)");
  if (Number(envRes.total_count) > envs.length) throw new Error(`${envRes.total_count} environments, only ${envs.length} read (unknown)`);
  const open = envs.filter((e) => !e.deployment_branch_policy).map((e) => e.name);
  // Owner decision 2026-11-05 (POLICY.md, least privilege): an environment any branch
  // can deploy to is accepted while one account alone can push; a second writer fails it.
  const writers = open.length
    ? (must(R("collaborators?affiliation=all&per_page=100")) ?? []).filter((c: any) => c.permissions?.push || c.permissions?.maintain || c.permissions?.admin).map((c: any) => c.login)
    : [];
  const sole = writers.length <= 1;
  const m = [deploySecrets.length ? `repository-level deploy-like secret(s), readable from any branch: ${deploySecrets.join(", ")}` : "",
    open.length && !sole ? `environment(s) any branch can deploy to: ${open.join(", ")}, and ${writers.length} accounts can push a branch (${writers.slice(0, 4).join(", ") + (writers.length > 4 ? ` (+${writers.length - 4})` : "")})` : ""].filter(Boolean);
  const fix = [deploySecrets.length ? `move each into an environment: gh secret set <NAME> --env <env> -R ${slug}, then gh secret delete <NAME> -R ${slug}` : "",
    open.length ? `gh api -X PUT repos/${slug}/environments/<env> --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' && gh api -X POST repos/${slug}/environments/<env>/deployment-branch-policies -f name=${shq(defaultBranch)} -f type=branch` : ""].filter(Boolean).join("; ");
  return m.length ? fail(m.join("; "), fix)
    : pass(`${repoSecrets.length} repository secret(s), none deploy-like; ${envs.length} environment(s), ${open.length ? `${open.join(", ")} open to any branch, accepted while ${writers[0] ?? "one account"} is the only writer` : "each branch-restricted"}`);
});
check("log-retention", () => {
  const d = must(R("actions/permissions/artifact-and-log-retention"));
  return Number(d?.days) <= 30 ? pass(`artifacts and logs kept ${d.days} days`)
    : fail(`artifacts and logs kept ${d?.days} days (screenshots, traces and any unredacted output live that long)`, known(typeof d?.days === "number", W("PUT", `repos/${slug}/actions/permissions/artifact-and-log-retention`, { days: 14 })));
});
// Reads git history at <ref>; prints domains only, never the addresses.
check("commit-email-noreply", () => {
  const lg = git("log", "-n", "200", "--format=%ae", ref);
  if (!lg.ok) throw new Error(lg.err.trim());
  const em = lg.out.split("\n").filter(Boolean);
  const bad = em.filter((e) => !NOREPLY.test(e));
  const domains = [...new Set(bad.map((e) => e.split("@")[1] ?? "?"))];
  return bad.length
    ? fail(`${bad.length} of the last ${em.length} commits carry a non-noreply author email (domains: ${domains.join(", ")})`,
      `git config --global user.email <id>+<login>@users.noreply.github.com and turn on "Block command line pushes that expose my email" (https://github.com/settings/emails); history keeps the old address — ${isPublic ? "already public" : "it becomes public if the repo ever does"}`)
    : pass(`last ${em.length} commits: noreply author emails`);
}, false);
// Reads the LOCAL clone's hooks (not <ref>): the hook that runs is the clone's.
check("gitleaks-precommit", () => {
  const { hp, dflt, dir: dirPath } = hookDir(git);
  const hookFile = `${dirPath}/pre-commit`, t = live(hookFile);
  const chained = !!hp && dirPath !== dflt && /(git-common-dir|git-path hooks)[^\n]*pre-commit|\.git\/hooks\/pre-commit/.test(t) && gates(live(`${dflt}/pre-commit`));
  const cmd = "gitleaks git --pre-commit --staged --redact";
  const prove = "then prove it with one blocked fake-secret commit";
  // An existing hook carries other checks: replacing it with the one-liner silently drops them (~/.claude, 2026-11: 75 lines became 2).
  const fix = t
    ? `ADD a line running ${cmd} to the existing ${hookFile}${hp ? " (or chain it to .git/hooks/pre-commit)" : ""}, ending in || exit 1 so a leak stops the commit; never overwrite the file, its other checks stop running; ${prove}`
    : `create ${hookFile} running ${cmd} (global: ~/.claude/git-hooks/pre-commit via init.templateDir; if that file exists, add the line to it, never overwrite), ${prove}`;
  if (!t) return fail(`no pre-commit hook at ${hookFile}`, fix);
  return gates(t) || chained ? pass(`${hookFile} runs gitleaks${chained ? " (chained)" : ""} — present, not proven by a blocked commit`) : fail(GL.test(reachable(t)) ? `${hookFile} runs gitleaks, but its failure does not fail the hook` : `${hookFile} does not run gitleaks`, fix);
}, false);
check("org-baseline", () => {
  if (!isOrg) return na("user-owned repository (see account-2fa)");
  const o = ownerData ?? must(ownerRes!);
  const m = [o.two_factor_requirement_enabled === true ? "" : o.two_factor_requirement_enabled == null ? "2FA requirement not readable (org-owner token needed)" : "2FA not required",
    o.members_can_create_public_repositories === false ? "" : "members can create PUBLIC repositories",
    ["read", "none"].includes(o.default_repository_permission) ? "" : `base permission ${o.default_repository_permission}`].filter(Boolean);
  const patch = W("PATCH", `orgs/${owner}`, { members_can_create_public_repositories: false, default_repository_permission: "read" });
  return m.length
    ? fail(`${owner}: ${m.join(", ")}`, known(typeof o.two_factor_requirement_enabled === "boolean" && typeof o.members_can_create_public_repositories === "boolean" && typeof o.default_repository_permission === "string",
      { ...patch, cmd: `${patch.cmd}  # if Team refuses the public-only switch: -F members_can_create_repositories=false; 2FA: https://github.com/organizations/${owner}/settings/security` }))
    : pass(`${owner}: 2FA required, members cannot create public repos, base permission ${o.default_repository_permission}`);
});
check("account-2fa", () => {
  if (isOrg) return na("organization-owned (see org-baseline)");
  if (ownerRes && !ownerRes.ok) throw new Error(ownerRes.msg);
  if (!ownerData) return na(`owned by ${owner}, not the authenticated account`);
  const tf = ownerData.two_factor_authentication;
  return tf === true ? pass(`${owner}: 2FA on`)
    : fail(tf == null ? `${owner}: 2FA state not readable (the token lacks the user scope)` : `${owner}: 2FA off`,
      tf == null ? "gh auth refresh -h github.com -s user" : "https://github.com/settings/security, recovery codes into 1Password");
});

// ------------------------------------------------------------------ report
const nf = rows.filter((r) => r.status === "fail").length;
if (json) {
  console.log(JSON.stringify({ slug, visibility, plan: plan ?? null, isOrg, defaultBranch, ci: CI?.path ?? null, rows }));
  process.exit(strict && nf ? 1 : 0);
}
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
console.log(`repo-create audit: ${repoPath} @ ${ref}${slug ? ` (${slug})` : ""}`);
if (repoJson) console.log(`${visibility} repository, ${isOrg ? "organization" : "user"}-owned, plan ${plan ?? "unknown"}`);
const mark = (s: Status) => (s === "fail" ? "**FAIL**" : s === "blocked" ? "**blocked**" : s);
console.log(`\n## Repository configuration\n\n| check | result | evidence |\n|---|---|---|`);
for (const r of rows) console.log(`| ${r.id} | ${mark(r.status)} | ${cell(r.ev)} |`);
const count = (s: Status) => rows.filter((r) => r.status === s).length;
console.log(`\n${count("pass")} pass, ${nf} fail, ${count("blocked")} blocked by plan, ${count("n.a.")} n.a.`);
if (minutesWarn) console.log(`\n**${minutesWarn}**`);
const todo = rows.filter((r) => r.fix && r.status !== "n.a.");
if (todo.length) {
  console.log("\n## Hardening — suggested, NOT applied; read each before running it\n");
  const tag = (s: Status) => (s === "blocked" ? " (plan decision)" : s === "pass" ? " (suggestion)" : "");
  for (const r of todo) console.log(`- ${r.id}${tag(r.status)}: ${r.fix}`);
}
process.exit(strict && nf ? 1 : 0);
