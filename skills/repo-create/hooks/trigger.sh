#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Rafael Arciniegas
# repo-create trigger — PreToolUse hook (Bash).
# A REMINDER, not enforcement: enforcement is server-side. Before a repository
# settings command (gh repo create/edit/rename/delete/(un)archive/transfer/deploy-key
# add, gh secret set, or a gh api write), it injects one line pointing at POLICY.md and the audit, once per
# session per repository. ci-flow's trigger owns git commit/push, gh pr, CI files,
# branch-protection and ruleset api writes and graphql mutations; this one stays
# silent on those. It never blocks: every path exits 0.
set -u
in=$(cat)
# Fast path: every command this hook fires on contains "gh"; anything else exits before jq.
[[ $in == *gh* ]] || exit 0
# One jq for the tool, its command, the session and the cwd (NUL-terminated: a command may span lines).
tool="" arg="" sid="" cwd=""
{ IFS= read -r tool; IFS= read -r -d '' arg; IFS= read -r -d '' sid; IFS= read -r -d '' cwd; } < <(printf '%s' "$in" |
  jq -j '(.tool_name // ""), "\n", (.tool_input.command // ""), "\u0000", (.session_id // ""), "\u0000", (.cwd // ""), "\u0000"' 2>/dev/null)
dir="" what=""

case "$tool" in
  Bash)
    cmd=$arg
    # `gh` as a command word; after a quote too, so `bash -c "gh …"` fires (and `echo "gh …"`, a false fire accepted).
    pre='(^|[[:space:];&|(`"'"'"'])gh[[:space:]]+'
    gh_re="${pre}"'(repo[[:space:]]+(create|edit|rename|delete|archive|unarchive|transfer|deploy-key[[:space:]]+add)|secret[[:space:]]+set)([[:space:]]|$)'
    # gh api that writes: an explicit non-GET method, or fields/input; attached (-XPATCH, --method=PATCH, -fa=b,
    # --field=a=b) or as the first argument too.
    api_w="${pre}"'api[[:space:]].*(-X|--method)[[:space:]=]*(PUT|POST|PATCH|DELETE)'
    api_f="${pre}"'api[[:space:]](.*[[:space:]])?(-[fF][^[:space:]]|(-f|-F|--field|--raw-field|--input)[[:space:]=])'
    # An explicit GET sends fields as query parameters, so it is a read, but only when nothing can hide in the
    # segment (fail closed): the GET before any quote, one `gh api`, no $( or backtick.
    api_g="${pre}"'api[[:space:]][^"'"'"']*(-X|--method)[[:space:]=]*GET([[:space:]]|$)'
    is_get() { [[ $1 =~ $api_g && $1 != *'$('* && $1 != *'`'* ]] && ! [[ $1 =~ gh[[:space:]]+api.*gh[[:space:]]+api ]]; }
    api_p="${pre}"'api[[:space:]]+(.*)$'
    # Not ours, judged on the path argument only: graphql, and ci-flow's branch protection / rulesets.
    path_x='^graphql$|/branches/[^/]+/protection([/?"'"'"']|$)|/rulesets?([/?"'"'"']|$)'
    # One shell word: a quoted value with spaces is one word, so it cannot pose as the path (a lone quote is a char).
    word='^[[:space:]]*(([^[:space:]"'"'"']|"[^"]*"|'"'"'[^'"'"']*'"'"'|["'"'"'])+)'
    # An unquoted echo or printf only prints.
    echo_re='^[[:space:]]*(echo|printf)[[:space:]][^"'"'"'`$]*$'
    # Each command segment on its own, so a later segment cannot silence an earlier write.
    segs=${cmd//&&/$'\n'}; segs=${segs//||/$'\n'}; segs=${segs//[;|]/$'\n'}
    while IFS= read -r seg; do
      [[ $seg =~ $echo_re ]] && continue
      if [[ $seg =~ $gh_re ]]; then what="gh ${BASH_REMATCH[2]}"; break
      elif { [[ $seg =~ $api_w ]] || { [[ $seg =~ $api_f ]] && ! is_get "$seg"; }; } && [[ $seg =~ $api_p ]]; then
        # path = first token after `gh api` that is not a flag or a flag's value
        path="" skip=0 s=${BASH_REMATCH[2]}
        while [[ $s =~ $word ]]; do t=${BASH_REMATCH[1]}; s=${s:${#BASH_REMATCH[0]}}
          if [ $skip = 1 ]; then skip=0; continue; fi
          case $t in
            -X|--method|-f|-F|--field|--raw-field|--input|-H|--header|--jq|-q|-t|--template|--cache|--hostname|-p|--preview) skip=1 ;;
            -*) ;;
            *) path=$t; break ;;
          esac
        done
        [[ $path =~ $path_x ]] || { what="a GitHub settings write (gh api)"; break; }
      fi
    done <<< "$segs"
    # `cd <dir> && …` runs the action in <dir>, not in the session's cwd.
    [[ $cmd =~ ^[[:space:]]*cd[[:space:]]+([^[:space:];&|]+) ]] && dir=${BASH_REMATCH[1]}
    dir=${dir/#\~/$HOME}
    ;;
esac
[ -n "$what" ] || exit 0
[ -n "$cwd" ] || cwd=$PWD
[ -n "$dir" ] || dir=$cwd
[ "${dir:0:1}" = / ] || dir="$cwd/$dir"
# Walk up to the nearest existing directory (a cd target may not exist yet).
while [ ! -d "$dir" ] && [ "$dir" != / ]; do up=${dir%/*}; [ "$up" = "$dir" ] && break; dir=${up:-/}; done
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$dir")

# Once per session per repository.
# Markers live in a directory only this user owns (never a shared /tmp), and
# the session id is reduced to safe characters so it cannot leave that directory.
base="${TMPDIR:-$HOME/.cache}/repo-create-trigger"
sid=$(printf '%s' "$sid" | tr -cd 'A-Za-z0-9_-'); sid=${sid:-nosession}
# A checksum of the root: fixed length, so no collisions from / vs _ and no over-long names.
read -r crc len < <(printf '%s' "$root" | cksum); key="$crc-$len"
(umask 077; mkdir -p "$base/$sid") 2>/dev/null
# A symlinked or foreign-owned directory: remind every time rather than write through it.
if [ ! -L "$base" ] && [ -O "$base" ] && [ ! -L "$base/$sid" ] && [ -O "$base/$sid" ]; then
  [ -e "$base/$sid/$key" ] && exit 0
  { : > "$base/$sid/$key"; } 2>/dev/null
fi

msg="repo-create applies ($what in $root): load the repo-create skill and follow ~/.claude/skills/repo-create/POLICY.md. Before gh repo create: bun ~/.claude/skills/repo-create/scripts/audit.ts --owner <login>; after any settings change: audit.ts $root."
jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $m}}'
exit 0
