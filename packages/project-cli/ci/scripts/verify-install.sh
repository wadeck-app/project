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

step "(b) project --version prints exactly the version"
assert_equals "project --version" "$VERSION" "$(installed_version)"

step "(c) project cli self-check exits 0"
project cli self-check
echo "ok: self-check passed"

step "(d) functional smoke test"
ALPHA="$(native_path "$VERIFY_ROOT")/work/alpha"
BETA="$(native_path "$VERIFY_ROOT")/work/beta"
mkdir -p "$ALPHA" "$BETA"

(cd "$ALPHA" && project add --name alpha --label state::temp)
LISTED="$(project list --label '*::temp')"
assert_contains "project list --label '*::temp'" "alpha" "$LISTED"

RESOLVED="$(cd "$ALPHA" && project resolve)"
assert_contains "project resolve in the registered folder" "project: alpha" "$RESOLVED"

if OUTSIDE_ERR="$(cd "$BETA" && project resolve 2>&1 > /dev/null)"; then
  fail "project resolve in an unregistered folder should fail"
fi
assert_contains "project resolve in an unregistered folder" "no project in scope" "$OUTSIDE_ERR"
assert_contains "project resolve in an unregistered folder" "hint:" "$OUTSIDE_ERR"

echo
echo "verify-install: all steps passed for $VERSION on $(uname -s)"
