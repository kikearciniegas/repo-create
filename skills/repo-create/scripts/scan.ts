// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// Read-only stack detection of a working tree (not necessarily a git repo): manifests,
// lockfiles, deploy configs, large files, env files and their KEY names, read as their own tool reads them
// (dotenv's grammar; .envrc only while it stays plain assignments, then the stop is reported),
// the LICENSE, source-file headers, and what to suggest from them. Writes nothing.
// Exit 0 on a scan; 2 on usage or a path that is not a directory.
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DEPLOYISH } from "./lib/deploy.ts";

// A directory named .env, .env.* or .env-* is a virtualenv, skipped like .venv.
export const SKIP = (name: string) => [".git", "node_modules", ".venv", "target", "dist", "build"].includes(name) || name === ".env" || /^\.env[.-]/.test(name);
const MANIFESTS: Record<string, string> = { "package.json": "npm", "pyproject.toml": "pip", "requirements.txt": "pip", "Cargo.toml": "cargo", "go.mod": "gomod" };
const LOCKFILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
  "poetry.lock", "uv.lock", "Pipfile.lock", "Cargo.lock", "go.sum"]);
const DEPLOY = new Set(["vercel.json", "wrangler.toml", "fly.toml", "netlify.toml"]);
// POLICY "A source file": these extensions, workflow .yml, and any file with a shebang.
const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs|sh|py)$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
// POLICY: never a source file inside third-party, generated, migration or fixture directories. Only the source-file
// count skips them: the rest of the scan (env files, manifests, large files) still reads them.
export const NOT_SOURCE_DIRS = new Set(["migrations", "fixtures", "vendor", "third_party", "node_modules", "dist", "build", "target", ".next", "coverage", "out", "__fixtures__"]);
/** POLICY "A source file", from its path relative to the root and its first bytes. */
export const isSource = (relPath: string, text: string) => !relPath.split("/").slice(0, -1).some((d) => NOT_SOURCE_DIRS.has(d))
  && (SOURCE_EXT.test(relPath) || WORKFLOW.test(relPath) || text.startsWith("#!"));
/** A licence header in the first 3 lines. */
export const hasHeader = (text: string) => /SPDX-License-Identifier|Copyright \(c\)/.test(text.split("\n").slice(0, 3).join("\n"));
const GITIGNORE = [["npm", "Node"], ["pip", "Python"], ["cargo", "Rust"], ["gomod", "Go"]] as const;
const MiB = 1024 * 1024;

export type Scan = {
  largeMb: number;
  manifests: { path: string; ecosystem: string }[];
  lockfiles: string[];
  deployConfig: string[];
  large: { path: string; mb: number }[];
  envFiles: string[];
  secretNames: string[];
  stopped: { file: string; line: number }[];
  licence: { path: string; mit: boolean } | null;
  headers: { sources: number; withHeader: number };
  suggest: { dependabot: string[]; needsEnvironments: boolean; lfs: boolean; gitignore: "Node" | "Python" | "Rust" | "Go" | null };
};

/** The first `n` bytes of a file, without reading the rest (a large file stays unread). */
export function head(file: string, n = 4096): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(n);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, n, 0));
  } finally { closeSync(fd); }
}

/* Portions BSD-2-Clause: the LINE regex below is dotenv 17.3.1 lib/main.js:46 (github.com/motdotla/dotenv), verbatim. dotenv LICENSE, verbatim:
 * Copyright (c) 2015, Scott Motte
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice, this
 *   list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg
/** The keys dotenv's own parser reads from a .env file: its LINE regex after its own `\r\n?` → `\n`. */
export const dotenvNames = (text: string) => [...text.replace(/\r\n?/g, "\n").matchAll(LINE)].map((m) => m[1]);

// .envrc is shell. Only plain one-line assignments are read: an unquoted token with no quote, `\`, `$`, backtick,
// `;&|()` or `<>` (a heredoc), a '…' with no ', or a "…" with no ", `\`, `$` or backtick; then optional `# comment`.
const ENVRC_OK = /^[ \t]*(?:#.*)?$|^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(?:[^\s'"\\$`;&|()<>]*|'[^']*'|"[^"\\$`]*")(?:[ \t]+#.*)?[ \t]*$/;
/** The names of an .envrc up to its first line outside that grammar; `stopped` is that line (1-based), if any. */
export function envrcNames(text: string): { names: string[]; stopped?: number } {
  const names: string[] = [], lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = ENVRC_OK.exec(lines[i].replace(/\r$/, ""));
    if (!m) return { names, stopped: i + 1 };
    if (m[1]) names.push(m[1]);
  }
  return { names };
}

