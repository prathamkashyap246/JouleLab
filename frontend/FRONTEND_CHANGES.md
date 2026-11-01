# Frontend restyle ("bench instrument" look): notes for integration

This folder is the complete `frontend/` directory after the restyle, without `node_modules`.
Nothing under `backend/` or `firmware/` was changed. No API calls were added, removed or renamed.

## Files changed
- `public/css/style.css`: rewritten (new tokens, system fonts, square corners, no shadows/gradients/animation).
- `views/index.ejs`, `views/nav.ejs`, `views/workspace.ejs`, `views/login.ejs`: text and layout; Google Fonts links removed.
- `src/app.jsx`: wording, tab order, chart colours, log-style status lines. **Edit this file, not `public/js/app.js`**; rebuild with `npm run build`.
- `public/js/workspace.js`: `[ OK ]/[WARN]/[FAIL]` status text, `jl>` console prefix, score colours.
- `public/js/main.js` and `public/js/fx.js`: **deleted** (they only drove the removed 3D/tilt/reveal effects). No page loads them.
- `server.js`, `auth.js`, `package.json`, `tests/`: unchanged.

## Hooks that must keep working
All element ids, `data-*` attributes and JS-queried classes were kept. e2e tests (`npm run test:e2e`) look for these texts, so keep them:
`TEST DATA · NOT FROM HARDWARE`, `Idle baseline: <function>`, `Above idle`, `Connect`, `Start session`, `● REC`, `Stop & save`, `Separate`, tab text `Module separation` / `Live hardware`, input placeholder starting `COM5`.

## Backend fields the frontend now depends on
If a backend change renames or removes any of these, update `src/app.jsx` / `public/js/workspace.js` to match.
- `GET /api/hardware/status` and `/ws/live-data` `status`: `state` (`disconnected | waiting_for_data | streaming | stalled | reconnecting | error`),
  `message`, `port`, `sample_rate_hz`, `lost_samples`, `test_source`, `connected`, plus the counters already shown
  (`packet_count`, `packet_errors`, `duplicate_samples`, `bytes_discarded`, `last_data_age_s`, `energy_mj`, `energy_scope`, `session`, `device_errors`).
  - The Live status line is built in the frontend: `[ OK ] INA219|TEST source · <rate> Hz · <port> · <lost> lost` when streaming;
    otherwise `[WARN]/[FAIL]/[IDLE]` + state text, with the backend `message` on its own line.
  - A **new** state value shows up with the `[ -- ]` tag; add it to `LEVEL` and `STATE_TEXT` in `src/app.jsx`.
- Build output / serial monitor: lines starting `[JouleLab] ` are shown as `jl> ` (display-only rewrite in `workspace.js`, function `jl`).
- `/api/analysis/separate` response: unchanged usage (`components`, `spectrogram`, `k_curve`, `scoring`, `truth`, `simulated`, ...).

## Known issues (pre-existing or open)
- e2e test "workspace: Verify succeeds" waits for exactly 3 boards; the backend lists 4 (`nucleo_f446re_arduino` was added),
  so it fails with or without this restyle. With `>= 3` all 8 e2e tests pass.
- Charts use a fixed 1560-wide viewBox, so at phone width the axis text is unreadably small (no horizontal scroll, though).
- The home-page figure is the simulator's ESP32 model, labelled SIM; replace it with a real capture when one exists.

## After integrating
`npm install && npm run build && npm start`, backend on port 8000, then `npm run test:e2e`.
