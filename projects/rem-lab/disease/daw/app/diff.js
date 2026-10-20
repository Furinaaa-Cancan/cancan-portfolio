// 版本改动处：每个版本有一份指纹（每 50 ms 16 个频带的能量，int8 dB），A 和 B 相减，哪个频带差超过阈值就算改过。
// 合并成段（间隔 <0.3 秒合并、短于 0.1 秒丢掉），给编排区画标记、给 ] / [ 跳转用。
import { S, emit, verById } from './store.js';

import { BASE } from './project.js';
const fps = new Map();          // file → Int8Array | Promise | null
const TH_DB = 2.0;              // 某频带差超过这么多 dB 才算改过（母带响度归一会让整首差零点几 dB）
const QUIET_DB = -55;           // 两边都很轻的帧不算
let cur = { key: '', regions: [], pending: null };

function load(file) {
  if (!file) return Promise.resolve(null);
  const v = fps.get(file);
  if (v instanceof Int8Array || v === null) return Promise.resolve(v);
  if (v) return v;
  const p = fetch(BASE + file).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Int8Array(b) : null)).catch(() => null)
    .then((a) => { fps.set(file, a); return a; });
  fps.set(file, p);
  return p;
}

function compute(a, b) {
  const nb = S.pj.fpBands || 16, hop = S.pj.fpHop || 0.05;
  const n = Math.min(a.length, b.length) / nb;
  // 两个版本整体响度可能差一点：先求整首每个频带的中位差，扣掉
  const off = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    const d = [];
    for (let i = 0; i < n; i += 4) { const x = a[i * nb + k], y = b[i * nb + k]; if (x > QUIET_DB || y > QUIET_DB) d.push(y - x); }
    d.sort((p, q) => p - q); off[k] = d.length ? d[d.length >> 1] : 0;
  }
  const flag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let mx = 0;
    for (let k = 0; k < nb; k++) {
      const x = a[i * nb + k], y = b[i * nb + k];
      if (x <= QUIET_DB && y <= QUIET_DB) continue;
      const d = Math.abs(y - x - off[k]);
      if (d > mx) mx = d;
    }
    flag[i] = mx;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (flag[i] < TH_DB) continue;
    const t = i * hop;
    const last = out[out.length - 1];
    if (last && t - last.t1 < 0.3) { last.t1 = t + hop; last.max = Math.max(last.max, flag[i]); }
    else out.push({ t0: t, t1: t + hop, max: flag[i] });
  }
  return out.filter((r) => r.t1 - r.t0 >= 0.1);
}

// A/B 变了就重算（异步，算完 emit('diff')）
export function refreshDiff() {
  const va = verById(S.A), vb = verById(S.B);
  const key = `${va?.id}|${vb?.id}`;
  if (key === cur.key) return;
  cur = { key, regions: [], pending: key };
  if (!va?.fp || !vb?.fp || va.id === vb.id) { cur.pending = null; emit('diff'); return; }
  Promise.all([load(va.fp), load(vb.fp)]).then(([a, b]) => {
    if (cur.key !== key) return;
    cur.regions = a && b ? compute(a, b) : [];
    cur.pending = null;
    emit('diff');
  });
}
export const diffRegions = () => cur.regions;
export const diffPending = () => !!cur.pending;

// 从 t 往后（dir=1）或往前（dir=-1）找下一处改动
export function nextDiff(t, dir) {
  const rs = cur.regions;
  if (!rs.length) return null;
  if (dir > 0) return rs.find((r) => r.t0 > t + 0.05) || null;
  for (let i = rs.length - 1; i >= 0; i--) if (rs[i].t0 < t - 0.6) return rs[i];
  return null;
}
