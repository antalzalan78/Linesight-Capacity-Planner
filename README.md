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

## ERP Control Tower

The Control Tower tab adds Strategic materials, Daily production and ERP imports to the existing planner. Its data is separate from planner snapshots, Undo / Versions, and Supabase plan sync. IndexedDB stores large imports locally, with revision checks to reject stale writes from another browser tab. Download an ERP backup before clearing browser storage or changing browsers. No ERP workbook, transaction rows, private watchlist, or source values are bundled into public application code. The `.local/` folder is ignored by Git and contains private task preparation only.

- Stock imports are full dated snapshots. Replacing an existing date requires confirmation. Available is the sum of the Available column at NLC 3PL, NLC Production WIP CFC and NLC to 3PL In Transit. On Hand at NLC 3PL HOLD is shown separately; other locations are excluded from the available total. Committed is not deducted again. Lot detail and excluded locations remain inspectable. Summary rows with no location are excluded. A missing SKU is unknown, not a fabricated zero.
- Private watchlists identify strategic SKUs, categories and optional minimum quantities. No thresholds are inferred from screenshot colours. No days-of-cover calculation is invented without material consumption or a BOM. Each new stock date adds an observed history point; a single snapshot is not a historical trend.
- Stock-only setup works without masterdata, production records or a watchlist: All stock items shows distinct SKUs present at the three available-stock locations or HOLD, with unclassified items labelled explicitly. Other-location-only items are excluded from this overview. Strategic watchlist remains a separate scope and can include missing SKUs. Track item adds an imported item to the private list; nothing is automatically classified as strategic. The default is the watchlist when configured, otherwise All stock items. Detail pages contain 100 items; KPIs, charts and CSV use the full filtered selection.
- Masterdata joins Item Code2 to the transaction Item. Duplicate master rows are consolidated per SKU without multiplying transaction quantities. Conflicting classifications are exposed; multiple countries are preserved rather than chosen by first row. HC and standard minutes are not used to infer actual labor or OEE.
- Daily production treats case-only differences in masterdata category, family and Generic as the same classification. Dropdowns, group charts, SKU detail and CSV share a source-backed display spelling. Existing imports are normalized in memory without rewriting ERP storage or requiring reimport. New imports also avoid flagging case-only classification differences as conflicts; genuinely different categories, accents, punctuation and SKU identifiers remain distinct.
- Production imports retain Work Order Completion records and use Quantity, not Built. Internal ID is the durable key. Overlapping uploads upsert IDs rather than add them twice; changed existing IDs need explicit approval. IDs omitted from a later file are retained. CFC is the default department; GAS is available through the filter. Date, line, category, family, Generic and SKU filters apply to every chart, headline, detail table and CSV export. Missing days are plotted as gaps, not silently converted to zero.
- Repeated Machine / Line columns in production exports are validated row by row. Identical populated values are used once, blanks fall back to the other repeated column, and conflicting values block the import with the source row number. The preview shows a warning when repeated headers are combined. Other duplicate headers, including Quantity and Internal ID, remain rejected. A separately named Machine / Line2 retains its existing fallback behavior.
- ERP imports run in a worker using the locally served Excel reader. Errors are previewed before any durable replacement. Choosing a file only prepares a preview: Apply import saves it, then opens the corresponding stock or production dashboard. Backup restoration validates records before saving. Raw Created By names are not retained in the dashboard transaction model.

`src/control-tower.js` owns pure import/calculation rules; `src/control-tower-ui.js` owns the existing app's new tab; `src/erp-import-worker.js` parses files off the UI thread. `tests/control-tower.test.cjs` uses synthetic records to verify location scope, HOLD exclusion, master deduplication, ID corrections, filters, missing values, offline worker parsing and backup validation.
