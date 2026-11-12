// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// starter.ts (T5): a new repo's starter files, each written only when absent; an existing
// file stays byte-identical. `--level full` adds the LICENSE, the manifest key and source headers.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { ENV, writeGh } from "./fixture";

const STARTER = join(import.meta.dir, "../skills/repo-create/scripts/starter.ts");
const ROOT = mkdtempSync(join(tmpdir(), "repo-create-starter-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
let n = 0;
const YEAR = new Date().getFullYear();
const NODE_SOURCE = "# Logs\nlogs\n*.log\nnode_modules/\n";

/** A fresh folder named `acme_widget` (a private-prefix name that must never leak) holding these files. */
function tree(files: Record<string, string> = {}): string {
  const dir = join(ROOT, `t${n++}`, "acme_widget");
  mkdirSync(dir, { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
/** Runs starter.ts with a fake gh first on PATH and a HOME of its own (no render-docs.ts unless `renderDocs`). */
function run(dir: string, args: string[], renderDocs?: string, extraEnv: Record<string, string> = {}) {
  const box = dirname(dir), home = join(box, "home"), bin = join(box, "bin"), ghDir = join(box, "gh");
  for (const d of [home, bin, ghDir]) mkdirSync(d, { recursive: true });
  writeGh(ghDir, bin, { gitignore: { name: "Node", source: NODE_SOURCE } });
  if (renderDocs) { mkdirSync(join(home, ".claude/scripts"), { recursive: true }); writeFileSync(join(home, ".claude/scripts/render-docs.ts"), renderDocs); }
  const r = spawnSync(process.execPath, [STARTER, dir, ...args],
    { env: { ...ENV, PATH: `${bin}:${ENV.PATH}`, GH_DIR: ghDir, HOME: home, ...extraEnv }, encoding: "utf8", timeout: 20_000 });
  return { status: r.status ?? -1, out: r.stdout + r.stderr, calls: readFileSync(join(ghDir, "calls.log"), "utf8") };
}
/** `git init` + an origin remote, as `gh repo create --remote origin` leaves a clone. */
function origin(dir: string, url: string) {
  const env = { ...ENV, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const a of [["init", "-q"], ["remote", "add", "origin", url]]) expect(spawnSync("git", ["-C", dir, ...a], { env }).status).toBe(0);
}
// A stand-in for render-docs.ts that names the project as it does: origin's basename, else the folder's.
const RENDER = `const fs = require("node:fs"), p = require("node:path"), root = process.argv[2];
const o = require("node:child_process").spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" }).stdout.trim();
fs.writeFileSync(p.join(root, "docs/prd.html"), "<title>" + (o ? p.basename(o).replace(/\\.git$/, "") : p.basename(root)) + "</title>");`;
const MIT_FULL = ["--slug", "o/widget", "--license", "mit", "--level", "full"];
/** Every file under dir → its bytes, mode and mtime, so any write, touch or new file shows. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name), st = lstatSync(abs);
      if (st.isDirectory()) { out[relative(dir, abs) + "/"] = "dir"; walk(abs); }
      else if (st.isSymbolicLink()) out[relative(dir, abs)] = `link:${readlinkSync(abs)}`;
      else out[relative(dir, abs)] = `${st.mode}:${st.mtimeMs}:${readFileSync(abs, "base64")}`;
    }
  };
  walk(dir);
  return out;
}
const files = (dir: string) => Object.keys(snapshot(dir)).filter((p) => !p.endsWith("/")).sort();
const lines = (out: string, verb: string) => out.split("\n").filter((l) => l.startsWith(`${verb} `)).map((l) => l.slice(verb.length + 1)).sort();

describe("starter files", () => {
  test("a fresh folder: the created list printed is exactly the files on disk, the starter set", () => {
    const dir = tree();
    const r = run(dir, [...MIT_FULL, "--gitignore", "Node"]);
    expect(r.status).toBe(0);
    expect(lines(r.out, "created")).toEqual(files(dir));
    expect(files(dir)).toEqual([".github/pull_request_template.md", ".gitignore", "CODEOWNERS", "LICENSE", "README.md", "SECURITY.md",
      "docs/app-flow.md", "docs/backend-schema.md", "docs/design-brief.md", "docs/implementation-plan.md", "docs/prd.md", "docs/trd.md"]);
    expect(readFileSync(join(dir, "README.md"), "utf8").split("\n")[0]).toBe("# widget");
    expect(readFileSync(join(dir, "CODEOWNERS"), "utf8")).toBe("* @o\n");
    expect(readFileSync(join(dir, "SECURITY.md"), "utf8")).toBe(readFileSync(join(import.meta.dir, "../SECURITY.md"), "utf8"));
    const prd = readFileSync(join(dir, "docs/prd.md"), "utf8");
    expect(prd.split("\n")[0]).toBe("# Product Requirements: widget");
    expect(prd).toContain("MISSING");
    expect(r.out).toContain("render-docs.ts not found");
  });

  test("the folder name appears in no written file, .html included; the slug's repo name does", () => {
    const dir = tree();
    expect(run(dir, [...MIT_FULL, "--gitignore", "Node"], RENDER).status).toBe(0);
    for (const f of files(dir)) expect(readFileSync(join(dir, f), "utf8")).not.toContain("acme_widget");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("widget");
  });

  test("an existing README.md stays byte-for-byte and is reported kept", () => {
    const dir = tree({ "README.md": "X" });
    const r = run(dir, MIT_FULL);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("X");
    expect(lines(r.out, "kept")).toContain("README.md");
    expect(lines(r.out, "created")).not.toContain("README.md");
  });

  test("--dry-run creates and changes nothing, and calls no gh", () => {
    const dir = tree({ "README.md": "X", "package.json": '{"name":"w"}', "a.ts": "export {};\n" });
    const before = snapshot(dir);
    const r = run(dir, [...MIT_FULL, "--gitignore", "Node", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(r.calls).toBe("");
    expect(lines(r.out, "would create")).toContain("LICENSE");
    expect(lines(r.out, "would header")).toEqual(["a.ts"]);
  });

  test("--gitignore Node: .gitignore is the template's source, fetched by one GET", () => {
    const dir = tree();
    expect(run(dir, [...MIT_FULL, "--gitignore", "Node"]).status).toBe(0);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(NODE_SOURCE);
    const r2 = run(tree(), MIT_FULL);
    expect(r2.calls).toBe("");
  });

  test("render-docs.ts runs after the stubs under an origin named like the slug", () => {
    const dir = tree();
    origin(dir, "https://github.com/o/widget.git");
    expect(run(dir, MIT_FULL, RENDER).status).toBe(0);
    expect(readFileSync(join(dir, "docs/prd.html"), "utf8")).toBe("<title>widget</title>");
  });

  test("render-docs.ts gets the same git env as the origin check: a leaked GIT_DIR cannot point it at another repo", () => {
    const dir = tree(), other = join(dirname(dir), "other");
    mkdirSync(other);
    origin(dir, "https://github.com/o/widget.git");
    expect(spawnSync("git", ["-C", other, "init", "-q"], { env: { ...ENV, GIT_CONFIG_GLOBAL: "/dev/null" } }).status).toBe(0);
    expect(run(dir, MIT_FULL, RENDER, { GIT_DIR: join(other, ".git") }).status).toBe(0);
    expect(readFileSync(join(dir, "docs/prd.html"), "utf8")).toBe("<title>widget</title>");
    for (const f of files(dir).filter((f) => !f.startsWith(".git/"))) expect(readFileSync(join(dir, f), "utf8")).not.toContain("acme_widget");
  });

  for (const [why, url] of [["no remote", null], ["an origin named otherwise", "https://github.com/o/other.git"]] as const) {
    test(`render-docs.ts is not run with ${why}`, () => {
      const dir = tree();
      if (url) origin(dir, url);
      const r = run(dir, MIT_FULL, RENDER);
      expect(r.status).toBe(0);
      expect(existsSync(join(dir, "docs/prd.html"))).toBe(false);
      expect(r.out).toContain("no origin named widget; docs/*.html not rendered (run render-docs.ts after gh repo create)");
    });
  }

  test("--dry-run says it would render only when a stub would be created under a matching origin", () => {
    const d1 = tree();
    origin(d1, "https://github.com/o/widget.git");
    expect(run(d1, [...MIT_FULL, "--dry-run"], RENDER).out).toContain("would run render-docs.ts");
    expect(run(tree(), [...MIT_FULL, "--dry-run"], RENDER).out).not.toContain("would run render-docs.ts");
    const d3 = tree(Object.fromEntries(["prd", "trd", "app-flow", "design-brief", "backend-schema", "implementation-plan"].map((d) => [`docs/${d}.md`, "x"])));
    origin(d3, "https://github.com/o/widget.git");
    expect(run(d3, [...MIT_FULL, "--dry-run"], RENDER).out).not.toContain("would run render-docs.ts");
  });
});

describe("licence levels", () => {
  test("mit: LICENSE holds the MIT grant and the current year", () => {
    const dir = tree();
    expect(run(dir, MIT_FULL).status).toBe(0);
    const lic = readFileSync(join(dir, "LICENSE"), "utf8");
    expect(lic).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
    expect(lic).toContain(`Copyright (c) ${YEAR} Rafael Arciniegas`);
  });

  test("all-rights-reserved: LICENSE is the POLICY line; package.json gains UNLICENSED; headers are the one copyright line", () => {
    const dir = tree({ "package.json": '{"name":"w"}', "a.ts": "export {};\n" });
    expect(run(dir, ["--slug", "o/widget", "--license", "all-rights-reserved", "--level", "full"]).status).toBe(0);
    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toBe(`Copyright (c) ${YEAR} Rafael Arciniegas. All rights reserved.\n`);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).license).toBe("UNLICENSED");
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe(`// Copyright (c) ${YEAR} Rafael Arciniegas. All rights reserved.\nexport {};\n`);
  });

  test("package.json with a license key stays byte-identical; one without gains MIT; other manifests are by hand", () => {
    const has = '{ "name": "w",   "license": "ISC" }';
    const d1 = tree({ "package.json": has });
    const r1 = run(d1, MIT_FULL);
    expect(r1.status).toBe(0);
    expect(readFileSync(join(d1, "package.json"), "utf8")).toBe(has);
    expect(lines(r1.out, "kept")).toContain("package.json");
    const d2 = tree({ "package.json": '{"name":"w"}', "Cargo.toml": "[package]\n" });
    const r2 = run(d2, MIT_FULL);
    expect(JSON.parse(readFileSync(join(d2, "package.json"), "utf8"))).toEqual({ name: "w", license: "MIT" });
    expect(r2.out).toContain("by hand: Cargo.toml");
    expect(readFileSync(join(d2, "Cargo.toml"), "utf8")).toBe("[package]\n");
  });

  test("headers: a.ts gains the two lines, e.sh keeps its shebang on line 1; headed, non-source and third-party files unchanged", () => {
    const HDR = `// SPDX-License-Identifier: MIT\n// Copyright (c) 2025 Someone\n`;
    const dir = tree({ "a.ts": "export const a = 1;\n", "b.ts": `${HDR}export const b = 2;\n`, "c.md": "# c\n", "d.json": "{}\n",
      "e.sh": "#!/bin/sh\necho e\n", "node_modules/x/i.js": "x\n", "__fixtures__/f.ts": "x\n", ".github/workflows/ci.yml": "on: push\n" });
    chmodSync(join(dir, "e.sh"), 0o755);
    const keep = Object.fromEntries(["b.ts", "c.md", "d.json", "node_modules/x/i.js", "__fixtures__/f.ts"].map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    const r = run(dir, MIT_FULL);
    expect(r.status).toBe(0);
    expect(lines(r.out, "header")).toEqual([".github/workflows/ci.yml", "a.ts", "e.sh"]);
    const mit = `SPDX-License-Identifier: MIT\n`, cr = `Copyright (c) ${YEAR} Rafael Arciniegas\n`;
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe(`// ${mit}// ${cr}export const a = 1;\n`);
    expect(readFileSync(join(dir, "e.sh"), "utf8")).toBe(`#!/bin/sh\n# ${mit}# ${cr}echo e\n`);
    expect(statSync(join(dir, "e.sh")).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(dir, ".github/workflows/ci.yml"), "utf8")).toBe(`# ${mit}# ${cr}on: push\n`);
    for (const [f, c] of Object.entries(keep)) expect(readFileSync(join(dir, f), "utf8")).toBe(c);
  });

  test("extensionless shebang scripts: the leader follows the interpreter, and the script still runs; an unknown one is by hand", () => {
    const dir = tree({ "bin/cli": '#!/usr/bin/env node\nconsole.log("ok")\n', "bin/tool": "#!/usr/bin/env -S python3 -u\nprint('ok')\n",
      "bin/x": "#!/usr/bin/awk -f\n{ print }\n" });
    const r = run(dir, MIT_FULL);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, "bin/cli"), "utf8").split("\n")[1]).toBe("// SPDX-License-Identifier: MIT");
    expect(readFileSync(join(dir, "bin/tool"), "utf8").split("\n")[1]).toBe("# SPDX-License-Identifier: MIT");
    expect(readFileSync(join(dir, "bin/x"), "utf8")).toBe("#!/usr/bin/awk -f\n{ print }\n");
    expect(r.out).toContain("by hand: bin/x");
    // The real node when installed (it is on GitHub's runners), else bun, which parses the same JavaScript.
    const js = spawnSync(Bun.which("node") ?? process.execPath, [join(dir, "bin/cli")], { encoding: "utf8" });
    expect(js.stdout).toBe("ok\n");
  });

  test("a Python coding line stays on line 2: the header goes after it", () => {
    const src = Buffer.concat([Buffer.from('#!/usr/bin/env python3\n# -*- coding: latin-1 -*-\nprint("caf'), Buffer.from([0xe9]), Buffer.from('")\n')]);
    const dir = tree();
    writeFileSync(join(dir, "tool.py"), src);
    expect(run(dir, MIT_FULL).status).toBe(0);
    const out = readFileSync(join(dir, "tool.py"));
    expect(out.equals(Buffer.concat([src.subarray(0, src.indexOf("print")), Buffer.from(`# SPDX-License-Identifier: MIT\n# Copyright (c) ${YEAR} Rafael Arciniegas\n`), src.subarray(src.indexOf("print"))]))).toBe(true);
    const py = Bun.which("python3");
    if (py) expect(spawnSync(py, [join(dir, "tool.py")]).status).toBe(0);
  });

  test("a LICENSE that could not be written: no headers, no manifest key, exit 1", () => {
    const dir = tree({ "a.ts": "export {};\n", "package.json": '{"name":"w"}' });
    chmodSync(dir, 0o555); // the root refuses new files; the existing ones stay writable
    try {
      const r = run(dir, MIT_FULL);
      expect(r.status).toBe(1);
      expect(r.out).toContain("LICENSE not written; headers and the manifest key skipped");
      expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("export {};\n");
      expect(readFileSync(join(dir, "package.json"), "utf8")).toBe('{"name":"w"}');
    } finally { chmodSync(dir, 0o755); }
  });

  test("level none: no LICENSE, no manifest key, no headers", () => {
    const dir = tree({ "package.json": '{"name":"w"}', "a.ts": "export {};\n" });
    const r = run(dir, ["--slug", "o/widget", "--license", "mit", "--level", "none"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "LICENSE"))).toBe(false);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe('{"name":"w"}');
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("export {};\n");
  });
});

describe("refusals: exit 2, nothing written", () => {
  for (const [why, link, kind] of [["package.json → a file outside", "package.json", "file"], ["docs → a directory outside", "docs", "dir"],
    [".github → a directory outside", ".github", "dir"]] as const) {
    test(`a symlink out of the root: ${why}`, () => {
      const dir = tree({ "a.ts": "x\n" }), outside = join(dirname(dir), "outside");
      mkdirSync(outside);
      if (kind === "file") writeFileSync(join(outside, "package.json"), '{"name":"o"}');
      symlinkSync(kind === "file" ? join(outside, "package.json") : outside, join(dir, link));
      const [inBefore, outBefore] = [snapshot(dir), snapshot(outside)];
      const r = run(dir, MIT_FULL);
      expect(r.status).toBe(2);
      expect(snapshot(dir)).toEqual(inBefore);
      expect(snapshot(outside)).toEqual(outBefore);
    });
  }

  for (const [why, args, files] of [
    ["--license none with --level full", ["--slug", "o/widget", "--license", "none", "--level", "full"], {}],
    ["a level outside none|full", ["--slug", "o/widget", "--license", "mit", "--level", "3"], {}],
    ["no slug", ["--license", "mit", "--level", "none"], {}],
    ["an existing LICENSE of the other kind", MIT_FULL, { "LICENSE": "Copyright (c) 2026 X. All rights reserved.\n", "a.ts": "x\n" }],
  ] as [string, string[], Record<string, string>][]) {
    test(why, () => {
      const dir = tree(files);
      const before = snapshot(dir);
      const r = run(dir, args);
      expect(r.status).toBe(2);
      expect(snapshot(dir)).toEqual(before);
    });
  }
});
