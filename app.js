// Blackstar — renderer + control panel.
//
// Nothing in here is design-specific: it reads the schema from params.js and the
// passes + perFrame() from shader.js. The frame loop allocates nothing, so there is
// no per-frame garbage for the collector to chase.

(function () {
  'use strict';

  const SCHEMA = window.BLACKSTAR_PARAMS;
  const SHADER = window.BLACKSTAR_SHADER;
  const STATE_TAG = 'blackstar/state@1';
  const STORAGE_KEY = 'blackstar:overrides';

  // ------------------------------------------------------------ param model
  const params = [];
  const byKey = Object.create(null);
  for (const group of SCHEMA) {
    for (const p of group.params) {
      p.group = group.group;
      p.type = p.type || 'range';
      p.default = p.value;
      p.decimals = p.type === 'range' ? decimalsOf(p.step) : 0;
      if (p.type === 'color') p.rgb = new Float32Array(3);
      if (byKey[p.key]) throw new Error('Duplicate param key: ' + p.key);
      params.push(p);
      byKey[p.key] = p;
      writeDerived(p);
    }
  }
  const uniformParams = params.filter((p) => p.uniform !== false);
  let paramVersion = 0; // bumped on every edit; each GL pass re-uploads params when it's behind

  function decimalsOf(step) {
    const s = String(step);
    return s.includes('e-') ? Number(s.split('e-')[1]) : (s.split('.')[1] || '').length;
  }
  function roundTo(v, d) { return Number(Number(v).toFixed(d)); }
  function writeDerived(p) {
    if (p.type !== 'color') return;
    const n = parseInt(p.value.slice(1), 16);
    p.rgb[0] = ((n >> 16) & 255) / 255;
    p.rgb[1] = ((n >> 8) & 255) / 255;
    p.rgb[2] = (n & 255) / 255;
  }
  function coerce(p, v) {
    if (p.type === 'bool') return !!v;
    if (p.type === 'color') return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : p.value;
    const n = Number(v);
    return Number.isFinite(n) ? roundTo(n, p.decimals) : p.value;
  }
  function isChanged(p) { return p.value !== p.default; }
  function setValue(p, v) {
    p.value = coerce(p, v);
    writeDerived(p);
    paramVersion++;
  }

  // Overrides survive reloads, but are dropped automatically once the code's
  // defaults change (e.g. after a pasted state has been baked into params.js).
  const SIGNATURE = (function () {
    const s = JSON.stringify(params.map((p) => [p.key, p.default]));
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  })();
  function loadOverrides() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || saved.sig !== SIGNATURE) return;
      for (const k in saved.values) if (byKey[k]) setValue(byKey[k], saved.values[k]);
    } catch (_) { /* storage unavailable — run on defaults */ }
  }
  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const values = {};
        for (const p of params) if (isChanged(p)) values[p.key] = p.value;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sig: SIGNATURE, values }));
      } catch (_) { /* ignore */ }
    }, 250);
  }
  loadOverrides();

  // ------------------------------------------------------------ GL
  const canvas = document.getElementById('stage');
  const errorBox = document.getElementById('error');
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
  });
  if (!gl) { fail('WebGL2 is not available in this browser.'); return; }

  const ANG_N = SHADER.angularSize;
  const UNIT_ANGULAR = 0, UNIT_FIELDS0 = 1, UNIT_FIELDS1 = 2;

  // Per-frame CPU values (f_*): one preallocated array each, plus a flat list for the upload loop.
  const frameVals = {};
  const frameList = [];
  // Spec is a component count (1–4 → float/vec2/vec3/vec4) or [length] for a float array.
  for (const name in SHADER.frameUniforms) {
    const spec = SHADER.frameUniforms[name];
    const array = Array.isArray(spec);
    const n = array ? spec[0] : spec;
    frameVals[name] = new Float32Array(n);
    frameList.push({ name, n, array, arr: frameVals[name] });
  }

  let vao = null, passAngular = null, passFields = null, passComposite = null;
  let angTex = null, angFbo = null, fldTex0 = null, fldTex1 = null, fldFbo = null, fldW = 0, fldH = 0;

  function fail(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    console.error(msg);
  }
  function compile(type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader "' + name + '" failed to compile:\n' + log);
    }
    return sh;
  }
  function header() {
    const vecType = ['', 'float', 'vec2', 'vec3', 'vec4'];
    return '#version 300 es\nprecision highp float;\nprecision highp int;\n' +
      'uniform vec2 u_res;\nuniform vec2 u_screen;\nuniform float u_time;\nuniform float u_realTime;\n' +
      uniformParams.map((p) => 'uniform ' + (p.type === 'color' ? 'vec3' : 'float') + ' u_' + p.key + ';').join('\n') + '\n' +
      frameList.map((f) => f.array ? 'uniform float ' + f.name + '[' + f.n + '];' : 'uniform ' + vecType[f.n] + ' ' + f.name + ';').join('\n') + '\n' +
      SHADER.common;
  }
  function buildPass(name, head) {
    const vs = compile(gl.VERTEX_SHADER, SHADER.vert, 'vert');
    const fs = compile(gl.FRAGMENT_SHADER, head + SHADER[name], name);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('Program "' + name + '" failed to link:\n' + gl.getProgramInfoLog(prog));
    }
    const loc = (n) => gl.getUniformLocation(prog, n);
    return {
      prog,
      version: -1,
      uRes: loc('u_res'), uScreen: loc('u_screen'), uTime: loc('u_time'), uRealTime: loc('u_realTime'),
      paramLocs: uniformParams.map((p) => loc('u_' + p.key)),
      frameLocs: frameList.map((f) => loc(f.name)),
    };
  }
  function makeTexture(unit, wrapS) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex; // stays bound to its own unit for the life of the context
  }
  function buildTargets() {
    // Angular shapes: half-float where renderable (smoother edges at large undulation), else RGBA8.
    angTex = makeTexture(UNIT_ANGULAR, gl.REPEAT);
    angFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, angFbo);
    const halfFloat = !!gl.getExtension('EXT_color_buffer_float');
    if (halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, ANG_N, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, angTex, 0);
    if (!halfFloat || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ANG_N, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    // Low-res fields: two RGBA8 targets written in one pass. Sized in resizeIfNeeded().
    fldTex0 = makeTexture(UNIT_FIELDS0, gl.CLAMP_TO_EDGE);
    fldTex1 = makeTexture(UNIT_FIELDS1, gl.CLAMP_TO_EDGE);
    fldFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fldFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fldTex0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, fldTex1, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fldW = fldH = 0;
  }
  function sizeFields(w, h) {
    if (w === fldW && h === fldH) return;
    fldW = w;
    fldH = h;
    gl.activeTexture(gl.TEXTURE0 + UNIT_FIELDS0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.activeTexture(gl.TEXTURE0 + UNIT_FIELDS1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  function buildAll() {
    const head = header();
    passAngular = buildPass('angular', head);
    passFields = buildPass('fields', head);
    passComposite = buildPass('composite', head);
    gl.useProgram(passComposite.prog);
    gl.uniform1i(gl.getUniformLocation(passComposite.prog, 'u_angular'), UNIT_ANGULAR);
    gl.uniform1i(gl.getUniformLocation(passComposite.prog, 'u_fields0'), UNIT_FIELDS0);
    gl.uniform1i(gl.getUniformLocation(passComposite.prog, 'u_fields1'), UNIT_FIELDS1);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buildTargets();
  }

  // ------------------------------------------------------------ frame loop (allocation-free)
  const P_timeScale = byKey.timeScale, P_paused = byKey.paused;
  const P_renderScale = byKey.renderScale, P_maxDpr = byKey.maxDpr;
  const P_adaptive = byKey.adaptive, P_targetFps = byKey.targetFps;
  let raf = 0, last = 0, sceneTime = 0, realTime = 0, pxRatio = 1;
  let fpsAccum = 0, fpsFrames = 0, fpsEl = null;

  function drawPass(pass, fbo, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pass.prog);
    gl.uniform2f(pass.uRes, w, h);
    gl.uniform2f(pass.uScreen, canvas.width, canvas.height);
    gl.uniform1f(pass.uTime, sceneTime);
    gl.uniform1f(pass.uRealTime, realTime);
    if (pass.version !== paramVersion) {
      for (let i = 0; i < uniformParams.length; i++) {
        const p = uniformParams[i], loc = pass.paramLocs[i];
        if (p.type === 'color') gl.uniform3fv(loc, p.rgb);
        else gl.uniform1f(loc, p.type === 'bool' ? (p.value ? 1 : 0) : p.value);
      }
      pass.version = paramVersion;
    }
    for (let i = 0; i < frameList.length; i++) {
      const f = frameList[i], loc = pass.frameLocs[i];
      if (f.array || f.n === 1) gl.uniform1fv(loc, f.arr);
      else if (f.n === 2) gl.uniform2fv(loc, f.arr);
      else if (f.n === 3) gl.uniform3fv(loc, f.arr);
      else gl.uniform4fv(loc, f.arr);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- adaptive quality
  // dynScale multiplies the render resolution. It drops when frames run slower than the target and
  // creeps back up when there's headroom. A drop that doesn't actually speed things up (the display or
  // power mode is capping fps, not the GPU) is undone, and dropping pauses for a while.
  const MIN_SCALE = 0.35;
  let dynScale = 1;
  let winTime = 0, winFrames = 0, sinceChange = 0, ceiling = 1, ceilingAge = 0;
  let judgingDrop = false, preDropScale = 1, preDropAvg = 0, holdDown = 0, holdDownLen = 5;

  function adapt(dt) {
    if (!P_adaptive.value) { dynScale = 1; return; }
    winTime += dt;
    winFrames++;
    sinceChange += dt;
    ceilingAge += dt;
    holdDown -= dt;
    if (winTime < 0.5) return;
    const avg = winTime / winFrames;
    winTime = 0;
    winFrames = 0;
    const budget = 1 / P_targetFps.value;

    if (judgingDrop) {
      judgingDrop = false;
      if (avg > preDropAvg * 0.92) { // didn't help → not GPU-bound
        dynScale = preDropScale;
        ceiling = 1;
        holdDown = holdDownLen;
        holdDownLen = Math.min(holdDownLen * 2, 60);
        sinceChange = 0;
        return;
      }
      holdDownLen = 5;
    }
    if (avg > budget * 1.2 && dynScale > MIN_SCALE && holdDown <= 0 && sinceChange > 0.5) {
      preDropScale = dynScale;
      preDropAvg = avg;
      dynScale = Math.max(MIN_SCALE, dynScale * 0.8);
      ceiling = preDropScale;
      ceilingAge = 0;
      judgingDrop = true;
      sinceChange = 0;
    } else if (avg < budget * 1.08 && dynScale < 1 && sinceChange > 2) {
      const next = Math.min(1, dynScale * 1.12);
      if (next < ceiling * 0.97 || ceilingAge > 20) {
        dynScale = next;
        sinceChange = 0;
      }
    }
  }

  function resizeIfNeeded() {
    const ratio = Math.min(window.devicePixelRatio || 1, P_maxDpr.value) * P_renderScale.value * dynScale;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const w = Math.max(1, Math.round(cw * ratio));
    const h = Math.max(1, Math.round(ch * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    pxRatio = cw > 0 ? w / cw : 1;
    sizeFields(Math.max(1, Math.ceil(w / SHADER.fieldsDivisor)), Math.max(1, Math.ceil(h / SHADER.fieldsDivisor)));
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) * 0.001, 0.1) : 0; // clamp after tab switches
    last = now;
    realTime = (realTime + dt) % 10000; // keep float32 precision in the shader
    if (!P_paused.value) sceneTime += dt * P_timeScale.value;

    adapt(dt);
    resizeIfNeeded();
    SHADER.perFrame(byKey, sceneTime, realTime, canvas.width, canvas.height, pxRatio, frameVals);
    drawPass(passAngular, angFbo, ANG_N, 1);
    drawPass(passFields, fldFbo, fldW, fldH);
    drawPass(passComposite, null, canvas.width, canvas.height);

    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      if (fpsEl && panelOpen) {
        fpsEl.textContent = Math.round(fpsFrames / fpsAccum) + ' fps · ' + canvas.width + '×' + canvas.height +
          (P_adaptive.value ? ' · res ' + Math.round(dynScale * 100) + '%' : '');
      }
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }

  function start() {
    try { buildAll(); } catch (err) { fail(err.message); return; }
    last = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    vao = passAngular = passFields = passComposite = null;
    angTex = angFbo = fldTex0 = fldTex1 = fldFbo = null;
    dynScale = Math.max(MIN_SCALE, dynScale * 0.6); // come back lighter
  });
  canvas.addEventListener('webglcontextrestored', start);

  // ------------------------------------------------------------ control panel
  const cog = document.getElementById('cog');
  const panel = document.getElementById('panel');
  const controls = document.getElementById('controls');
  const copyBtn = document.getElementById('copy');
  const resetBtn = document.getElementById('reset');
  const statusEl = document.getElementById('status');
  fpsEl = document.getElementById('fps');
  let panelOpen = false;
  const UI_KEY = 'blackstar:ui';
  const rows = []; // { p, wrap, sync }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildRow(p) {
    const wrap = el('div', 'row row-' + p.type);
    const label = el('label', 'lbl', p.label);
    const id = 'p-' + p.key;
    label.htmlFor = id;
    label.title = (p.desc ? p.desc + '\n' : '') + 'key: ' + p.key + ' · default: ' + p.default + '\nDouble-click to reset.';
    // Labels stay linked to their control for accessibility, but a click on one must not activate it
    // (that opened the colour picker / toggled checkboxes); double-click is reserved for reset.
    label.addEventListener('click', (e) => e.preventDefault());
    label.addEventListener('dblclick', () => { setValue(p, p.default); sync(); onEdited(); });
    wrap.appendChild(label);

    let sync;
    if (p.type === 'bool') {
      const box = el('input');
      box.type = 'checkbox';
      box.id = id;
      box.addEventListener('change', () => { setValue(p, box.checked); onEdited(); sync(); });
      wrap.appendChild(box);
      sync = () => { box.checked = p.value; wrap.classList.toggle('changed', isChanged(p)); };
    } else if (p.type === 'color') {
      const pick = el('input');
      pick.type = 'color';
      pick.id = id;
      const hex = el('input', 'num');
      hex.type = 'text';
      hex.spellcheck = false;
      hex.maxLength = 7;
      pick.addEventListener('input', () => { setValue(p, pick.value); hex.value = p.value; wrap.classList.toggle('changed', isChanged(p)); onEdited(); });
      hex.addEventListener('change', () => { setValue(p, hex.value.trim().replace(/^#?/, '#')); sync(); onEdited(); });
      wrap.append(pick, hex);
      sync = () => { pick.value = p.value; hex.value = p.value; wrap.classList.toggle('changed', isChanged(p)); };
    } else {
      const range = el('input');
      range.type = 'range';
      range.id = id;
      range.min = p.min;
      range.max = p.max;
      range.step = p.step;
      const num = el('input', 'num');
      num.type = 'number';
      num.step = p.step;
      // The number box deliberately has no min/max: type past the slider range if you need to.
      range.addEventListener('input', () => { setValue(p, range.value); num.value = p.value; wrap.classList.toggle('changed', isChanged(p)); onEdited(); });
      num.addEventListener('change', () => { setValue(p, num.value); sync(); onEdited(); });
      wrap.append(range, num);
      sync = () => { range.value = p.value; num.value = p.value; wrap.classList.toggle('changed', isChanged(p)); };
    }
    wrap.title = p.desc || '';
    sync();
    rows.push({ p, sync });
    return wrap;
  }

  for (const group of SCHEMA) {
    const det = el('details', 'group');
    det.open = true;
    det.appendChild(el('summary', null, group.group));
    for (const p of group.params) det.appendChild(buildRow(p));
    controls.appendChild(det);
  }

  function syncAll() { for (const r of rows) r.sync(); }
  function changedCount() { let n = 0; for (const p of params) if (isChanged(p)) n++; return n; }
  // Mobile browser bars and overscroll take the page background / theme-color, not canvas pixels,
  // so keep both on the orb's edge colour — the orb fills the screen's narrow edges.
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function syncPageColour() {
    const c = byKey.orbColor.value;
    document.documentElement.style.backgroundColor = c;
    document.body.style.backgroundColor = c;
    if (themeMeta) themeMeta.content = c;
  }

  function onEdited() {
    scheduleSave();
    syncPageColour();
    const n = changedCount();
    statusEl.textContent = n === 0 ? 'No changes' : n + (n === 1 ? ' change' : ' changes');
    resetBtn.hidden = n === 0;
  }

  // UI mode: 'off' (nothing shown — the default for new visitors), 'closed' (cog only) or
  // 'open' (cog + panel; the canvas shrinks to the remaining area). Remembered per browser.
  function setUi(mode) {
    panelOpen = mode === 'open';
    document.body.dataset.ui = mode;
    panel.setAttribute('aria-hidden', String(!panelOpen));
    cog.setAttribute('aria-expanded', String(panelOpen));
    try { localStorage.setItem(UI_KEY, mode); } catch (_) { /* ignore */ }
  }
  cog.addEventListener('click', () => setUi(panelOpen ? 'closed' : 'open'));
  let savedUi = 'off';
  try { savedUi = localStorage.getItem(UI_KEY) || 'off'; } catch (_) { /* ignore */ }
  setUi(savedUi === 'open' || savedUi === 'closed' ? savedUi : 'off');

  // ---- copy state
  function buildState() {
    const changed = {};
    for (const p of params) if (isChanged(p)) changed[p.key] = { from: p.default, to: p.value };
    return JSON.stringify({ blackstar: STATE_TAG, changed }, null, 2);
  }
  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = el('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove();
      return ok;
    }
  }
  let copyTimer = 0;
  copyBtn.addEventListener('click', async () => {
    const text = buildState();
    const ok = await writeClipboard(text);
    if (!ok) console.log(text);
    copyBtn.textContent = ok ? 'Copied' : 'Clipboard blocked — logged to console';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyBtn.textContent = 'Copy changes'; }, 1800);
  });

  resetBtn.addEventListener('click', () => {
    for (const p of params) setValue(p, p.default);
    syncAll();
    onEdited();
  });


  // ---- keyboard
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox'));
    if (e.key === 'Escape') { if (panelOpen) setUi('closed'); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'd' || e.key === 'D') setUi(document.body.dataset.ui === 'off' ? 'open' : 'off');
    else if (e.key === ' ') { e.preventDefault(); setValue(P_paused, !P_paused.value); syncAll(); onEdited(); }
  });

  onEdited();
  start();
})();
