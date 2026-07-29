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
Targets are **Home Assistant 2026.3.1+** ⇒ **Python 3.14** and **Node 22.13+/24**.

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

Release automation (release-please) is **config-ready but deferred to WP5** —
see `.github/workflows/release-please.yml`. When enabled, merging Conventional
Commits to `main` opens a release PR that bumps the version across
`manifest.json`, `pyproject.toml`, and the card's `package.json`, and publishes
a GitHub Release with generated notes.
