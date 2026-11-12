// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// `audit.ts --owner <login>`: before creating a repo. Prints, never creates.
import { ghGet, run } from "./gh.ts";
import { capsFor, minutesOf, PACKAGES_GB, planOf, QUOTA, randomName } from "./plans.ts";

// ------------------------------------------------- --owner: before creating a repo
// What the owner's plan allows a NEW repo, how many repos exist, and this
// month's minutes. Repository slots are unlimited on every plan, so "slots
// available" is reported as such rather than as a number GitHub never enforces.
export function ownerReport(ownerArg: string): never {
  const who = ghGet(`users/${ownerArg}`);
  if (!who.ok) { console.error(who.msg); process.exit(2); }
  const isOrg = who.data?.type === "Organization";
  const det = isOrg ? ghGet(`orgs/${ownerArg}`) : ghGet("user");
  const d = det.ok && (isOrg || det.data?.login === ownerArg) ? det.data : undefined;
  const LIMIT = 1000; // a list this long may be cut: reported as LIMIT+, never as an exact count
  const list = run("gh", ["repo", "list", ownerArg, "--limit", String(LIMIT), "--json", "name,visibility,isArchived,defaultBranchRef"]);
  const repos: any[] = list.ok ? JSON.parse(list.out) : [];
  let plan = planOf(d?.plan?.name), src = plan ? "GitHub" : "";
  if (!plan) { // A private repo's protection answers it: refused with an upgrade message = Free; readable or "not protected" = paid.
    const p = repos.find((r) => r.visibility !== "PUBLIC" && r.defaultBranchRef?.name);
    if (p) {
      const pr = ghGet(`repos/${ownerArg}/${p.name}/branches/${p.defaultBranchRef.name}/protection`);
      plan = !pr.ok && pr.kind === "blocked" ? "free" : pr.ok || (pr.kind === "missing" && /Branch not protected/i.test(pr.msg)) ? (isOrg ? "team" : "pro") : undefined; // any other 404: unknown
      if (plan) src = `inferred from ${p.name}'s branch protection`;
    }
  }
  const nPub = repos.filter((r) => r.visibility === "PUBLIC").length, nPriv = repos.length - nPub, nArch = repos.filter((r) => r.isArchived).length;
  const priv = capsFor(plan, false), pub = capsFor(plan, true), yn = (b: boolean) => (b ? "yes" : "**no**");
  console.log(`repo-create: before creating a repository under ${ownerArg} (${isOrg ? "organization" : "user"})\n`);
  console.log(`Plan: ${plan ?? "unknown"}${src ? ` (${src})` : ""}${isOrg && d?.plan ? `, seats ${d.plan.filled_seats}/${d.plan.seats}` : ""}`);
  console.log(`Repositories: ${list.ok ? `${repos.length >= LIMIT ? `${LIMIT}+ (counts below cover the first ${LIMIT}): ` : ""}${nPub} public, ${nPriv} private (${nArch} archived)` : `not listed: ${list.err.trim().split("\n")[0]}`}; slots: unlimited on every plan`);
  if (isOrg && d) console.log(`Members may create: public repos ${d.members_can_create_public_repositories ? "YES (see org-baseline)" : "no"}, private repos ${d.members_can_create_private_repositories ? "yes" : "no"}`);
  console.log(`\n| What a new repo gets | private | public |\n|---|---|---|`);
  const P = plan ?? "?";
  for (const [k, a, b] of [
    ["branch protection / rulesets", yn(priv.protection), yn(pub.protection)],
    ["environments + environment secrets", yn(priv.environments), yn(pub.environments)],
    ["environment reviewers / wait timers", yn(priv.envReviewers), yn(pub.envReviewers)],
    ["secret scanning + push protection", priv.secretScanning, pub.secretScanning],
    ["CodeQL code scanning", priv.codeql, pub.codeql],
    ["private vulnerability reporting", yn(priv.privateReporting), yn(pub.privateReporting)],
    ["Dependabot alerts + security updates", "yes", "yes"],
    ["Actions minutes (standard Linux)", plan ? `${QUOTA[plan]}/month${isOrg ? ", shared by the org" : ", shared by the account"}` : P, "free"],
    ["Packages storage", plan ? `${PACKAGES_GB[plan]} GB` : P, "free"],
  ]) console.log(`| ${k} | ${a} | ${b} |`);
  let warn = "";
  if (plan) {
    try { const u = minutesOf(ownerArg, isOrg, plan); console.log(`\nActions this month (${u.month}): ${u.line}`); warn = u.warn; }
    catch (e) { console.log(`\nActions this month: not readable — ${(e as Error).message}`); }
  } else console.log(`\nPlan not readable: ${isOrg ? "an org-owner token is needed" : "gh auth refresh -h github.com -s user"}`);
  if (warn) console.log(`\n**${warn}**`);
  const name = randomName();
  console.log(`\nSuggested (nothing was created):\n- gh repo create ${ownerArg}/${name} --private   # a random development name; no product, client or folder name until launch` +
    `\n- after the first push: bun ~/.claude/skills/repo-create/scripts/audit.ts <clone>   # baseline + hardening commands` +
    `\n- at launch, when it goes public: gh repo rename <product-name> -R ${ownerArg}/${name}` +
    (!plan || priv.protection ? "" : `\n- on ${plan}, a private repo gets no protection and no environments: if it will deploy or gate merges on CI, create it under the Team org instead`));
  process.exit(0);
}
