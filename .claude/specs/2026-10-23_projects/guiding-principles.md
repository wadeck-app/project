# Guiding Principles -- Projects

Any option that conflicts with a principle must be raised as an open question, never silently accepted.

## Principles

### P-1: Explicit failure over silent fallback
A missing or ambiguous project is an error with an actionable message, never a fallback to cwd.
**Why:** user-wide rule (UX/DX first); flow already follows it (D#40).

### P-2: All machines are trusted
Every machine and every registered project is trusted; no gating of project-supplied hooks or subscribers.
**Why:** stated by the user (2026-10-24). Wrong-project protection (typos, name collisions) is still in scope; hostile-repo protection is not.
**Remote machines (user, 2026-11-13):** only machines registered with the machine CLI are trusted, and every registration is signed with the admin key. An unregistered or unsigned peer is not trusted: trust is by registration, not by network reachability.

### P-3: Findings go to the owning session
Bugs and inconsistencies found in a CLI are reported to its owner session, not fixed from the spec.
**Why:** stated by the user (2026-10-24).
