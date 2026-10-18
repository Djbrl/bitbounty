#!/usr/bin/env bash
# Creates the public demo repo (default Djbrl/bitbounty-demo) from docs/demo/bitbounty-demo/,
# its labels, and the issues written in docs/demo/demo-repo.md (D1).
#
#   scripts/demo-repo.sh --dry-run   # print what it would do, touch nothing
#   scripts/demo-repo.sh             # do it (needs `gh auth login` with repo scope)
#
# Safe to re-run: an existing repo is not pushed to again, an existing label is updated, and an
# issue whose exact title already exists is skipped. It does NOT install the GitHub App: do that
# by hand afterwards (see docs/demo/demo-repo.md).
# Env: DEMO_REPO=owner/name to use another repo.
set -euo pipefail

REPO="${DEMO_REPO:-Djbrl/bitbounty-demo}"
DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/docs/demo/bitbounty-demo"
DOC="$ROOT/docs/demo/demo-repo.md"
[ -d "$TEMPLATE" ] || { echo "missing $TEMPLATE" >&2; exit 1; }
[ -f "$DOC" ] || { echo "missing $DOC" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run]'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- parse the issues out of the doc ------------------------------------------------------------
# Each issue is "### Issue N · <title>", then "Labels: `a` `b` ...", then the body between
# <!-- issue-body:start --> and <!-- issue-body:end -->.
awk -v dir="$WORK" '
  /^### Issue [0-9]+ · / { n++; title = $0; sub(/^### Issue [0-9]+ · /, "", title); print title > (dir "/" n ".title"); next }
  /^Labels: / && n > 0 && !labels[n]++ {
    line = $0; sub(/ · .*/, "", line); out = ""
    while (match(line, /`[^`]+`/)) { l = substr(line, RSTART + 1, RLENGTH - 2); out = out (out == "" ? "" : ",") l; line = substr(line, RSTART + RLENGTH) }
    print out > (dir "/" n ".labels"); next
  }
  /^<!-- issue-body:start -->$/ { inbody = 1; next }
  /^<!-- issue-body:end -->$/ { inbody = 0; next }
  inbody { print > (dir "/" n ".body") }
' "$DOC"

COUNT=$(find "$WORK" -name '*.title' | wc -l | tr -d ' ')
[ "$COUNT" -gt 0 ] || { echo "no issues found in $DOC" >&2; exit 1; }
for i in $(seq 1 "$COUNT"); do
  for ext in title labels body; do
    [ -s "$WORK/$i.$ext" ] || { echo "issue $i in $DOC has no $ext" >&2; exit 1; }
  done
done

# --- checks -------------------------------------------------------------------------------------
command -v gh >/dev/null || { echo "install the GitHub CLI: https://cli.github.com" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
if [ "$DRY_RUN" = 0 ]; then gh auth status >/dev/null || { echo "run: gh auth login" >&2; exit 1; }; fi

echo "Repo: $REPO · $COUNT issues from docs/demo/demo-repo.md"

# --- 1. the repo --------------------------------------------------------------------------------
if [ "$DRY_RUN" = 0 ] && gh repo view "$REPO" >/dev/null 2>&1; then
  echo "· $REPO already exists: not pushing the template again"
else
  SRC="$WORK/repo"
  cp -R "$TEMPLATE" "$SRC"
  echo "· files: $(cd "$SRC" && find . -type f | sed 's|^\./||' | sort | tr '\n' ' ')"
  run git -C "$SRC" init -q -b main
  run git -C "$SRC" add -A
  run git -C "$SRC" commit -q -m "FCFA and sats helpers, English and French messages"
  run gh repo create "$REPO" --public \
    --description "FCFA amounts and Lightning sats helpers. The BitBounty demo repo: fix an issue, get paid in sats." \
    --source "$SRC" --remote origin --push
fi

# --- 2. labels ----------------------------------------------------------------------------------
label() { run gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force; }
label "bug" "d73a4a" "Something isn't working"
label "enhancement" "a2eeef" "New feature or request"
label "documentation" "0075ca" "Improvements or additions to documentation"
label "good first issue" "7057ff" "Good for newcomers"
label "help wanted" "008672" "Extra attention is needed"
label "translation" "fbca04" "New language or wording"

# --- 3. issues, in order (on a new repo they get #1..#N) ----------------------------------------
existing=""
if [ "$DRY_RUN" = 0 ]; then
  existing="$(gh issue list --repo "$REPO" --state all --limit 200 --json title --jq '.[].title')"
fi
for i in $(seq 1 "$COUNT"); do
  title="$(cat "$WORK/$i.title")"
  if printf '%s\n' "$existing" | grep -Fxq -- "$title"; then
    echo "· issue exists, skipped: $title"
    continue
  fi
  args=(issue create --repo "$REPO" --title "$title" --body-file "$WORK/$i.body")
  IFS=',' read -r -a labels < "$WORK/$i.labels"
  for l in "${labels[@]}"; do args+=(--label "$l"); done
  run gh "${args[@]}"
  if [ "$DRY_RUN" = 1 ]; then sed 's/^/    | /' "$WORK/$i.body"; fi
done

cat <<EOF

Done. Next, by hand:
  1. Install the BitBounty GitHub App on $REPO.
  2. Fund the issues that should show on the board before the demo (see docs/demo/demo-repo.md).
  3. Check that main is green in https://github.com/$REPO/actions
EOF
