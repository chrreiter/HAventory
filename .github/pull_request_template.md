## Summary

<!-- What does this PR do, and why? -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation / tooling / CI
- [ ] Refactor (no functional change)

## How was this tested?

<!-- Both gates must be green. Paste the commands you ran and their results. -->

- [ ] Backend: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`
- [ ] Frontend (`cards/haventory-card`): `npm audit --audit-level=moderate`, `npx eslint .`, `npm run typecheck`, `npx vitest run`, `npm run build`. The gate in full is `CONTRIBUTING.md` → "The gate".

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: …`, `fix: …`).
- [ ] Tests added or updated (happy path plus at least one edge or error case).
- [ ] Docs updated where behavior changed (`README.md`, `docs/backend_api_contract.md`, `docs/data_shapes.md`).
- [ ] WebSocket API changes keep `ws.py`, `docs/backend_api_contract.md` and `docs/data_shapes.md` in sync.
- [ ] Core invariants preserved (case-insensitive search, denormalized `location_path`, optimistic `version`).

## Screenshots (card / UI changes)

<!-- Before / after screenshots for any visible card change. -->
