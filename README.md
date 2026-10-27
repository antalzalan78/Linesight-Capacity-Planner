# LineSight Capacity Planner

LineSight is a browser-based monthly capacity and MPS batch-planning tool. GitHub Pages serves the application directly, so no build step is required.

## Project structure

- `linesight_monthly_planner14.html` — user interface and planner orchestration.
- `src/calculations.js` — reusable, DOM-independent calculation engine.
- `src/production.js` — production ledger, import reconciliation, dated actuals and adherence calculations.
- `tests/calculations.test.cjs` — automated capacity, workforce and spill-over tests.
- `tests/security.test.cjs` — regression checks for authenticated sync and RLS.
- `tests/planning-regressions.test.cjs` — executable planner tests for weekly/daily calendar consistency and product-group backlog.
- `tests/sync-conflicts.test.cjs` — simulated concurrent clients, stale responses and recovery-version tests (no real cloud writes).
- `supabase/` — secure authentication and Row Level Security setup.
- `.github/workflows/calculations.yml` — runs the tests automatically on pushes and pull requests.

## Run the tests

Node.js 20 or newer is required.

```sh
npm test
```

The calculation module supports both the browser and Node.js. This keeps the GitHub Pages deployment simple while allowing the business-critical formulas to be tested independently.

## Capacity and backlog rules

The Weekly View and MPS share a working-day calendar. Weekly Days and OEE overrides apply to daily load, weekly summaries, spill-over and auto-placement. Days fill chronologically, using open weekdays first, then weekends, then shutdown dates only when a manual override needs them. Fractional days receive partial capacity. Daily totals preserve rounded weekly capacity exactly. In MPS demand mode, weekly demand is assigned to the batch's planned week.

Demand and backlog are calculated per product group, including groups with no active line. Spare capacity from one group does not clear another group's backlog. Month-end MPS spill is assigned to the batches still unfinished, rather than spread across every batch produced that month.

## Cloud conflict protection

Cloud updates use an atomic conditional update against the last downloaded `updated_at` value. A new plan uses an ordinary insert rather than an upsert. The existing Supabase schema and RLS migration are sufficient; no additional SQL migration is required.

If another device saves first, or local edits occur during a download, automatic sync pauses. Open Secure sync and choose **Keep my local plan** or **Load the cloud plan**. The replaced version is saved as a local recovery checkpoint first. Initial connections to an existing plan also ask for a choice if the locally saved plan differs. Refresh all open LineSight tabs after deploying this update so every device uses the conflict protection.

## Production completion imports and KPI definitions

Production is stored in a separate ledger inside the plan snapshot, local save and cloud payload. Jobs without an MPS match, jobs with ambiguous matches and rows with no Job number are retained. They contribute once to actual production, but ambiguous/unmatched jobs are not allocated to multiple planned batches. Adding the matching batch later links its history automatically. Clearing or reimporting the batch plan does not clear the production ledger.

- **Full Job/day totals:** sums every completion row for a Job/date. Reimporting that same Job/date replaces its total. A lower total or a change of import mode requires the correction checkbox; invalid rows block the file so an incomplete total cannot be silently applied. Only the included Job/date pairs are replaced. The export must include the full total for those pairs.
- **Incremental imports:** require one row per unique Completion ID, Transaction ID or Internal ID. Already known IDs are updated instead of added twice. Repeated IDs inside one file are rejected because the file's grain is ambiguous. A moved ID or reduced total requires approval.
- **Manual corrections:** preserve the imported ledger and legacy completion detail. The total override is represented as an adjustment against imported production, with a correction date. When no actual date is known, supply it in the correction-date field; undated adjustments are excluded from timed KPIs. Importing data for a manually corrected Job requires approval to return to the imported values. The Produced field can be returned to imported values with its reset button.
- **Actual production:** net dated units recorded in the selected month, through today (or month end for historical months), including unmatched records and dated manual corrections. Undated quantities are reported separately.
- **Plan completion:** dated produced units for batches planned to start in the selected month, capped at each batch's planned quantity, divided by their planned volume. Records dated after the reporting cutoff are excluded.
- **On-time adherence:** fully completed batches on or before their explicit Due date, divided by batches due in the selected month through the reporting cutoff. A batch start date is not a due date. Missing due dates, ambiguous Jobs and undated corrections do not earn an on-time completion; the UI shows the missing data.

The MPS importer accepts optional due/end and actual production date columns. Due dates can also be edited in the Batches table. The table distinguishes completed-on dates from last production dates (available in Excel/CSV exports), and shows early, on-time, late and overdue outcomes. Daily actuals are shown in a separate MPS table and can be exported as CSV. The production backup includes ledger history and manual corrections.

Imported text is escaped at HTML text/attribute boundaries, including mapping previews, batch chips, SKU descriptions and import errors. CSV text that starts like a spreadsheet formula is exported as literal text. `tests/production.test.cjs` covers import repetition, corrections, cross-month timing, retained unmatched data and HTML escaping; `tests/fixtures/` contains synthetic browser-test inputs.
