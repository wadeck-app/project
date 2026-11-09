# Recommendations

<!-- consolidated 2026-10-31 -->
## Documentation

- [ ] Add a concrete scaffold template for authoring an app-core module (reference layout drawn from the task/, queue/ and agent-fleet/ workspaces). This avoids rediscovering the pattern by exploring them.
- [ ] Document that moving `.queue` to the registry requires a queue daemon restart before subscribers appear. Add "restart the daemon" to the migration steps and to the "no subscribers" troubleshooting entry.
- [ ] Document that project-sdk scaffolding needs `npm install` before the test suite can run.
- [ ] Add a Windows shell pitfalls note to `kb/lessons-learned.md`:
  - Complex `sed` regexes break on backslashes, `$` interpolation and CRLF line endings. Use the Edit tool, and check `file <path>` and `core.autocrlf` when `sed` fails.
  - macOS temp dirs are symlinks, so path-normalization tests must call `realpath`.
  - Shell scripts must be validated on the real Windows and macOS CI runners.
- [ ] Document the extension-point ownership rule: extension points are requested from the task, queue and flow owners, not from app-core-owner.

## Process

- [ ] Label each item "DECISION" or "INFO" when presenting options. When a choice is needed, give one recommendation, let the user decide quickly, and move on.
- [ ] Default to MVP, "working system first" scope. Note edge cases (for example registry mismatch across daemons) as deferred items instead of asking open-ended questions about them.
- [ ] State the development approach (strict TDD, clean code) in the initial brief to sub-agents. Do not send it mid-task.
- [ ] Do not stop at "X NOT done" reports. Either continue the missing work (for example the launcher/platform packages) or list it explicitly as a partial implementation at the top of the response.
- [ ] Verify sub-agent output directly (read files, run tests) before reporting success. Never trust the summary.
- [ ] Load the `write-doc` skill before writing any .md file, and do not continue if it is unavailable. Use the Skill tool, or ToolSearch if the skill is not loaded, instead of writing the README directly.
- [ ] Batch destructive operations into a single command (for example one `rm` for four files). Rename files directly instead of copy-then-delete.
- [ ] In subprocess tests, use absolute paths for the CLI and fixtures. Relative paths fail silently when the working directory differs.
- [ ] Prefer the Edit tool over `sed -i`. Use vitest's native reporter and filter options instead of piping through grep.
- [ ] Avoid inline `node -e` experiments in tests (the guardrail blocks them). Use test-framework mocks, or plain-text tools such as `grep` and `cut`.
- [ ] Use Node, not Python, for scripts (no `python3 --version` checks).

## Configuration

- [ ] Add a CLAUDE.md rule that naming should be directional and explicit (for example `to-parents` / `to-children` instead of a generic `direction`).
- [ ] Add a CLAUDE.md rule against copy-then-delete file moves and against `sed -i` for multi-line or path edits on Windows.
