#!/usr/bin/env node
// Consistency check for params.js ↔ shader.js (GLSL passes + perFrame). Run: node scripts/check.js
// Exits non-zero on errors; prints warnings for unused params.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'params.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'shader.js'), 'utf8'), ctx);

const schema = ctx.window.BLACKSTAR_PARAMS;
const S = ctx.window.BLACKSTAR_SHADER;
const frag = [S.common, S.angular, S.fields, S.composite].join('\n');
const perFrameSrc = fs.readFileSync(path.join(root, 'shader.js'), 'utf8'); // perFrame() and its CPU helpers
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const BUILTINS = new Set(['u_res', 'u_screen', 'u_time', 'u_realTime', 'u_angular', 'u_fields0', 'u_fields1']);
const frameNames = new Set(Object.keys(S.frameUniforms));

const errors = [];
const warnings = [];
const keys = new Set();

for (const group of schema) {
  if (!group.group || !Array.isArray(group.params)) errors.push('Malformed group: ' + JSON.stringify(group).slice(0, 80));
  for (const p of group.params) {
    const where = `${group.group}/${p.key}`;
    const type = p.type || 'range';
    if (!/^[a-z][A-Za-z0-9]*$/.test(p.key || '')) errors.push(`${where}: key must be camelCase`);
    if (keys.has(p.key)) errors.push(`${where}: duplicate key`);
    keys.add(p.key);
    if (!p.label) errors.push(`${where}: missing label`);
    if (!p.desc) warnings.push(`${where}: missing desc (tooltip)`);
    if (type === 'range') {
      for (const f of ['min', 'max', 'step']) if (typeof p[f] !== 'number') errors.push(`${where}: missing ${f}`);
      if (typeof p.value !== 'number') errors.push(`${where}: value must be a number`);
      else if (p.value < p.min || p.value > p.max) errors.push(`${where}: default ${p.value} outside [${p.min}, ${p.max}]`);
    } else if (type === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(p.value)) errors.push(`${where}: color must be #rrggbb`);
    } else if (type === 'bool') {
      if (typeof p.value !== 'boolean') errors.push(`${where}: value must be boolean`);
    } else {
      errors.push(`${where}: unknown type "${type}"`);
    }
    if (p.uniform === false) {
      if (!appSrc.includes(`byKey.${p.key}`) && !new RegExp(`\\bP\\.${p.key}\\b`).test(perFrameSrc)) {
        warnings.push(`${where}: CPU-only param not used by app.js (byKey.${p.key}) or perFrame() (P.${p.key})`);
      }
      if (new RegExp(`\\bu_${p.key}\\b`).test(frag)) errors.push(`${where}: has uniform: false but the shader uses u_${p.key}`);
    } else if (!new RegExp(`\\bu_${p.key}\\b`).test(frag)) {
      warnings.push(`${where}: u_${p.key} is never used in the shader`);
    }
  }
}

for (const m of new Set(frag.match(/\bu_[A-Za-z0-9]+\b/g) || [])) {
  if (!BUILTINS.has(m) && !keys.has(m.slice(2))) errors.push(`shader uses ${m} but no param "${m.slice(2)}" exists`);
}
for (const m of new Set(frag.match(/\bf_[A-Za-z0-9]+\b/g) || [])) {
  if (!frameNames.has(m)) errors.push(`shader uses ${m} but it is not in frameUniforms`);
}
for (const n of frameNames) {
  if (!new RegExp(`\\bf\\.${n}\\b`).test(perFrameSrc)) errors.push(`frameUniforms.${n} is never written by perFrame()`);
}

for (const w of warnings) console.log('warn  ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(`${keys.size} params · ${errors.length} errors · ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
