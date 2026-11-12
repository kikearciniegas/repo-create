// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// Shared test fixture: a synthetic repository, a fake `gh` on PATH serving canned
// JSON (recording every call), and harness(root) to run audit.ts against them.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const AUDIT = join(import.meta.dir, "../skills/repo-create/scripts/audit.ts");
export const APPLY = join(import.meta.dir, "../skills/repo-create/scripts/apply.ts");

// Hermetic: a leaked GIT_DIR (a hook, a worktree) would point every git call
// below at the caller's repository.
export const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

export const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
export const CI = ".github/workflows/ci.yml", DEP = ".github/workflows/deploy.yml";
// The project's needs, as the configuration checks read them: a pull-request
// workflow (so merges can be gated) and a deploy workflow (so environments matter).
export const BASE: Record<string, string> = {
  [CI]: `name: CI
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
jobs:
  checks:
    if: \${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA} # v7
      - uses: oven-sh/setup-bun@${SHA} # v2
      - run: bun test
`,
  [DEP]: `name: deploy
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo deploy
`,
};

export const REPO = { default_branch: "main", name: "r", private: true, owner: { login: "o", type: "Organization" },
  delete_branch_on_merge: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false };
export const ORG = { plan: { name: "team", seats: 1, filled_seats: 1, private_repos: 999999 }, two_factor_requirement_enabled: true,
  members_can_create_public_repositories: false, members_can_create_private_repositories: true, default_repository_permission: "read" };
export const GH_BASE: Record<string, unknown> = {
  repo: REPO,
  org: ORG,
  vuln: "",
  asf: { enabled: true, paused: false },
  wfperm: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
  actperm: { enabled: true, allowed_actions: "selected", sha_pinning_required: true },
  selacts: { github_owned_allowed: true, verified_allowed: false, patterns_allowed: ["oven-sh/setup-bun@*"] },
  forkpriv: { run_workflows_from_fork_pull_requests: false, send_write_tokens_to_workflows: false, send_secrets_and_variables: false },
  retention: { days: 14 },
  secrets: { secrets: [{ name: "NPM_TOKEN" }] },
  keys: [{ id: 1, title: "ci read", read_only: true }],
  hooks: [{ id: 2, config: { url: "https://hooks.example.invalid/x", insecure_ssl: "0", secret: "********" } }],
  collab: [],
  envs: { environments: [{ name: "production", deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }] },
  rules: [],
  usage: { usageItems: [{ sku: "Actions Linux", quantity: 600, repositoryName: "r", netAmount: 0 }, { sku: "Actions storage", quantity: 9000, repositoryName: "r" }] },
  budgets: { budgets: [{ budget_product_sku: "actions", budget_amount: 20, budget_scope: "organization", prevent_further_usage: true }] },
  protection: {
    required_status_checks: { strict: true, checks: ["cheap", "unit-count", "browser"].map((context) => ({ context, app_id: 15368 })) },
    enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
    required_pull_request_reviews: { required_approving_review_count: 0 },
  },
};

