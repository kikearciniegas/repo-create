// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// lib/hooks.ts gates(): the `if ! gitleaks …; then` shapes, a fail-closed "not installed" guard, and the shapes that must still fail.
import { describe, expect, test } from "bun:test";
import { gates } from "../skills/repo-create/scripts/lib/hooks.ts";

const GUARD = `if ! command -v gitleaks >/dev/null 2>&1; then
  printf '%sBLOCKED%s  gitleaks is not installed; commit refused.\\n' "$RED" "$RST"
  exit 1
fi`;
const SCAN = `if ! gitleaks git --pre-commit --staged --redact --no-banner; then
  printf '%sBLOCKED%s  gitleaks found a possible secret.\\n' "$RED" "$RST"
  block=1
fi`;
const TEST = `if [ "$block" = 1 ]; then
  printf '\\n%sCommit rejected.%s\\n' "$YEL" "$RST"
  exit 1
fi
exit 0`;
// The shape of a global multi-check hook (live lines only), less its `[ -z "$staged" ] && exit 0` line (see below).
const OWNER = `#!/usr/bin/env bash
set -uo pipefail
RED=$'\\033[31m'; YEL=$'\\033[33m'; RST=$'\\033[0m'
block=0

staged=$(git diff --cached --name-only --diff-filter=ACM)

${GUARD}
${SCAN}

while IFS= read -r f; do
  case "$f" in
    *.pem|*.key) printf 'BLOCKED  secret file staged: %s\\n' "$f"; block=1 ;;
  esac
done <<< "$staged"

${TEST}
`;
const hook = (scan: string, test = TEST) => `#!/bin/sh\nblock=0\n${GUARD}\n${scan}\n${test}\n`;

describe("gates: if ! gitleaks …; then", () => {
  test("a multi-check hook: fail-closed guard, flag set on a leak, flag tested with exit 1", () => expect(gates(OWNER)).toBe(true));
  test("the then-body exits directly", () => expect(gates(hook("if ! gitleaks git --pre-commit --staged; then\n  echo leak\n  exit 1\nfi", "exit 0"))).toBe(true));
  test("flag forms: \"1\", -eq, [[ ]]", () => {
    for (const t of ['if [ "$block" = "1" ]; then', "if [ $block -eq 1 ]; then", 'if [[ "$block" == 1 ]]; then'])
      expect(gates(hook(SCAN, TEST.replace(/^.*\n/, `${t}\n`)))).toBe(true);
  });

  test("a non-zero exit between the flag and its test (a refuse helper, an awk program's exit) does not spoil it", () => {
    const helper = `refuse() { printf 'BLOCKED %s\\n' "$1"; exit 1; }\nawk '{ f = 1 } END { exit !f }' x && refuse "pii"`;
    expect(gates(hook(SCAN, `${helper}\n${TEST}`))).toBe(true);
    expect(gates(hook(SCAN, `[ -f x ] || exit 2\n${TEST}`))).toBe(true);
  });

  test("the then-body only warns: fail", () => expect(gates(hook("if ! gitleaks git --pre-commit --staged; then\n  echo warn\nfi", "exit 0"))).toBe(false));
  test("the flag is set but never tested: fail", () => expect(gates(hook(SCAN, "exit 0"))).toBe(false));
  test("the flag is tested but exits 0: fail", () => expect(gates(hook(SCAN, TEST.replace("exit 1", "exit 0")))).toBe(false));
  test("the flag is reset or the hook exits before the test: fail", () => {
    expect(gates(hook(SCAN, `block=0\n${TEST}`))).toBe(false);
    expect(gates(hook(SCAN, `[ -n "$x" ] && exit 0\n${TEST}`))).toBe(false);
    for (const e of ["exit", "exit;", "exit $?", "exit $rc", "exit 256", "exec true", "f() { exit; }"])
      expect(gates(hook(SCAN, `[ -n "$x" ] && ${e}\n${TEST}`))).toBe(false);
  });
  test("the then-body exits only under a further condition, or exits 0 first: fail", () => {
    expect(gates(hook("if ! gitleaks git --pre-commit --staged; then\n  [ -n \"$CI\" ] && exit 1\nfi", "exit 0"))).toBe(false);
    expect(gates(hook("if ! gitleaks git --pre-commit --staged; then\n  exit 0\n  exit 1\nfi", "exit 0"))).toBe(false);
  });
  test("the status is replaced by a pipe: fail", () => expect(gates(hook("if ! gitleaks git --pre-commit --staged | tee log; then\n  exit 1\nfi", "exit 0"))).toBe(false));
  test("an unguarded exit 0 before the call: fail (the multi-check hook with its nothing-staged exit included)", () => {
    expect(gates(OWNER.replace(GUARD, `npm test\nexit 0\n${GUARD}`))).toBe(false);
    // `[ -z "$staged" ] && exit 0` with --diff-filter=ACM skips the scan on a rename-only commit that adds a secret (measured).
    expect(gates(OWNER.replace("\n\n" + GUARD, `\n[ -z "$staged" ] && exit 0\n\n${GUARD}`))).toBe(false);
  });
  test("a missing gitleaks lets the hook pass: fail", () => {
    expect(gates(`#!/bin/sh\ncommand -v gitleaks || exit 0\ngitleaks git --pre-commit --staged || exit 1\n`)).toBe(false);
    expect(gates(hook(SCAN).replace("  exit 1\nfi\nif !", "  exit 0\nfi\nif !"))).toBe(false);
  });
});
