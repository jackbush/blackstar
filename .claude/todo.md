# Blackstar — initial build

Decisions: WebGL2 single fragment shader · ambient film burn · standalone fullscreen · crisp organic orb edge.

- [x] `params.js` — single schema of every tunable (groups → params), the only source of defaults
- [x] `shader.js` — fullscreen fragment shader; param uniforms auto-declared from schema
- [x] `app.js` — GL loop (zero per-frame allocation), dirty-uniform upload, context-loss recovery, sidebar UI generated from schema, copy-state, localStorage overrides
- [x] `index.html` — canvas, cog, panel, styles
- [x] `scripts/check.js` — schema/shader consistency check (node)
- [x] Skill: `blackstar-state` — apply pasted state blobs to defaults
- [x] Skill: `blackstar-elements` — add/edit/remove params & layers
- [x] Verify in browser (render, sidebar, copy, no console errors)

## Review
- Headless Chrome (SwiftShader) render: shader compiles, all layers visible; sidebar opens; live slider edits apply; Copy state emits correct `changed` diff + notes.
- Tuned after first render: orb edge was too crinkly (added `orbDetail`, 2-layer blob noise); edge burn read as a uniform picture frame (width now varies along the edge).
- Not verified: real-GPU fps, long-session memory profile (design is allocation-free per frame by construction).
