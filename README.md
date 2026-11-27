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

Data Hub has one **Production completion / transactions** upload. A detailed NetSuite export with Internal ID, Transaction Date, Item, Quantity and Type is parsed once. Work Order Completion records update the Control Tower's retained transaction store and MPS Job/day completion totals after one preview/Apply. Job links rows to MPS batches; the `Work Order #` display prefix is normalized without changing identifier case. MPS defaults to CFC; the preview can select another department or all departments. Raw ERP data retains every department, independently of dashboard view filters. Quantity, not Built, supplies both destinations.

Production is stored in a separate ledger inside the plan snapshot, local save and cloud payload. Only Job/day aggregates and prior legacy history enter this ledger; new raw ERP rows and their ID index remain in IndexedDB. Jobs without an MPS match, jobs with ambiguous matches and rows with no Job number are retained. They contribute once to actual production, but ambiguous/unmatched jobs are not allocated to multiple planned batches. Adding the matching batch later links its history automatically. Clearing or reimporting the batch plan does not clear the production ledger. The unmatched table displays at most 100 totals; production CSV retains all rows.

Raw uploads merge by Internal ID, retaining IDs omitted from a partial report. The MPS projection is rebuilt from that retained history, never added to the previous MPS total. A changed ID, overlapping legacy Job/day total, changed manual correction or MPS department change needs approval. Moved IDs clear the old Job/day with a zero total so a saved batch's legacy Produced value cannot reappear. Negative net corrections stay signed. The source and replaced totals remain in bounded history.

Legacy Job/day-only report files are no longer a second active upload; use the detailed transaction export. Their already saved completion history is retained. Overlapping daily totals are replaced only after approval, not added; dates outside the ERP import remain. Legacy event IDs absent from retained ERP history stay in MPS and are removed from that legacy supplement when the same IDs arrive in ERP, preventing double counting. The preview discloses these MPS-only historical events until their detailed transaction history is reimported.

The two browser storage systems are coordinated with a durable `productionBridge` journal in ERP state. ERP records commit first; the planner's aggregate save is quota-checked before memory changes or cloud scheduling. If the planner changed after preview or its save fails, Data Hub clearly reports **ERP saved / MPS pending** and offers **Review pending MPS update** without another upload. A crash after the plan save is safe to retry. New production uploads wait for that pending update to finish. ERP backup restoration always requires review before applying its shared production history to the current planner; restoring ERP data does not silently replace the plan. The stores are not claimed to be one atomic transaction.

- **Legacy full Job/day totals:** stored totals retain their original grain and history. They are not assumed to be individual ERP transactions and are not added over an overlapping shared import.
- **Legacy incremental imports:** their stable completion IDs remain inspectable in history and support deduplication when detailed ERP records become available.
- **Manual corrections:** preserve the imported ledger and legacy completion detail. The total override is represented as an adjustment against imported production, with a correction date. When no actual date is known, supply it in the correction-date field; undated adjustments are excluded from timed KPIs. Importing data for a manually corrected Job requires approval to return to the imported values. The Produced field can be returned to imported values with its reset button.
- **Actual production:** net dated units recorded in the selected month, through today (or month end for historical months), including unmatched records and dated manual corrections. Undated quantities are reported separately.
- **Plan completion:** dated produced units for batches planned to start in the selected month, capped at each batch's planned quantity, divided by their planned volume. Records dated after the reporting cutoff are excluded.
- **On-time adherence:** fully completed batches on or before their explicit Due date, divided by batches due in the selected month through the reporting cutoff. A batch start date is not a due date. Missing due dates, ambiguous Jobs and undated corrections do not earn an on-time completion; the UI shows the missing data.

The MPS importer accepts optional due/end and actual production date columns. Due dates can also be edited in the Batches table. The table distinguishes completed-on dates from last production dates (available in Excel/CSV exports), and shows early, on-time, late and overdue outcomes. Daily actuals are shown in a separate MPS table and can be exported as CSV. The production backup includes ledger history and manual corrections.