export function scan(root: string, largeMb = 5): Scan {
  const s: Scan = { largeMb, manifests: [], lockfiles: [], deployConfig: [], large: [], envFiles: [], secretNames: [], stopped: [], licence: null,
    headers: { sources: 0, withHeader: 0 }, suggest: { dependabot: [], needsEnvironments: false, lfs: false, gitignore: null } };
  const names = new Set<string>();
  const workflows: { path: string; y: any; on: Record<string, any> }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name), rel = relative(root, abs), st = lstatSync(abs);
      if (st.isDirectory()) { if (!SKIP(name)) walk(abs); continue; }
      if (!st.isFile()) continue; // symlinks are not followed: they can loop or leave the tree
      if (name in MANIFESTS) s.manifests.push({ path: rel, ecosystem: MANIFESTS[name] });
      if (WORKFLOW.test(rel)) {
        s.manifests.push({ path: rel, ecosystem: "github-actions" });
        try { // as audit.ts parses workflows; an unparsable one cannot be judged a deploy
          const y = Bun.YAML.parse(readFileSync(abs, "utf8")) as any, o = y?.on ?? y?.true;
          workflows.push({ path: rel, y, on: typeof o === "string" ? { [o]: null } : Array.isArray(o) ? Object.fromEntries(o.map((k) => [k, null])) : (o ?? {}) });
        } catch {}
      }
      if (LOCKFILES.has(name)) s.lockfiles.push(rel);
      if (DEPLOY.has(name)) s.deployConfig.push(rel);
      if (st.size > largeMb * MiB) s.large.push({ path: rel, mb: Math.round((st.size / MiB) * 10) / 10 });
      if (name.startsWith("LICENSE") && dir === root)
        s.licence = { path: rel, mit: /\bMIT\b/.test(head(abs).split("\n")[0]) };
      if (name.startsWith(".env")) {
        s.envFiles.push(rel);
        const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
        // Shell (fail closed): .envrc and its variants (.envrc.local), .env* with a .sh/.bash/.zsh/.ksh/.fish part in any case
        // (.env.sh.local, .env.SH), and any .env* whose text starts with a shebang or holds `<<` (a heredoc) — a dotenv value
        // with `<<` then costs a reported stop, never a leak. Every other .env* file is dotenv.
        const shell = name.startsWith(".envrc") || /\.(sh|bash|zsh|ksh|fish)(\.|$)/i.test(name) || text.startsWith("#!") || text.includes("<<");
        const r = shell ? envrcNames(text) : { names: dotenvNames(text) };
        for (const n of r.names) names.add(n);
        if ("stopped" in r && r.stopped) s.stopped.push({ file: rel, line: r.stopped });
      }
      const text = st.size ? head(abs) : "";
      if (isSource(rel, text)) {
        s.headers.sources++;
        if (hasHeader(text)) s.headers.withHeader++;
      }
    }
  };
  walk(root);
  s.secretNames = [...names].sort();
  const eco = new Set(s.manifests.map((m) => m.ecosystem));
  // Mirrors audit.ts:73–74: CI is the PR-triggered workflow with the most jobs; a deploy is any other named or filed /deploy/i.
  const jobs = (w: (typeof workflows)[number]) => Object.keys(w.y?.jobs ?? {}).length;
  const ci = workflows.filter((w) => "pull_request" in w.on).sort((a, b) => jobs(b) - jobs(a))[0];
  const deployWorkflow = workflows.some((w) => w !== ci && (/deploy/i.test(w.path.slice(w.path.lastIndexOf("/") + 1)) || /deploy/i.test(String(w.y?.name ?? ""))));
  s.suggest = {
    dependabot: [...eco].sort(),
    needsEnvironments: s.deployConfig.length > 0 || deployWorkflow || s.secretNames.some((n) => DEPLOYISH.test(n)),
    lfs: s.large.length > 0,
    gitignore: GITIGNORE.find(([e]) => eco.has(e))?.[1] ?? null,
  };
  return s;
}

function table(s: Scan): string {
  const list = (a: string[]) => (a.length ? a.join(", ") : "—");
  return [
    ["manifests", list(s.manifests.map((m) => `${m.ecosystem} (${m.path})`))],
    ["lockfiles", list(s.lockfiles)],
    ["deploy config", list(s.deployConfig)],
    [`large files (> ${s.largeMb} MiB)`, list(s.large.map((l) => `${l.path} (${l.mb} MiB)`))],
    ["env files", list(s.envFiles)],
    ["secret names", list(s.secretNames)],
    ...s.stopped.map((x) => [`${x.file}: stopped at line ${x.line} (not read further)`, ""]),
    ["licence", s.licence ? `${s.licence.path}${s.licence.mit ? " (MIT)" : ""}` : "—"],
    ["headers", `${s.headers.withHeader} of ${s.headers.sources} source files`],
    ["suggest dependabot", list(s.suggest.dependabot)],
    ["suggest environments", s.suggest.needsEnvironments ? "yes" : "no"],
    ["suggest lfs", s.suggest.lfs ? "yes" : "no"],
    ["suggest .gitignore", s.suggest.gitignore ?? "—"],
  ].map(([k, v]) => `${k.padEnd(24)}${v}`).join("\n");
}

if (import.meta.main) {
  const usage = (): never => { console.error("usage: bun scan.ts <path> [--large-mb <n>] [--json]"); process.exit(2); };
  const args = process.argv.slice(2);
  let path = "", largeMb = 5, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--large-mb") { largeMb = Number(args[++i]); if (!(largeMb > 0)) usage(); }
    else if (a.startsWith("-") || path) usage();
    else path = a;
  }
  if (!path) usage();
  try { if (!statSync(path).isDirectory()) usage(); } catch { usage(); }
  const s = scan(path, largeMb);
  console.log(json ? JSON.stringify(s, null, 2) : table(s));
}
