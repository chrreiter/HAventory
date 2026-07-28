# Repository settings

The GitHub-side configuration that is not expressible in a workflow file. Everything
here except the social-preview image can be reported and applied with:

```bash
scripts/repo_hardening.sh            # read-only report; exits 1 on drift
scripts/repo_hardening.sh --apply    # push the settings to GitHub
```

The script needs the `gh` CLI authenticated as a repository admin.

## Branch ruleset on `main`

Declared in [`.github/rulesets/main.json`](../.github/rulesets/main.json) — the exact body
the REST API takes, and the same JSON the UI's *Settings → Rules → Import a ruleset*
accepts. `scripts/repo_hardening.sh` compares the live ruleset against it field by field
(via `scripts/ruleset_diff.py`) and PUTs the file on `--apply`.

It targets `~DEFAULT_BRANCH` and:

- blocks deletion and force-push of `main`;
- requires a pull request, with **0 required approvals** — a solo maintainer cannot
  approve their own PR, so any higher number would make `main` unmergeable;
- requires the ten status checks below to pass.

`strict_required_status_checks_policy` is off on purpose: with it on, every open branch
would need a rebase after each merge, and parallel PRs are the normal working mode here.

Required checks — each pinned to the GitHub Actions app (id `15368`) so a status posted by
any other app cannot satisfy them:

| Check | Workflow |
|---|---|
| `backend (3.14)` | `ci.yml` |
| `frontend (22)`, `frontend (24)` | `ci.yml` |
| `integration` | `ci.yml` |
| `actionlint` | `ci.yml` |
| `validation` (hassfest + HACS) | `ci.yml` |
| `review` | `dependency-review.yml` |
| `lint` (Conventional-Commit PR title) | `pr-title.yml` |
| `CodeQL (python)`, `CodeQL (javascript-typescript)` | `codeql.yml` |

A required check that never reports blocks a pull request forever, so
`tests/test_repo_hardening_offline.py` re-derives the check names from the workflows and
fails if a required context is not produced by a job that runs on every pull request to
`main` — including the case where a `paths:` filter would keep it from reporting at all.
Renaming a job (or its matrix values) without updating the ruleset fails that test.

There are no bypass actors. A stuck merge is unblocked by editing the ruleset — set
`enforcement` to `evaluate` or `disabled` in *Settings → Rules*, which is logged — not by
a standing exemption.

## Discussions

Enabled: `CONTRIBUTING.md` and the README both point contributors at Discussions for
questions, and the issue templates are for bugs and feature requests only.

## Secret scanning and push protection

Both enabled, along with Dependabot security updates. Push protection rejects a commit
containing a recognized credential at `git push` time rather than after the fact.

## Labels

Labels are code: [`.github/labels.yml`](../.github/labels.yml), synced by
`.github/workflows/labels.yml` on any push that touches that file. The workflow also has a
`workflow_dispatch` trigger, which is what `--apply` uses when a label in the file is
missing on GitHub. `skip-delete` is on, so labels created outside the file (GitHub's
defaults, Dependabot's) are never removed.

## Social preview image

**Manual.** GitHub exposes no API for the social preview, so this is the one setting the
script only reports on:

1. *Settings → General → Social preview → Edit → Upload an image*.
2. Upload [`assets/social-preview.png`](assets/social-preview.png) — 2560×1280, which is
   GitHub's 1280×640 at 2x so the image stays sharp on HiDPI displays.

The PNG is generated from [`assets/social-preview.html`](assets/social-preview.html):

```bash
node scripts/render_social_preview.mjs
```

The page loads Roboto from Google Fonts, so rendering needs network access; the script
waits for the webfont before the screenshot rather than baking in a fallback face.
