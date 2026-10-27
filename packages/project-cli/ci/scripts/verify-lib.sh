#!/usr/bin/env bash
# Shared helpers of verify-install.sh and verify-update.sh. Sourced, never run.
# Run locally: see the header of verify-install.sh (needs bash, node, npm and a token with read:packages in your npm config).

# --- output ---------------------------------------------------------------------------------------------------------

step() {
  echo
  echo "==> $*"
}

# A collapsible block in the GitHub log; plain separators elsewhere.
group_start() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::group::$*"
  else
    echo "--- $*"
  fi
}

group_end() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::endgroup::"
  fi
  return 0
}

# Where the output of the last `run_project` (or npm install) is kept, for the checks and for the diagnosis of a failure.
last_stdout_file() { echo "${VERIFY_ROOT:-.}/last-stdout.txt"; }
last_stderr_file() { echo "${VERIFY_ROOT:-.}/last-stderr.txt"; }
last_stdout() { cat "$(last_stdout_file)" 2> /dev/null || true; }
last_stderr() { cat "$(last_stderr_file)" 2> /dev/null || true; }

# The last non-empty line of the stdout of the last command, without carriage returns.
last_line() {
  { tr -d '\r' < "$(last_stdout_file)" 2> /dev/null | grep -v '^[[:space:]]*$' | tail -n 1; } || true
}

# One GitHub annotation (readable through the check-runs API without access to the job log): the message and the last lines of the
# output of the failing command, newlines and percent signs encoded as workflow commands require, about 1500 characters at most.
annotate_error() {
  local text="$1" tail_out tail_err
  tail_out="$(tail -n 15 "$(last_stdout_file)" 2> /dev/null | tr -d '\r' || true)"
  tail_err="$(tail -n 15 "$(last_stderr_file)" 2> /dev/null | tr -d '\r' || true)"
  if [ -n "$tail_out" ]; then
    text="$text"$'\n'"--- last stdout:"$'\n'"$tail_out"
  fi
  if [ -n "$tail_err" ]; then
    text="$text"$'\n'"--- last stderr:"$'\n'"$tail_err"
  fi
  text="${text:0:1500}"
  text="${text//'%'/%25}"
  text="${text//$'\r'/%0D}"
  text="${text//$'\n'/%0A}"
  echo "::error title=verify-install::$text"
}

fail() {
  local message="FAIL: $*"
  echo "$message" >&2
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    annotate_error "$message"
  fi
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
  # npm authentication must survive the redirection of HOME: setup-node sets NPM_CONFIG_USERCONFIG; for a local run, npm is asked where its
  # user config is before HOME moves. Nothing here reads or copies that file.
  if [ -z "${NPM_CONFIG_USERCONFIG:-}" ]; then
    local userconfig
    userconfig="$(npm config get userconfig 2> /dev/null || true)"
    if [ -n "$userconfig" ]; then
      export NPM_CONFIG_USERCONFIG="$userconfig"
    fi
  fi
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
  # The global bin folder: the prefix itself on Windows, <prefix>/bin elsewhere. In git-bash PATH is a list of POSIX paths separated by
  # colons: a C:/ entry would be cut at its colon.
  local bin_dir
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) bin_dir="$(cygpath -u "$npm_config_prefix")" ;;
    *) bin_dir="$npm_config_prefix/bin" ;;
  esac
  export PATH="$bin_dir:$PATH"
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

# Runs `project` with its stdout and stderr kept apart in files (never mixed in a value to compare), shows both in the log, and returns its status.
run_project() {
  local status=0
  mkdir -p "${VERIFY_ROOT:-.}"
  project "$@" > "$(last_stdout_file)" 2> "$(last_stderr_file)" || status=$?
  {
    echo "--- project $* (exit $status)"
    cat "$(last_stdout_file)"
    if [ -s "$(last_stderr_file)" ]; then
      echo "--- stderr:"
      cat "$(last_stderr_file)"
    fi
  } >&2
  return $status
}

# The very first run of the bin launcher installs its platform package and prints npm's output before the answer of the command:
# it is run once, under its own label, so that no later check has to deal with that noise.
first_run() {
  step "first run: the launcher may install its platform package"
  local status=0
  run_project --version || status=$?
  if [ "$status" -ne 0 ]; then
    fail "the first run of project exited with status $status"
  fi
}

# The installed version: the last non-empty line of the stdout of `project --version`.
installed_version() {
  local status=0
  run_project --version || status=$?
  if [ "$status" -ne 0 ]; then
    fail "project --version exited with status $status"
  fi
  last_line
}

# `project cli update` until the installed version is the wanted one: right after a publish the registry may still serve the previous dist-tag.
update_to() {
  local want="$1" attempt status got=""
  for attempt in 1 2 3 4 5 6; do
    status=0
    run_project cli update || status=$?
    if [ "$status" -ne 0 ]; then
      fail "project cli update exited with status $status"
    fi
    got="$(installed_version)"
    if [ "$got" = "$want" ]; then
      echo "ok: installed version is '$got' (update attempt $attempt)"
      return 0
    fi
    echo "installed '$got', wanted '$want' (the registry may still serve the previous dist-tag), retrying in 15 s ($attempt of 6)"
    sleep 15
  done
  fail "after 6 attempts the installed version is '$got', expected '$want'"
}

# `npm install -g` of a version that was just published may fail for a few seconds (the registry has not indexed it yet).
install_global() {
  local spec="$1" attempt status
  mkdir -p "${VERIFY_ROOT:-.}"
  group_start "npm install -g $spec"
  for attempt in 1 2 3 4 5 6; do
    status=0
    npm install -g "$spec" > "$(last_stdout_file)" 2> "$(last_stderr_file)" || status=$?
    cat "$(last_stdout_file)"
    cat "$(last_stderr_file)" >&2
    if [ "$status" -eq 0 ]; then
      group_end
      return 0
    fi
    echo "npm install -g $spec failed (attempt $attempt of 6), retrying in 10 s"
    sleep 10
  done
  group_end
  fail "npm install -g $spec did not succeed after 6 attempts"
}
