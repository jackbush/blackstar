# Blackstar

WebGL2 canvas piece: an undulating black orb with a burning halo on a wobbling yellow gradient, with an analog film layer on top. No build step. See `README.md` to run it.

- `params.js`: every tunable value; the sidebar is generated from it
- `shader.js`: three render passes (angular → fields → composite) plus `perFrame()` for per-frame CPU values
- `app.js`: generic engine (GL, allocation-free frame loop, adaptive quality, sidebar, copy state)
- `scripts/check.js`: params ↔ shader consistency check; run after every change
- `scripts/bench.mjs`: real-GPU fps benchmark via headless Chrome (serve the folder on :8765 first)
- Skills: `blackstar-state` (apply pasted state blobs), `blackstar-elements` (add/edit/remove elements)
- Deploy: `.github/workflows/pages.yml` publishes root `*.html` + `*.js` to GitHub Pages on push to `main`, replacing `__VERSION__` in `index.html` with the commit hash and writing `version.json`. Open tabs compare against it and jump to the new build. New site files must live at the root (or extend the copy step); keep `?v=__VERSION__` on any new `<script>`/`<link>`.

## Optimisation todo

Baseline after the multi-pass rewrite (M3, adaptive quality off): 1440×813 → ~815fps; 2268×1343 → ~720fps; 5120×2706 → ~320fps with the panel closed. The old single-pass shader got 182, 72 and a stalled GPU on the same three.

- [ ] Find out which machine and browser showed ~2fps for the user, and benchmark there; all numbers so far come from an M3.
- [ ] Re-measure with the sidebar open. At 5K, fps dropped 323 → 129 with the panel open because of `backdrop-filter` blur. The blur has been removed (panel is now an opaque 0.93 background) but this hasn't been re-benchmarked.
- [ ] `bench.mjs --swiftshader` timed out (>90s) once adaptive quality started at 100% instead of 75%. Find out why the first frames stall on very weak GPUs: consider a cheap first-frame timing probe, or start conservative and ramp up quickly.
- [ ] Composite pass: grain and dust still cost ~7 PCG hash chains per pixel. Try a small per-film-frame noise texture at grain resolution instead.
- [ ] Fields pass: try 1/6 or 1/8 resolution (`fieldsDivisor`) and check whether mottle and halo flame still look right at their maximum scales.
- [ ] Adaptive quality: check display-capped detection (30Hz / low-power mode) on a real device, and tune hysteresis so resolution doesn't pump.
- [ ] Update the shader-budget numbers in the `blackstar-elements` skill once the above settles.
