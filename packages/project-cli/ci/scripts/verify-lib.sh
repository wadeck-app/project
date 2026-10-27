#!/usr/bin/env bash
# Shared helpers of verify-install.sh and verify-update.sh. Sourced, never run.
# Run locally: see the header of verify-install.sh (needs bash, node, npm and a token with read:packages in your npm config).

# --- output ---------------------------------------------------------------------------------------------------------

step() {
  echo
  echo "==> $*"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_equals() {
  local what="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    fail "$what: expected '$expected', got '$actual'"
  fi
  echo "ok: $what is '$actual'"
}

assert_contains() {
  local what="$1" needle="$2" text="$3"
  case "$text" in
    *"$needle"*) echo "ok: $what contains '$needle'" ;;
    *) fail "$what: expected it to contain '$needle', got: $text" ;;
  esac
}

# --- isolated environment -------------------------------------------------------------------------------------------

# A path the native node.exe understands too: C:/Users/... on Windows (git-bash), unchanged elsewhere.
native_path() {
  if command -v cygpath > /dev/null 2>&1; then
    cygpath -m "$1"
  else
    echo "$1"
  fi
}

# Everything the tests do happens in a temp folder: the global npm prefix, the registry/config folder, the home.
# The automatic update is switched off so that a background update never races with the steps (`project cli update` still works: it forces).
isolate_env() {
  local root="${VERIFY_ROOT:-$(mktemp -d)}"
  mkdir -p "$root"
  root="$(native_path "$root")"
  export VERIFY_ROOT="$root"
  export npm_config_prefix="$root/npm-prefix"
  export XDG_CONFIG_HOME="$root/xdg"
  export HOME="$root/home"
  export USERPROFILE="$root/home"
  mkdir -p "$npm_config_prefix" "$XDG_CONFIG_HOME/project" "$HOME"
  echo "autoUpdate: false" > "$XDG_CONFIG_HOME/project/config.yml"
  # The global bin folder: the prefix itself on Windows, <prefix>/bin elsewhere.
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) export PATH="$npm_config_prefix:$PATH" ;;
    *) export PATH="$npm_config_prefix/bin:$PATH" ;;
  esac
  echo "isolated environment in $root"
}

# --- running the CLI ------------------------------------------------------------------------------------------------

# The bin launcher needs a platform package (win32-x64, darwin-arm64, darwin-x64). There is none for linux yet: there the tests run
# project.cjs of the global install with node, which is what the launcher starts everywhere else.
USE_BUNDLE=0
choose_runner() {
  if [ "$(uname -s)" = "Linux" ]; then
    USE_BUNDLE=1
    echo "linux: the bin launcher has no linux-x64 platform package yet (ci-templates), running project.cjs of the global install with node instead of the 'project' command"
  else
    USE_BUNDLE=0
  fi
}

project() {
  if [ "$USE_BUNDLE" = "1" ]; then
    node "$(npm root -g)/@wadeck-app/project-cli/project.cjs" "$@"
  else
    command project "$@"
  fi
}

installed_version() {
  project --version
}

# `npm install -g` of a version that was just published may fail for a few seconds (the registry has not indexed it yet).
install_global() {
  local spec="$1" attempt
  for attempt in 1 2 3 4 5 6; do
    if npm install -g "$spec"; then
      return 0
    fi
    echo "npm install -g $spec failed (attempt $attempt of 6), retrying in 10 s"
    sleep 10
  done
  fail "npm install -g $spec did not succeed after 6 attempts"
}
