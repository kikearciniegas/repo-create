// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// A new clone's local setup: the gitleaks pre-commit hook (created when absent; when missing, the line is
// inserted right after the shebang, so it runs before anything can exit; no existing line changes), the commit email in the repo's own config (never the global one), and the
// Synology Drive exclusions and the worktree pointer, printed only. Nothing else is written.
// Exit 0 when done; 1 when a step is left by hand or a write did not read back; 2 on usage (nothing written).
import fs, { chmodSync, closeSync, lstatSync, openSync, rmSync, statSync, writeSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { run } from "./lib/gh.ts";
import { GITLEAKS, NOREPLY, gates, hookDir, live, reachable } from "./lib/hooks.ts";

const CMD = "gitleaks git --pre-commit --staged --redact";
const LINE = `${CMD} || exit 1`; // sh carries on past a failed command: the leak must stop the hook
/** A hook a shell line can be appended to: no shebang, or one naming sh, bash, dash or zsh (directly or through env). */
const shell = (first: string) => {
  const m = /^#!\s*(\S+)(.*)/.exec(first);
  if (!m) return true;
  const prog = basename(m[1]) === "env" ? m[2].trim().split(/\s+/).find((w) => !w.startsWith("-") && !w.includes("=")) ?? "" : m[1];
  return /^(sh|bash|dash|zsh)$/.test(basename(prog));
};
const USAGE = "usage: bun local-setup.ts <repo-path> [--email <id>+<login>@users.noreply.github.com]";
const refuse = (msg: string): never => { console.error(`${msg}; nothing written\n${USAGE}`); process.exit(2); };

const args = process.argv.slice(2);
let root = "", email = "";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--email") email = args[++i] ?? "";
  else if (a.startsWith("-") || root) refuse(`unexpected argument ${a}`);
  else root = a;
}
if (!root) refuse("no path");
if (args.includes("--email") && !/^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$/.test(email)) refuse("--email must be <id>+<login>@users.noreply.github.com");
root = resolve(root);
const git = (...a: string[]) => run("git", ["-C", root, ...a]);
/** The real path, through the nearest existing ancestor when p does not exist yet. */
const real = (p: string): string => { try { return realpathSync(p); } catch { return p === dirname(p) ? p : join(real(dirname(p)), basename(p)); } };
const { top, dflt, dir } = hookDir(git);
if (!top || real(top) !== real(root)) refuse(`${root} is not the top of a git repository`);
let code = 0;
const byHand = (msg: string) => { console.log(`by hand: ${msg}`); code = 1; };

// The hook: a write outside the repo (a shared hooks dir, a symlink's target) would change other repos' hooks.
const hook = `${dir}/pre-commit`, inside = (p: string, d: string) => p === d || p.startsWith(`${d}/`);
const link = (() => { try { return lstatSync(hook).isSymbolicLink() ? readlinkSync(hook) : null; } catch { return null; } })();
const exists = (() => { try { lstatSync(hook); return true; } catch { return false; } })();
// The audit's rule (gates): a gitleaks call whose failure fails the hook. One that is called but ignored is not rewritten.
if (gates(live(hook))) console.log(`pre-commit: ${hook} already runs gitleaks; left as it is`);
else if (GITLEAKS.test(reachable(live(hook)))) byHand(`add || exit 1 to its gitleaks line in ${hook}`);
else if (link !== null) byHand(`the pre-commit hook is a symlink to ${link}; add the gitleaks line there`);
else if (![real(top), real(dirname(dflt))].some((d) => inside(real(dir), d))) byHand(`core.hooksPath points outside this repo (${real(dir)}); add a line running ${CMD} to its pre-commit there`);
else if (!exists) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(hook, `#!/bin/sh\n${LINE}\n`); chmodSync(hook, 0o755);
  console.log(`pre-commit: created ${hook} running gitleaks`);
} else if (!shell(readFileSync(hook, "utf8").split("\n")[0])) byHand(`this hook is not a shell script; add a call to ${CMD} in its own language`);
else {
  const raw = readFileSync(hook, "utf8"), nl = raw.indexOf("\n");
  // Line 2 (line 1 without a shebang): before any line that could exit or exec.
  const want = !raw.startsWith("#!") ? `${LINE}\n${raw}` : nl < 0 ? `${raw}\n${LINE}\n` : `${raw.slice(0, nl + 1)}${LINE}\n${raw.slice(nl + 1)}`;
  // Atomic: a new file beside the hook (same mode), renamed over it; any failure leaves the old hook as it was.
  const tmp = `${dir}/.pre-commit.${crypto.randomUUID()}.tmp`;
  let made = false, done = false;
  try {
    const fd = openSync(tmp, "wx", 0o600); // wx: O_CREAT | O_EXCL
    made = true;
    try { writeSync(fd, want); } finally { closeSync(fd); }
    chmodSync(tmp, statSync(hook).mode & 0o7777);
    fs.renameSync(tmp, hook); // through `fs.` so a test can inject a failure
    done = true;
  } catch (e) {
    if (made) rmSync(tmp, { force: true });
    byHand(`${hook} left as it was; the rewrite failed: ${(e as Error).message}`);
  }
  if (done && readFileSync(hook, "utf8") === want) console.log(`pre-commit: inserted the gitleaks line in ${hook} right after its shebang; its other lines are unchanged`);
  else if (done) byHand(`${hook} did not read back as written`);
}
if (code === 0 && !gates(live(hook))) byHand(`${hook} does not run gitleaks after the write`);

// The email: repo-local only; a non-noreply address is never printed.
const now = git("config", "--get", "user.email").out.trim();
if (NOREPLY.test(now)) console.log("commit email: already a noreply address");
else if (email) {
  git("config", "user.email", email);
  if (git("config", "--local", "--get", "user.email").out.trim() === email) console.log(`commit email: set to ${email} in this repo's config`);
  else byHand(`user.email did not read back as ${email}`);
} else console.log(`commit email: not a noreply address; run: git -C ${root} config user.email <id>+<login>@users.noreply.github.com`);

// Printed, never applied.
console.log(`Synology Drive (by hand): exclude both folders by full path in the client's selective sync:
  ${root}/.git
  ${root}/node_modules
probe: create a file under ${root}/.git, then confirm the client does not sync it
worktrees: CLAUDE.md §3 — work in ~/tmp/${basename(root)}-<task>, never beside the repo`);
process.exit(code);
