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

# app-core is not running here: a registration is left for its next start (deferred), it neither fails nor is skipped silently.
pick_free_port

step "(e2) project cli update installs $VERSION"
update_to "$VERSION"

step "(e2b) the update did NOT register the app-module: the first registration is explicit"
[ ! -e "$XDG_CONFIG_HOME/project/app-module" ] || fail "the update staged the app-module although it was never registered ($XDG_CONFIG_HOME/project/app-module)"
[ ! -e "$APP_CORE_CONFIG_DIR/modules/project.json" ] || fail "the update registered the app-module with app-core although it was never registered"
echo "ok: nothing was registered by the update"

step "(e2c) project cli register (app-core is not running: deferred)"
run_project cli register --json || fail "project cli register exited with status $?"
assert_contains "project cli register" "\"status\": \"deferred\"" "$(last_stdout)"
assert_file "the staged copy of the app-module" "$XDG_CONFIG_HOME/project/app-module/$VERSION/manifest.json"
assert_file "the pending registration for app-core" "$APP_CORE_CONFIG_DIR/modules/project.json"

step "(e3) project cli rollback puts $PREVIOUS back"
run_project cli rollback || fail "project cli rollback exited with status $?"
ACTUAL="$(installed_version)"
assert_equals "installed version after the rollback" "$PREVIOUS" "$ACTUAL"

# The module was registered before: this update must register it again. The pending registration is removed to see it come back.
rm -f "$APP_CORE_CONFIG_DIR/modules/project.json"

step "(e4) project cli update installs $VERSION again, and registers the app-module again (it was registered)"
update_to "$VERSION"
assert_file "the staged copy of the app-module after the second update" "$XDG_CONFIG_HOME/project/app-module/$VERSION/manifest.json"
assert_file "the pending registration for app-core, written by the update" "$APP_CORE_CONFIG_DIR/modules/project.json"

echo
echo "verify-update: all steps passed ($PREVIOUS -> $VERSION -> $PREVIOUS -> $VERSION) on $(uname -s)"
