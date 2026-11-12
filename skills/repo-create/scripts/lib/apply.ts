// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// Pure decisions for apply.ts: which approved rows may run, the gh argv of each
// call, and the read-back verdicts. No I/O here.

export type Status = "pass" | "fail" | "n.a." | "blocked";
export type Call = { method: string; path: string; fields?: Record<string, string | boolean | number | string[]>; input?: unknown };
export type Row = { id: string; status: Status; ev: string; fix?: string; apply?: Call[] };

const DOOR_KEYS = new Set(["private", "visibility", "name", "archived"]);
const METHODS = new Set(["PUT", "PATCH", "POST"]);
/** Why a call cannot be undone by another write ("" when it can): apply never makes one. */
export function oneWay(c: Call): string {
  if (/^delete$/i.test(c.method)) return "DELETE";
  if (/\/transfer\/?$/i.test(c.path)) return "transfer";
  const keys = [...Object.keys(c.fields ?? {}), ...(c.input && typeof c.input === "object" ? Object.keys(c.input) : [])];
  return keys.map((k) => k.split("[")[0]).find((k) => DOOR_KEYS.has(k)) ?? "";
}

/** Why a row cannot run ("" when it can). Only a `fail` with calls, all two-way and all inside repos/<slug>, runs. */
export function blocker(r: Row, slug: string, ci: string | null): string {
  if (r.status === "pass") return "already pass";
  if (r.status === "n.a.") return "n.a.";
  if (r.status === "blocked") return "owner decision"; // the plan refuses it (D6's words)
  if (r.status !== "fail" || !r.apply?.length) return "by hand";
  if (r.id === "branch-baseline" && ci !== null) return "n.a."; // ci-flow's protect script is the single writer
  for (const c of r.apply) {
    if (oneWay(c)) return "one-way door";
    if (!METHODS.has(c.method)) return "unknown method";
    if (/^orgs\//.test(c.path)) return "org-wide";
    // Lexical only: nothing gh or GitHub could decode or normalise into another path.
    if (!slug || (c.path !== `repos/${slug}` && !c.path.startsWith(`repos/${slug}/`)) || /[%?#\\]/.test(c.path)
      || c.path.split("/").some((s) => s === "" || s === "." || s === "..")) return "not this repo";
  }
  return "";
}

/** The approved rows' calls, or nothing at all when any approved id is refused. */
export function select(rows: Row[], ids: string[], slug: string, ci: string | null) {
  const run: { id: string; calls: Call[] }[] = [], refused: { id: string; why: string }[] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    const why = r ? blocker(r, slug, ci) : "not in the audit";
    if (why) refused.push({ id, why }); else run.push({ id, calls: r!.apply! });
  }
  return refused.length ? { run: [], refused } : { run, refused };
}

/** gh argv for one call: strings as -f (raw, never re-read as @file), numbers and booleans as -F, a body on stdin. */
export const argv = (c: Call): string[] => [
  "api", "-X", c.method, c.path,
  ...Object.entries(c.fields ?? {}).flatMap(([k, v]) => [v].flat().flatMap((x) => [typeof x === "string" ? "-f" : "-F", `${k}=${x}`])),
  ...(c.input === undefined ? [] : ["--input", "-"]),
];

/** Verified = the second audit reads the row `pass`; anything else (fail, blocked, n.a., missing) is not. */
export const readback = (before: Row[], after: Row[], ids: string[]) => ids.map((id) => {
  const a = after.find((x) => x.id === id)?.status ?? "missing";
  return { id, before: before.find((x) => x.id === id)?.status ?? "missing", after: a, ok: a === "pass" };
});
