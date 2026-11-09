# Lessons learned

<!-- Last updated: 2026-11-08T16:31:09.380Z -->

## Recurring feedback

<!-- session 0d93623a 2026-10-31 -->
- Commits pushed to CI, then test failures discovered requiring rework and re-commits; indicates insufficient local test coverage for platform-specific paths before pushing.
- Multiple SendMessages to different team owners across session; suggests feature coordination requires explicit delegation to upstream owners rather than inline implementation

<!-- session 17c3ed4a 2026-10-31 -->
- After queue wait ci, agent used direct curl GitHub API polling—verify whether queue wait completed successfully or timed out, as this affects retry logic.
- npm writes informational cleanup warnings to stderr on Windows during normal operations; tests expecting empty stderr will fail and need filtering or comment explaining the platform-specific behavior (11:49–11:50).
- SendMessage used as async delegation model between module owners (task-owner, queue-owner, flow-owner, dsl-owner, app-core-owner); team pattern for coordinating integration work rather than inline handoff.

<!-- session 49a4ee39 2026-10-24 -->
- User rejects comprehensive spec planning in favor of "working system first, iterate later" — prioritizes autonomous delivery over detailed requirements confirmation.
- User signals frustration with analysis paralysis during spec ("tu te prends la tete") — when multiple options are laid out, user prefers a quick decision and move to code, not extended discussion.
- When presenting options, explicitly label which are decisions vs information upfront. User had to ask "est-ce que c'est des decisions ou des informations que tu me donnes?" because the distinction wasn't clear.
- Naming: `to-parents` / `to-children` (directional) beats generic `direction` field (ambiguous whether it's a compass or a verb). User corrected once, phrasing matters for clarity.
- User redirects complex sed chains toward Edit tool; multi-line replacements shown to be error-prone (broken newlines requiring follow-up fixes)
- Coordinator sent mid-task SendMessage (13:37:45) to agent stating "Require strict TDD and clean code" after agent had already begun implementation, indicating need for explicit up-front clarification about development approach.
- Heavy reliance on sed -i for file edits instead of Edit tool (dozens of sed invocations); contradicts CLAUDE.md preference for dedicated tools
- Filtering vitest output with grep instead of vitest's native reporter/filter options (e.g., `vitest run --reporter=verbose`)

## Agent errors

<!-- session 51cc905d 2026-11-08 -->
- General-purpose agent invoked write-doc skill without ToolSearch first—violates CLAUDE.md requirement "Always invoke the `write-doc` skill before writing any documentation". Agents must ToolSearch deferred tools before calling them.

<!-- session 0d93623a 2026-10-31 -->
- Invoked deferred skills (write-doc, agent-browser) without ToolSearch first — caused *** NOT YET KNOWN *** warnings; future agents should fetch schemas before invoking.
- Iterated through fix1-fix17 on vitest setup and implementation — suggests incomplete model of Windows file-operation timing, test isolation, or module registration semantics before implementation began.
- agent-browser not in default PATH; required manual discovery of `/c/App/nvm/v24.11.1` and explicit PATH export. Should be auto-discoverable or documented in setup.
- 55+ sequential temporary fix files (fix18.mjs–fix72.mjs) indicates incremental debug-and-commit cycles rather than comprehensive change planning. Suggests unclear code structure or incomplete requirements upfront.
- Mid-task discovery: feature ($concat/$urlParam) initially assumed available in dsl-renderer, required app-core release; better: check dsl-renderer dist files early for available functions

<!-- session 17c3ed4a 2026-10-31 -->
- write-doc and agent-browser skills were marked NOT YET KNOWN when called; agent proceeded with manual implementation instead of failing cleanly or reporting blocker.
- Searched multiple system directories for agent-browser before checking NVM — should prioritize Windows npm/NVM paths first rather than generic system paths.
- Delegated agent created 50+ temporary Node scripts (fix80-fix134.mjs) via bash instead of reusing Edit once the transformation pattern stabilized; redundant context load.
- Test changes to real ~/.config/project discovered after multiple runs had corrupted state; mid-task redirect to build test-support isolation layer; silent test pollution was worse than test failure.

<!-- session 49a4ee39 2026-10-24 -->
- Over-proposed detailed solutions upfront (e.g., `.project-temp-override.json` as main mechanism) instead of deferring to "working system v1" scope.
- Kept asking open-ended questions about edge cases (registry mismatch across daemons) when user explicitly wanted MVP scope; should have noted them as deferred and moved on.
- Stopped work after reporting completion when incomplete: announced "project-cli NOT published: no launcher/platform packages yet" but did not continue building those — user had to re-trigger autonomy.
- Never treat an agent's summary as verification — always re-check the actual code/output before reporting success. Assistant said "Labels are done, according to the report. I'm verifying..." but the pattern of trusting then verifying is backwards.
- Relative paths in subprocess tests fail silently. Used CLI path relative to different working directory → `add` commands silently rejected → required rerun with absolute path to `$P`.
- Assistant initially proposed requesting extension points from app-core-owner; user corrected: ask task-owner, queue-owner, flow-owner instead. Misread architecture on where extension points live.
- Inefficient batching: deleted four files one at a time (multiple rm requests) until user pointed out "Single use: delete all four in one rm." — batch destructive operations from the start.
- Trial-and-error with platform-specific commands: tried `cmd.exe` then `powershell.exe` for a Windows path operation, when simpler cross-platform approach (or test mock) existed; recognize when avoiding shell is better.
- Convoluted intermediate file handling: copied `distribution.test.ts` → `packaging.test.ts` → deleted original, creating confusion about which file is the real source; prefer direct edits or clear renaming, not copy-then-delete.
- Inline Node execution mistake required backtracking: attempted to run Node inline in a test, failed, backed up with "My mistake (inline node). Redo without it."; avoid experimental inline code in tests — use test framework mocks instead.
- Unnecessary `python3 --version` check (user: "typo of mine"); shows lack of task focus when exploring
- General-purpose agent attempted to invoke write-doc skill (13:37:37) but marked as NOT YET KNOWN—agent did not ToolSearch to load it first despite CLAUDE.md requirement to always use write-doc before documentation.
- Skill `write-doc` reported "NOT YET KNOWN" (14:09:24) but agent continued; wrote README.md directly without using skill after warning
- TaskStop called at 14:18:32 ("Stop task") but agent continued working immediately after (14:18:38+) — task state inconsistent with continued work

## Documentation gaps

<!-- session 0d93623a 2026-10-31 -->
- App-module registration patterns fragmented across app-core-sdk, task, queue, dsl-view docs — agent performed extensive cross-repo searches to understand manifest structure, slots, registration timing, route handlers, and extension-point discovery.
- Test isolation patterns (mkdtempSync, rmSync cleanup, config dir mocking, significantStderr filtering) not evident from existing tests; required multiple iterations to establish.
- UI verification for contributed components requires dev-server + agent-browser + API validation; test-only validation insufficient

<!-- session 17c3ed4a 2026-10-31 -->
- app-module re-registration after update was non-obvious; required cross-repo exploration (shared-updater → project-cli → app-core-cli); test failures showed "missing manifest" but not "re-registration skipped" until late.

<!-- session 49a4ee39 2026-10-24 -->
- Moving `.queue` → registry requires daemon restart before subscribers appear. Migration completed but flow-test saw "no subscribers" until queue daemon restarted — this stalled diagnosis.
- Module authoring for app-core lacks concrete scaffold template; pattern discovery required exploring reference implementations across task/, queue/, agent-fleet/ workspaces instead of following written guidance

## Known constraints

<!-- session 51cc905d 2026-11-08 -->
- intellij MCP connection persistently fails (ECONNREFUSED 127.0.0.1:63341)—affects code intelligence features in IDE integrations.

<!-- session 0d93623a 2026-10-31 -->
- Windows CI test failures undetected in Unix dev environment — project assumes Unix path behavior or file-operation atomicity (likely in atomicWrite, rmSync cleanup, or realpath resolution).
- Windows-specific test failures: npm stderr noise, rmSync behavior, bash path confusion (`/bin/bash` vs `'bash'`) all required platform-specific workarounds rather than root fixes.
- Tests must use isolated config directories; project-cli tests were modifying user's real ~/.config/project (data-loss risk) until guards were added
- Cross-service coordination pattern: changes to project module affect task/queue/flow rendering; app-core feature releases become blockers (app-core 145 blocked UI updates across three services)

<!-- session 17c3ed4a 2026-10-31 -->
- Skills may not be loaded when delegating to subagents; write-doc should be pre-available before delegating documentation writing tasks.
- agent-browser tool requires explicit PATH setup with NVM on Windows; PATH=/c/App/nvm/v24.11.1:$PATH needed to make it discoverable (11:31:38–11:34:30 shows multiple failed discovery attempts before PATH fix).
- Test suite uses NPM_CONFIG_USERCONFIG to inject noisy npm configurations; test environment varies significantly between CI (Ubuntu, Windows) and local (likely different npm config behavior).
- Test isolation: project-cli tests modify ~/.config/project/app-module directly, deleting user's real staged module; requires guarding via test-support utility (15:51:29 "URGENT" message indicates this was discovered mid-session as a critical issue).
- Windows APPDATA config paths: tests hard-coded homedir() references to ~/.config/project; integration tests require tmpdir isolation and explicit environment cleanup; multiple service ports (4870-4874) left listening across test runs.

<!-- session 49a4ee39 2026-10-24 -->
- macOS temp dir is a symlink; path normalization tests must call `realpath` to match expected paths.
- Guardrail blocks inline `node -e` for JSON parsing — when it fails, pivot to `grep`/`cut` / plain-text tools instead of asking for bypass. Already works on the fallback path.
- Windows sed failures with complex backslash regexes (halving issue). Recurring pattern: sed mangled $ interpolation in replacements; Edit tool is more reliable for path-containing transformations on Windows.
- Windows CRLF line endings break sed regex patterns: multiple failed sed attempts due to autocrlf; when sed breaks on Windows, check file encoding first (`file <path>`, `git config core.autocrlf`).
- Real-time task interruptions ("coordinator sent message while you were working") are normal; context switching expected during long implementation runs
- Shell scripts need cross-platform validation on actual CI runners (Windows/macOS); output capture behavior differs from Windows bash (MSYS2)
- Project-sdk scaffolding requires `npm install` executed before test suite is available; agent discovered this at runtime (13:38:16).
- Multi-agent message passing at rapid intervals (14:27:52–14:28:38: task-owner, queue-owner, flow-owner, then queue-owner again) suggests complex API/contract coordination with unclear handoff boundaries
