# Contributing to P3 Portal

Thanks for your interest in P3 Portal. This file describes how
contributions work in practice, so there are no surprises.

## Current status: sole-maintainer project

P3 Portal is currently maintained by a single person, who is also
the sole copyright holder of all code in the tree (other than the
clearly-attributed external libraries listed in dependency
manifests). External pull requests are auto-closed by the
[`.github/workflows/close-prs.yml`](.github/workflows/close-prs.yml)
workflow.

**This is not a comment on contribution quality.** It is a
deliberate posture while the project's legal structure (entity,
trademark, contributor licensing) is still being worked out. The
practical effect is that the entire repository today has a single
identifiable copyright holder, which keeps the project simple to
relicense or restructure if that ever becomes necessary.

If the project's structure changes (a legal entity is set up, a
contributor base grows, a Contributor License Agreement / CLA bot
is added, etc.), this file will be updated and external pull
requests will be enabled with the appropriate process. Until then,
the sole-owner posture stays.

## What contributions ARE welcome

**Bug reports via GitHub Issues** are very welcome. To make a
report useful, use the bug-report template — it asks for the
information that actually helps:

- A behaviour description (what happened, what you expected)
- A reproducer (smallest possible steps)
- P3 Portal version (or image tag)
- Host OS (distribution + version)
- Container runtime + version (Podman or Docker; compose tool if
  used)
- Optionally: a prose description of the root cause, references
  to affected file paths / function names / line numbers, and a
  prose description of a suggested mitigation approach

**Documentation, deployment, configuration questions** belong in
[GitHub Discussions](https://github.com/P3Portal-org/p3portal/discussions),
not as bug reports.

**Security vulnerabilities** must go through
[GitHub Private Vulnerability Reporting](https://github.com/P3Portal-org/p3portal/security/advisories/new),
not public issues. The full policy is in
[`SECURITY.md`](SECURITY.md).

## What contributions are NOT possible right now

**External pull requests are auto-closed.** Don't take it
personally if a PR you opened lands closed within minutes —
that's the workflow, not a human decision.

**"Suggested Fix" code blocks in issue text are problematic.**
GitHub Terms of Service §D.5 grants display rights on the
platform, but not redistribution rights into the codebase, and
"inbound = outbound" only attaches to pull requests, not to issue
comments. Implementation code pasted into issue text leaves the
project in an ambiguous licensing situation: we can either ask
the reporter for an explicit licence grant (which has happened —
see SECURITY.md → Hall of thanks for precedent), or re-implement
the fix from scratch using only the bug description (which has
also happened, in v1.74.8-beta).

To avoid forcing that choice on us and on you:

- **Yes:** "Function `foo()` in `backend/services/bar.py` doesn't
  validate input `X`, which is why the crash happens. A
  validation step before the existing call to `baz()` would close
  it."
- **No:** A 20-line Python diff in a fenced code block showing
  exactly what to write.

Behaviour descriptions, expected vs actual outputs, references to
existing code via `file.py:line`, prose discussion of approaches
— all of that is genuinely useful and licence-safe.

## Hall of thanks

Reporters whose bug reports have shaped releases are credited in
[`SECURITY.md`](SECURITY.md). That credit is for the report — for
finding the issue, describing it precisely, and reporting it
through an appropriate channel. It is not a claim that any code
written by the reporter has been adopted into the codebase
without explicit licence; where code adoption did happen, it is
either explicitly licensed (see the issue thread for the licence
grant) or has been replaced by a clean-room re-implementation.

## Future

If you'd like to know when external pull requests might be opened
up, watch this file. Any change will be reflected here first
(plus a short note in `SECURITY.md`).

Thanks for taking the time to read this. Bug reports under the
above structure are appreciated.
