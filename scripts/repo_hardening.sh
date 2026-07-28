#!/usr/bin/env bash
# Report or apply the GitHub repository settings HAventory expects
# (see docs/repo_hardening.md).
#
#   scripts/repo_hardening.sh            # read-only report; exits 1 on drift
#   scripts/repo_hardening.sh --apply    # push the settings to GitHub
#
# Needs the `gh` CLI authenticated as a repository admin. The social-preview
# image is the one setting with no API at all, so it stays a manual upload and
# this script only reports whether one is set.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  ""|--check) ;;
  *) err "usage: $0 [--check|--apply]"; exit 2 ;;
esac

command -v gh >/dev/null 2>&1 || { err 'gh CLI not found.'; exit 2; }

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
RULESET_FILE="$REPO_ROOT/.github/rulesets/main.json"
LABELS_FILE="$REPO_ROOT/.github/labels.yml"
DRIFT=0

drift() { DRIFT=1; err "$*"; }

# --- Branch ruleset on the default branch -----------------------------------
RULESET_ID="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="main") | .id')"
if [ -n "$RULESET_ID" ]; then
  LIVE="$(gh api "repos/$REPO/rulesets/$RULESET_ID")"
else
  LIVE='{}'
fi

if RULESET_DIFF="$(printf '%s' "$LIVE" | py "$REPO_ROOT/scripts/ruleset_diff.py" "$RULESET_FILE")"
then
  ok "ruleset 'main' matches .github/rulesets/main.json"
else
  drift "ruleset 'main' differs from .github/rulesets/main.json:"$'\n'"$RULESET_DIFF"
  if [ "$APPLY" = 1 ]; then
    if [ -n "$RULESET_ID" ]; then
      gh api -X PUT "repos/$REPO/rulesets/$RULESET_ID" --input "$RULESET_FILE" >/dev/null
      ok "updated ruleset $RULESET_ID"
    else
      gh api -X POST "repos/$REPO/rulesets" --input "$RULESET_FILE" >/dev/null
      ok 'created the ruleset'
    fi
  fi
fi

# --- Discussions ------------------------------------------------------------
if [ "$(gh api "repos/$REPO" --jq .has_discussions)" = 'true' ]; then
  ok 'Discussions enabled'
else
  drift 'Discussions disabled (CONTRIBUTING.md points contributors at them)'
  if [ "$APPLY" = 1 ]; then
    gh api -X PATCH "repos/$REPO" -F has_discussions=true >/dev/null
    ok 'enabled Discussions'
  fi
fi

# --- Secret scanning + push protection --------------------------------------
for feature in secret_scanning secret_scanning_push_protection; do
  if [ "$(gh api "repos/$REPO" --jq ".security_and_analysis.$feature.status")" = 'enabled' ]; then
    ok "$feature enabled"
  else
    drift "$feature disabled"
    if [ "$APPLY" = 1 ]; then
      printf '{"security_and_analysis":{"%s":{"status":"enabled"}}}' "$feature" |
        gh api -X PATCH "repos/$REPO" --input - >/dev/null
      ok "enabled $feature"
    fi
  fi
done

# --- Labels -----------------------------------------------------------------
# The workflow syncs on pushes touching .github/labels.yml, so a label added
# before that workflow existed needs one manual dispatch.
MISSING="$(
  gh api "repos/$REPO/labels" --paginate --jq '.[].name' | py -c '
import sys, yaml
have = {line.strip() for line in sys.stdin}
want = {entry["name"] for entry in yaml.safe_load(open(sys.argv[1], encoding="utf-8"))}
print("\n".join(sorted(want - have)))
' "$LABELS_FILE"
)"
if [ -z "$MISSING" ]; then
  ok 'labels in sync with .github/labels.yml'
else
  drift "labels missing on GitHub: $(echo "$MISSING" | tr '\n' ' ')"
  if [ "$APPLY" = 1 ]; then
    gh workflow run labels.yml
    ok 'dispatched the labels workflow'
  fi
fi

# --- Social preview (manual) ------------------------------------------------
CUSTOM_OG="$(gh api graphql \
  -f query='query($owner:String!,$name:String!){
    repository(owner:$owner,name:$name){usesCustomOpenGraphImage}
  }' \
  -f owner="${REPO%/*}" -f name="${REPO#*/}" \
  --jq .data.repository.usesCustomOpenGraphImage)"
if [ "$CUSTOM_OG" = 'true' ]; then
  ok 'custom social-preview image set'
else
  drift 'no custom social-preview image — upload docs/assets/social-preview.png under
       Settings > General > Social preview (GitHub exposes no API for it)'
fi

if [ "$DRIFT" = 1 ] && [ "$APPLY" = 0 ]; then
  err 'settings drift (--apply fixes everything except the social preview)'
  exit 1
fi
ok 'Repository hardening OK'
