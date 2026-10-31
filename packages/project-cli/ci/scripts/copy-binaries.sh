#!/usr/bin/env bash
# Copies the Go launcher binaries, the esbuild bundles, the packaged app-module and the README into the generated platform packages and dist package.
# Run after generate-platform-packages.sh, from the repository root:
#   bash packages/project-cli/ci/scripts/copy-binaries.sh
set -euo pipefail

LAUNCHER_DIST="packages/project-cli/launcher-go/dist"
BUNDLE_DIST="packages/project-cli/dist-bundle"

cp "$LAUNCHER_DIST/project_windows_release.exe" packages/project-cli-win32-x64/project.exe
cp "$LAUNCHER_DIST/project_darwin_arm64_release" packages/project-cli-darwin-arm64/project
cp "$LAUNCHER_DIST/project_darwin_amd64_release" packages/project-cli-darwin-x64/project
chmod +x packages/project-cli-darwin-arm64/project packages/project-cli-darwin-x64/project
cp "$BUNDLE_DIST/project.cjs" packages/project-cli-dist/project.cjs
cp "$BUNDLE_DIST/project-updater.cjs" packages/project-cli-dist/project-updater.cjs
cp -r "$BUNDLE_DIST/app-module" packages/project-cli-dist/app-module
cp packages/project-cli/README.md packages/project-cli-dist/README.md
echo "project artifacts copied"
