# LineSight Capacity Planner

LineSight is a browser-based monthly capacity and MPS batch-planning tool. GitHub Pages serves the application directly, so no build step is required.

## Project structure

- `linesight_monthly_planner14.html` — user interface and planner orchestration.
- `src/calculations.js` — reusable, DOM-independent calculation engine.
- `tests/calculations.test.cjs` — automated capacity, workforce and spill-over tests.
- `tests/security.test.cjs` — regression checks for authenticated sync and RLS.
- `supabase/` — secure authentication and Row Level Security setup.
- `.github/workflows/calculations.yml` — runs the tests automatically on pushes and pull requests.

## Run the tests

Node.js 20 or newer is required.

```sh
npm test
```

The calculation module supports both the browser and Node.js. This keeps the GitHub Pages deployment simple while allowing the business-critical formulas to be tested independently.