// The fake answers GETs (and the read-only \`gh repo list\`); any other shape is
// refused and logged. A "<name>.err" file makes that endpoint fail with its text.
// A write (\`api -X <M> <path> …\`) is logged to writes.log with its stdin, and
// changes the server state only if "<name>.after.json" exists (never by itself).
export const FAKE_GH = `#!/bin/sh
echo "$*" >> "$GH_DIR/calls.log"
if [ "$1" = repo ] && [ "$2" = list ]; then cat "$GH_DIR/repolist.json" 2>/dev/null || exit 1; exit 0; fi
w=; p=$2
if [ "$1" = api ] && [ "$2" = -X ] && [ $# -ge 4 ]; then
  w=$3; p=$4; shift 4
  echo "WRITE $w $p $*" >> "$GH_DIR/writes.log"
  case " $* " in *" --input - "*) cat >> "$GH_DIR/writes.log"; echo >> "$GH_DIR/writes.log" ;; esac
else
  [ "$1" = api ] && [ $# -eq 2 ] || exit 9
fi
case "$p" in
  repos/o/r) f=repo ;;
  repos/o/r/vulnerability-alerts) f=vuln ;;
  repos/o/r/automated-security-fixes) f=asf ;;
  repos/o/r/actions/permissions/workflow) f=wfperm ;;
  repos/o/r/actions/permissions/fork-pr-workflows-private-repos) f=forkpriv ;;
  repos/o/r/actions/permissions/fork-pr-contributor-approval) f=forkpub ;;
  repos/o/r/actions/permissions/artifact-and-log-retention) f=retention ;;
  repos/o/r/actions/permissions) f=actperm ;;
  repos/o/r/actions/permissions/selected-actions) f=selacts ;;
  repos/o/r/actions/secrets*) f=secrets ;;
  repos/o/r/private-vulnerability-reporting) f=pvr ;;
  repos/o/r/keys*) f=keys ;;
  repos/o/r/hooks*) f=hooks ;;
  repos/o/r/collaborators*) f=collab ;;
  repos/o/r/environments*) f=envs ;;
  repos/o/r/rules/branches/*) f=rules ;;
  orgs/o/settings/billing/budgets) f=budgets ;;
  */settings/billing/usage*) f=usage ;;
  orgs/o) f=org ;;
  users/o) f=whois ;;
  user) f=user ;;
  */protection) f=protection ;;
  gitignore/templates/Node) f=gitignore ;;
  *) exit 1 ;;
esac
if [ -n "$w" ]; then
  if [ -f "$GH_DIR/$f.wfail" ]; then cat "$GH_DIR/$f.wfail" >&2; exit 1; fi
  [ -f "$GH_DIR/$f.wbreak" ] && mv "$GH_DIR/../repo/.git" "$GH_DIR/../repo/.git.gone"
  if [ -f "$GH_DIR/$f.after.json" ]; then cp "$GH_DIR/$f.after.json" "$GH_DIR/$f.json"; rm -f "$GH_DIR/$f.err"; fi
  exit 0
fi
if [ -f "$GH_DIR/$f.err" ]; then cat "$GH_DIR/$f.err" >&2; exit 1; fi
[ -f "$GH_DIR/$f.json" ] || exit 1
cat "$GH_DIR/$f.json"
`;

/** Write the fake gh's answers; `{ __err: text }` makes that endpoint fail with `text` on stderr;
 *  `__after: value` (beside the answer or the `__err`) is what the endpoint answers once written;
 *  `__wfail: text` makes a write to it exit 1 with `text`; `__wbreak: true` makes a write remove the repo's .git,
 *  so the next audit cannot read the tree. */
export function writeGh(ghDir: string, bin: string, gh: Record<string, unknown | null>) {
  for (const [k, v] of Object.entries({ ...GH_BASE, ...gh })) {
    if (v == null) continue;
    const { __err: e, __after: after, __wfail: wfail, __wbreak: wbreak, ...rest } = v as any;
    const marked = [after, wfail, wbreak].some((x) => x !== undefined);
    writeFileSync(join(ghDir, e ? `${k}.err` : `${k}.json`), e ?? JSON.stringify(marked ? rest : v));
    if (after !== undefined) writeFileSync(join(ghDir, `${k}.after.json`), JSON.stringify(after));
    if (wfail !== undefined) writeFileSync(join(ghDir, `${k}.wfail`), wfail);
    if (wbreak) writeFileSync(join(ghDir, `${k}.wbreak`), "");
  }
  writeFileSync(join(bin, "gh"), FAKE_GH); chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(ghDir, "calls.log"), ""); writeFileSync(join(ghDir, "writes.log"), "");
}
export type Result = { status: number; out: string; rows: Map<string, string>; calls: string; writes: string; path: string };
/** hooksPath: [core.hooksPath value, path it resolves to under the fixture (HOME = the fixture dir), hook written there]. */
export type Opts = { hook?: string | null; email?: string; hooksPath?: [string, string, string] };
export const GITLEAKS_HOOK = "#!/bin/sh\ngitleaks git --pre-commit --staged\n";
// A private repo on Free: GitHub refuses protection "with an upgrade message",
// the plan is inferred from that, and the project's needs decide blocked vs n.a.
export const FREE_GH = {
  repo: { ...REPO, owner: { login: "o", type: "User" } },
  user: { login: "o", two_factor_authentication: true },
  protection: { __err: "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)" },
};

// Three reference variants, each passing everything it evaluates. Visibility
// and plan decide which configuration checks apply, so no single fixture can
// exercise them all: a check is n.a. in one variant only if another passes it.
export const PUB_GH = {
  repo: { ...REPO, private: false, owner: { login: "o", type: "User" },
    security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } } },
  user: { login: "o", plan: { name: "free" }, two_factor_authentication: true },
  forkpub: { approval_policy: "first_time_contributors" },
  pvr: { enabled: true },
};

