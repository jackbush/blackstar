---
name: blackstar-elements
description: Add, edit, or remove visual elements and parameters in the Blackstar canvas animation (orb, halo, background gradient, film burn, grain, etc.). Use when the user asks for a new effect/layer/control, wants an existing element to behave differently, wants something removed, or when a Blackstar state blob's notes request structural changes.
---

# Changing Blackstar's elements

## Architecture (read this before editing)

| File | Role | Edit when |
|---|---|---|
| `params.js` | **The only place defaults live.** Groups → params. The sidebar UI is generated from it. | Any new, changed or removed control |
| `shader.js` | Three GLSL passes plus `perFrame()` (CPU). All design logic lives here. | Any visual change |
| `app.js` | Generic engine: GL setup, passes, allocation-free frame loop, adaptive quality, sidebar, copy state, storage. No design logic. | Only for engine behaviour (timing, resolution, new param *types*) |
| `index.html` | Canvas, cog, panel shell, CSS. | Panel layout/styling only |
| `scripts/check.js` | Checks that params, GLSL and `perFrame()` agree. | Rarely |
| `scripts/bench.mjs` | Real-GPU fps benchmark. | — |

**Passes in `shader.js`:**
1. `angular` (1024×1): noise that depends only on the angle around the orb. The composite pass reads it as `A`, i.e. `vec4(ownN, hueN, free, free)` (the halo's own shape and its hue drift).
2. `fields` (¼ resolution, two RGBA outputs): smooth, low-frequency noise, sampled in the composite pass as `F0` (warp, mottle, leak, rays) and `F1` (swirl, free, free, free). Put any new *smooth* noise here, in a free channel.
3. `composite` (full resolution): cheap per-pixel work only, i.e. texture lookups, crisp edges, colour, hashes for grain and dust.
- **Orb outline:** a closed Catmull-Rom spline through `orbPoints` radii evenly spaced around a circle (point 0 at the top). Each point is a sine wave with its own phase and speed and a slowly jittering amplitude (`ringPoint()` on the CPU). `perFrame()` writes the offsets into `f_ring`: slots `[0, N)` are now and `[MAX_POINTS, MAX_POINTS+N)` are at `t − haloLag`, which the halo uses. In GLSL, `ringOffset(angle, 0 | MAX_POINTS)` returns the radius offset as a fraction of `f_orbR`.
- `perFrame(P, t, rt, w, h, px, f)` runs on the CPU once per frame. Anything identical for every pixel (centres, directions, halo reach) is computed here and written into a preallocated `f_*` uniform declared in `frameUniforms` (a count 1–4 gives float/vec2/vec3/vec4; `[n]` gives a float array). It must not allocate.

**How a param reaches the GPU:** a param `{ key: 'fooBar', ... }` is automatically declared in every pass as `uniform float u_fooBar;`, or `vec3` for colours. **Never hand-declare a param uniform.** A param that is only read by `perFrame()` (`P.fooBar`) or by `app.js` (`byKey.fooBar`) must have `uniform: false`. Built-ins: `u_res` (the current pass's target size), `u_screen` (canvas size), `u_time` (scene time: scaled and pausable), `u_realTime` (wall clock, which drives the film layer).

**Composite order:** background → halo → orb → light leaks → highlight burn → vignette → exposure → dust → grain. Put new layers where they'd physically sit. Scene content goes before the film layers, and grain always comes last.

**Coordinates:** `q` is centred, aspect-correct, with screen height = 1 (so x spans ±aspect/2), and +y up. `fuv` is the matching 0–1 coordinate for sampling fields. `fc` is `gl_FragCoord` in canvas pixels; multiply pixel sizes by `f_px` (canvas px per CSS px) so they stay stable when adaptive quality changes resolution.

**Shared GLSL helpers (`common`):** `snoise(vec3)` returns -1..1, `fbm3` is 3 octaves, `ringOffset` is the orb outline, `hash(vec3)` returns 0..1 per integer cell, and `encode`/`decode` pack values for the passes. On the CPU there are `noise1(x)` and `hash2(a, b)`.

## Adding a parameter

1. Add it to the right group in `params.js`, next to related params:
   ```js
   { key: 'haloFlare', label: 'Flare', value: 0.2, min: 0, max: 1, step: 0.01, desc: 'One-line tooltip.' },
   ```
   - `key` is camelCase, unique and descriptive. It becomes `u_<key>` and the key in copied state.
   - `type` is `'range'` (the default), `'color'` (`'#rrggbb'`) or `'bool'`.
   - The default must sit inside `[min, max]`. Pick ranges that are useful but not destructive, and pick `step` to suit the precision that matters.
   - `label` stays short (≤ 18 characters) so it fits the 124px label column. `desc` is required because it's the tooltip.
2. Use `u_<key>` in the relevant pass in `shader.js`. If only `perFrame()` reads it, use `P.<key>` there and set `uniform: false`.
3. Run `node scripts/check.js`.

## Adding a visual element (a new layer)

1. Create a new group in `params.js` if the element is distinct (e.g. `{ group: 'Embers', params: [...] }`). Otherwise extend an existing group.
2. Expose **every** tunable number and color as a param. The user wants every aspect of the design live-editable, so don't leave magic numbers that a designer would want to touch. Pure implementation constants, like hash offsets, can stay inline.
3. Work out where each part should be computed: values identical for every pixel go in `perFrame()`, smooth noise goes in the `fields` pass, angle-only shapes go in `angular`, and only crisp or per-pixel detail goes in `composite`. Write the composite part as a commented block (`// --- name: what it does`).
4. Include an amount/intensity param so that setting it to 0 makes the layer invisible.
5. Update the composite-order comment at the top of `shader.js` if you added a new stage.

## Editing an element

- Prefer changing default values (in `params.js`) over changing shader math. If the behaviour can't be reached with the existing params, change the math *and* add params for the new degrees of freedom.
- If you change what a param means (its scale or units), update its `desc`, `min`/`max` and default together, so that old pasted state blobs aren't silently misread. Mention the change to the user.

## Removing an element or param

1. Delete the shader code that uses it.
2. Delete the param(s) from `params.js`. If you're deleting a group's last param, delete the group too.
3. Run `node scripts/check.js`. It errors on shader uniforms with no param and warns on params the shader never uses.
4. A **rename** counts as a removal plus an addition. Old state blobs will carry the old key, so tell the user the rename (the `blackstar-state` skill looks for renames in git history).

## Performance and garbage-collection rules (non-negotiable)

- **The JS frame loop and `perFrame()` must allocate nothing.** No object/array literals, closures, string building, `for…of`, spread or `map` in them. Write into the preallocated `f.*` arrays. Params are re-uploaded only when `paramVersion` changes.
- Cache param lookups (`const P_x = byKey.x`) outside the loop in `app.js`.
- DOM writes from the loop are throttled (see the fps readout: twice a second, and only while the panel is open).
- **The composite pass is the hot path.** Avoid `snoise`/`fbm3` there. If you can't, put it behind a branch that only a small part of the screen takes. Sample textures with `textureLod(..., 0.0)` *outside* branches, and keep `fwidth` outside branches too.
- Loops must have constant bounds. If you add a pass or render target, create it in `buildAll()`/`buildTargets()`, resize it only when its size changes, and null it in the `webglcontextlost` handler.
- After a change, run `node scripts/bench.mjs --fixed --size 2560x1440 --dpr 2` and compare against the numbers in `CLAUDE.md`.

## Verify

1. `node scripts/check.js` must report 0 errors.
2. Render it and look at it. Serve the folder with `python3 -m http.server 8765 --bind 127.0.0.1`, then run `node scripts/bench.mjs --size 1280x800 --shot <scratchpad>/shot.png`. Read the PNG. A shader compile error makes the script exit non-zero and print `error`. Set the new param to an extreme value to confirm it does something.
3. Tell the user which new controls appeared and in which sidebar group.
