# Release testing: what must hold before the HACS release

HAventory goes public as **1.0.0**, cut once the owner has run `0.9.x` on the household's
own inventory and is satisfied with it. There is no formal validation program before that
tag. The automated suites, everyday use and the short list of key features below are the
gate, and a scenario is checked by using the feature, not by walking a script.

The full scenario plan and the logged run against 0.9.0 (install, mobile, connectivity,
lifecycle, backup, integrity, multi-client, import and export, services) are in git history
before this file was shortened. Its outcome and the two fixes it produced are recorded on
[#276](https://github.com/chrreiter/HAventory/issues/276). The scale measurement it planned
is deferred: the README's Known limitations carries the rough curve, and that is enough.

## Before the tag

1. The automated suites are green on the candidate: both halves of the gate, the in-process
   HA suite, the online smokes and the stress regimen, run as `docs/developing.md` and
   `.claude/skills/test-haventory/SKILL.md` describe.
2. The owner has used the candidate at home for ordinary inventory work long enough to trust
   it. Every usability bug that turned up is filed with the bug template, fixed as a `fix:`
   and shipped as a `0.9.x` patch.
3. Each key feature below has been exercised once on the candidate, on the production
   instance and on a phone where the row says so.
4. After all of that, the Home Assistant log carries no traceback from
   `custom_components.haventory`. A `validation_error`, `not_found` or `conflict` logs one
   WARNING line without a traceback by design and is not a finding.

## Key features

| Feature | What to check | Where |
|---|---|---|
| Install | HACS custom repository → install → restart → add the integration → the card is in the picker and the sidebar entry opens | a throwaway HA, then production |
| Upgrade in place | Items, locations, statuses and attachments are intact after the update; the counts in `haventory/health` match before and after | production |
| Items | Create, edit, adjust quantity, move, delete; a second editor on the same item gets a conflict with a way to load the latest | desktop and phone |
| Location tree | Nest three levels deep, rename a root, move an item; every path updates and the area chip follows the root | desktop |
| Search and filters | Accent- and case-insensitive search; the quick-filter pills and the filter sheet keep the right rows | desktop and phone |
| Check-out | Check out with a due date, see it overdue after the date, check it back in | phone |
| Photos and manuals | Take a photo from the item editor, upload a manual, open both; the row shows the tile | phone and desktop |
| Shopping list | Drop an item to its threshold; the line appears on the chosen to-do list and clears when stock returns | production |
| Calendar and reminders | An inspection date and a repeating reminder show on `calendar.haventory`; one automation fires on the event start | production |
| Sensors and events | The count sensors move on a mutation; one automation fires on `haventory_low_stock` | production |
| Export and import | Export, import into an empty throwaway instance, compare counts; the import preview names a clash before it writes | desktop, once from the phone |
| Restart and reconnect | Restart HA with the card open on desktop and in the companion app; both reconnect with the data current | production and phone |
| Backup | A Home Assistant backup carries the store and the integration folder; restoring it into a throwaway instance loads the inventory | a throwaway HA |
| Non-admin user | A non-admin user sees the sidebar entry and can read and edit the inventory, as the README's Known limitations says | production |

Reading the counts is one command from the `run-haventory` skill:

```bash
HAVENTORY_IGNORE_ENV_FILE=1 HA_BASE_URL=http://<host>:8123 HA_TOKEN=<token> \
  uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/health"}'
```

`HAVENTORY_IGNORE_ENV_FILE=1` is what makes the two variables beside it win over the `.env`
in the checkout. Never point `scripts/smoke_online.sh` at production: with `HA_CONTAINER`
set it deletes the store before it runs.

## Findings

A finding is an issue filed with the bug template and fixed in its own `fix:` pull request,
which cuts the next `0.9.x`. A finding a typical household would not hit stays a sentence in
that pull request's "Follow-ups" note rather than an issue.
