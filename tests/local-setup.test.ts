// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// local-setup.ts (T6): the gitleaks pre-commit hook created or appended to, never overwritten;
// the commit email set in the repo's own config, never the global one; Synology lines printed only.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV, harness } from "./fixture";

const SETUP = join(import.meta.dir, "../skills/repo-create/scripts/local-setup.ts");
const ROOT = mkdtempSync(join(tmpdir(), "repo-create-local-setup-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const { audit } = harness(ROOT);
const LINE = "gitleaks git --pre-commit --staged --redact", INS = `${LINE} || exit 1`;
const NOREPLY = "123+octo@users.noreply.github.com";
let n = 0;

/** A fresh `git init` with an empty template; `global` is the file GIT_CONFIG_GLOBAL points at. */
function repo(globalCfg = "") {
  const box = join(ROOT, `l${n++}`), dir = join(box, "repo"), tpl = join(box, "tpl"), global = join(box, "gitconfig");
  for (const d of [dir, tpl]) mkdirSync(d, { recursive: true });
  writeFileSync(global, globalCfg);
  const env = { ...ENV, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { env, encoding: "utf8" });
  expect(git("init", "-q", `--template=${tpl}`).status).toBe(0);
  const run = (...a: string[]) => {
    const r = spawnSync(process.execPath, [SETUP, dir, ...a], { env, encoding: "utf8", timeout: 20_000 });
    return { status: r.status ?? -1, out: r.stdout + r.stderr };
  };
  return { box, dir, global, env, git, run, hook: join(dir, ".git/hooks/pre-commit") };
}
const put = (p: string, text: string, mode = 0o755) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, text); chmodSync(p, mode); };
const mode = (p: string) => statSync(p).mode & 0o777;

