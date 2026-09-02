# Security policy

HAventory is a Home Assistant custom integration maintained by one person in their spare
time. This policy describes what that means in practice rather than promising a response
window nobody is on call to meet.

## Supported versions

Only the most recent release. Fixes ship as a new release; there are no backports and no
long-term-support line. The minimum supported Home Assistant version is declared in
`hacs.json`, and HACS enforces it at install time.

## Reporting a vulnerability

Report privately. **Please do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/chrreiter/HAventory/security/advisories/new).
The report stays visible only to you and the maintainer until an advisory is published.

Useful things to include: the HAventory and Home Assistant versions, whether the problem is
in the integration or the card, what an attacker gains, and the shortest reproduction you
have. A proof of concept is welcome but not required.

## What to expect

- **Acknowledgement**: best effort, usually within a week. A holiday or a busy stretch can
  make it longer. There is no SLA behind this.
- **A fix**: timing follows severity and how much of the integration has to move. Anything
  that lets an unauthenticated caller read or change inventory data is treated as urgent.
- **Credit**: in the advisory and the changelog, unless you would rather not be named.
- **Disclosure**: coordinated. Once a fixed release exists, the report is published as a
  GitHub Security Advisory. If a report goes unanswered for 90 days, publish it. A silent
  maintainer is not a reason for a problem to stay hidden.

## Scope

**In scope:** the integration in `custom_components/haventory/` and the Lovelace card in
`cards/haventory-card/`, as shipped in a release.

**Out of scope**, because they are somebody else's to fix. Report them upstream, but do say
so if HAventory's particular use of them is what makes the problem reachable:

- Home Assistant itself, HACS, and third-party dependencies.
- A Home Assistant instance exposed to the internet without authentication in front of it.
- The security of the machine Home Assistant runs on.

## What HAventory's design already assumes

Two properties shape what does and does not count as a vulnerability here:

- **HAventory has no authentication of its own.** Every WebSocket command, service call and
  the sidebar panel rides Home Assistant's session, so a caller is already an authenticated
  Home Assistant user. There are no per-user permissions and no admin-only commands. "An
  authenticated Home Assistant user can edit the inventory" is the design, not a finding. An
  *unauthenticated* caller reaching data or mutating state is a finding, as is anything that
  uses HAventory to step outside Home Assistant's own boundaries.
- **Everything stays local.** Inventory data is persisted through Home Assistant's `Store`
  into its `.storage` directory, inheriting that directory's permissions and backup
  handling. HAventory contacts no external service and sends no telemetry, so nothing leaves
  the instance unless the user exports it.
