# Threat Model -- Projects

**Version:** 1.0
**Date:** 2026-10-23
**Methodology:** STRIDE

## Scope

Local, single-user machine. Cross-project reads/writes between task, flow and queue, plus a global project registry.

## Assets

| Asset | Sensitivity | Owner |
|---|---|---|
| Project registry (paths of all projects) | Low-Medium | User |
| Per-project task data | Medium | User |
| Per-project hooks / queue subscribers (execute commands) | High | User |

## Threat actors

| Actor | Motivation | Capability |
|---|---|---|
| ~~Malicious cloned repo~~ | Out of scope per P-2 (all machines trusted) | - |
| Confused agent / script | Writes into the wrong project | Passes a wrong project reference |

## STRIDE analysis

### Spoofing
A project name colliding with another (same basename today) lets an action hit the wrong project.

### Tampering
Cross-project writes can alter another project's tasks by mistake. Hostile-repo subscribers are out of scope (P-2).

### Repudiation
*(pending)*

### Information Disclosure
Global visibility exposes every registered project's tasks to any project's commands.

### Denial of Service
*(pending)*

### Elevation of Privilege
Acting "from A on B" triggers B's hooks/subscribers with B's cwd; the risk is a wrong-target mistake, not a hostile repo (P-2).

## Mitigations

| ID | Threat category | Threat description | Mitigation | Status | Decision # |
|---|---|---|---|---|---|
| T-01 | Spoofing | Name collision targets wrong project | *(pending)* | Open | - |
| T-02 | Elevation | Cross-project action triggers target hooks | No prevention (P-2). Origin recorded when available and shown with the resolved target; residual risk accepted. A friend system is out of scope for now | Accepted (residual) | - |
| T-03 | Spoofing | Cloned repo marker claims an existing project id | No marker exists; the registry is the only source of ids | Mitigated | 3 |
| T-05 | Spoofing | One path registered under two projects makes resolution ambiguous and may hit the wrong project | A path belongs to exactly one project; registration of a held path is refused | Mitigated | 5 |
| T-06 | DoS | Parent cycle or dangling parent id loops or silently truncates the chain | Cycles refused at write; dangling parent is a resolution error | Mitigated (design) | 6 |
| T-07 | Tampering | A test or worker run writes to the production registry (override not applied, or a stray override file redirects a real run) | Override target must exist and be valid (no fallback); cwd-root-only override file; resolution logged at every command start | Open, accepted for version 1: override deferred (Decision #16), so tests using the SDK touch the default registry and its project data unless the environment is redirected by other means; revisit with Q21 | 12, 16 |
| T-04 | Tampering | Registry is the single trust anchor; a wrong or concurrent edit re-scopes every command | Atomic writes (Decision #4); lock with pid and 30 s staleness (Decision #13); validated reads pending (Q16) | Open (mostly mitigated) | 3, 4, 13 |

## Open security questions

Q: permission model for cross-project actions -> resolved, Decision #10
