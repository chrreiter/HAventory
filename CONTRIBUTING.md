# Contributing to HAventory

Thanks for your interest in HAventory! This project is a Home Assistant custom
integration (domain `haventory`) plus a Lit + TypeScript Lovelace card.
Contributions of all kinds are welcome — bug reports, features, docs, and code.

## Ways to contribute

- **Report a bug** or **request a feature** via the
  [issue tracker](https://github.com/chrreiter/HAventory/issues) — the forms
  guide you through the details we need.
- **Ask a question / discuss an idea** in
  [Discussions](https://github.com/chrreiter/HAventory/discussions) or the
  [Home Assistant community](https://community.home-assistant.io/).
- **Send a pull request** (see below).

## Development setup

Prerequisites: [uv](https://docs.astral.sh/uv/), Node 22.13+ (or 24 LTS), git.
Targets are **Home Assistant 2026.6.0+** ⇒ **Python 3.14** and **Node 22.13+/24**.

```bash
# One-shot bootstrap: uv env + card deps + pre-commit hooks
scripts/setup.sh

# ...or manually:
uv sync
(cd cards/haventory-card && npm ci)
```

See the [README "Developer Checklist"](README.md#developer-checklist) for the
full toolchain and helper scripts.

## The gate (run before every commit — both halves must be green)

```bash
# Backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run mypy

# Frontend (in cards/haventory-card)
npm audit --audit-level=high
npx eslint .
npm run typecheck
npx vitest run
npm run build
```

Or run everything at once with `scripts/ci_local.sh`. CI runs the same checks
plus `actionlint`, `hassfest`, HACS validation, CodeQL, and dependency review.

**`npm run build` also refreshes `custom_components/haventory/haventory-card.js`, and that
copy is checked in — commit it with any card change.** HACS installs an
Integration-category repository by copying `custom_components/` and nothing else, so a card
that lives only in `cards/www/` (git-ignored) never reaches a user; setup copies the bundled
one into `<config>/www/haventory/`. A tracked build artifact can drift from its source, so
CI rebuilds and fails on any diff rather than trusting the commit.

## Conventions

- **Test-driven**: every feature/fix ships with tests — happy path plus at least
  one edge/error case. Default to offline tests (HA is stubbed in
  `tests/conftest.py`); async tests use `@pytest.mark.asyncio`.
- **Conventional Commits** for commit messages *and PR titles* (a CI check
  enforces the PR title). Examples: `feat: add low-stock filter`,
  `fix: preserve location_path on move`, `docs: …`, `chore: …`.
- **Keep the API docs in sync**: WebSocket/API changes must update `ws.py`,
  `docs/backend_api_contract.md`, and `docs/data_shapes.md` together.
- **Preserve load-bearing invariants**: case-insensitive search, denormalized
  `location_path` on items, and optimistic concurrency via the item `version`.
- Update `README.md` when behavior changes. Report out-of-scope findings under a
  "Follow-ups" note rather than fixing them in the same PR.

## Pull request process

1. Fork and branch from `main`.
2. Make focused commits; keep the PR scoped to one change.
3. Ensure both gate halves are green and add/adjust tests.
4. Open the PR — fill in the template, use a Conventional Commit title, and link
   any issues it closes (`Closes #123`). CODEOWNERS review is requested
   automatically.
5. A maintainer reviews. A ruleset protects `main`: merging needs a pull request and
   green CI, CodeQL, dependency-review and PR-title checks.

## Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release-please.yml`, `release-please-config.json`). Nobody
edits a version by hand.

### The flow

1. Conventional Commits land on `main`.
2. release-please opens — and then keeps updating — a **release PR** titled
   `chore(main): release <version>`. It bumps every version file, writes
   `CHANGELOG.md` from the commit history, and updates
   `.release-please-manifest.json`.
3. Review that PR like any other. CI runs on it, which is where a version file
   that release-please *failed* to rewrite gets caught
   (`tests/test_release_version_consistency.py`).
4. Merging it tags the release and publishes a GitHub Release with the generated
   notes. The same workflow run then checks that the tag names the version the
   repository declares. (That check lives in the release workflow rather than in
   a `push: tags:` one because the tag is pushed with `GITHUB_TOKEN`, and GitHub
   does not start new workflow runs for events that token raises.)

### What each commit type does to the version

Pre-1.0, `bump-minor-pre-major` keeps breaking changes from reaching 1.0.0 by
accident:

| Commit | Effect while `0.x` | Effect once `1.x` |
|---|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) | patch |
| `feat:` | **minor** (`0.1.0` → `0.2.0`) | minor |
| `feat!:` / `BREAKING CHANGE:` | **minor** (capped below 1.0.0) | major |
| `chore:`, `docs:`, `test:`, `ci:`, `refactor:` | no release on their own | same |

`bump-patch-for-minor-pre-major` is deliberately **not** set: with it, a `feat`
would only bump the patch pre-1.0, and the first cut off `0.0.1` would be
`0.0.2` rather than `0.1.0`.

To release a specific version instead of the computed one, put a
`Release-As: 1.2.3` footer in a commit on `main`. Do **not** use the config's
`release-as` key — release-please deprecates it in favour of the commit footer,
and it is sticky: left in place, every later release repeats the same version.

### The version files

Five files carry the version, each rewritten by a different release-please
mechanism, so each can fail to update independently:

| File | Mechanism |
|---|---|
| `pyproject.toml` | `release-type: python` |
| `custom_components/haventory/manifest.json` | `extra-files` json + jsonpath |
| `cards/haventory-card/package.json` | `extra-files` json + jsonpath |
| `custom_components/haventory/const.py` (`INTEGRATION_VERSION`) | `extra-files` generic + an `x-release-please-version` line annotation |
| `.release-please-manifest.json` | release-please's own bookkeeping |

`INTEGRATION_VERSION` is the one users see: `haventory/version` returns it and
every export document is stamped with it. `scripts/check_version_consistency.py`
compares all five (and, on a tag build, the tag) — run it locally any time:

```bash
uv run python scripts/check_version_consistency.py
```
