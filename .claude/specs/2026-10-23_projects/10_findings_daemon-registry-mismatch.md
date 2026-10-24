# Daemon vs registry location (Q21): owner findings

Source: sessions `queue-owner` (received 2026-10-24) and `flow-owner` (pending). References are in the owners' repos and were NOT re-verified by project-owner.

## queue-owner

| Topic | Finding |
|---|---|
| Daemon identity | Its config dir (`QUEUE_CONFIG_DIR`, default `$XDG_CONFIG_HOME/queue` or `~/.config/queue`): WAL, DLQ, history, logs, global `subscribers.yml`, `config.port`, `health_token`. A client finds its daemon through its own config dir, so a client with config dir X cannot reach a daemon started with config dir Y |
| Second daemon | Works today without touching the real one (port scan 47910-47920, `startDaemon(configDir, {port: 0})`). Exception: each daemon start re-registers the queue module in app-core; a sandbox must set `APP_CORE_PORT` / `APP_CORE_CONFIG_DIR` (queue-cli test config does) |
| Subscriber lookup | Which subscribers fire depends on the request `cwd`: walk-up to the nearest `.queue/subscribers.yml`, merged with the daemon's global file. A sandbox push whose cwd is inside a real project fires the real project's subscribers, even on a sandbox daemon. This is a second resolution path that bypasses the registry |
| Cost of a per-request registry field | About 10-15 files, moderate: optional field on request types, check in each command, version advertised in `GET /version`, SDK/CLI, protocol doc (additive minor), fixtures, tests. Only commands with a `rejected` status can refuse cleanly; others need a thrown error or new response variants. Clients that do not send the field stay unprotected |
| Test frequency | Daemon-backed tests on every full `npm test` of queue-cli, several per day, each with its own temp config dir. Adopters (orchestrator, task, flow) use the SDK fake daemon, never a real one |
| Opinion | Make the registry location part of the daemon's existing identity, so isolation needs no protocol change: a single sandbox variable from which the queue config dir and the registry are derived, or the registry defined relative to the queue config dir. If the registry must be overridable independently: do Option A as a CLIENT-side check (daemon advertises its bound registry in `GET /version` and `config.port`; clients refuse on mismatch before sending); a daemon-side refusal only protects against clients that skip the check |

## flow-owner

Request withdrawn: Q21 was deferred by Decision #16 before an answer was needed.

## Status

Deferred (Decision #16). If the override returns, start from queue-owner's opinion: make the registry part of the daemon's existing identity (config dir), or check client-side via the daemon's advertised registry, rather than adding a per-request field.

## New backlog question

Q31: with config and data per project in the registry (Decisions #4, #9), queue subscribers move out of `<project>/.queue/`. How does a pushed event's `cwd` select the project's subscribers: registry path match instead of walk-up?
