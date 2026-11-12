// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// scan.ts (T4): read-only stack detection of a working tree, run as the CLI the
// skill calls. It reports secret names only and writes nothing.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ENV } from "./fixture";

const SCAN = join(import.meta.dir, "../skills/repo-create/scripts/scan.ts");
const ROOT = mkdtempSync(join(tmpdir(), "repo-create-scan-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
let n = 0;
const MiB = 1024 * 1024;
const HDR = "// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Rafael Arciniegas\n";
const SECRET = "abc123xyz";

/** A fresh tree with these files (no git repo: a new project may not be one). */
function tree(files: Record<string, string | Buffer>): string {
  const dir = join(ROOT, `t${n++}`);
  mkdirSync(dir, { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
// A timeout, so a scan that loops (a followed symlink) fails instead of hanging the suite.
const run = (dir: string, ...extra: string[]) => spawnSync(process.execPath, [SCAN, dir, ...extra], { env: ENV, encoding: "utf8", timeout: 20_000 });
function json(dir: string, ...extra: string[]) {
  const r = run(dir, "--json", ...extra);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}
/** Every entry under dir: path → kind, size, mtime and bytes, so any write, touch or new file shows. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name), st = statSync(p);
      out[p] = `${st.isDirectory() ? "d" : "f"} ${st.size} ${st.mtimeMs}` + (st.isFile() ? ` ${readFileSync(p).toString("base64")}` : "");
      if (st.isDirectory()) walk(p);
    }
  };
  out[dir] = `d ${statSync(dir).mtimeMs}`;
  walk(dir);
  return out;
}

describe("scan", () => {
  test("package.json + bun.lock: npm, its lockfile, a Node .gitignore, dependabot npm", () => {
    const s = json(tree({ "package.json": "{}", "bun.lock": "{}" }));
    expect(s.manifests).toEqual([{ path: "package.json", ecosystem: "npm" }]);
    expect(s.lockfiles).toEqual(["bun.lock"]);
    expect(s.suggest).toEqual({ dependabot: ["npm"], needsEnvironments: false, lfs: false, gitignore: "Node" });
  });

  test("each manifest maps to its ecosystem; workflows to github-actions", () => {
    const s = json(tree({ "pyproject.toml": "", "requirements.txt": "", "Cargo.toml": "", "go.mod": "", ".github/workflows/ci.yml": "on: push\n" }));
    expect(s.manifests.map((m: any) => `${m.path}=${m.ecosystem}`).sort()).toEqual(
      [".github/workflows/ci.yml=github-actions", "Cargo.toml=cargo", "go.mod=gomod", "pyproject.toml=pip", "requirements.txt=pip"]);
    expect(s.suggest.dependabot).toEqual(["cargo", "github-actions", "gomod", "pip"]);
    expect(s.suggest.gitignore).toBe("Python");
  });

  test("vercel.json is deploy config, so environments are needed", () => {
    const s = json(tree({ "package.json": "{}", "vercel.json": "{}" }));
    expect(s.deployConfig).toEqual(["vercel.json"]);
    expect(s.suggest.needsEnvironments).toBe(true);
  });

  test("a 6 MiB file is large at the 5 MiB default and not at --large-mb 10; the threshold is printed", () => {
    const dir = tree({ "assets/video.bin": Buffer.alloc(6 * MiB), "small.bin": Buffer.alloc(MiB) });
    const at5 = json(dir);
    expect(at5.largeMb).toBe(5);
    expect(at5.large).toEqual([{ path: "assets/video.bin", mb: 6 }]);
    expect(at5.suggest.lfs).toBe(true);
    expect(run(dir).stdout).toMatch(/^large files \(> 5 MiB\) +assets\/video\.bin \(6 MiB\)$/m);
    const at10 = json(dir, "--large-mb", "10");
    expect(at10.largeMb).toBe(10);
    expect(at10.large).toEqual([]);
    expect(at10.suggest.lfs).toBe(false);
    expect(run(dir, "--large-mb", "10").stdout).toMatch(/^large files \(> 10 MiB\) +—$/m);
  });

  test("the boundary: exactly 5 MiB is not large, one byte more is", () => {
    const s = json(tree({ "exact.bin": Buffer.alloc(5 * MiB), "over.bin": Buffer.alloc(5 * MiB + 1) }));
    expect(s.large.map((l: any) => l.path)).toEqual(["over.bin"]);
  });

  test("env files: KEY names are reported, never a value, in JSON or the table", () => {
    const dir = tree({
      ".env": `TOKEN=${SECRET}\n# COMMENTED=${SECRET}1\n`,
      "app/.env.local": `export API_KEY = "${SECRET}2"\nDB_URL=postgres://u:${SECRET}3@h/db\n` +
        // A multi-line quoted value: its body lines are shaped `WORD=` (base64 padding) and must never read as names.
        `PRIVATE_KEY="-----BEGIN KEY-----\n${SECRET}5=\nMIIB${SECRET}6==\n-----END KEY-----"\nAFTER=1\n` +
        "BT=`-----BEGIN KEY-----\n" + `${SECRET}10=\n` + "-----END KEY-----`\nAFTER_BT=1\n",
      // A backslash continues a line: `export K=abc\` then the value's next line.
      ".envrc": `export MULTI="a\n${SECRET}8=b"\nexport LAST='x\n${SECRET}9=y'\nexport K=abc\\\n${SECRET}12=more\nAFTER_K=1\n`,
    });
    const s = json(dir);
    expect(s.envFiles).toEqual([".env", ".envrc", "app/.env.local"]);
    // .envrc opens a multi-line quote on line 1: outside the plain-assignment grammar, so it is not read.
    expect(s.secretNames).toEqual(["AFTER", "AFTER_BT", "API_KEY", "BT", "DB_URL", "PRIVATE_KEY", "TOKEN"]);
    expect(s.stopped).toEqual([{ file: ".envrc", line: 1 }]);
    const t = run(dir);
    expect(t.status).toBe(0);
    expect(t.stdout).toContain("TOKEN");
    for (const out of [JSON.stringify(s), run(dir, "--json").stdout, t.stdout, t.stderr]) {
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("postgres");
      expect(out).not.toContain("MIIB");
    }
  });

  test("dotenv files: the names are exactly the keys dotenv reads; no value body comes back as a name", () => {
    const dir = tree({
      ".env": [
        "MSG=don't", "L='line1", `${SECRET}61=`, "'", // an apostrophe mid-value is literal to dotenv
        `K=abc"def`, `M="x`, `${SECRET}62=`, `"`, // so is a quote mid-value
        "K2=abc#it's", "N='y", `${SECRET}63=`, "'", // `#` after an unquoted value starts a comment
        "K4='abc\\'", `${SECRET}40=`, "'", // dotenv honours \' inside '…'
        `K3="a\\"b`, `${SECRET}32=`, `c"`, // and \" inside "…"
        "my.key=1", "KEY: value", "",
      ].join("\n"),
      // CRLF is dotenv's LF: after `COLON:` its value is the next line, which must not read as a key.
      ".env.crlf": `COLON:\r\n${SECRET}50=\r\nAFTER_C=1\r\n`,
      ".env.bom": "﻿FIRST=1\n",
    });
    const s = json(dir);
    expect(s.secretNames).toEqual(["AFTER_C", "COLON", "FIRST", "K", "K2", "K3", "K4", "KEY", "L", "M", "MSG", "N", "my.key"]);
    expect(s.stopped).toEqual([]);
    const t = run(dir);
    expect(t.status).toBe(0);
    for (const out of [JSON.stringify(s), t.stdout, t.stderr]) expect(out).not.toContain(SECRET);
  });

  test(".envrc: plain assignments are read; at the first other line reading stops, and the stop is reported", () => {
    const dir = tree({ ".envrc": `# direnv\n\nexport A=1\nB='two' # it's\nexport C="three"\nE=x#y\nuse nix\nD=4\n` });
    const s = json(dir);
    expect(s.secretNames).toEqual(["A", "B", "C", "E"]);
    expect(s.stopped).toEqual([{ file: ".envrc", line: 7 }]);
    expect(run(dir).stdout).toMatch(/^\.envrc: stopped at line 7 \(not read further\)$/m);
    // A BOM and CRLF endings are not grammar violations.
    const ok = json(tree({ ".envrc": "﻿export A=1\r\nB=2\r\n" }));
    expect([ok.secretNames, ok.stopped]).toEqual([["A", "B"], []]);
    // A `\` + CRLF continuation is shell, so it lives here: reading stops at it, and the continued line is never read.
    const crlf = tree({ ".envrc": `export OK=1\r\nexport C=abc\\\r\n${SECRET}33=x\r\nAFTER_C=1\r\n` });
    const c = json(crlf), ct = run(crlf);
    expect([c.secretNames, c.stopped]).toEqual([["OK"], [{ file: ".envrc", line: 2 }]]);
    for (const out of [JSON.stringify(c), ct.stdout, ct.stderr]) expect(out).not.toContain(SECRET);
  });

  test(".envrc.* and .env* with a shell suffix are shell by name alone: a continued line is never read as a name, and the stop is reported", () => {
    // No `<<` and no shebang, so only the name routes these files; dotenv would read the continued line as a key.
    const body = `export OK=1\nexport K=abc\\\n${SECRET}80=x\n`;
    // `.env.SH` sits in its own dir: on a case-insensitive filesystem (macOS) it would overwrite `.env.sh`.
    const shell = [".env.bash", ".env.fish", ".env.ksh", ".env.sh", ".env.sh.local", ".env.zsh", ".envrc.local", "u/.env.SH"];
    const dir = tree(Object.fromEntries(shell.map((f) => [f, body])));
    const s = json(dir), t = run(dir);
    expect(s.secretNames).toEqual(["OK"]);
    expect(s.stopped).toEqual(shell.map((file) => ({ file, line: 2 })));
    for (const f of shell) expect(t.stdout).toContain(`\n${f}: stopped at line 2 (not read further)\n`);
    for (const out of [JSON.stringify(s), t.stdout, t.stderr]) expect(out).not.toContain(SECRET);
  });

  test("content routes to the shell reader too: a shebang or a heredoc, whatever the file's name", () => {
    const dir = tree({
      ".env.local": `export OK=1\ncat > /dev/null <<EOF\n${SECRET}80=\nEOF\n`, // a heredoc
      "s/.env": `#!/bin/sh\nexport OK2=1\nexport K=abc\\\n${SECRET}82=x\n`, // a shebang; dotenv would read line 4 as a key
    });
    const s = json(dir), t = run(dir);
    expect(s.secretNames).toEqual(["OK", "OK2"]);
    expect(s.stopped).toEqual([{ file: ".env.local", line: 2 }, { file: "s/.env", line: 3 }]);
    expect(t.stdout).toContain("\n.env.local: stopped at line 2 (not read further)\n");
    for (const out of [JSON.stringify(s), t.stdout, t.stderr]) expect(out).not.toContain(SECRET);
  });

  test("the trade-off: a dotenv file whose value holds `<<` is read as shell, and the stop is reported", () => {
    const s = json(tree({ ".env": "A=1\nB=x<<y\n" }));
    expect(s.secretNames).toEqual(["A"]);
    expect(s.stopped).toEqual([{ file: ".env", line: 2 }]);
  });

  test(".envrc: each construct outside the grammar stops reading at its line, so no value body is read", () => {
    // Line 2 of each file; the lines after it would read as names if line 2 were accepted.
    const bad: Record<string, string> = {
      semicolonComment: "export A=1;# it's", ansiC: "export K=$'it\\'s'", heredoc: "cat <<EOF",
      sq: "A=it's", dq: `A=ab"c`, backslash: "A=abc\\", dollar: "A=${X:-", backtick: "A=`echo",
      semi: "A=1;B=2", amp: "A=1&&B=2", pipe: "A=1|cat", lparen: "A=(a", rparen: "A=x)", lt: "A=x<<E", gt: "A=x>f",
      sqInside: "A='a'b'", dqInside: `A="a"b"`, dqBackslash: `A="a\\"`, dqDollar: `A="$HOME"`, dqBacktick: "A=\"`x`\"",
    };
    const dir = tree(Object.fromEntries(Object.entries(bad).map(([k, line]) =>
      [`${k}/.envrc`, `export OK=1\n${line}\n${SECRET}${k}=\n'"\`)}\nEOF\n`])));
    const s = json(dir);
    expect(s.secretNames).toEqual(["OK"]);
    expect(s.stopped).toEqual(Object.keys(bad).sort().map((k) => ({ file: `${k}/.envrc`, line: 2 })));
    const t = run(dir);
    for (const out of [JSON.stringify(s), t.stdout, t.stderr]) expect(out).not.toContain(SECRET);
  });

  test("headers: a .ts with and one without a header count 1 of 2", () => {
    const s = json(tree({ "a.ts": `${HDR}export {};\n`, "b.ts": "export {};\n" }));
    expect(s.headers).toEqual({ sources: 2, withHeader: 1 });
  });

  test("headers follow POLICY's source-file definition: shebang counts, docs and JSON do not, line 4 is too late", () => {
    const s = json(tree({
      "bin/run": `#!/bin/sh\n# SPDX-License-Identifier: MIT\n`,
      "README.md": HDR, "data.json": "{}",
      "late.py": "#\n#\n#\n# SPDX-License-Identifier: MIT\n",
      ".github/workflows/ci.yml": `# SPDX-License-Identifier: MIT\non: push\n`,
    }));
    expect(s.headers).toEqual({ sources: 3, withHeader: 2 });
  });

  test("licence: the LICENSE file and whether line 1 says MIT", () => {
    expect(json(tree({ LICENSE: "MIT License\n\nCopyright (c) 2026\n" })).licence).toEqual({ path: "LICENSE", mit: true });
    expect(json(tree({ "LICENSE.md": "Copyright (c) 2026 Rafael Arciniegas. All rights reserved.\nMIT\n" })).licence).toEqual({ path: "LICENSE.md", mit: false });
  });

  test("needsEnvironments: a deploying workflow, or a deploy-like secret name, with no deploy config file", () => {
    const wf = (name: string) => `name: ${name}\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n`;
    const pr = `name: CI deploy check\non:\n  pull_request:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n`;
    expect(json(tree({ ".github/workflows/release.yml": wf("Deploy") })).suggest.needsEnvironments).toBe(true);
    expect(json(tree({ ".github/workflows/deploy.yml": wf("Ship") })).suggest.needsEnvironments).toBe(true);
    expect(json(tree({ ".env": "VERCEL_TOKEN=\n" })).suggest.needsEnvironments).toBe(true);
    // Negative control: the PR-triggered CI workflow is never the deploy, even named so; plain names and a non-secret id are not deploy-like.
    expect(json(tree({ ".github/workflows/ci.yml": pr, ".github/workflows/release.yml": wf("Release"),
      ".env": "TOKEN=\nVERCEL_PROJECT_ID=\n" })).suggest.needsEnvironments).toBe(false);
  });

  test("a symlink loop is not followed: exit 0, no hang", () => {
    const dir = tree({ "package.json": "{}" });
    symlinkSync(".", join(dir, "loop"));
    const r = run(dir, "--json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).manifests).toEqual([{ path: "package.json", ecosystem: "npm" }]);
  });

  test("a directory named .env* is a virtualenv, skipped like .venv", () => {
    const s = json(tree({ ".env/lib/site.py": "x\n", ".env/pyvenv.cfg": "home=x\n", ".env.d/lib/a.py": "x\n", ".env-old/b.py": "x\n",
      ".envoy/c.py": "x\n" }));
    expect(s.envFiles).toEqual([]);
    // Only .env and .env.* / .env-* are virtualenv names; .envoy/ is walked.
    expect(s.headers.sources).toBe(1);
  });

  test("sources inside migrations, fixtures, vendor, third_party and generated dirs are not counted; the dirs are still scanned", () => {
    const s = json(tree({ "a.ts": "x\n", "migrations/m.ts": "x\n", ".next/server/p.js": "x\n", "fixtures/f.py": "x\n", "__fixtures__/f.ts": "x\n", "vendor/v.js": "x\n",
      "third_party/t.sh": "x\n", "coverage/lcov.js": "x\n", "out/o.js": "x\n", "migrations/.env": "DB_URL=x\n" }));
    expect(s.headers).toEqual({ sources: 1, withHeader: 0 });
    expect(s.secretNames).toEqual(["DB_URL"]);
  });

  test("node_modules, .git, .venv, target, dist and build are skipped", () => {
    const s = json(tree(Object.fromEntries(["node_modules/x", ".git", ".venv/lib", "target", "dist", "build"].map((d) => [`${d}/package.json`, "{}"]))));
    expect(s.manifests).toEqual([]);
    expect(s.suggest.gitignore).toBeNull();
  });

  test("empty dir: every list empty, exit 0", () => {
    const r = run(tree({}), "--json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      largeMb: 5, manifests: [], lockfiles: [], deployConfig: [], large: [], envFiles: [], secretNames: [], stopped: [], licence: null,
      headers: { sources: 0, withHeader: 0 }, suggest: { dependabot: [], needsEnvironments: false, lfs: false, gitignore: null },
    });
    expect(run(tree({})).status).toBe(0);
  });

  test("usage: a missing path or a bad --large-mb exits 2", () => {
    expect(run(join(ROOT, "absent")).status).toBe(2);
    expect(run(tree({}), "--large-mb", "x").status).toBe(2);
  });

  test("writes nothing: same entries, bytes and mtimes after a JSON and a table run", () => {
    const dir = tree({ "package.json": "{}", "bun.lock": "{}", "vercel.json": "{}", ".env": `TOKEN=${SECRET}\n`,
      "a.ts": `${HDR}x\n`, "big.bin": Buffer.alloc(6 * MiB), "node_modules/x/package.json": "{}" });
    const before = snapshot(dir);
    expect(run(dir, "--json").status).toBe(0);
    expect(run(dir).status).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });
});
