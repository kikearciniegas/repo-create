// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// The repo-create trigger hook: fires on repository-settings commands (gh repo
// create/edit/rename/delete/archive/transfer, gh api writes), once per session
// per repo; silent on everything ci-flow owns and on read-only commands.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "../skills/repo-create/hooks/trigger.sh");
const tmp = mkdtempSync(join(tmpdir(), "repo-create-trigger-"));
const repo = join(tmp, "repo");
mkdirSync(repo);
const env = { PATH: process.env.PATH!, HOME: tmp, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
spawnSync("git", ["init", "-q", "--template=", repo], { env });
let n = 0;

/** Runs the hook in a fresh session (so the once-per-session marker never masks a result). */
function fire(tool: string, input: Record<string, string>, session = `s${n++}`, cwd = repo): string {
  const r = spawnSync("bash", [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: input, session_id: session, cwd }), env: { ...env, TMPDIR: tmp }, encoding: "utf8" });
  expect(r.status).toBe(0); // a reminder never blocks
  return r.stdout;
}
const bash = (command: string, session?: string) => fire("Bash", { command }, session);
const top = () => spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
const ctx = (o: string) => JSON.parse(o).hookSpecificOutput.additionalContext as string;

describe("fires", () => {
  for (const c of ["gh repo create o/x --private", "gh repo edit --visibility public", "gh repo rename y", "gh repo delete o/x --yes", "gh repo archive o/x", "gh repo transfer o/x new",
    "gh api -X PATCH repos/o/r -f private=true", "gh api --method DELETE repos/o/r/hooks/1", "gh api repos/o/r/environments/p/deployment-branch-policies -f name=main", "gh api -X POST repos/o/r/transfer -f new_owner=x",
    "gh api gists -f description=x", "gh api -X DELETE repos/o/r; gh api graphql -f query=x", `gh api -X PATCH repos/o/r -f description="/rulesets"`,
    "true && gh repo create o/x --private", "gh api graphql -f query=x; gh api -X DELETE repos/o/r", "gh api repos/o/r/environments/protection-x -X PUT", "gh api -X PUT repos/o/r/rulesetsfoo",
    `echo "done" && gh repo create o/x --private`, `git commit -m "x"; gh repo archive o/x`, "gh api -X GET repos/o/r; gh api -X PATCH repos/o/r -f private=true",
    // the GET exemption fails closed: a GET in a $( ) or inside a quoted value does not make the write a read
    "gh api repos/o/r/hooks -f url=x $(gh api -X GET user)", `gh api repos/o/r/hooks -f note="use -X GET here"`,
    "gh api repos/o/r/hooks -f url=x `gh api -X GET user`", "gh api -X GET user && gh api repos/o/r/hooks -f url=x",
    // quoted gh can run for real: a missed reminder costs more than a false one (ruling S5)
    `bash -c "gh repo create o/x --private"`, `sh -c 'gh api -X PATCH repos/o/r -f private=true'`, `echo "$(gh repo create o/x --private)"`, `x="$(gh repo create o/x)"`,
    // known false fires, accepted: quoted text that only looks like a command
    `echo "gh repo create x"`, `echo "run; gh repo create x"`, `git commit -m "gh repo create o/x"`,
    // attached flag forms and a field flag as the first token
    "gh api repos/o/r -fprivate=true", "gh api repos/o/r -Fprivate=true", "gh api repos/o/r --field=private=true", "gh api repos/o/r --raw-field=description=x",
    "gh api repos/o/r/hooks --input=hook.json", "gh api -XPATCH repos/o/r", "gh api --method=PATCH repos/o/r", "gh api -f a=b repos/o/r",
    // repository settings outside gh repo create/edit/…
    "gh secret set TOKEN --body x", "gh repo deploy-key add key.pub", "gh api -X POST repos/o/r/keys -f key=x", "gh api repos/o/r/keys -f title=x -f key=y", "gh repo unarchive o/x",
    // a quoted value with spaces is one token: it cannot pose as the path
    "gh api -f note='x /rulesets' -X PATCH repos/o/r", "gh api --raw-field note='see /branches/main/protection' -X PATCH repos/o/r"])
    test(c, () => expect(bash(c)).toContain("repo-create applies"));
  test("names the repo root and the audit", () => {
    const o = JSON.parse(bash("gh repo edit --visibility public"));
    expect(o.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(o.hookSpecificOutput.additionalContext).toContain(`audit.ts ${top()}`);
    expect(o.hookSpecificOutput.additionalContext).toContain("audit.ts --owner <login>");
  });
  test("`cd <repo> && gh repo edit` from another cwd names <repo>", () =>
    expect(ctx(fire("Bash", { command: `cd ${repo} && gh repo edit --visibility public` }, undefined, tmp))).toContain(`audit.ts ${top()}`));
  test("a multi-line command still fires", () => expect(bash("echo start\ngh repo archive o/x")).toContain("repo-create applies"));
});

describe("does not fire", () => {
  for (const c of ["git commit -m x", "git push", "git status", "gh pr create --draft", "gh pr merge 3", "gh repo view", "gh repo list", "gh repo clone o/x",
    "gh api repos/o/r", "gh api repos/o/r --jq .private", "gh api 'repos/o/r/actions/runs?status=queued'",
    "gh api -X PUT repos/o/r/branches/main/protection --input -", "gh api -X PUT repos/o/r/rulesets/1 --input -", "gh api -X POST repos/o/r/rulesets -f name=x",
    "gh api graphql -f query='mutation { updateRepository(input: {}) { clientMutationId } }'", "gh api graphql -f query='{ viewer { login } }'",
    "gh api graphql -F query=@q.graphql", "gh api -X POST graphql -f query='mutation{x}'", "gh api repos/o/r/rulesets/1 -X PUT", "gh api repos/o/r/rulesets?x=1 -X PUT",
    `gh api -X PUT "repos/o/r/branches/main/protection" --input -`, "gh api -X PUT 'repos/o/r/branches/main/protection' --input -", `gh api -X POST "repos/o/r/rulesets" -f name=x`,
    // an explicit GET sends -f as query parameters: a read
    "gh api -X GET search/repositories -f q=foo", "gh api --method GET search/issues -f q=x", "gh api search/code -X GET -F per_page=100",
    "gh api -X GET repos/o/r", "gh api --method=GET repos/o/r", "gh api -XGET search/issues -f q=x", "gh api --method=GET search/issues -f q=x",
    // an unquoted echo only prints
    "echo gh api -X PATCH", "echo gh api -X PATCH repos/o/r",
    // graphql is ci-flow's (a mutation) or a read, whatever the flag order
    "gh api graphql -f query='query{viewer{login}}'", "gh api --method=POST graphql -f query='mutation{x}'", "gh api -f query='mutation{x}' graphql",
    // ci-flow's paths in the attached and field-first forms
    "gh api -XPUT repos/o/r/branches/main/protection --input=p.json", "gh api --method=POST repos/o/r/rulesets --field=name=x", "gh api -f name=x repos/o/r/rulesets",
    // a quoted value with spaces cannot pose as the path (`rule'` was taken as the path)
    "gh api -f name='my rule' -X POST repos/o/r/rulesets",
    "gh secret list", "gh repo deploy-key list"])
    test(c, () => expect(bash(c)).toBe(""));
  for (const f of [".github/workflows/ci.yml", ".github/dependabot.yml", "README.md"])
    test(`Write ${f}`, () => expect(fire("Write", { file_path: join(repo, f) })).toBe(""));
  test("Edit of a workflow", () => expect(fire("Edit", { file_path: join(repo, ".github/workflows/ci.yml") })).toBe(""));
});

describe("once per session per repo", () => {
  test("second action in the same session is silent; a new session fires again", () => {
    expect(bash("gh repo edit --visibility public", "same")).toContain("repo-create applies");
    expect(bash("gh repo archive o/x", "same")).toBe("");
    expect(bash("gh repo archive o/x", "other")).toContain("repo-create applies");
  });
  test("a hostile session id cannot write outside the marker directory", () => {
    expect(bash("gh repo archive o/x", "../../escape")).toContain("repo-create applies");
    expect(existsSync(join(tmp, "escape"))).toBe(false);
    expect(existsSync(join(tmp, "repo-create-trigger", "escape"))).toBe(true); // reduced to safe characters, kept inside
  });
  test("repos whose paths differ only by / vs _ each get their own reminder", () => {
    for (const p of ["x/a_b", "x/a/b"]) { mkdirSync(join(tmp, p), { recursive: true }); spawnSync("git", ["init", "-q", "--template=", join(tmp, p)], { env }); }
    expect(fire("Bash", { command: "gh repo archive o/x" }, "col", join(tmp, "x/a_b"))).toContain("repo-create applies");
    expect(fire("Bash", { command: "gh repo archive o/x" }, "col", join(tmp, "x/a/b"))).toContain("repo-create applies");
  });
  test("a relative cwd ends (no hang) and still reminds", () => {
    const r = spawnSync("bash", [HOOK], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh repo archive o/x" }, session_id: "rel", cwd: "rel" }), env: { ...env, TMPDIR: tmp }, encoding: "utf8", timeout: 5000, cwd: "/" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("repo-create applies");
  });
  test("a symlinked marker directory is never written through; the hook still reminds", () => {
    const target = join(tmp, "elsewhere");
    mkdirSync(target);
    symlinkSync(target, join(tmp, "repo-create-trigger", "linked"));
    expect(bash("gh repo archive o/x", "linked")).toContain("repo-create applies");
    expect(bash("gh repo archive o/x", "linked")).toContain("repo-create applies"); // no marker, so it fires again
    expect(readdirSync(target)).toEqual([]);
  });
});
