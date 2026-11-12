// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// What audit.ts judges and local-setup.ts writes must read a clone the same way: the noreply test,
// the gitleaks call, a hook's live (uncommented) text, and the directory git runs hooks from.
import { readFileSync } from "node:fs";

export const NOREPLY = /@users\.noreply\.github\.com$|^noreply@github\.com$|\[bot\]@/i;
export const GITLEAKS = /\bgitleaks\s+(git|protect|detect)\b/;

/** A hook file's lines that are not comments; "" when it cannot be read. */
export const live = (p: string) => { try { return readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"); } catch { return ""; } };

const nz = (l: string) => { const m = /^\s*exit\s+(\d+)\s*$/.exec(l); return !!m && Number(m[1]) % 256 !== 0; };
/** A then-body with no nested control flow, `&&`/`||`, or exit/exec other than a whole-line `exit N` (N≠0). */
const plain = (b: string[]) => b.every((l) => !/^\s*(?:if|case|for|while|until|select)\b|&&|\|\|/.test(l) && (!/\b(?:exit|exec)\b/.test(l) || nz(l)));
const fiAfter = (lines: string[], i: number) => lines.findIndex((l, j) => j > i && /^\s*fi\s*$/.test(l));
// `if ! command -v gitleaks …; then … exit N; fi` (N≠0) stops the commit when gitleaks is missing: fail closed, not a skip.
const GUARD = /^[ \t]*if[ \t]+![ \t]+command[ \t]+-v[ \t]+gitleaks\b[^\n;]*;[ \t]*then[ \t]*\n((?:[^\n]*\n)*?)[ \t]*fi[ \t]*$/gm;

/** The text before the first `exit` or `exec` word, a fail-closed gitleaks-missing guard aside: what surely runs before the hook can
 *  stop (fail closed). Lines are blanked, not removed, so line numbers still match the hook's. */
// shortcut: over-refuses any other exit or exec before the gitleaks call (`[ -z "$staged" ] && exit 0` included); text, not a parse, so
// it still passes gitleaks in `if false; then …; fi`, in a function never called, in heredoc or echo text, and after `ex\it` or
// `kill $$`; the blocked fake-secret commit remains the proof.
export const reachable = (t: string) =>
  t.replace(GUARD, (blk, b: string) => { const l = b.split("\n").slice(0, -1); return plain(l) && l.some(nz) ? blk.replace(/[^\n]/g, "") : blk; })
    .split(/\b(?:exit|exec)\b/)[0];

/** After a gitleaks then-body sets `v=1`: a later `if [ "$v" = 1 ]; then … exit N; fi` (N≠0, `"1"` or `-eq` too), with no exit, exec,
 *  other assignment or unset of v on the way. */
const flagged = (lines: string[], end: number, v: string) => {
  const test = new RegExp(`^\\s*if\\s+\\[\\[?\\s+"?\\$\\{?${v}\\}?"?\\s+(?:==?|-eq)\\s+["']?1["']?\\s+\\]\\]?\\s*;\\s*then\\s*$`);
  // An exit that cannot be 0 (a literal 1–99, or awk's `exit !f`) stops the commit anyway: only a possible exit 0, or any exec, spoils.
  const spoil = new RegExp(`\\bexec\\b|\\bexit\\b(?!\\s+(?:[1-9]\\d?|!\\w+)\\b)|\\b${v}=(?!["']?1["']?\\s*(?:;|$))|\\bunset\\b.*\\b${v}\\b`);
  for (let j = end + 1; j < lines.length; j++) {
    if (test.test(lines[j])) { const e = fiAfter(lines, j), b = lines.slice(j + 1, e); return e > 0 && plain(b) && b.some(nz); }
    if (spoil.test(lines[j])) return false;
  }
  return false;
};

/** A reachable gitleaks call whose failure fails the hook: it ends in `|| exit N` (N≠0), or is the last live line, or a `set -e` line
 *  precedes it; and nothing after it on its line (`;`, `|`, `&`, `|| true`) can replace its status. Or it is `if ! gitleaks …; then`
 *  whose plain then-body has `exit N` (N≠0) or sets a flag a later test exits on (flagged). Fails closed on anything else. */
export const gates = (t: string) => {
  const lines = t.split("\n");
  return reachable(t).split("\n").some((part, i) => {
    const m = GITLEAKS.exec(part);
    if (!m) return false;
    const f = /^\s*if\s+!\s+(.*?)\s*;\s*then\s*$/.exec(lines[i]);
    if (f && /^(?:\S*\/)?gitleaks\s+(?:git|protect|detect)\b/.test(f[1])) {
      const end = fiAfter(lines, i), b = lines.slice(i + 1, end);
      if (/(?<![<>])[;&|]/.test(f[1]) || end < 0 || !plain(b)) return false;
      return b.some(nz) || b.some((l) => { const v = /^\s*(\w+)=["']?1["']?\s*$/.exec(l)?.[1]; return !!v && flagged(lines, end, v); });
    }
    const tail = lines[i].slice(m.index + m[0].length), ex = /\|\|\s*exit\s+(\d+)\s*$/.exec(tail);
    if (/(?<![<>])[;&|]/.test(ex ? tail.slice(0, ex.index) : tail)) return false; // `2>&1` is a redirect, not a separator
    if (ex) return Number(ex[1]) % 256 !== 0;
    return lines.slice(i + 1).every((l) => !l.trim()) || lines.slice(0, i).some((l) => /^\s*set\s+-[A-Za-z]*e/.test(l));
  });
};

/** core.hooksPath as configured, the common dir's hooks, and the directory git runs hooks from. */
export function hookDir(git: (...a: string[]) => { out: string }) {
  const top = git("rev-parse", "--show-toplevel").out.trim();
  const hp = git("config", "--type=path", "--get", "core.hooksPath").out.trim(); // --type=path expands ~
  // --git-path hooks follows core.hooksPath; the file a hook chains to is the common dir's.
  const dflt = `${git("rev-parse", "--path-format=absolute", "--git-common-dir").out.trim()}/hooks`;
  return { top, hp, dflt, dir: hp ? (hp.startsWith("/") ? hp : `${top}/${hp}`) : dflt };
}
