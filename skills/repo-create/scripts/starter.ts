// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// A new repo's starter files, each written only when absent (an existing file is left byte-identical and
// reported kept). `--level full` adds the LICENSE, the manifest `license` key and a header in every source
// file, which follows the LICENSE text (POLICY "Licensing"). GitHub is only read (one GET, for .gitignore).
// Exit 0 when done; 1 when a file could not be written or fetched; 2 on usage or a refusal (nothing written).
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { ghGet } from "./lib/gh.ts";
import { NOT_SOURCE_DIRS, SKIP, hasHeader, head, isSource } from "./scan.ts";

const TPL = join(import.meta.dir, "../templates");
const DOCS = ["prd", "trd", "app-flow", "design-brief", "backend-schema", "implementation-plan"];
// A shebang interpreter's comment leader; any other interpreter is left by hand (a wrong leader stops the file running).
const SLASH = /^(node|bun|deno|tsx)$/, HASH = /^(sh|bash|zsh|dash|ksh|python[0-9.]*|ruby|perl)$/;
// PEP 263: a coding declaration counts only on line 1 or 2, so the header goes after it.
const CODING = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;
// Manifests with a licence field this script does not edit.
const BY_HAND = ["pyproject.toml", "Cargo.toml"];

const USAGE = "usage: bun starter.ts <path> --slug <owner/name> --license mit|all-rights-reserved|none --level none|full [--gitignore <Template>] [--dry-run]";
const refuse = (msg: string): never => { console.error(`${msg}; nothing written\n${USAGE}`); process.exit(2); };

const args = process.argv.slice(2);
let root = "", slug = "", license = "", level = "", gitignore = "", dry = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") dry = true;
  else if (a === "--slug") slug = args[++i] ?? "";
  else if (a === "--license") license = args[++i] ?? "";
  else if (a === "--level") level = args[++i] ?? "";
  else if (a === "--gitignore") gitignore = args[++i] ?? "";
  else if (a.startsWith("-") || root) refuse(`unexpected argument ${a}`);
  else root = a;
}
if (!root) refuse("no path");
try { if (!statSync(root).isDirectory()) refuse(`${root} is not a directory`); } catch { refuse(`${root} is not a directory`); }
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) refuse("--slug must be <owner>/<name>");
if (!["mit", "all-rights-reserved", "none"].includes(license)) refuse("--license must be mit, all-rights-reserved or none");
if (!["none", "full"].includes(level)) refuse("--level must be none or full");
if (license === "none" && level === "full") refuse("--level full needs a licence (--license mit or all-rights-reserved)");
if (gitignore && !/^[A-Za-z0-9_+.-]+$/.test(gitignore)) refuse("--gitignore must be a GitHub template name, e.g. Node");

const [owner, name] = slug.split("/");
const vars: Record<string, string> = { name, owner, year: String(new Date().getFullYear()) };
// A function replacer: a value is never read as a `$&` pattern.
const fill = (t: string) => readFileSync(join(TPL, t), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]);
const at = (p: string) => join(root, p);
const exists = (p: string) => { try { lstatSync(at(p)); return true; } catch { return false; } };
const mit = license === "mit";

// The LICENSE, existing or to be written, decides the header: an existing one of another kind is refused.
let licence: string | null = null, header: string[] = [];
if (level === "full") {
  if (existsSync(at("LICENSE"))) {
    licence = readFileSync(at("LICENSE"), "utf8");
    const isMit = /\bMIT\b/.test(licence.split("\n")[0]); // scan.ts's reading of a LICENSE
    if (mit ? !isMit : isMit || !/All rights reserved\./.test(licence)) refuse(`LICENSE exists and is not ${license}`);
  } else licence = fill(mit ? "LICENSE-MIT" : "LICENSE-ARR");
  const m = /^Copyright \(c\) (\S+) (.+?)(?:\. All rights reserved\.)?\s*$/m.exec(licence);
  if (!m) refuse("LICENSE has no `Copyright (c) <year> <holder>` line to take the header from");
  const [, year, holder] = m!;
  header = mit ? ["SPDX-License-Identifier: MIT", `Copyright (c) ${year} ${holder}`] : [`Copyright (c) ${year} ${holder}. All rights reserved.`];
}

const files: [string, () => string][] = [
  ["README.md", () => fill("README.md")],
  ["SECURITY.md", () => fill("SECURITY.md")],
  ...(licence ? [["LICENSE", () => licence!] as [string, () => string]] : []),
  ...(gitignore ? [[".gitignore", () => {
    const r = ghGet(`gitignore/templates/${gitignore}`);
    if (!r.ok || typeof r.data?.source !== "string") throw new Error(r.ok ? "no source in the answer" : r.msg);
    return r.data.source;
  }] as [string, () => string]] : []),
  ["CODEOWNERS", () => fill("CODEOWNERS")],
  [".github/pull_request_template.md", () => fill("pull_request_template.md")],
  ...DOCS.map((d) => [`docs/${d}.md`, () => fill(`docs/${d}.md`)] as [string, () => string]),
];
// Every path this run may write, and each parent it may create, is refused if any component is a symlink:
// a write through one lands outside the root.
for (const p of [...files.map(([p]) => p), ...(licence ? ["package.json"] : [])]) {
  const parts = p.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join("/");
    if (!exists(sub)) break;
    if (lstatSync(at(sub)).isSymbolicLink()) refuse(`${sub} is a symlink`);
  }
}

