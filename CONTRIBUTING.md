# Contributing to HAventory

Thanks for your interest in HAventory. The project is a Home Assistant custom integration
(domain `haventory`) plus a Lit + TypeScript Lovelace card. Bug reports, feature requests,
docs and code are all welcome. Taking part means following the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** or **request a feature** through the
  [issue tracker](https://github.com/chrreiter/HAventory/issues). The forms ask for the
  details we need.
- **Ask a question or discuss an idea** in
  [Discussions](https://github.com/chrreiter/HAventory/discussions) or the
  [Home Assistant community](https://community.home-assistant.io/).
- **Send a pull request** (see below).

Found a security problem? Do not open an issue. [SECURITY.md](SECURITY.md) has the private
reporting route and says what to expect from a one-maintainer project.

## Development setup

Prerequisites: [uv](https://docs.astral.sh/uv/), Node 22.13+ (or 24 LTS), git. The target is
**Home Assistant 2026.6.0+**, which means **Python 3.14** and **Node 22.13+/24**.

The development toolchain is **Linux/bash only**. The scripts, the test scaffolding and CI
all assume it, and nothing here is tested on a Windows host. On Windows, develop inside WSL2.
This is about contributing, not about running HAventory: the integration itself runs
wherever Home Assistant does.

**Proposing a higher Home Assistant floor?** Three constraints apply, and the binding one
changes: the HA APIs the integration touches, the Python floor those releases carry, and
security. A declared floor is a recommendation about what to run, so it must not point at a
release with a known unpatched **high or critical** advisory. Lower severities do not move
it, because "any advisory at all" would turn the floor into a treadmill. Re-derive the number
rather than assuming the current one is still right. `hacs.json` is the one place the floor
is declared; `tests/test_min_ha_version.py` checks every copy of it, and `dependency-review`
fails CI if `requirements-integration.txt` is pinned below it.

[`docs/developing.md`](docs/developing.md) has the rest: the bootstrap script, the full
toolchain, both backend test modes, the online smokes and the helper scripts.

## The gate

Run it before every commit. Both halves must be green.

```bash
# Backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run ruff format --check .   # CI fails on formatting alone; `ruff check` does not cover it
uv run mypy

# Frontend (in cards/haventory-card)
npm audit --audit-level=moderate
npx eslint .
npm run typecheck
npx vitest run
npm run build
```

The audit is the only place a development-scope npm vulnerability shows up: the
repository's Dependabot rule dismisses dev-scope alerts, so the alert dashboard is not the
truth for the card's lockfile, CI is. The level is `moderate` for the same reason. CI and
`scripts/ci_local.sh` run the same level, so a lower one locally is green against a red CI.

`scripts/ci_local.sh` runs everything at once. CI runs the same checks plus `actionlint`,
`hassfest`, HACS validation, CodeQL and dependency review.

## Conventions

- **Test-driven.** Every feature or fix ships with tests: the happy path plus at least one
  edge or error case. Default to offline tests (HA is stubbed in `tests/conftest.py`); async
  tests use `@pytest.mark.asyncio`. The WebSocket stub applies each command's schema before
  dispatch, so an offline test sends frames a real client could send. Dispatch a command with
  `ws_send` from `tests/ws_helpers.py`, never a private copy: it returns the full result
  envelope and takes an optional `conn=`. A card component test mounts through
  `mountComponent` from `cards/haventory-card/src/test.utils.ts` and reads it with `q`,
  `all`, `settle` and `componentCss` from the same place, never a per-file copy.
- **Conventional Commits** for commit messages *and PR titles* (a CI check enforces the PR
  title). Examples: `feat: add low-stock filter`, `fix: preserve location_path on move`.
- **Keep the API docs in sync.** A WebSocket or API change updates `ws.py`,
  `docs/backend_api_contract.md` and `docs/data_shapes.md` together.
- **Two documentation trees.** `docs/` is for what a user or contributor of the shipped
  integration needs. `dev/` is for the development process: the release testing plan, the
  dev Home Assistant's config, and the current milestone's implementation plan. Neither is a
  tracker; work lives in GitHub issues. A plan document is deleted in the pull request that
  ships the work it describes, because a plan left behind reads as pending work.
- **Preserve the core invariants:** case-insensitive search, denormalized `location_path`
  on items, and optimistic concurrency via the item `version`. `location_path` is derived:
  no client writes it, and rewriting it leaves `version` and `updated_at` alone, because a
  location rename is not an item edit.
- **The card renders no `ha-*` element.** Home Assistant's frontend components (`ha-form`,
  `ha-dialog`, `ha-selector`, `ha-data-table`) are registered lazily inside HA's own bundle,
  are not published for card authors, and are not versioned. A card that renders one breaks
  after a user's upgrade rather than in CI, because none of them exists in jsdom either.
  Build the control out of the card's own elements and `--hv-*` tokens instead; the glyphs
  are inlined in `ui/icons` for the same reason. `cards/haventory-card/src/ha-contract.ts`
  names everything the card *does* ask of Home Assistant, and its test enforces this rule.
- **Deleting or renaming a file inside `custom_components/haventory/`?** Add its old path to
  `RETIRED_PATHS` in `custom_components/haventory/stale_files.py` in the same PR. An upgrade
  extracts the release asset over the install directory without clearing it, so the file
  survives on every existing install until the setup-time sweep removes it.
- **User-facing text is never a literal.** The card reads every string through `t()` /
  `tn()` from `cards/haventory-card/src/i18n/`, and the integration through `strings.json`
  plus `translations/<tag>.json`. See "Adding a language" below for the shape, and
  `docs/frontend_architecture.md` for why copy cannot be a module constant.
- Update `README.md` when behavior changes. Report out-of-scope findings under a
  "Follow-ups" note rather than fixing them in the same PR.

### Comments explain constraints, not history

A comment earns its place by saying something the code cannot: a browser or platform quirk,
an API contract, a required ordering, an accessibility requirement, a deliberate tradeoff.
Write it in the present tense, about the code as it stands.

- Do **not** narrate development history: what a component replaced, what an earlier
  version did, which work package introduced it. That context dies with the branch. Git
  history is where it belongs.
- Do **not** point at anything a reader of this repository cannot open: design-mock numbers,
  an external design canvas, a numbered entry in a tracker. State the constraint instead.
- Do **not** restate the line below. If a comment paraphrases the code, delete the comment
  or fix the naming.
- A wrong comment is worse than none. When a comment names a symbol, a type, a caller or a
  stored shape, that name must still be correct.
- `TODO` / `FIXME` markers do not belong in committed code. The repository has zero and
  keeps it that way. Record follow-ups as GitHub issues (🔧 Task template).
- Component-level JSDoc says what the component is responsible for and what it talks to.
  Non-obvious CSS gets a why-comment; obvious CSS gets none.
- **Plain words, no stock AI-review vocabulary**, in comments, issues, pull request bodies,
  commit messages and docs alike. "Load-bearing", "blast radius" and phrases of that family
  are out. Name concretely what depends on the thing, or what a change would break.

This applies to TypeScript and Python alike and is enforced by review rather than by a lint
rule, because the distinction is a judgment call.

## Adding a language

HAventory ships English and German. A new language is two files and one line.

**The card.** Copy `cards/haventory-card/src/i18n/de.ts` to `<tag>.ts` (a lower-case BCP-47
tag such as `fr` or `pt-br`), translate the values, and register it:

```ts
// cards/haventory-card/src/i18n/index.ts
import { fr } from './fr';
export const DICTIONARIES: Readonly<Record<string, Dictionary>> = { en, de, fr };
```

Type it `Dictionary` (a `Partial`) while it is incomplete: `t()` falls through to the
English string for a missing key, so a half-finished language ships as a mixed screen rather
than as `hv.action.retry` printed on a button. Type it `CompleteDictionary`, as `de.ts` is,
once it is complete; TypeScript then refuses an English string added without its
counterpart. `catalog.test.ts` checks every registered dictionary for orphaned keys and
mismatched placeholders, and checks the ones its `COMPLETE` list names for completeness.

A counted string is written per plural category: `tn()` asks `Intl.PluralRules` for the
language's category and reads `<key>.<category>`. Write the categories your language uses,
and `.other` alone where the noun does not inflect, since every other category falls back
to it.

**The integration.** Copy `custom_components/haventory/translations/en.json` to `<tag>.json`
and translate the values. The key tree has to stay identical:
`tests/test_config_flow_offline.py` compares it against `strings.json`, checks that every
`{placeholder}` survives, and rejects an inline URL (a link belongs in the `{docs_url}`
placeholder). Home Assistant discovers the file by name; nothing registers it.

**Then** add the language to the README line naming what ships, run both gates, and check
the result against a real instance: set the Home Assistant profile to the language and read
the config flow, the options screen, the card and the sidebar page. The `run-haventory`
skill documents that recipe.

Two conventions worth copying from `de.ts`: match Home Assistant's own translations for
anything HA already has a word for (its `de.json` files live in
`homeassistant/components/*/translations/`), and add a same-line `// codespell:ignore` to the
rare test assertion whose non-English text trips the spell-check hook. The dictionaries
themselves are already excluded by path.

## Pull request process

1. Fork and branch from `main`.
2. Make focused commits and keep the PR scoped to one change.
3. Make sure both gate halves are green and add or adjust tests.
4. Open the PR: fill in the template, use a Conventional Commit title, and link any issues it
   closes (`Closes #123`). CODEOWNERS review is requested automatically.
5. A maintainer reviews. A ruleset protects `main`: merging needs a pull request and green
   CI, CodeQL, dependency-review and PR-title checks.

## Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release-please.yml`, `release-please-config.json`). Nobody edits a
version by hand.

### The flow

1. Conventional Commits land on `main`.
2. release-please opens and keeps updating a **release PR** titled
   `chore(main): release <version>`. It bumps every version file, writes `CHANGELOG.md` from
   the commit history, and updates `.release-please-manifest.json`.
3. Review that PR like any other. CI runs on it, which is where a version file that
   release-please failed to rewrite gets caught (`tests/test_release_version_consistency.py`).

   The release PR is opened by `github-actions[bot]`, which the required checks have to
   accommodate: GitHub creates no `pull_request_target` run for a PR that GITHUB_TOKEN
   opened, so a required check on such a workflow would wait forever. `pr-title.yml`
   therefore runs on `pull_request`. If a future required check reports on every PR except
   the release one, that is the cause. Either move it to `pull_request`, or give
   release-please its own token (`token:` on the action step, a PAT or GitHub App token with
   contents and pull-requests write).
4. Merging it tags the release and **drafts** a GitHub Release with the generated notes.
   The same workflow run then checks that the tag names the version the repository declares.
   That check lives in the release workflow rather than in a `push: tags:` one because the
   tag is pushed with `GITHUB_TOKEN`, and GitHub does not start workflow runs for events that
   token raises. Step 5 sits in the same job for the same reason.
5. Still in that run, from the tag checkout: the card is built, the whole of
   `custom_components/haventory/` is zipped into `haventory.zip`,
   `scripts/check_release_zip.py` asserts the archive would extract to a working
   integration, the asset is attached to the release, and the draft is published last.

That order is what makes a release safe to install. `zip_release` in `hacs.json` means HACS
installs the attached zip and nothing else, so a release whose asset is missing or wrongly
nested installs an integration that does nothing. HACS never shows a draft, so the release
only becomes installable once its bundle is on it. The tag exists that early because
`force-tag-creation` makes release-please push it explicitly.

If the run fails after the tag and before the publish, the draft stays a draft and nobody
sees a broken release. Re-running the job does not retry it, because release-please has
already marked the PR released. Recover by hand from a checkout of the tag:

```bash
(cd cards/haventory-card && npm ci && npm run build)
rm -f haventory.zip  # `zip -r` updates an existing archive; stale entries would ship
(cd custom_components/haventory && zip -r ../../haventory.zip . -x '*__pycache__*')
uv run python scripts/check_release_zip.py haventory.zip
gh release upload vX.Y.Z haventory.zip --clobber
gh release edit vX.Y.Z --draft=false
```

### What each commit type does to the version

Pre-1.0, `bump-minor-pre-major` keeps breaking changes from reaching 1.0.0 by accident:

| Commit | Effect while `0.x` | Effect once `1.x` |
|---|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) | patch |
| `feat:` | **minor** (`0.1.0` → `0.2.0`) | minor |
| `feat!:` / `BREAKING CHANGE:` | **minor** (capped below 1.0.0) | major |
| `chore:`, `docs:`, `test:`, `ci:`, `refactor:` | no release on their own | same |

`bump-patch-for-minor-pre-major` is deliberately **not** set: with it, a `feat` would only
bump the patch pre-1.0, and the first cut off `0.0.1` would be `0.0.2` rather than `0.1.0`.

To release a specific version instead of the computed one, put a `Release-As: 1.2.3`
footer in a commit on `main`. Do **not** use the config's `release-as` key: release-please
deprecates it, and it is sticky, so every later release would repeat the same version.

### The version files

Seven files carry the version, each rewritten by a different release-please mechanism, so
each can fail to update independently:

| File | Mechanism |
|---|---|
| `pyproject.toml` | `release-type: python` |
| `custom_components/haventory/manifest.json` | `extra-files` json + jsonpath |
| `cards/haventory-card/package.json` | `extra-files` json + jsonpath |
| `cards/haventory-card/package-lock.json` | `extra-files` json + **two** jsonpaths |
| `custom_components/haventory/const.py` (`INTEGRATION_VERSION`) | `extra-files` generic + an `x-release-please-version` line annotation |
| `uv.lock` | `extra-files` toml + jsonpath |
| `.release-please-manifest.json` | release-please's own bookkeeping |

`INTEGRATION_VERSION` is the one users see: `haventory/version` returns it and every export
document is stamped with it.

The card's lockfile takes two entries because npm writes the root package's version twice,
at the top level and again under `packages[""]`, and one `extra-files` entry rewrites one
jsonpath. A copy left behind is rewritten by the next `npm install`, which dirties the
working tree for whoever runs it.

`uv.lock` is the odd one: nothing reads its version, but uv writes `pyproject`'s version
into the project's own `[[package]]` entry, so a stale lockfile is rewritten by the next
`uv` command. Its jsonpath, `$.package[?(@.name.value=='haventory')].version`, needs the
`.value` hop because release-please's TOML updater parses string values into
`{start, end, value}` spans. A path without it matches nothing, and release-please treats
no match as a warning rather than an error. That is the failure the consistency check
exists to make loud.

`scripts/check_version_consistency.py` compares all seven (and, on a tag build, the tag).
Run it locally any time:

```bash
uv run python scripts/check_version_consistency.py
```
