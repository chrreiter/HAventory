# Contributing to HAventory

Thanks for your interest in HAventory! This project is a Home Assistant custom
integration (domain `haventory`) plus a Lit + TypeScript Lovelace card.
Contributions of all kinds are welcome — bug reports, features, docs, and code.
Taking part means following the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** or **request a feature** via the
  [issue tracker](https://github.com/chrreiter/HAventory/issues) — the forms
  guide you through the details we need.
- **Ask a question / discuss an idea** in
  [Discussions](https://github.com/chrreiter/HAventory/discussions) or the
  [Home Assistant community](https://community.home-assistant.io/).
- **Send a pull request** (see below).

Found a security problem? Do not open an issue — [SECURITY.md](SECURITY.md) has the
private reporting route and says what to expect from a one-maintainer project.

## Development setup

Prerequisites: [uv](https://docs.astral.sh/uv/), Node 22.13+ (or 24 LTS), git.
Targets are **Home Assistant 2026.6.0+** ⇒ **Python 3.14** and **Node 22.13+/24**.

The development toolchain is **Linux/bash only** — the scripts, the test
scaffolding and CI all assume it, and nothing here is tested on a Windows host.
On Windows, develop inside WSL2. (This is about contributing, not about running
HAventory: the integration itself runs wherever Home Assistant does.)

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
  `tests/conftest.py`); async tests use `@pytest.mark.asyncio`. The WebSocket
  stub applies each command's schema before dispatch, so an offline test sends
  frames a real client could send and gets `invalid_format` for the rest.
  A card component test mounts through `mountComponent` from
  `cards/haventory-card/src/test.utils.ts` and reads it with `q` / `all` /
  `settle` / `componentCss` / `ownCss` from the same place — never a per-file
  copy, which is how the mount helpers drifted into dropping half the mock
  config.
  Dispatch a command with `ws_send` from `tests/ws_helpers.py` — never a private
  copy: it returns the full result envelope and takes an optional `conn=`, so a
  test can assert on the answer, on what the handler pushed on the connection,
  or on both.
- **Conventional Commits** for commit messages *and PR titles* (a CI check
  enforces the PR title). Examples: `feat: add low-stock filter`,
  `fix: preserve location_path on move`, `docs: …`, `chore: …`.
- **Keep the API docs in sync**: WebSocket/API changes must update `ws.py`,
  `docs/backend_api_contract.md`, and `docs/data_shapes.md` together.
- **Two documentation trees**: `docs/` is for what a user or a contributor of the
  shipped integration needs; `dev/` is for the development process — the release
  testing plan, the release review, and per-task design documents. A new document
  goes in one of the two, and neither is a tracker: work lives in GitHub issues.
- **Preserve the core invariants**: case-insensitive search, denormalized
  `location_path` on items, and optimistic concurrency via the item `version`.
- **Deleting or renaming a file inside `custom_components/haventory/`?** Add its
  old path to `RETIRED_PATHS` in `custom_components/haventory/stale_files.py` in
  the same PR — an upgrade extracts the release asset over the install directory
  without clearing it, so the file survives on every existing install until the
  setup-time sweep removes it.
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

   The release PR is opened by `github-actions[bot]`, which the required checks
   have to accommodate: GitHub creates no `pull_request_target` run for a PR
   that GITHUB_TOKEN opened, so a required check on such a workflow would wait
   for a status that never arrives. `pr-title.yml` therefore runs on
   `pull_request`. If a future required check reports on every PR *except* the
   release one, that is the cause — either move it to `pull_request`, or give
   release-please its own token (`token:` on the action step, a PAT or GitHub
   App installation token with contents and pull-requests write), which makes
   its PRs raise events like anyone else's.
4. Merging it tags the release and **drafts** a GitHub Release with the generated
   notes. The same workflow run then checks that the tag names the version the
   repository declares. (That check lives in the release workflow rather than in
   a `push: tags:` one because the tag is pushed with `GITHUB_TOKEN`, and GitHub
   does not start new workflow runs for events that token raises. Everything in
   step 5 sits in that same job for the same reason.)
5. Still in that run, from the tag checkout: the card is built, the whole of
   `custom_components/haventory/` is zipped into `haventory.zip`,
   `scripts/check_release_zip.py` asserts the archive would extract to a working
   integration, the asset is attached to the release, and the draft is published
   last.

That last order is what makes a release safe to install. `zip_release` in
`hacs.json` means HACS installs the attached zip and *nothing else* — not the
repository tree — so a release whose asset is missing or wrongly nested installs
an integration that does nothing and reports success. Drafting first closes the
window: HACS never shows a draft, so the release only becomes installable once
its bundle is on it. The tag exists that early because `force-tag-creation` makes
release-please push it explicitly; a draft release on its own creates no tag.

If the run fails after the tag and before the publish, nobody sees a broken
release — the draft stays a draft. Re-running the job does not retry it
(release-please has already marked the PR released, so it creates nothing the
second time). Recover by hand from a checkout of the tag:

```bash
(cd cards/haventory-card && npm ci && npm run build)
rm -f haventory.zip  # `zip -r` updates an existing archive; stale entries would ship
(cd custom_components/haventory && zip -r ../../haventory.zip . -x '*__pycache__*')
uv run python scripts/check_release_zip.py haventory.zip
gh release upload vX.Y.Z haventory.zip --clobber
gh release edit vX.Y.Z --draft=false
```

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

Six files carry the version, each rewritten by a different release-please
mechanism, so each can fail to update independently:

| File | Mechanism |
|---|---|
| `pyproject.toml` | `release-type: python` |
| `custom_components/haventory/manifest.json` | `extra-files` json + jsonpath |
| `cards/haventory-card/package.json` | `extra-files` json + jsonpath |
| `custom_components/haventory/const.py` (`INTEGRATION_VERSION`) | `extra-files` generic + an `x-release-please-version` line annotation |
| `uv.lock` | `extra-files` toml + jsonpath |
| `.release-please-manifest.json` | release-please's own bookkeeping |

`INTEGRATION_VERSION` is the one users see: `haventory/version` returns it and
every export document is stamped with it.

`uv.lock` is the odd one: nothing reads its version, but uv writes `pyproject`'s
version into the project's own `[[package]]` entry, so a lockfile left at the
previous release is rewritten by the next `uv` command and dirties the tree for
whoever runs it. Its jsonpath —
`$.package[?(@.name.value=='haventory')].version` — needs the `.value` hop
because release-please's TOML updater parses string values into
`{start, end, value}` spans in order to rewrite them in place; a path without it
matches nothing, and release-please treats no match as a warning rather than an
error. That is the failure this check exists to make loud.

`scripts/check_version_consistency.py` compares all six (and, on a tag build,
the tag) — run it locally any time:

```bash
uv run python scripts/check_version_consistency.py
```