let failed = false, docs = 0;
for (const [p, content] of files) {
  if (exists(p)) { console.log(`kept ${p}`); continue; }
  if (dry) { console.log(`would create ${p}`); if (p.startsWith("docs/")) docs++; continue; }
  try {
    const c = content();
    mkdirSync(dirname(at(p)), { recursive: true });
    writeFileSync(at(p), c, { flag: "wx" }); // wx: never overwrite, even a file that appeared since the check
    console.log(`created ${p}`);
    if (p.startsWith("docs/")) docs++;
  } catch (e) { console.log(`FAILED ${p}: ${(e as Error).message}`); failed = true; }
}

// render-docs names the project after origin, else after the folder (which may carry a private prefix): it runs
// only under an origin named like the slug.
const render = join(homedir(), ".claude/scripts/render-docs.ts");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const origin = docs ? spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { env, encoding: "utf8" }).stdout?.trim() ?? "" : "";
if (!existsSync(render)) console.log(`render-docs.ts not found at ${render}; docs/*.html not rendered`);
else if (!docs) console.log("no docs stub created; render-docs.ts not run");
else if (basename(origin).replace(/\.git$/, "") !== name) console.log(`no origin named ${name}; docs/*.html not rendered (run render-docs.ts after gh repo create)`);
else if (dry) console.log("would run render-docs.ts");
else {
  const r = spawnSync(process.execPath, [render, root], { env, stdio: "inherit" });
  if (r.status !== 0) { console.log("FAILED render-docs.ts"); failed = true; }
}

if (licence && !dry && !exists("LICENSE")) { console.log("LICENSE not written; headers and the manifest key skipped"); failed = true; }
else if (licence) {
  const key = mit ? "MIT" : "UNLICENSED";
  if (existsSync(at("package.json"))) {
    let pkg: any;
    try { pkg = JSON.parse(readFileSync(at("package.json"), "utf8")); } catch {}
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) console.log(`by hand: package.json (not a JSON object) — add "license": "${key}"`);
    else if ("license" in pkg) console.log("kept package.json");
    else if (dry) console.log(`would add "license": "${key}" to package.json`);
    // shortcut: rewrites with 2-space JSON.stringify, upgrade to a format-preserving edit if a repo complains
    else { writeFileSync(at("package.json"), JSON.stringify({ ...pkg, license: key }, null, 2) + "\n"); console.log(`added "license": "${key}" to package.json`); }
  }
  for (const m of BY_HAND) if (existsSync(at(m))) console.log(`by hand: ${m} — add the licence (${key})`);

  // The headers pass: every file is listed before any is changed.
  const todo: [string, string][] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir).sort()) {
      const abs = join(dir, n), rel = relative(root, abs), st = lstatSync(abs);
      if (st.isDirectory()) { if (!SKIP(n) && !NOT_SOURCE_DIRS.has(n)) walk(abs); continue; }
      if (!st.isFile()) continue; // symlinks are not followed
      const text = st.size ? head(abs) : "";
      if (!isSource(rel, text) || hasHeader(text)) continue;
      const lead = leader(rel, text);
      if (lead) todo.push([rel, lead]); else console.log(`by hand: ${rel} — header for an unknown interpreter`);
    }
  };
  walk(root);
  for (const [rel] of todo) console.log(`${dry ? "would header" : "header"} ${rel}`);
  if (!dry) for (const [rel, lead] of todo) {
    const buf = readFileSync(at(rel)), end = (from: number) => (buf.indexOf(10, from) + 1) || buf.length;
    // After a shebang line (which must stay line 1) and a coding line; bytes, so a file that is not UTF-8 is not re-encoded.
    let cut = buf[0] === 0x23 && buf[1] === 0x21 ? end(0) : 0;
    if (CODING.test(buf.subarray(cut, end(cut)).toString("latin1"))) cut = end(cut);
    const nl = cut && buf[cut - 1] !== 10 ? "\n" : "";
    writeFileSync(at(rel), Buffer.concat([buf.subarray(0, cut), Buffer.from(nl + header.map((l) => `${lead} ${l}\n`).join("")), buf.subarray(cut)]));
  }
}
process.exit(failed ? 1 : 0);

/** The comment leader for a source file: from its extension, else from its shebang interpreter; null when unknown. */
function leader(rel: string, text: string): string | null {
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(rel)) return "//";
  if (/\.(sh|py|ya?ml)$/.test(rel)) return "#";
  const words = text.split("\n")[0].slice(2).trim().split(/\s+/);
  const prog = (w?: string) => w?.slice(w.lastIndexOf("/") + 1) ?? "";
  // `#!/usr/bin/env [-S] node …` names the interpreter after env and its flags.
  const it = prog(words[0]) === "env" ? prog(words.slice(1).find((w) => !w.startsWith("-"))) : prog(words[0]);
  return SLASH.test(it) ? "//" : HASH.test(it) ? "#" : null;
}
