// Blackstar — shaders + per-frame CPU values.
//
// Rendering is three passes, so expensive noise is evaluated only where it's needed:
//
//   1. angular   (1024×1)        Orb/halo edge shapes as functions of angle only.
//   2. fields    (¼ resolution)  Smooth, low-frequency noise fields (bg warp, mottle,
//                                leaks, halo flame, edge raggedness, orb swirl).
//   3. composite (full res)      Cheap per-pixel work: looks up the two killtextures above,
//                                draws crisp edges, then film burn, dust, scratches, grain.
//
// Anything identical for every pixel (orb centre, gradient direction, weave, flicker,
// scratch positions) is computed once per frame on the CPU in perFrame() → f_* uniforms.
//
// Composite order: background → halo → orb → light leaks → highlight burn →
// vignette / edge burn → exposure & flicker → scratches → dust → grain.
//
// Uniforms available in every pass:
//   u_<key>     every param in params.js without `uniform: false` (auto-declared)
//   f_<name>    per-frame values declared in frameUniforms and written by perFrame()
//   u_res       size of the current pass's render target, in px
//   u_screen    size of the final canvas, in px
//   u_time      scene seconds (scaled & pausable)
//   u_realTime  wall-clock seconds (drives the film layer, so grain keeps running while paused)

(function () {
  // ---------------------------------------------------------------- CPU noise (allocation-free)
  function hash1(n) {
    n |= 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  function hash2(a, b) { return hash1(Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)); }
  // 1D gradient noise, roughly -1..1.
  function noise1(x) {
    const i = Math.floor(x), f = x - i;
    const g0 = hash1(i) * 2 - 1, g1 = hash1(i + 1) * 2 - 1;
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    return 2 * (g0 * f * (1 - u) + g1 * (f - 1) * u);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  window.BLACKSTAR_SHADER = {
    angularSize: 1024,
    fieldsDivisor: 4,

    // name → component count. Each is declared as float/vec2/vec3/vec4 in every pass.
    frameUniforms: {
      f_px: 1,          // canvas px per CSS px (keeps grain/dust size stable when resolution changes)
      f_frame: 1,       // film frame index
      f_weave: 2,
      f_bgDir: 2,
      f_orbCenter: 2,
      f_haloCenter: 2,
      f_haloReach: 1,
      f_exposure: 1,    // exposure × flicker
      f_scratchX: 3,    // px
      f_scratchW: 3,    // px; 0 = off
      f_scratchE: 3,    // epoch seed
    },

    // Called once per frame. P = params by key, f = preallocated Float32Arrays. Must not allocate.
    perFrame(P, t, rt, width, height, px, f) {
      const seed = P.seed.value;
      const frame = Math.floor(rt * P.filmFps.value);
      f.f_px[0] = px;
      f.f_frame[0] = frame;

      const wv = P.weave.value; // screen-height units
      f.f_weave[0] = (hash2(frame, 1) - 0.5) * wv + noise1(rt * 0.7 + seed) * wv * 0.6;
      f.f_weave[1] = (hash2(frame, 3) - 0.5) * wv + noise1(rt * 0.6 + seed + 57) * wv * 0.6;

      // Gradient direction wanders irregularly (two incommensurate tracks) within ±range/2.
      const ws = P.bgWobbleSpeed.value;
      const w = 0.65 * noise1(t * ws + seed * 0.71 + 101) + 0.35 * noise1(t * ws * 2.37 + seed + 211);
      const ang = (P.bgAngle.value + 0.5 * P.bgWobbleRange.value * clamp(w * 1.4, -1, 1)) * (Math.PI / 180);
      f.f_bgDir[0] = Math.cos(ang);
      f.f_bgDir[1] = Math.sin(ang);

      const drift = P.orbDrift.value, lagT = t - P.haloLag.value;
      f.f_orbCenter[0] = drift * noise1(t * 0.11 + seed + 307);
      f.f_orbCenter[1] = drift * noise1(t * 0.09 + seed + 401);
      f.f_haloCenter[0] = drift * noise1(lagT * 0.11 + seed + 307);
      f.f_haloCenter[1] = drift * noise1(lagT * 0.09 + seed + 401);

      f.f_haloReach[0] = Math.max(P.haloReach.value * (1 + P.haloPulse.value * noise1(t * P.haloPulseSpeed.value + seed + 503)), 1e-3);

      f.f_exposure[0] = P.exposure.value *
        (1 + P.flicker.value * ((hash2(frame, 11) - 0.5) * 1.2 + 0.5 * noise1(rt * 2 + 601)));

      // Scratches persist for several frames, jitter each frame.
      const fps = P.filmFps.value, chance = P.scratches.value * 0.6;
      for (let i = 0; i < 3; i++) {
        const epoch = Math.floor(rt * fps / (5 + i * 4));
        const on = hash2(epoch, 41 + i * 7) < chance;
        f.f_scratchE[i] = epoch % 997;
        f.f_scratchX[i] = hash2(epoch, 43 + i * 7) * width + (hash2(frame, 47 + i * 7) - 0.5) * 3 * px;
        f.f_scratchW[i] = on ? (0.5 + 1.1 * hash2(epoch, 53 + i * 7)) * px : 0;
      }
    },

    vert: `#version 300 es
void main() {
  // Fullscreen triangle from vertex id — no buffers needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,

    // Prepended (after uniform declarations) to every pass.
    common: `
#define TAU 6.28318530718
#define PI  3.14159265359

// 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x  = x_ * ns.x + ns.yyyy;
  vec4 y  = y_ * ns.x + ns.yyyy;
  vec4 h  = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.875;
}

// Integer hash (PCG) → 0..1 per integer cell.
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float hash(vec3 p) {
  uvec3 u = uvec3(ivec3(floor(p)));
  return float(pcg(u.x + pcg(u.y + pcg(u.z)))) * (1.0 / 4294967295.0);
}

// Pass-to-pass packing: values in ±1.5 stored as 0..1 (works for RGBA8 and half-float targets).
vec4 encode(vec4 v) { return clamp(v / 3.0 + 0.5, 0.0, 1.0); }
vec4 decode(vec4 v) { return (v - 0.5) * 3.0; }

// Broad lobes plus an optional finer layer (u_orbDetail) — low detail reads as liquid.
float blobNoise(vec3 p) {
  return (snoise(p) + u_orbDetail * snoise(p * vec3(2.1, 2.1, 1.6) + 11.3)) / (1.0 + u_orbDetail * 0.6);
}
`,

    // ---------------------------------------------------------------- pass 1
    angular: `
out vec4 outColor;
void main() {
  // Texel i ↔ angle matching atan(y, x): (i + 0.5) / N * TAU - PI.
  float a = gl_FragCoord.x / u_res.x * TAU - PI;
  vec2 dir = vec2(cos(a), sin(a));
  float t = u_time;
  vec2 c = dir * u_orbWobbleFreq;
  float orbN  = blobNoise(vec3(c + u_seed * 1.37, t * u_orbWobbleSpeed));
  float lagN  = blobNoise(vec3(c + u_seed * 1.37, (t - u_haloLag) * u_orbWobbleSpeed));
  float ownN  = blobNoise(vec3(c * 0.8 + vec2(31.7, -12.3) + u_seed, t * u_orbWobbleSpeed * 0.73));
  float hueN  = snoise(vec3(dir * 1.3 + 5.0 + u_seed, t * 0.12));
  outColor = encode(vec4(orbN, lagN, ownN, hueN));
}`,

    // ---------------------------------------------------------------- pass 2
    fields: `
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;
void main() {
  float aspect = u_screen.x / u_screen.y;
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time, rt = u_realTime;

  float warp   = fbm3(vec3(q * u_bgWarpScale + u_seed, t * 0.05));
  float mottle = fbm3(vec3(q * u_bgMottleScale - u_seed, t * 0.03));
  float leak   = fbm3(vec3(q * 0.9 + u_seed * 2.1, rt * u_leakSpeed));
  vec2 hd = q - f_haloCenter;
  float hr = length(hd);
  float rays   = snoise(vec3(hd / max(hr, 1e-5) * 2.5 + u_seed, hr * 3.0 - t * 0.35));

  vec2 ep = uv * vec2(aspect, 1.0);
  float ragged = fbm3(vec3(ep * 3.0 + u_seed, rt * 0.08));
  float burnW  = snoise(vec3(ep * 0.9 - u_seed, rt * 0.05));
  float swirl  = snoise(vec3((q - f_orbCenter) * 5.0 + u_seed, t * 0.2));

  out0 = encode(vec4(warp, mottle, leak, rays));
  out1 = encode(vec4(ragged, burnW, swirl, 0.0));
}`,

    // ---------------------------------------------------------------- pass 3
    composite: `
uniform sampler2D u_angular;
uniform sampler2D u_fields0;
uniform sampler2D u_fields1;
out vec4 outColor;

vec4 angular(vec2 d) { return decode(textureLod(u_angular, vec2(atan(d.y, d.x) / TAU + 0.5, 0.5), 0.0)); }

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / u_res;
  float px = f_px;
  float frame = f_frame;

  vec2 q = (fc - 0.5 * u_res) / u_res.y + f_weave;
  vec2 fuv = q / vec2(aspect, 1.0) + 0.5;
  vec4 F0 = decode(textureLod(u_fields0, fuv, 0.0)); // warp, mottle, leak, rays
  vec4 F1 = decode(textureLod(u_fields1, fuv, 0.0)); // ragged, burn width, swirl, -

  // --- background: wobbling, warped gradient with mottling
  float halfExtent = 0.5 * (abs(f_bgDir.x) * aspect + abs(f_bgDir.y));
  float g = dot(q, f_bgDir) / (2.0 * halfExtent) + 0.5 + u_bgWarp * F0.x;
  g = pow(clamp(g, 0.0, 1.0), u_bgBias);
  vec3 col = mix(u_bgBottom, u_bgTop, g) * (1.0 + u_bgMottle * F0.y);

  // --- halo: lagged copy of the orb's undulation blended with its own shape
  vec2 hd = q - f_haloCenter;
  float hr = length(hd);
  vec4 A = angular(hd); // orbN, lagN, ownN, hueN
  float haloR = u_orbRadius * u_haloScale
              * (1.0 + mix(u_orbWobbleAmp * A.y, u_haloWobbleAmp * A.z, u_haloIndependence));
  float x = clamp((hr - haloR) / f_haloReach, 0.0, 1.0);
  // smoothstep has zero slope at both ends → fades to nothing with no visible edge.
  float halo = pow(1.0 - smoothstep(0.0, 1.0, x), u_haloFalloff);
  halo = clamp(halo * (1.0 + u_haloRays * F0.w * x), 0.0, 1.0) * u_haloIntensity;
  float hueShift = (A.w * 0.5 + 0.5) * u_haloHueVariation * 0.6;
  vec3 haloCol = mix(u_haloInner, u_haloOuter, clamp(pow(x, u_haloColorBias) + hueShift, 0.0, 1.0));
  col = mix(col, haloCol, halo);

  // --- orb: crisp wobbling silhouette, rim borrows the nearest halo hue
  vec2 od = q - f_orbCenter;
  float orr = length(od);
  float orbR = u_orbRadius * (1.0 + u_orbWobbleAmp * angular(od).x);
  float sd = orr - orbR;
  float aa = fwidth(sd) + u_orbEdgeSoftness;
  float orbA = 1.0 - smoothstep(-aa, aa, sd);
  if (orbA > 0.0) {
    float depth = clamp(-sd / u_orbRadius, 0.0, 1.0);
    vec3 orbCol = mix(u_orbColor, u_orbCoreColor, smoothstep(0.0, 1.0, depth));
    vec3 edgeHue = mix(u_haloInner, u_haloOuter, clamp(hueShift, 0.0, 1.0));
    float rim = exp(-depth / u_orbHueDepth);
    orbCol += edgeHue * (u_orbHueShare * rim + u_orbSheen * (F1.z * 0.5 + 0.5) * (1.0 - 0.7 * depth));
    col = mix(col, orbCol, orbA);
  }

  // --- light leaks: drifting blooms, masked toward the frame edges
  float edgeDist = length(q / vec2(0.5 * aspect, 0.5));
  col += u_leakColor * smoothstep(0.1, 0.65, F0.z) * smoothstep(0.45, 1.35, edgeDist) * u_leak;

  // --- highlight burn: anything pushed past white blows out toward the burn colour
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, u_burnColor, smoothstep(0.95, 1.4, lum) * u_burnHighlights);

  // --- vignette + ragged edge burn; burn width varies along the edge so it never reads as a frame
  col = mix(col, u_vignetteColor, smoothstep(0.35, 1.55, edgeDist) * u_vignette);
  vec2 e2 = min(uv, 1.0 - uv) * vec2(aspect, 1.0);
  float e = min(e2.x, e2.y) + u_edgeBurnRagged * F1.x;
  float bw = u_edgeBurnWidth * (0.35 + 1.3 * smoothstep(-0.4, 0.6, F1.y));
  float hot = 1.0 - smoothstep(0.0, bw, e);
  col += u_edgeBurnColor * hot * hot * u_edgeBurn;
  float charred = 1.0 - smoothstep(0.0, bw * 0.3, e);
  col = mix(col, u_vignetteColor * 0.5, clamp(charred * u_edgeBurn, 0.0, 1.0));

  // --- exposure + flicker
  col *= f_exposure;

  // --- scratches (positions computed on the CPU; noise only evaluated right next to a line)
  for (int i = 0; i < 3; i++) {
    float w = f_scratchW[i];
    float dx = fc.x - f_scratchX[i];
    if (w > 0.0 && abs(dx) < 4.0 * w) {
      float breakup = smoothstep(-0.3, 0.6, snoise(vec3(float(i) * 7.0, uv.y * 5.0, f_scratchE[i])));
      col += exp(-(dx * dx) / (w * w)) * breakup * 0.3;
    }
  }

  // --- dust: sparse white specks, one candidate per cell per frame
  float cell = 48.0 * px;
  vec2 cid = floor(fc / cell);
  if (hash(vec3(cid, frame + 101.0)) < u_dust * 0.05) {
    vec2 cpos = (cid + 0.2 + 0.6 * vec2(hash(vec3(cid, frame + 7.0)), hash(vec3(cid, frame + 13.0)))) * cell;
    vec2 dd = fc - cpos;
    dd.x /= mix(1.0, 3.0, hash(vec3(cid, frame + 29.0)));
    float rad = mix(0.7, 2.6, hash(vec3(cid, frame + 19.0))) * px;
    col += (1.0 - smoothstep(rad * 0.4, rad, length(dd))) * mix(0.4, 0.9, hash(vec3(cid, frame + 23.0)));
  }

  // --- grain: white, per film frame, two scales, clumped, screened over the image
  float gs = max(u_grainSize * px, 0.5);
  vec2 gp = floor(fc / gs);
  float gn = (hash(vec3(gp, frame)) + hash(vec3(gp, frame + 1000.0)) + hash(vec3(gp, frame + 2000.0))) / 3.0;
  vec2 gp2 = floor(fc / (gs * 2.3));
  float gn2 = (hash(vec3(gp2, frame + 3000.0)) + hash(vec3(gp2, frame + 4000.0))) * 0.5;
  float grain = pow(clamp((mix(gn, gn2, 0.3) - 0.5) * 3.2, 0.0, 1.0), u_grainSharpness);
  grain *= mix(1.0, 2.0 * hash(vec3(floor(fc / (gs * 4.0)), frame + 77.0)), u_grainClump) * u_grainAmount;
  col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - clamp(grain, 0.0, 1.0));

  outColor = vec4(col, 1.0);
}`,
  };
})();
