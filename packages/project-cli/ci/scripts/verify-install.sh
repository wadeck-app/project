#!/usr/bin/env bash
# Verifies, in an isolated temp environment, that a published version of @wadeck-app/project-cli installs and works.
#
# Usage:       bash packages/project-cli/ci/scripts/verify-install.sh <version>
# Run locally: needs bash (git-bash on Windows), node >= 22, npm configured for GitHub Packages
#              (@wadeck-app:registry=https://npm.pkg.github.com and a token with read:packages).
#              Nothing outside a temp folder is touched: the global npm prefix, the config folder and the home are redirected.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/verify-lib.sh"

VERSION="${1:-}"
[ -n "$VERSION" ] || fail "usage: verify-install.sh <version>"

isolate_env

step "(a) npm install -g @wadeck-app/project-cli@$VERSION"
install_global "@wadeck-app/project-cli@$VERSION"
choose_runner
first_run

step "(b) project --version prints exactly the version"
ACTUAL="$(installed_version)"
assert_equals "project --version" "$VERSION" "$ACTUAL"

step "(c) project cli self-check exits 0"
run_project cli self-check || fail "project cli self-check exited with status $?"
echo "ok: self-check passed"

step "(d) functional smoke test"
ALPHA="$(native_path "$VERIFY_ROOT")/work/alpha"
BETA="$(native_path "$VERIFY_ROOT")/work/beta"
mkdir -p "$ALPHA" "$BETA"

(cd "$ALPHA" && run_project add --name alpha --label state::temp) || fail "project add exited with status $?"
run_project list --label '*::temp' || fail "project list --label exited with status $?"
assert_contains "project list --label '*::temp'" "alpha" "$(last_stdout)"

(cd "$ALPHA" && run_project resolve) || fail "project resolve in the registered folder exited with status $?"
assert_contains "project resolve in the registered folder" "project: alpha" "$(last_stdout)"

if (cd "$BETA" && run_project resolve); then
  fail "project resolve in an unregistered folder should fail"
fi
assert_contains "project resolve in an unregistered folder" "no project in scope" "$(last_stderr)"
assert_contains "project resolve in an unregistered folder" "hint:" "$(last_stderr)"

echo
echo "verify-install: all steps passed for $VERSION on $(uname -s)"
