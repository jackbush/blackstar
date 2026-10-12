# Lessons

- **Benchmark shaders on the real GPU at large display sizes before handing over.** The first build "worked" in a headless SwiftShader screenshot but stalled the user's browser (~2fps / crash): a single pass ran ~35 3D-noise calls per pixel. A screenshot only proves that it renders, not that it's fast. Run `node scripts/bench.mjs --fixed --size 2560x1440 --dpr 2` before saying a visual change is done.
- Compute per-pixel only what actually varies per pixel: put pixel-invariant values on the CPU (`perFrame`), angle-only shapes in a 1D pass, and smooth fields at low resolution.