Imported text is escaped at HTML text/attribute boundaries, including mapping previews, batch chips, SKU descriptions and import errors. CSV text that starts like a spreadsheet formula is exported as literal text. `tests/production.test.cjs` covers import repetition, corrections, cross-month timing, retained unmatched data and HTML escaping; `tests/fixtures/` contains synthetic browser-test inputs.

## Operations Overview

The read-only opening view combines material exceptions, MPS plan/actual production, batch action signals, monthly line-capacity spill and weekly combined labour-hour coverage. Choose a focus date inside the selected month. The default is today for the current month, month-end for historical months and the first day for future months. Weeks are Monday–Sunday, clipped to the selected month; actual reporting never extends beyond today.

Scheduled units follow the same FIFO multi-day load/capacity model as MPS, including units, standard-minute and runtime bases. A start-day peak is not automatically an overload: only load still uncleared at month-end is flagged. Parked batches and batches on unavailable lines do not silently enter the daily scheduled plan. Prior-month backlog remains in Backlog Analysis rather than being assigned to invented daily batches.

Daily/weekly actuals use the dated MPS completion ledger, including retained unmatched Jobs, exactly once. The weekly comparison aligns scheduled and recorded quantities through the same cutoff; the full-week plan remains visible separately. The shared report now refreshes these MPS totals from retained ERP transactions in the selected department; raw ERP quantities are not added a second time. A date with no completion fact is unknown, not zero. The current day's recorded quantity is not a guaranteed final daily total. Month plan completion and on-time adherence reuse the existing production definitions. Overdue/unconfirmed signals require an explicit due date before the reporting cutoff and insufficient dated completion; ambiguous Jobs, undated actuals and status-only completion remain data issues.

Material risks reuse the four strategic monitor panels and the latest stock snapshot on or before the cutoff. Complete groups below their manual target or with no available stock are flagged. Missing or partial groups remain unknown; an unset target is not zero. Source cards distinguish latest observed source-data date from upload time. The editable warning rule defaults to two calendar days and is not a claim of export completeness or a business SLA. ERP production freshness and master-match counts use CFC, consistent with Daily production's default department. Dashboard drill-downs clear unrelated MPS/ERP filters and preserve the relevant stock snapshot/date scope.

Overview CSV contains the selected focus week's daily values, monitor populations, the current batch-signal selection, monthly line loads, labour weeks and source freshness. New calculation/UI modules are `src/operations-overview.js` and `src/operations-overview-ui.js`; synthetic regression coverage is in `tests/operations-overview.test.cjs`. Dashboard filters are not part of planner cloud snapshots, and overview reads do not persist ERP or change the plan.

## ERP Control Tower

The Control Tower tab adds Strategic materials, Daily production and ERP imports to the existing planner. Its raw ERP data is separate from planner snapshots, Undo / Versions, and Supabase plan sync; shared production imports also update the aggregate MPS ledger described above. IndexedDB stores large imports locally, with revision checks to reject stale writes from another browser tab. Download an ERP backup before clearing browser storage or changing browsers. No ERP workbook, transaction rows, private watchlist, or source values are bundled into public application code. The `.local/` folder is ignored by Git and contains private task preparation only.

Strategic materials has four monitor panels: Glass bottles, Generic SWM, Gas cylinders and Other monitored items. Each panel pairs vertical Available-stock columns and manual safety-stock markers with an editable family/item table. A family can contain several SKUs, counted once within its panel. Expand a family to inspect source item availability/HOLD and edit its name or codes; Add item / group and Remove change monitor configuration only. Save monitor changes applies edits across all four panels atomically. Zero is a valid safety-stock target; a blank target remains unset. Gap = complete available stock minus safety stock. Below-target groups are red; missing-source groups stay unknown. When only some SKUs are present, Available is an explicitly marked partial sum, and Gap/target compliance remain unknown rather than treating missing SKUs as zero.

