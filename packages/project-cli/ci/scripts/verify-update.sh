#!/usr/bin/env bash
# Verifies, in an isolated temp environment, the real update path: the PREVIOUS published version updates itself to <version>,
# rolls back, and updates again.
#
# Usage:       bash packages/project-cli/ci/scripts/verify-update.sh <version>
# Run locally: same requirements as verify-install.sh. The previous version is taken from the registry
#              (npm view @wadeck-app/project-cli versions --json), see previous-version.mjs. Skipped, with a log line, when there is none.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/verify-lib.sh"

VERSION="${1:-}"
[ -n "$VERSION" ] || fail "usage: verify-update.sh <version>"
PACKAGE="@wadeck-app/project-cli"

isolate_env

step "(e0) find the version published before $VERSION"
VERSIONS=""
for attempt in 1 2 3 4; do
  status=0
  VERSIONS="$(npm view "$PACKAGE" versions --json 2> "$(last_stderr_file)")" || status=$?
  if [ "$status" -eq 0 ]; then
    break
  fi
  echo "npm view $PACKAGE versions failed (attempt $attempt of 4), retrying in 10 s"
  cat "$(last_stderr_file)" >&2
  sleep 10
done
[ "$status" -eq 0 ] || fail "npm view $PACKAGE versions --json did not succeed after 4 attempts"
PREVIOUS="$(printf '%s' "$VERSIONS" | node "$SCRIPT_DIR/previous-version.mjs" "$VERSION" | tr -d '\r')"
if [ -z "$PREVIOUS" ]; then
  echo "SKIPPED: there is no version published before $VERSION, nothing to update from (first publication)"
  exit 0
fi
echo "previous version: $PREVIOUS"

step "(e1) npm install -g $PACKAGE@$PREVIOUS"
install_global "$PACKAGE@$PREVIOUS"
choose_runner
first_run
ACTUAL="$(installed_version)"
assert_equals "installed version" "$PREVIOUS" "$ACTUAL"

# app-core is not running here: the updater must leave the new pages for its next start (deferred), not fail and not skip silently.
pick_free_port

step "(e2) project cli update installs $VERSION"
update_to "$VERSION"

step "(e2b) the update told app-core about the app-module of $VERSION (deferred: app-core is not running)"
assert_file "the staged copy of the app-module" "$XDG_CONFIG_HOME/project/app-module/$VERSION/manifest.json"
assert_file "the pending registration for app-core" "$APP_CORE_CONFIG_DIR/modules/project.json"

step "(e3) project cli rollback puts $PREVIOUS back"
run_project cli rollback || fail "project cli rollback exited with status $?"
ACTUAL="$(installed_version)"
assert_equals "installed version after the rollback" "$PREVIOUS" "$ACTUAL"

step "(e4) project cli update installs $VERSION again"
update_to "$VERSION"
assert_file "the staged copy of the app-module after the second update" "$XDG_CONFIG_HOME/project/app-module/$VERSION/manifest.json"

echo
echo "verify-update: all steps passed ($PREVIOUS -> $VERSION -> $PREVIOUS -> $VERSION) on $(uname -s)"