describe("local-setup.ts: the pre-commit hook", () => {
  test("absent: created with the gitleaks line, executable, and the audit passes it", () => {
    const r = repo(), s = r.run();
    expect(s.status).toBe(0);
    expect(readFileSync(r.hook, "utf8")).toBe(`#!/bin/sh\n${INS}\n`);
    expect(mode(r.hook)).toBe(0o755);
    expect(audit({}, {}, [], { hook: readFileSync(r.hook, "utf8") }).rows.get("gitleaks-precommit")).toBe("pass");
  });

  test("3 lines without gitleaks: 4 lines, gitleaks on line 2, the old lines unchanged around it, mode kept, the audit passes", () => {
    const r = repo(), before = "#!/bin/sh\nset -e\nnpm run lint\n";
    put(r.hook, before, 0o700);
    const ino = statSync(r.hook).ino;
    expect(r.run().status).toBe(0);
    const after = readFileSync(r.hook, "utf8"), a = after.split("\n"), b = before.split("\n");
    expect(statSync(r.hook).ino).not.toBe(ino); // a new file renamed over the hook, not a rewrite in place
    expect(readdirSync(join(r.dir, ".git/hooks"))).toEqual(["pre-commit"]); // no temp file left
    expect(after).toBe(`#!/bin/sh\n${INS}\nset -e\nnpm run lint\n`);
    expect(after.trimEnd().split("\n")).toHaveLength(4);
    expect([a[0], a[2], a[3]]).toEqual([b[0], b[1], b[2]]);
    expect(a[1]).toBe(INS);
    expect(mode(r.hook)).toBe(0o700);
    expect(audit({}, {}, [], { hook: after }).rows.get("gitleaks-precommit")).toBe("pass");
  });

  test("no shebang: gitleaks becomes line 1; a shebang with no newline: line 2", () => {
    const a = repo();
    put(a.hook, "npm test\n");
    expect(a.run().status).toBe(0);
    expect(readFileSync(a.hook, "utf8")).toBe(`${INS}\nnpm test\n`);
    const b = repo();
    put(b.hook, "#!/bin/sh");
    expect(b.run().status).toBe(0);
    expect(readFileSync(b.hook, "utf8")).toBe(`#!/bin/sh\n${INS}\n`);
  });

  test("runs gitleaks but ignores its status: byte-identical, by hand, exit 1 (the audit fails it too)", () => {
    const r = repo(), text = "#!/bin/sh\ngitleaks protect --staged\nexec npm test\n";
    put(r.hook, text);
    const m = statSync(r.hook).mtimeMs;
    const s = r.run();
    expect(s.status).toBe(1);
    expect(s.out).toContain(`by hand: add || exit 1 to its gitleaks line in ${realpathSync(r.hook)}`);
    expect(s.out).not.toContain("already runs gitleaks");
    expect(readFileSync(r.hook, "utf8")).toBe(text);
    expect(statSync(r.hook).mtimeMs).toBe(m);
    expect(audit({}, {}, [], { hook: text }).rows.get("gitleaks-precommit")).toBe("fail");
  });

  test("already runs gitleaks with || exit 1: byte-identical, exit 0, and the audit passes it", () => {
    const r = repo(), text = "#!/bin/sh\ngitleaks protect --staged || exit 1\nexec npm test\n";
    put(r.hook, text);
    const m = statSync(r.hook).mtimeMs;
    const s = r.run();
    expect(s.status).toBe(0);
    expect(s.out).toContain("already runs gitleaks; left as it is");
    expect(readFileSync(r.hook, "utf8")).toBe(text);
    expect(statSync(r.hook).mtimeMs).toBe(m);
    expect(audit({}, {}, [], { hook: text }).rows.get("gitleaks-precommit")).toBe("pass");
  });

  test("a commented-out gitleaks line is not a call: the line is inserted", () => {
    const r = repo(), text = "#!/bin/sh\n# gitleaks git --pre-commit\n";
    put(r.hook, text);
    expect(r.run().status).toBe(0);
    expect(readFileSync(r.hook, "utf8")).toBe(`#!/bin/sh\n${INS}\n# gitleaks git --pre-commit\n`);
  });

  test("gitleaks only after an exit (the audit's rule: not reachable): the line is inserted before it", () => {
    const r = repo(), text = `#!/bin/sh\nnpm test\nexit 0\n${LINE}\n`;
    put(r.hook, text);
    const s = r.run();
    expect(s.status).toBe(0);
    expect(s.out).not.toContain("already runs gitleaks");
    expect(readFileSync(r.hook, "utf8")).toBe(`#!/bin/sh\n${INS}\nnpm test\nexit 0\n${LINE}\n`);
  });

  // Each shape stops the hook early; the inserted line runs anyway (stub gitleaks leaves a mark), a leak (stub exit 1) fails the hook,
  // and a clean run (stub exit 0) leaves the hook's own exit code as it was.
  const SHAPES: Record<string, string> = {
    "cmd; exit 0": "npm test; exit 0\n",
    "cmd && exit 0": "npm test && exit 0\n",
    "tab-indented exit": "npm test\n\texit 0\n",
    "exit in a called function": "f() {\n  exit 0\n}\nf\n",
    "column-0 exit": "npm test\nexit 0\n",
    "exec": "exec npm test\n",
  };
  for (const [name, body] of Object.entries(SHAPES)) test(`a hook that stops early (${name}): gitleaks is inserted and runs`, () => {
    const r = repo(), text = `#!/bin/sh\n${body}`, bin = join(r.box, "stub"), mark = join(r.box, "gitleaks-ran");
    put(r.hook, text);
    expect(r.run().status).toBe(0);
    expect(readFileSync(r.hook, "utf8")).toBe(`#!/bin/sh\n${INS}\n${body}`);
    const orig = join(r.box, "orig-hook"), sh = (p: string) => spawnSync(p, [], { cwd: r.dir, env: { PATH: `${bin}:/usr/bin:/bin` } }).status;
    put(orig, text);
    put(join(bin, "npm"), "#!/bin/sh\nexit 0\n"); // npm passes: a non-zero exit can only come from gitleaks
    put(join(bin, "gitleaks"), `#!/bin/sh\ntouch "${mark}"\nexit 1\n`);
    expect(sh(r.hook)).not.toBe(0);
    expect(existsSync(mark)).toBe(true);
    put(join(bin, "gitleaks"), "#!/bin/sh\nexit 0\n");
    put(join(bin, "npm"), "#!/bin/sh\nexit 3\n"); // npm fails: the hook's own code must come through unchanged
    expect(sh(r.hook)).toBe(sh(orig));
  });

  test("a failed rename (injected through a --preload that makes fs.renameSync throw): the hook byte-identical, no temp file, exit 1", () => {
    const r = repo(), text = "#!/bin/sh\nnpm test\n", pre = join(r.box, "fail-rename.ts");
    put(r.hook, text, 0o700);
    writeFileSync(pre, 'import fs from "node:fs";\nfs.renameSync = () => { throw new Error("EPERM: injected"); };\n');
    const s = spawnSync(process.execPath, ["--preload", pre, SETUP, r.dir], { env: r.env, encoding: "utf8" });
    expect(s.status).toBe(1);
    expect(s.stdout).toContain(`by hand: ${realpathSync(r.hook)} left as it was; the rewrite failed: EPERM: injected`);
    expect(readFileSync(r.hook, "utf8")).toBe(text);
    expect(mode(r.hook)).toBe(0o700);
    expect(readdirSync(join(r.dir, ".git/hooks"))).toEqual(["pre-commit"]);
  });

  test.skipIf(process.getuid?.() === 0)("a hooks dir that cannot take a new file: the hook byte-identical, exit 1", () => {
    const r = repo(), text = "#!/bin/sh\nnpm test\n", hooks = join(r.dir, ".git/hooks");
    put(r.hook, text);
    chmodSync(hooks, 0o555);
    try {
      const s = r.run();
      expect(s.status).toBe(1);
      expect(s.out).toContain(`by hand: ${realpathSync(r.hook)} left as it was`);
      expect(readFileSync(r.hook, "utf8")).toBe(text);
      expect(readdirSync(hooks)).toEqual(["pre-commit"]);
    } finally { chmodSync(hooks, 0o755); }
  });

  test("a node hook: byte-identical, still runs, by hand, exit 1", () => {
    const r = repo(), text = '#!/usr/bin/env node\nconsole.log("ok")\n';
    put(r.hook, text);
    const s = r.run();
    expect(s.status).toBe(1);
    expect(s.out).toContain(`by hand: this hook is not a shell script; add a call to ${LINE} in its own language`);
    expect(readFileSync(r.hook, "utf8")).toBe(text);
    expect(spawnSync(process.execPath, [r.hook], { encoding: "utf8" }).stdout).toBe("ok\n");
  });

  test("shell shebangs, direct or through env: the line is inserted", () => {
    for (const sb of ["#!/usr/bin/env bash", "#!/usr/bin/env -S zsh -e", "#!/bin/dash"]) {
      const r = repo();
      put(r.hook, `${sb}\nnpm test\n`);
      expect(r.run().status).toBe(0);
      expect(readFileSync(r.hook, "utf8")).toBe(`${sb}\n${INS}\nnpm test\n`);
    }
  });

  test("core.hooksPath inside the repo: the hook lands there, .git/hooks untouched", () => {
    const r = repo();
    expect(r.git("config", "core.hooksPath", ".githooks").status).toBe(0);
    expect(r.run().status).toBe(0);
    expect(readFileSync(join(r.dir, ".githooks/pre-commit"), "utf8")).toBe(`#!/bin/sh\n${INS}\n`);
    expect(existsSync(join(r.dir, ".git/hooks"))).toBe(false);
  });

  test("core.hooksPath outside the repo: nothing written there, by hand, exit 1", () => {
    const r = repo(), shared = join(r.box, "shared-hooks");
    expect(r.git("config", "core.hooksPath", shared).status).toBe(0);
    const s = r.run();
    expect(s.status).toBe(1);
    expect(s.out).toContain(`by hand: core.hooksPath points outside this repo (${realpathSync(r.box)}/shared-hooks)`);
    expect(existsSync(shared)).toBe(false);
  });

  test("core.hooksPath ../ outside the repo: the message names the normalised path", () => {
    const r = repo();
    expect(r.git("config", "core.hooksPath", "../esc").status).toBe(0);
    const s = r.run();
    expect(s.status).toBe(1);
    expect(s.out).toContain(`by hand: core.hooksPath points outside this repo (${realpathSync(r.box)}/esc)`);
    expect(existsSync(join(r.box, "esc"))).toBe(false);
  });

  test("a symlinked hook: the outside target stays byte-identical, by hand naming the target, exit 1", () => {
    const r = repo(), target = join(r.box, "husky-pre-commit"), text = "#!/bin/sh\nnpm test\n";
    put(target, text);
    mkdirSync(join(r.dir, ".git/hooks"), { recursive: true });
    symlinkSync(target, r.hook);
    const s = r.run();
    expect(s.status).toBe(1);
    expect(s.out).toContain(`by hand: the pre-commit hook is a symlink to ${target}; add the gitleaks line there`);
    expect(readFileSync(target, "utf8")).toBe(text);
    expect(lstatSync(r.hook).isSymbolicLink() && readlinkSync(r.hook)).toBe(target);
  });
});

