#!/usr/bin/env bash
# Generates platform package directories for npm publish.
# Called by CI before copy-binaries.sh. Not needed locally.
#
# Usage:
#   bash ci/scripts/generate-platform-packages.sh <cli[:extra-file1[:extra-file2]]>...
#
# Examples:
#   bash ci/scripts/generate-platform-packages.sh flow:worker.cjs task
#   bash ci/scripts/generate-platform-packages.sh my-cli
#   bash ci/scripts/generate-platform-packages.sh a:extra1.cjs:extra2.cjs b
#
# Each argument is a CLI name optionally followed by extra filenames separated by ':'.
# Extra filenames are added to the "files" array in the dist package.json (e.g. "worker.cjs").
#
# Environment variables:
#   TEMPLATES_DIR   Path to the templates directory containing bin-launcher.js.tmpl.
#                   Defaults to <script-dir>/../templates.
#   REGISTRY        npm registry URL (default: https://npm.pkg.github.com/).
#   PKG_SCOPE       npm scope without leading '@' (default: wadeck-app).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="${TEMPLATES_DIR:-${SCRIPT_DIR}/../templates}"
REGISTRY="${REGISTRY:-https://npm.pkg.github.com/}"
PKG_SCOPE="${PKG_SCOPE:-wadeck-app}"

if [[ $# -eq 0 ]]; then
  echo "Error: no CLI names provided." >&2
  echo "Usage: $0 <cli[:extra-file1[:extra-file2]]>..." >&2
  exit 1
fi

BIN_LAUNCHER_TMPL="${TEMPLATES_DIR}/bin-launcher.js.tmpl"
if [[ ! -f "$BIN_LAUNCHER_TMPL" ]]; then
  echo "Error: template not found: $BIN_LAUNCHER_TMPL" >&2
  echo "Set TEMPLATES_DIR to the directory containing bin-launcher.js.tmpl." >&2
  exit 1
fi

# generate <package-name> <os> <cpu> <bin-file>
# Creates packages/<package-name>/package.json for a platform-specific binary package.
generate() {
  local name="$1" os="$2" cpu="$3" bin_file="$4"
  local dir="packages/${name}"
  mkdir -p "$dir"
  cat > "$dir/package.json" <<EOF
{
  "name": "@${PKG_SCOPE}/${name}",
  "version": "0.0.0",
  "os": ["${os}"],
  "cpu": ["${cpu}"],
  "files": ["${bin_file}"],
  "publishConfig": {
    "registry": "${REGISTRY}"
  }
}
EOF
  echo "generated packages/${name}/package.json"
}

# generate_dist <cli> [extra-file1 extra-file2 ...]
# Creates packages/<cli>-cli-dist/ with bin launcher and package.json.
# Extra args (2+): additional filenames to include in the files array (e.g. "worker.cjs").
generate_dist() {
  local cli="$1"
  shift
  # Build extra_files_json from remaining args: '"foo.cjs",' for each
  local extra_files_json=""
  for f in "$@"; do
    extra_files_json+="		\"${f}\","$'\n'
  done
  local dir="packages/${cli}-cli-dist"
  mkdir -p "$dir/bin"

  # Generate bin/${cli}.js from template
  sed -e "s/{{CLI_NAME}}/${cli}/g" -e "s/{{PKG_PREFIX}}/${cli}-cli/g" \
      "${BIN_LAUNCHER_TMPL}" > "$dir/bin/${cli}.js"
  chmod +x "$dir/bin/${cli}.js"
  echo "generated $dir/bin/${cli}.js"

  # Generate package.json (preserves optionalDependencies, files, publishConfig)
  cat > "$dir/package.json" <<EOF
{
	"name": "@${PKG_SCOPE}/${cli}-cli",
	"version": "0.0.0",
	"private": false,
	"type": "commonjs",
	"bin": {
		"${cli}": "./bin/${cli}.js"
	},
	"files": [
		"bin/",
		"${cli}.cjs",
		"${cli}-updater.cjs",
${extra_files_json}		"package.json"
	],
	"optionalDependencies": {
		"@${PKG_SCOPE}/${cli}-cli-win32-x64": ">=0.0.0-0",
		"@${PKG_SCOPE}/${cli}-cli-darwin-arm64": ">=0.0.0-0",
		"@${PKG_SCOPE}/${cli}-cli-darwin-x64": ">=0.0.0-0"
	},
	"publishConfig": {
		"registry": "${REGISTRY}"
	}
}
EOF
  echo "generated $dir/package.json"
}

for arg in "$@"; do
  # Split on ':' — first field is the CLI name, remaining fields are extra files
  IFS=':' read -ra parts <<< "$arg"
  cli="${parts[0]}"
  extra_files=("${parts[@]:1}")

  generate "${cli}-cli-win32-x64"    "win32"  "x64"   "${cli}.exe"
  generate "${cli}-cli-darwin-arm64" "darwin" "arm64" "${cli}"
  generate "${cli}-cli-darwin-x64"   "darwin" "x64"   "${cli}"
  generate_dist "${cli}" "${extra_files[@]+"${extra_files[@]}"}"
done
