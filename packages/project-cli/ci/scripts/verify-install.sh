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

step "(e) the package ships the app-module (the pages of app-core) and 'project cli register' defers it when app-core is not running"
PACKAGE_DIR="$(installed_package_dir)"
assert_file "the packaged manifest of the app-module" "$PACKAGE_DIR/app-module/manifest.json"
assert_contains "the packaged manifest of the app-module" "\"id\": \"project\"" "$(cat "$PACKAGE_DIR/app-module/manifest.json")"
assert_contains "the packaged manifest of the app-module" "\"version\": \"$VERSION\"" "$(cat "$PACKAGE_DIR/app-module/manifest.json")"
pick_free_port
run_project cli register --json || fail "project cli register exited with status $? (it must defer when app-core is not running)"
assert_contains "project cli register" "\"status\": \"deferred\"" "$(last_stdout)"
# The copy app-core will load at its next start lives in the registry folder: it must survive an update or removal of the npm folder.
assert_file "the staged copy of the app-module" "$XDG_CONFIG_HOME/project/app-module/$VERSION/manifest.json"
assert_file "the pending registration for app-core" "$APP_CORE_CONFIG_DIR/modules/project.json"
run_project cli unregister --json || fail "project cli unregister exited with status $?"
[ ! -e "$APP_CORE_CONFIG_DIR/modules/project.json" ] || fail "project cli unregister left the pending registration $APP_CORE_CONFIG_DIR/modules/project.json"
echo "ok: the pending registration was removed"

echo
echo "verify-install: all steps passed for $VERSION on $(uname -s)"
