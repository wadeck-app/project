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
PREVIOUS="$(npm view "$PACKAGE" versions --json | node "$SCRIPT_DIR/previous-version.mjs" "$VERSION")"
if [ -z "$PREVIOUS" ]; then
  echo "SKIPPED: there is no version published before $VERSION, nothing to update from (first publication)"
  exit 0
fi
echo "previous version: $PREVIOUS"

step "(e1) npm install -g $PACKAGE@$PREVIOUS"
install_global "$PACKAGE@$PREVIOUS"
choose_runner
assert_equals "installed version" "$PREVIOUS" "$(installed_version)"

step "(e2) project cli update installs $VERSION"
project cli update
assert_equals "installed version after the update" "$VERSION" "$(installed_version)"

step "(e3) project cli rollback puts $PREVIOUS back"
project cli rollback
assert_equals "installed version after the rollback" "$PREVIOUS" "$(installed_version)"

step "(e4) project cli update installs $VERSION again"
project cli update
assert_equals "installed version after the second update" "$VERSION" "$(installed_version)"

echo
echo "verify-update: all steps passed ($PREVIOUS -> $VERSION -> $PREVIOUS -> $VERSION) on $(uname -s)"
