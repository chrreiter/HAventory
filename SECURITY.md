# Security Policy

## Supported versions

HAventory is pre-release and unversioned in production. Security fixes are made
against the latest `main`. Until a `1.0.0` release, only the most recent code on
`main` is supported.

| Version | Supported |
| ------- | --------- |
| `main` (latest) | ✅ |
| older commits / pre-release | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately using GitHub's built-in
[private vulnerability reporting](https://github.com/chrreiter/HAventory/security/advisories/new)
(Security → "Report a vulnerability"). If that is unavailable, email the
maintainer at **chrrei@gmail.com** with details.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected component (integration / card) and versions (HAventory + Home Assistant).

### What to expect

- Acknowledgement within a few days.
- An initial assessment and, where applicable, a coordinated fix and disclosure.
- Credit for the report if you would like it.

## Scope

HAventory is a local-push, single-instance integration with no external
services; it persists to Home Assistant's `Store`. Relevant areas include the
WebSocket API, service handlers, storage/migrations, and the Lovelace card.
Issues in Home Assistant core itself should be reported to the
[Home Assistant project](https://github.com/home-assistant/core/security).