Existing private watchlists supply initial panel memberships, grouping glass and Generic SWM by family and cylinders by type. Public code contains no item presets. Import monitor setup accepts a private `linesight-monitor-setup` version-1 JSON configuration without replacing stock, masterdata or transactions, and keeps non-blank existing targets for exact matching SKU groups. Download monitor setup transfers this configuration separately; full ERP backups also include saved `monitors`. The original per-SKU browsing, watchlist minimums and lot/history drill-down remain in Stock explorer. A stock-only import with no configured monitor items opens Stock explorer, preserving a useful first result. Monitor CSV exports the same family populations, source coverage and target comparisons as the panel charts/tables.

- Stock imports are full dated snapshots. Replacing an existing date requires confirmation. Available is the sum of the Available column at NLC 3PL, NLC Production WIP CFC and NLC to 3PL In Transit. On Hand at NLC 3PL HOLD is shown separately; other locations are excluded from the available total. Committed is not deducted again. Lot detail and excluded locations remain inspectable. Summary rows with no location are excluded. A missing SKU is unknown, not a fabricated zero.
- Private watchlists identify strategic SKUs, categories and optional minimum quantities. No thresholds are inferred from screenshot colours. No days-of-cover calculation is invented without material consumption or a BOM. Each new stock date adds an observed history point; a single snapshot is not a historical trend.
- Stock-only setup works without masterdata, production records or a watchlist: All stock items shows distinct SKUs present at the three available-stock locations or HOLD, with unclassified items labelled explicitly. Other-location-only items are excluded from this overview. Strategic watchlist remains a separate scope and can include missing SKUs. Track item adds an imported item to the private list; nothing is automatically classified as strategic. The default is the watchlist when configured, otherwise All stock items. Detail pages contain 100 items; KPIs, charts and CSV use the full filtered selection.
- Masterdata joins Item Code2 to the transaction Item. Duplicate master rows are consolidated per SKU without multiplying transaction quantities. Conflicting classifications are exposed; multiple countries are preserved rather than chosen by first row. HC and standard minutes are not used to infer actual labor or OEE.
- Daily production treats case-only differences in masterdata category, family and Generic as the same classification. Dropdowns, group charts, SKU detail and CSV share a source-backed display spelling. Existing imports are normalized in memory without rewriting ERP storage or requiring reimport. New imports also avoid flagging case-only classification differences as conflicts; genuinely different categories, accents, punctuation and SKU identifiers remain distinct.
- Production imports retain Work Order Completion records and use Quantity, not Built. Internal ID is the durable key. Overlapping uploads upsert IDs rather than add them twice; changed existing IDs need explicit approval. IDs omitted from a later file are retained. CFC is the default department; GAS is available through the filter. Date, line, category, family, Generic and SKU filters apply to every chart, headline, detail table and CSV export. Missing days are plotted as gaps, not silently converted to zero.
- Repeated Machine / Line columns in production exports are validated row by row. Identical populated values are used once, blanks fall back to the other repeated column, and conflicting values block the import with the source row number. The preview shows a warning when repeated headers are combined. Other duplicate headers, including Quantity and Internal ID, remain rejected. A separately named Machine / Line2 retains its existing fallback behavior.
- ERP imports run in a worker using the locally served Excel reader. Errors are previewed before any durable replacement. Choosing a file only prepares a preview: Apply import saves it, then opens the corresponding stock or production dashboard. Backup restoration validates records before saving. Raw Created By names are not retained in the dashboard transaction model.

`src/control-tower.js` owns pure import/calculation rules; `src/control-tower-ui.js` owns the existing app's new tab; `src/erp-import-worker.js` parses files off the UI thread. `tests/control-tower.test.cjs` uses synthetic records to verify location scope, HOLD exclusion, master deduplication, ID corrections, filters, missing values, offline worker parsing and backup validation.

`src/production-import.js` owns the shared Job/day projection; `tests/production-import.test.cjs` covers repeat/partial imports, legacy snapshots/events, moved IDs, department scope, signed corrections, manual approval, concurrent planner edits, quota failures, pending journal recovery, backup restoration and HTML escaping using synthetic data only.
