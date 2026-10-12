// Blackstar — parameter schema.
//
// This file is the single source of truth for every tunable value in the piece.
// The sidebar is generated from it, and every param (unless `uniform: false`)
// is auto-declared in the shader as `uniform float u_<key>` (or `vec3` for colors).
//
// Params marked `uniform: false` are read on the CPU — by app.js (engine settings) or by
// perFrame() in shader.js (values that are the same for every pixel).
//
// Param fields:
//   key      unique camelCase id — also the uniform name suffix and the key in copied state
//   label    sidebar label
//   value    default value
//   type     'range' (default) | 'color' (hex string) | 'bool'
//   min/max/step   slider bounds (range only)
//   desc     tooltip text
//   uniform  false → CPU-only param, not declared in the shader

window.BLACKSTAR_PARAMS = [
  {
    group: 'Playback',
    params: [
      { key: 'timeScale', label: 'Speed', value: 0.41, min: 0, max: 4, step: 0.01, uniform: false, desc: 'Global speed of all scene motion (film layer runs on real time).' },
      { key: 'paused', label: 'Pause scene', type: 'bool', value: false, uniform: false, desc: 'Freeze orb, halo and background. Film grain keeps running. Shortcut: Space.' },
      { key: 'seed', label: 'Seed', value: 0, min: 0, max: 100, step: 0.01, desc: 'Offsets every noise field — a different take of the same design.' },
      { key: 'renderScale', label: 'Render scale', value: 1, min: 0.25, max: 1, step: 0.05, uniform: false, desc: 'Internal resolution ceiling. Lower = faster, softer. Adaptive quality works below this.' },
      { key: 'adaptive', label: 'Adaptive quality', type: 'bool', value: true, uniform: false, desc: 'Automatically lowers internal resolution when frames run slow, and raises it again when there is headroom.' },
      { key: 'targetFps', label: 'Target fps', value: 60, min: 24, max: 120, step: 1, uniform: false, desc: 'Frame rate adaptive quality tries to hold.' },
      { key: 'maxDpr', label: 'Max pixel ratio', value: 2, min: 1, max: 3, step: 0.25, uniform: false, desc: 'Caps device pixel ratio on retina screens.' },
    ],
  },
  {
    group: 'Background',
    params: [
      { key: 'bgBottom', label: 'Bottom colour', type: 'color', value: '#f9e9a8', desc: 'Buttery yellow at the low end of the gradient.' },
      { key: 'bgTop', label: 'Top colour', type: 'color', value: '#f3a63c', desc: 'Orange-yellow at the high end of the gradient.' },
      { key: 'bgAngle', label: 'Base angle °', value: 263, min: 0, max: 360, step: 1, uniform: false, desc: 'Direction the gradient runs bottom→top (90 = straight up).' },
      { key: 'bgWobbleRange', label: 'Wobble range °', value: 90, min: 0, max: 180, step: 1, uniform: false, desc: 'Total arc the gradient direction swings through.' },
      { key: 'bgWobbleSpeed', label: 'Wobble speed', value: 0.41, min: 0, max: 1, step: 0.005, uniform: false, desc: 'How quickly the gradient direction drifts.' },
      { key: 'bgBias', label: 'Gradient bias', value: 2.04, min: 0.3, max: 3, step: 0.01, desc: '>1 holds the bottom colour longer, <1 pushes the top colour down.' },
      { key: 'bgWarp', label: 'Line warp', value: 0.205, min: 0, max: 0.6, step: 0.005, desc: 'How far the gradient bands bend away from a straight line.' },
      { key: 'bgWarpScale', label: 'Warp scale', value: 2.2, min: 0.1, max: 5, step: 0.05, desc: 'Size of the bends — low = broad curves, high = ripples.' },
      { key: 'bgMottle', label: 'Mottle', value: 0, min: 0, max: 0.3, step: 0.001, desc: 'Subtle brightness variance across the field.' },
      { key: 'bgMottleScale', label: 'Mottle scale', value: 0.2, min: 0.2, max: 12, step: 0.1, desc: 'Size of the mottled patches.' },
    ],
  },
  {
    group: 'Orb',
    params: [
      { key: 'orbRadius', label: 'Size', value: 1.005, min: 0.1, max: 1.5, step: 0.005, uniform: false, desc: 'Mean radius relative to half the screen\'s short side — 1 = touching the narrow edges.' },
      { key: 'orbPoints', label: 'Points', value: 6, min: 3, max: 12, step: 1, uniform: false, desc: 'Number of control points around the edge; the outline is a smooth curve through them.' },
      { key: 'orbWobbleAmp', label: 'Undulation', value: 0.06, min: 0, max: 0.3, step: 0.001, uniform: false, desc: 'How far each point swings in and out, as a fraction of the radius.' },
      { key: 'orbWobbleSpeed', label: 'Undulation speed', value: 0.11, min: 0, max: 1, step: 0.005, uniform: false, desc: 'Sine cycles per second for each point.' },
      { key: 'orbSpeedJitter', label: 'Speed jitter', value: 0.35, min: 0, max: 1, step: 0.01, uniform: false, desc: 'Per-point variation in sine speed, so points drift in and out of phase.' },
      { key: 'orbAmpJitter', label: 'Amplitude jitter', value: 0.5, min: 0, max: 1, step: 0.01, uniform: false, desc: 'How much each point\'s swing size wanders over time.' },
      { key: 'orbAmpJitterSpeed', label: 'Amp jitter speed', value: 0.06, min: 0, max: 1, step: 0.005, uniform: false, desc: 'How fast the swing sizes wander.' },
      { key: 'orbDrift', label: 'Drift', value: 0.052, min: 0, max: 0.1, step: 0.001, uniform: false, desc: 'How far the orb wanders from centre.' },
      { key: 'orbEdgeSoftness', label: 'Edge softness', value: 0.0005, min: 0, max: 0.03, step: 0.0005, desc: 'Extra feathering on the silhouette (0 = crisp, antialiased).' },
      { key: 'orbColor', label: 'Edge colour', type: 'color', value: '#1c0605', desc: 'Red-black body colour near the edge.' },
      { key: 'orbCoreColor', label: 'Core colour', type: 'color', value: '#030000', desc: 'Colour at the centre of the orb.' },
      { key: 'orbHueShare', label: 'Halo hue share', value: 0.32, min: 0, max: 1.5, step: 0.005, desc: 'How much of the nearest halo colour bleeds into the orb rim.' },
      { key: 'orbHueDepth', label: 'Hue share depth', value: 0.03, min: 0.005, max: 0.6, step: 0.005, desc: 'How far inward the borrowed halo hue reaches.' },
      { key: 'orbSheen', label: 'Inner sheen', value: 0.05, min: 0, max: 0.5, step: 0.005, desc: 'Faint swirling halo-tinted texture inside the orb.' },
    ],
  },
  {
    group: 'Halo',
    params: [
      { key: 'haloInner', label: 'Inner colour', type: 'color', value: '#ff7a22', desc: 'Halo colour hugging the orb.' },
      { key: 'haloOuter', label: 'Outer colour', type: 'color', value: '#d2260c', desc: 'Halo colour toward its fading edge.' },
      { key: 'haloColorBias', label: 'Colour bias', value: 1, min: 0.1, max: 3, step: 0.01, desc: '<1 brings the outer colour in closer to the orb.' },
      { key: 'haloHueVariation', label: 'Hue variation', value: 1, min: 0, max: 1, step: 0.01, desc: 'Angular drift between inner and outer colour around the ring.' },
      { key: 'haloIntensity', label: 'Intensity', value: 0.88, min: 0, max: 1, step: 0.01, desc: 'Peak opacity of the halo.' },
      { key: 'haloReach', label: 'Reach', value: 0.385, min: 0.02, max: 1.2, step: 0.005, uniform: false, desc: 'Distance beyond the halo body over which it fades to zero.' },
      { key: 'haloFalloff', label: 'Falloff', value: 1.7, min: 0.3, max: 6, step: 0.01, desc: 'Shape of the fade — higher = tighter glow, longer faint tail.' },
      { key: 'haloScale', label: 'Body scale', value: 1.04, min: 0.5, max: 2, step: 0.005, desc: 'Size of the halo body relative to the orb.' },
      { key: 'haloLag', label: 'Lag (s)', value: 1.2, min: 0, max: 5, step: 0.01, uniform: false, desc: 'How far behind the orb the halo follows the same undulation.' },
      { key: 'haloIndependence', label: 'Independence', value: 0.3, min: 0, max: 1, step: 0.01, desc: '0 = lagged copy of the orb shape, 1 = its own shape entirely.' },
      { key: 'haloWobbleAmp', label: 'Own undulation', value: 0.06, min: 0, max: 0.4, step: 0.001, desc: 'Amplitude of the halo\'s independent shape (fraction of radius).' },
      { key: 'haloWobbleFreq', label: 'Own lobes', value: 1, min: 0.2, max: 4, step: 0.01, desc: 'Size of the bulges in the halo\'s independent shape.' },
      { key: 'haloWobbleSpeed', label: 'Own speed', value: 0.08, min: 0, max: 1, step: 0.005, desc: 'How fast the halo\'s independent shape evolves.' },
      { key: 'haloPulse', label: 'Breathing', value: 0.12, min: 0, max: 0.6, step: 0.005, uniform: false, desc: 'How much the reach swells and contracts.' },
      { key: 'haloPulseSpeed', label: 'Breathing speed', value: 0.25, min: 0, max: 2, step: 0.005, uniform: false, desc: 'Speed of the swell.' },
      { key: 'haloRays', label: 'Flame texture', value: 0, min: 0, max: 1.5, step: 0.01, desc: 'Streaky outward-moving texture in the outer halo.' },
    ],
  },
  {
    group: 'Film burn',
    params: [
      { key: 'exposure', label: 'Exposure', value: 1.04, min: 0.5, max: 1.6, step: 0.01, desc: 'Overall brightness before grain.' },
      { key: 'filmFps', label: 'Film frame rate', value: 24, min: 6, max: 60, step: 1, uniform: false, desc: 'Rate at which grain and dust update.' },
      { key: 'vignette', label: 'Vignette', value: 0.41, min: 0, max: 1, step: 0.01, desc: 'Corner burn: the image is multiplied by the vignette colour toward the corners.' },
      { key: 'vignetteColor', label: 'Vignette colour', type: 'color', value: '#ff6a2a', desc: 'Multiply tint for the corners. Saturated warm colours scorch without greying; darker colours darken.' },
      { key: 'leak', label: 'Light leaks', value: 1.23, min: 0, max: 1.5, step: 0.01, desc: 'Drifting hot blooms creeping in from the edges, over everything.' },
      { key: 'leakColor', label: 'Leak colour', type: 'color', value: '#ff5a1e', desc: 'Colour of the light leaks.' },
      { key: 'leakSpeed', label: 'Leak speed', value: 0.08, min: 0, max: 1, step: 0.005, desc: 'How fast leaks drift and morph.' },
      { key: 'burnHighlights', label: 'Highlight burn', value: 0.6, min: 0, max: 1, step: 0.01, desc: 'Over-bright areas blow out toward the burn colour.' },
      { key: 'burnColor', label: 'Burn colour', type: 'color', value: '#fff3d2', desc: 'What blown highlights clip to.' },
    ],
  },
  {
    group: 'Grain & damage',
    params: [
      { key: 'grainAmount', label: 'Grain amount', value: 0.1, min: 0, max: 0.8, step: 0.005, desc: 'Strength of the light grain (screened over the image).' },
      { key: 'grainSize', label: 'Grain size (px)', value: 0.5, min: 0.5, max: 6, step: 0.05, desc: 'Size of individual grains in canvas pixels.' },
      { key: 'grainSharpness', label: 'Grain sparsity', value: 1.4, min: 0.3, max: 4, step: 0.01, desc: 'Higher = fewer, brighter specks; lower = even haze.' },
      { key: 'grainClump', label: 'Grain clumping', value: 0.5, min: 0, max: 1, step: 0.01, desc: 'Uneven grain density, like real emulsion.' },
      { key: 'dust', label: 'Dust', value: 0.1, min: 0, max: 1, step: 0.01, desc: 'Density of white dust specks per frame.' },
    ],
  },
];
