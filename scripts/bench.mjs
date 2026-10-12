#!/usr/bin/env node
// Frame-rate benchmark on the real GPU via headless Chrome (vsync off). Node ≥ 22, no deps.
//
//   python3 -m http.server 8765 --bind 127.0.0.1   # in another shell
//   node scripts/bench.mjs [--size 2560x1440] [--dpr 2] [--fixed] [--swiftshader] [--shot out.png]
//
// --fixed       turn adaptive quality off, so the number is raw throughput at full resolution
// --swiftshader CPU renderer: a stand-in for a very weak GPU (use with adaptive on)

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);
const url = opt('--url', 'http://127.0.0.1:8765/');
const [W, H] = opt('--size', '1440x900').split('x').map(Number);
const dpr = opt('--dpr', '1');
const shot = opt('--shot', null);

const profile = mkdtempSync(join(tmpdir(), 'blackstar-bench-'));
const port = 9300 + Math.floor(Math.random() * 600);
const flags = [
  '--headless=new', `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, `--force-device-scale-factor=${dpr}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist',
];
if (has('--swiftshader')) flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', flags, { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
setTimeout(() => { console.error('timed out'); done(1); }, 240000);

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.enable');
await send('Page.navigate', { url });
await sleep(1500);
await evaluate(`document.getElementById('cog').click()`); // panel open → fps readout updates
if (has('--fixed')) await evaluate(`(() => { const b = document.getElementById('p-adaptive'); b.checked = false; b.dispatchEvent(new Event('change')); })()`);
await sleep(has('--swiftshader') ? 10000 : 2500); // let adaptive quality settle

const result = await evaluate(`new Promise((res) => {
  let n = 0; const s = performance.now();
  const tick = () => { n++; if (performance.now() - s < 4000) requestAnimationFrame(tick); else {
    const c = document.getElementById('stage'), gl = c.getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info');
    const err = document.getElementById('error');
    res({ fps: +(n / ((performance.now() - s) / 1000)).toFixed(1), canvas: c.width + 'x' + c.height,
          readout: document.getElementById('fps').textContent, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?',
          error: err.hidden ? null : err.textContent });
  } };
  requestAnimationFrame(tick);
})`);
console.log(JSON.stringify(result));
if (shot) {
  await evaluate(`document.getElementById('close').click()`);
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
}
done(result?.error ? 1 : 0);