describe("local-setup.ts: the commit email", () => {
  test("global non-noreply + --email: the repo-local value is set, the global file untouched", () => {
    const g = "[user]\n\temail = t@example.invalid\n", r = repo(g);
    const s = r.run("--email", NOREPLY);
    expect(s.status).toBe(0);
    expect(r.git("config", "--local", "--get", "user.email").stdout.trim()).toBe(NOREPLY);
    expect(r.git("config", "--get", "user.email").stdout.trim()).toBe(NOREPLY);
    expect(readFileSync(r.global, "utf8")).toBe(g);
    expect(s.out).not.toContain("t@example.invalid");
  });

  test("no --email: no config write, the fix is printed", () => {
    const g = "[user]\n\temail = t@example.invalid\n", r = repo(g);
    const cfg = readFileSync(join(r.dir, ".git/config"), "utf8");
    const s = r.run();
    expect(s.status).toBe(0);
    expect(readFileSync(join(r.dir, ".git/config"), "utf8")).toBe(cfg);
    expect(readFileSync(r.global, "utf8")).toBe(g);
    expect(s.out).toContain(`git -C ${r.dir} config user.email <id>+<login>@users.noreply.github.com`);
    expect(s.out).not.toContain("t@example.invalid");
  });

  test("already noreply: --email does not write", () => {
    const r = repo("[user]\n\temail = 9+x@users.noreply.github.com\n");
    const cfg = readFileSync(join(r.dir, ".git/config"), "utf8");
    expect(r.run("--email", NOREPLY).status).toBe(0);
    expect(readFileSync(join(r.dir, ".git/config"), "utf8")).toBe(cfg);
  });

  test("an --email that is not <id>+<login>@users.noreply.github.com: refused, nothing written", () => {
    const r = repo();
    const s = r.run("--email", "me@example.com");
    expect(s.status).toBe(2);
    expect(existsSync(join(r.dir, ".git/hooks"))).toBe(false);
    expect(r.git("config", "--local", "--get", "user.email").status).toBe(1);
  });
});

describe("local-setup.ts: printed only", () => {
  test("the Synology exclusions, the probe and the worktree pointer", () => {
    const r = repo(), s = r.run();
    expect(s.out).toContain(`${r.dir}/.git\n`);
    expect(s.out).toContain(`${r.dir}/node_modules\n`);
    expect(s.out).toMatch(/probe: create a file under [^\n]*\.git[^\n]*does not sync it/);
    expect(s.out).toContain("CLAUDE.md §3");
    expect(s.out).toContain("~/tmp/repo-<task>");
    expect(existsSync(join(r.dir, "node_modules"))).toBe(false);
  });

  test("not a git repository: exit 2, nothing written", () => {
    const dir = join(ROOT, `plain${n++}`);
    mkdirSync(dir);
    const r = spawnSync(process.execPath, [SETUP, dir], { env: { ...ENV, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: ROOT }, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });
});