// What apply.ts, audit.ts and the fake gh run by name (found by running with this bin alone and reading what broke).
export const ISOLATED_TOOLS = ["git", "cat", "cp", "rm", "mv"];
/** Per-file harness: each test file passes its own temp root, so two files never delete each other's dir. */
export function harness(root: string) {
  let n = 0;
  // A fake private prefix, so the repo-name check is tested without the owner's real list.
  writeFileSync(join(root, "prefixes"), "acme_\n");
  const env = { ...ENV, REPO_CREATE_PREFIXES_FILE: join(root, "prefixes") };
  /** isolated: PATH is the fixture's private bin only — the fake gh plus links to ISOLATED_TOOLS — so no real gh is reachable
   *  wherever one is installed (GitHub's Linux runners put it in /usr/bin). */
  const runner = (script: string, isolated: boolean) => (files: Record<string, string | null>, gh: Record<string, unknown | null> = {}, extra: string[] = [], opts: Opts = {}): Result => {
    const dir = join(root, `r${n++}`), repo = join(dir, "repo"), ghDir = join(dir, "gh"), bin = join(dir, "bin"), tpl = join(dir, "tpl");
    for (const d of [repo, ghDir, bin, tpl]) mkdirSync(d, { recursive: true });
    for (const [p, c] of Object.entries({ ...BASE, ...files })) {
      if (c == null) continue;
      mkdirSync(dirname(join(repo, p)), { recursive: true });
      writeFileSync(join(repo, p), c);
    }
    writeGh(ghDir, bin, gh);
    const g = (...a: string[]) => {
      const r = spawnSync("git", ["-C", repo, ...a], { env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    };
    // An empty template: the host's own hooks (a global gitleaks hook) must neither run nor be judged.
    g("init", "-q", `--template=${tpl}`); g("add", "-A");
    g("-c", "user.name=t", "-c", `user.email=${opts.email ?? "1+t@users.noreply.github.com"}`, "commit", "-qm", "fixture");
    const hook = opts.hook === undefined ? GITLEAKS_HOOK : opts.hook;
    if (hook != null) { mkdirSync(join(repo, ".git/hooks"), { recursive: true }); writeFileSync(join(repo, ".git/hooks/pre-commit"), hook); }
    if (opts.hooksPath) {
      const [value, at, text] = opts.hooksPath;
      g("config", "core.hooksPath", value);
      mkdirSync(join(dir, at), { recursive: true }); writeFileSync(join(dir, at, "pre-commit"), text);
    }
    // The audit reads core.hooksPath: the host's global git config must not answer for the fixture.
    if (isolated) for (const t of ISOLATED_TOOLS) symlinkSync(Bun.which(t)!, join(bin, t));
    const PATH = isolated ? bin : `${bin}:${env.PATH}`;
    const r = spawnSync(process.execPath, [script, repo, "--ref", "HEAD", "--repo", "o/r", ...extra],
      { env: { ...env, PATH, GH_DIR: ghDir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...(opts.hooksPath ? { HOME: dir } : {}) }, encoding: "utf8" });
    const rows = new Map<string, string>();
    for (const l of r.stdout.split("\n")) {
      const m = /^\| ([\w.-]+) \| (\*\*FAIL\*\*|\*\*blocked\*\*|pass|n\.a\.) \|/.exec(l);
      if (m) rows.set(m[1], m[2] === "**FAIL**" ? "fail" : m[2] === "**blocked**" ? "blocked" : m[2]);
    }
    const read = (f: string) => readFileSync(join(ghDir, f), "utf8");
    return { status: r.status ?? -1, out: r.stdout + r.stderr, rows, calls: read("calls.log"), writes: read("writes.log"), path: PATH };
  };
  const audit = runner(AUDIT, false), apply = runner(APPLY, true);
  /** `--owner` mode: no repository, only the fake gh. */
  function ownerAudit(gh: Record<string, unknown | null>) {
    const dir = join(root, `o${n++}`), ghDir = join(dir, "gh"), bin = join(dir, "bin");
    for (const d of [ghDir, bin]) mkdirSync(d, { recursive: true });
    writeGh(ghDir, bin, gh);
    const r = spawnSync("bun", [AUDIT, "--owner", "o"], { env: { ...env, PATH: `${bin}:${env.PATH}`, GH_DIR: ghDir }, encoding: "utf8" });
    return { status: r.status ?? -1, out: r.stdout + r.stderr, calls: readFileSync(join(ghDir, "calls.log"), "utf8") };
  }
  return { audit, apply, ownerAudit };
}
