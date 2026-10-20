// 编排区：全曲导航、时间尺（循环条）、编排轨（结构段落）、问题/标注条、轨道（轨头＋波形/频谱）、播放头叠层与交互。
import { S, on, emit, $, el, clamp, fmt, fmtS, fitCanvas, rgba, xOf, tOf, laneWidth, hdrW, setView, zoomTo, sectionAt, verById,
  trackById, persist, rafThrottle, SEC_COLORS, STATUS_HEX, saveNotes } from './store.js';
import { audio } from './audio.js';
import { diffRegions } from './diff.js';

const peaks = new Map();        // file → Int16Array（min,max 交替）
const imgs = new Map();         // file → HTMLImageElement
import { BASE } from './project.js';

export async function getPeaks(file) {
  if (!file) return null;
  if (peaks.has(file)) return peaks.get(file);
  const p = fetch(BASE + file).then((r) => { if (!r.ok) throw new Error(file + ' ' + r.status); return r.arrayBuffer(); })
    .then((b) => { const a = new Int16Array(b); peaks.set(file, a); return a; })
    .catch((e) => { console.warn('峰值文件读不到', e); peaks.set(file, null); return null; });
  peaks.set(file, p);
  return p;
}
// 已载入就直接给数组，否则开始载入并返回 null（逐帧调用用）
export function peaksNow(file) {
  const a = file ? peaks.get(file) : null;
  if (a instanceof Int16Array) return a;
  if (file && !peaks.has(file)) getPeaks(file);
  return null;
}
export function getImg(file) {
  if (!file) return null;
  if (imgs.has(file)) return imgs.get(file);
  const im = new Image(); im.src = BASE + file; im.onload = () => { redrawLanes(); emit('specload'); };
  imgs.set(file, im);
  return im;
}

// ---------- 波形 / 频谱绘制 ----------
function drawWave(ctx, w, h, arr, color, opt = {}) {
  // 双层：外层＝这一像素里的最大峰值（淡），内层＝各 512 点峰值的平均（亮），缩小看时有层次
  const hopT = S.pj.peaksHop / S.pj.sampleRate, n = arr.length / 2, mid = h / 2, amp = (h / 2 - 3) * (opt.gain || 1);
  const t0 = S.view.t0, pps = S.view.pps;
  const outer = [], inner = [];
  for (let x = 0; x < w; x++) {
    const ia = Math.floor((t0 + x / pps) / hopT), ib = Math.max(ia + 1, Math.floor((t0 + (x + 1) / pps) / hopT));
    if (ib <= 0 || ia >= n) continue;
    let mn = 0, mx = 0, sum = 0, cnt = 0;
    for (let i = Math.max(0, ia); i < Math.min(n, ib); i++) {
      const a = arr[2 * i], b = arr[2 * i + 1];
      if (a < mn) mn = a; if (b > mx) mx = b;
      sum += (b - a) / 2; cnt++;
    }
    if (mx === 0 && mn === 0) continue;
    outer.push(x, mid - (mx / 32767) * amp, mid - (mn / 32767) * amp);
    const r = (cnt ? sum / cnt : 0) / 32767 * amp * 0.92;
    inner.push(x, mid - r, mid + r);
  }
  ctx.fillStyle = opt.outer || color;
  for (let i = 0; i < outer.length; i += 3) ctx.fillRect(outer[i], outer[i + 1], 1, Math.max(1, outer[i + 2] - outer[i + 1]));
  if (opt.inner) {
    ctx.fillStyle = opt.inner;
    for (let i = 0; i < inner.length; i += 3) ctx.fillRect(inner[i], inner[i + 1], 1, Math.max(1, inner[i + 2] - inner[i + 1]));
  }
  ctx.fillStyle = opt.inner || color; ctx.globalAlpha = 0.35; ctx.fillRect(0, Math.round(mid), w, 1); ctx.globalAlpha = 1;
}
export function drawSpec(ctx, w, h, file) {
  const im = getImg(file);
  if (!im || !im.complete || !im.naturalWidth) { ctx.fillStyle = '#0b0d11'; ctx.fillRect(0, 0, w, h); return false; }
  const pps = S.pj.specPxPerSec, sx = S.view.t0 * pps, sw = (w / S.view.pps) * pps;
  ctx.imageSmoothingEnabled = true;
  const dx0 = sx < 0 ? (-sx / pps) * S.view.pps : 0;
  ctx.fillStyle = '#000004'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(im, Math.max(0, sx), 0, Math.max(1, sw - Math.max(0, -sx)), im.naturalHeight, dx0, 0, w - dx0, h);
  return true;
}

// ---------- 轨道区 ----------
const lanesEl = () => $('#lanes');
let rows = [];                   // [{id, kind:'ver'|'trk', cv, rowEl}]

function st(id) { return (S.trk[id] ||= {}); }

export function buildLanes() {
  const L = lanesEl(); L.innerHTML = ''; rows = [];
  L.append(trackRow({ id: '__ver', kind: 'ver' }));
  const groups = [];
  for (const t of S.pj.tracks) { let g = groups.find((x) => x.name === t.group); if (!g) groups.push(g = { name: t.group, items: [] }); g.items.push(t); }
  for (const g of groups) {
    const gs = (S.grp[g.name] ||= {});
    const shown = g.items.filter((t) => !st(t.id).hidden);
    const gh = el('div', { class: 'grp' + (gs.closed ? ' closed' : '') },
      el('div', { class: 'gh', onclick: () => { gs.closed = !gs.closed; persist(); buildLanes(); } }, el('span', { class: 'car' }, '▾'), g.name, el('span', { class: 'muted', style: 'font-weight:400' }, ` ${shown.length}/${g.items.length}`)),
      el('div'));
    L.append(gh);
    if (gs.closed) continue;
    for (const t of shown) L.append(trackRow({ id: t.id, kind: 'trk', t }));
  }
  redrawLanes();
  emit('lanes');
}

function msBtn(id, k, label, title) {
  const b = el('button', { class: 'ms ' + k + (st(id)[k === 'm' ? 'mute' : 'solo'] ? ' on' : ''), title }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const key = k === 'm' ? 'mute' : 'solo';
    if (key === 'solo' && (e.altKey || e.metaKey)) { for (const t of ['__ver', ...S.pj.tracks.map((x) => x.id)]) st(t).solo = false; }
    st(id)[key] = !st(id)[key];
    persist(); audio.sync(); refreshHeaders();
  });
  return b;
}

function trackRow({ id, kind, t }) {
  const isVer = kind === 'ver';
  const s = st(id);
  const h = s.h || (isVer ? 92 : 58);
  const color = isVer ? (S.active === 'A' ? '#e9a94f' : '#5cc8b8') : t.color;
  const vol = el('input', { type: 'range', min: -30, max: 6, step: 0.5, value: s.vol ?? 0, title: '音量（双击归零）' });
  const db = el('span', { class: 'db' }, `${(s.vol ?? 0).toFixed(1)} dB`);
  vol.addEventListener('input', () => { s.vol = +vol.value; db.textContent = `${s.vol.toFixed(1)} dB`; audio.sync(); });
  vol.addEventListener('change', persist);
  vol.addEventListener('dblclick', () => { s.vol = 0; vol.value = 0; db.textContent = '0.0 dB'; audio.sync(); persist(); });
  const hasSpec = isVer ? true : !!t.spec;
  const viewBtn = hasSpec ? el('button', { class: 'ms v' + (s.mode === 'spec' ? ' on' : ''), title: '波形 / 频谱（F）' }, s.mode === 'spec' ? '频谱' : '波形') : null;
  viewBtn?.addEventListener('click', (e) => { e.stopPropagation(); s.mode = s.mode === 'spec' ? 'wave' : 'spec'; persist(); buildLanes(); });
  const name = isVer ? el('span', { class: 'nm' }, '成品 ', el('span', { style: `color:${color}` }, S.active), ' · ', verById(S[S.active])?.label || '—') : el('span', { class: 'nm', title: t.name }, t.name);
  const note = isVer ? (verById(S[S.active])?.note || '') : '';
  const nd = isVer ? diffRegions().length : 0;
  const sub = isVer ? el('div', { class: 'sub', title: note }, nd ? el('span', { class: 'dif' }, `与 ${S.active === 'A' ? 'B' : 'A'} 不同 ${nd} 处`) : null, el('span', { class: 'nt' }, note)) : null;
  const head = el('div', { class: 'th' }, el('span', { class: 'cb', style: `background:${color}` }),
    el('div', { class: 'l1' }, name, viewBtn, msBtn(id, 'm', 'M', '静音'), msBtn(id, 's', 'S', '独奏（⌥ 单击＝只独奏这条）')),
    sub, el('div', { class: 'l2' }, vol, db));
  const lane = el('div', { class: 'tl' });
  const cv = el('canvas'); lane.append(cv);
  const row = el('div', { class: 'trow' + (S.sel.track === id ? ' sel' : ''), style: `height:${h}px`, 'data-id': id }, head, lane);
  head.addEventListener('mousedown', () => selectTrack(id));
  laneMouse(lane, id);
  rows.push({ id, kind, cv, row, t });
  return row;
}

export function selectTrack(id) {
  S.sel.track = id;
  for (const r of rows) r.row.classList.toggle('sel', r.id === id);
  emit('select');
}
function refreshHeaders() { buildLanes(); }

export const redrawLanes = rafThrottle(() => {
  for (const r of rows) drawLane(r);
});
async function drawLane(r) {
  const gen = (r.gen = (r.gen || 0) + 1);
  const s = st(r.id);
  const isVer = r.kind === 'ver';
  const v = isVer ? verById(S[S.active]) : null;
  const file = isVer ? v?.peaks : r.t.peaks;
  const spec = isVer ? v?.spec : r.t.spec;
  const color = isVer ? (S.active === 'A' ? '#e9a94f' : '#5cc8b8') : r.t.color;
  const useSpec = s.mode === 'spec' && spec;
  const a = useSpec ? null : await getPeaks(file);
  if (gen !== r.gen || !r.cv.isConnected) return;     // 等峰值期间又重画过
  const { ctx, w, h } = fitCanvas(r.cv);
  ctx.clearRect(0, 0, w, h);
  // 段落底色
  for (const [i, sec] of (S.pj.sections || []).entries()) {
    const x1 = xOf(sec.t0), x2 = xOf(sec.t1);
    if (x2 < 0 || x1 > w) continue;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.012)' : 'rgba(255,255,255,0.028)';
    ctx.fillRect(x1, 0, x2 - x1, h);
  }
  if (useSpec) { drawSpec(ctx, w, h, spec); }
  else {
    if (a) {
      ctx.fillStyle = rgba(color, 0.06); ctx.fillRect(0, 0, w, h);
      const muted = !audibleNow(r.id);
      drawWave(ctx, w, h, a, null, { outer: rgba(color, muted ? 0.22 : 0.5), inner: rgba(color, muted ? 0.45 : 0.95) });
    }
    if (s.mode === 'spec' && !spec) {
      ctx.font = '11px -apple-system, "PingFang SC", sans-serif'; ctx.textBaseline = 'top';
      const msg = isVer ? '这个版本没有预先算频谱' : '这条轨没有预先算频谱';
      const tw = ctx.measureText(msg).width;
      ctx.fillStyle = 'rgba(10,12,16,0.72)'; ctx.fillRect(6, 5, tw + 12, 18);
      ctx.fillStyle = 'rgba(231,234,240,0.78)'; ctx.fillText(msg, 12, 8);
    }
  }
  // 成品轨：A/B 改动处（顶上一条琥珀色＋淡底）
  if (isVer) {
    for (const d of diffRegions()) {
      const x1 = xOf(d.t0), x2 = xOf(d.t1); if (x2 < 0 || x1 > w) continue;
      ctx.fillStyle = 'rgba(255,196,92,0.10)'; ctx.fillRect(x1, 0, Math.max(2, x2 - x1), h);
      ctx.fillStyle = 'rgba(255,196,92,0.95)'; ctx.fillRect(x1, 0, Math.max(2, x2 - x1), 3);
    }
  }
  // 拼接窗口与问题范围的细框
  if (r.id === 'rem_lead') {
    for (const c of S.pj.comps || []) {
      const x1 = xOf(c.t0), x2 = xOf(c.t1); if (x2 < 0 || x1 > w) continue;
      ctx.strokeStyle = c.id === S.sel.comp ? '#ffffff' : 'rgba(255,207,107,0.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 0.5, 1.5, x2 - x1, h - 3);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, h - 1, w, 1);
}
function audibleNow(id) {
  const anySolo = (S.trk.__ver?.solo) || S.pj.tracks.some((t) => S.trk[t.id]?.solo);
  const s = S.trk[id] || {};
  return anySolo ? !!s.solo : !s.mute;
}

// ---------- 鼠标：轨道区 ----------
function laneMouse(lane, id) {
  lane.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    selectTrack(id);
    const r = lane.getBoundingClientRect(), x0 = e.clientX - r.left, t0 = tOf(x0);
    let dragging = false;
    const mv = (ev) => {
      const x = ev.clientX - r.left;
      if (!dragging && Math.abs(x - x0) > 4) dragging = true;
      if (dragging) { const t1 = tOf(x); S.loop.a = Math.max(0, Math.min(t0, t1)); S.loop.b = Math.min(S.pj.duration, Math.max(t0, t1)); emit('loop'); }
    };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
      if (!dragging) audio.seek(t0); else { persist(); if (S.play.playing && S.loop.on) audio.start(S.loop.a); }
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
  lane.addEventListener('dblclick', (e) => { const r = lane.getBoundingClientRect(); const t = tOf(e.clientX - r.left); const sec = sectionAt(t); if (sec) zoomTo(sec.t0, sec.t1); });
}
export function wheel(e) {
  const host = $('#center').getBoundingClientRect();
  const x = e.clientX - host.left - hdrW();
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const t = tOf(x), f = Math.exp(-e.deltaY * 0.0022);
    const pps = clamp(S.view.pps * f, laneWidth() / (S.pj.duration + 2), 1500); setView(t - x / pps, pps);
  } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    e.preventDefault();
    const d = (e.shiftKey ? e.deltaY : e.deltaX) / S.view.pps;
    setView(S.view.t0 + d);
  }
}

// ---------- 全曲导航 ----------
const ovEnv = { key: '', cv: null };
function overviewEnvelope(v, cw, ch, w, h) {
  const key = `${v?.id}|${S.active}|${cw}x${ch}`;
  if (ovEnv.key === key) return ovEnv.cv;
  const a = peaksNow(v?.peaks);
  if (!a) { if (v?.peaks) getPeaks(v.peaks).then((x) => { if (x) drawOverview(); }); return null; }
  const oc = ovEnv.cv || document.createElement('canvas');
  oc.width = cw; oc.height = ch;
  const o = oc.getContext('2d'); o.setTransform(cw / w, 0, 0, ch / h, 0, 0); o.clearRect(0, 0, w, h);
  const n = a.length / 2, mid = (h - 6) / 2, amp = mid - 2;
  o.fillStyle = rgba(S.active === 'A' ? '#e9a94f' : '#5cc8b8', 0.55);
  for (let x = 0; x < w; x++) {
    const ia = Math.floor((x / w) * n), ib = Math.max(ia + 1, Math.floor(((x + 1) / w) * n));
    let mx = 0; for (let i = ia; i < ib; i++) { const q = Math.max(-a[2 * i], a[2 * i + 1]); if (q > mx) mx = q; }
    const y = (mx / 32767) * amp; o.fillRect(x, mid - y, 1, Math.max(1, 2 * y));
  }
  ovEnv.key = key; ovEnv.cv = oc;
  return oc;
}
export const drawOverview = rafThrottle(() => {
  const cv = $('#overview'); const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const dur = S.pj.duration, sx = (t) => (t / dur) * w;
  const env = overviewEnvelope(verById(S[S.active]), cv.width, cv.height, w, h);
  if (env) ctx.drawImage(env, 0, 0, w, h);
  for (const [i, sec] of (S.pj.sections || []).entries()) { ctx.fillStyle = rgba(SEC_COLORS[i % SEC_COLORS.length], 0.75); ctx.fillRect(sx(sec.t0), h - 4, sx(sec.t1) - sx(sec.t0) - 1, 4); }
  for (const is of S.pj.issues || []) { ctx.fillStyle = STATUS_HEX[issueStatus(is)] || '#888'; ctx.fillRect(sx(is.t0), 0, Math.max(2, sx(is.t1) - sx(is.t0)), 3); }
  ctx.fillStyle = 'rgba(255,196,92,0.95)';
  for (const d of diffRegions()) ctx.fillRect(sx(d.t0), 4, Math.max(2, sx(d.t1) - sx(d.t0)), 3);
  const lw = laneWidth(), a0 = S.view.t0, a1 = S.view.t0 + lw / S.view.pps;
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(sx(a0), 0, sx(a1) - sx(a0), h - 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.strokeRect(sx(a0) + 0.5, 0.5, Math.max(2, sx(a1) - sx(a0) - 1), h - 5);
  const pt = sx(audio.now()); ctx.fillStyle = '#fff'; ctx.fillRect(pt, 0, 1, h);
});
export function overviewMouse() {
  const cv = $('#overview');
  cv.addEventListener('mousedown', (e) => {
    const r = cv.getBoundingClientRect(), dur = S.pj.duration, span = laneWidth() / S.view.pps;
    const tAt = (cx) => ((cx - r.left) / r.width) * dur;
    const t = tAt(e.clientX), inBox = t >= S.view.t0 && t <= S.view.t0 + span;
    const grab = inBox ? t - S.view.t0 : span / 2;
    setView(t - grab);
    const mv = (ev) => setView(tAt(ev.clientX) - grab);
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); persist(); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
  cv.addEventListener('dblclick', () => { import('./store.js').then((m) => m.fitAll()); });
}

// ---------- 时间尺 ----------
function tickStep(pps) { const cands = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]; return cands.find((s) => s * pps >= 70) || 60; }
export const drawRuler = rafThrottle(() => {
  const cv = $('#ruler'); const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f1217'; ctx.fillRect(0, 0, w, h * 0.42);
  const L = S.loop;
  if (L.b > L.a) { ctx.fillStyle = L.on ? 'rgba(229,176,92,0.85)' : 'rgba(255,255,255,0.22)'; ctx.fillRect(xOf(L.a), 2, xOf(L.b) - xOf(L.a), h * 0.42 - 4); }
  const step = tickStep(S.view.pps), t0 = Math.floor(S.view.t0 / step) * step, t1 = S.view.t0 + w / S.view.pps;
  ctx.font = '10.5px "SF Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle';
  for (let t = t0; t <= t1; t += step) {
    const x = Math.round(xOf(t)) + 0.5; if (x < -40) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, h * 0.45, 1, h * 0.55);
    ctx.fillStyle = '#9aa3b2'; ctx.fillText(step < 1 ? fmt(t, step < 0.5 ? 2 : 1) : fmt(t, 0), x + 4, h * 0.72);
    for (let k = 1; k < 4; k++) { const xx = Math.round(xOf(t + (step * k) / 4)) + 0.5; ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(xx, h * 0.82, 1, h * 0.18); }
  }
});
export function rulerMouse() {
  const cv = $('#ruler');
  cv.addEventListener('mousedown', (e) => {
    const r = cv.getBoundingClientRect(), y = e.clientY - r.top, t0 = tOf(e.clientX - r.left);
    if (y < r.height * 0.42) {
      const L = S.loop, inside = L.b > L.a && t0 >= L.a && t0 <= L.b, nearA = Math.abs(xOf(L.a) - (e.clientX - r.left)) < 6, nearB = Math.abs(xOf(L.b) - (e.clientX - r.left)) < 6;
      let mode = nearA ? 'a' : nearB ? 'b' : inside ? 'move' : 'new', moved = false; const a0 = L.a, b0 = L.b;
      const mv = (ev) => {
        const t = clamp(tOf(ev.clientX - r.left), 0, S.pj.duration); moved = true;
        if (mode === 'new') { L.a = Math.min(t0, t); L.b = Math.max(t0, t); }
        else if (mode === 'a') { L.a = Math.min(t, L.b - 0.05); } else if (mode === 'b') { L.b = Math.max(t, L.a + 0.05); }
        else { const d = t - t0; L.a = clamp(a0 + d, 0, S.pj.duration - (b0 - a0)); L.b = L.a + (b0 - a0); }
        emit('loop');
      };
      const up = () => {
        window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
        if (!moved && inside) L.on = !L.on; else if (moved) L.on = true;
        persist(); emit('loop'); if (S.play.playing) audio.start(L.on ? L.a : audio.now());
      };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    } else {
      audio.seek(t0);
      const mv = (ev) => { if (!S.play.playing) { S.play.t = clamp(tOf(ev.clientX - r.left), 0, S.pj.duration); emit('seek'); } };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }
  });
}

// ---------- 编排轨 / 问题条 ----------
export function issueStatus(is) { return S.notes.issues?.[is.id]?.status || is.status; }
export function drawArranger() {
  const host = $('#arranger'); host.innerHTML = '';
  const w = host.clientWidth, cur = sectionAt(audio.now());
  (S.pj.sections || []).forEach((sec, i) => {
    const x1 = xOf(sec.t0), x2 = xOf(sec.t1); if (x2 < 0 || x1 > w) return;
    const d = el('div', { class: 'sec' + (cur === sec ? ' cur' : ''), title: `${sec.name}  ${fmtS(sec.t0)}–${fmtS(sec.t1)}\n单击：循环这一段　双击：放大到这一段　数字键 ${i + 1}`,
      style: `left:${x1 + 1}px;width:${Math.max(4, x2 - x1 - 2)}px;background:${SEC_COLORS[i % SEC_COLORS.length]}` }, x2 - x1 > 40 ? sec.name : '');
    d.addEventListener('click', () => { S.loop.a = sec.t0; S.loop.b = sec.t1; S.loop.on = true; persist(); emit('loop'); audio.seek(sec.t0); });
    d.addEventListener('dblclick', () => zoomTo(sec.t0, sec.t1));
    host.append(d);
  });
}
export function drawIssueLane() {
  // 跨度长（>25% 视野或 >30 秒）的画成底下一条细线；其余按时间排进两行，放不下的挤到细线行；标签按实际宽度决定显不显示
  const host = $('#issuelane'); host.innerHTML = '';
  const w = host.clientWidth, H = host.clientHeight || 34;
  const view = w / S.view.pps;
  const rowsEnd = [-1e9, -1e9];
  const items = (S.pj.issues || []).slice().sort((a, b) => a.t0 - b.t0);
  for (const is of items) {
    const x1 = xOf(is.t0), x2 = xOf(is.t1); if (x2 < 0 || x1 > w) continue;
    const col = STATUS_HEX[issueStatus(is)] || '#999';
    const long = is.t1 - is.t0 > Math.min(30, view * 0.25);
    const label = `${is.title}\n${fmtS(is.t0)}–${fmtS(is.t1)} · ${issueStatus(is)}`;
    let d;
    if (long) {
      d = el('div', { class: 'iss thin' + (S.sel.issue === is.id ? ' sel' : ''), title: label, style: `left:${Math.max(0, x1)}px;width:${Math.max(6, Math.min(w, x2) - Math.max(0, x1))}px;background:${col}` });
    } else {
      const wpx = Math.max(8, x2 - x1);
      const txt = is.title;
      const need = Math.min(220, 14 + txt.length * 11);
      const span = Math.max(wpx, need);
      let row = rowsEnd.findIndex((e) => x1 >= e + 3);
      const showText = row >= 0 && wpx >= 34;
      if (row < 0) row = rowsEnd[0] <= rowsEnd[1] ? 0 : 1;
      rowsEnd[row] = Math.max(rowsEnd[row], x1 + (showText ? span : wpx));
      d = el('div', { class: 'iss' + (S.sel.issue === is.id ? ' sel' : ''), title: label,
        style: `left:${x1}px;top:${2 + row * 13}px;width:${showText ? span : wpx}px;background:${col}` }, showText ? el('span', {}, txt) : '');
      if (showText && span > wpx) d.style.background = `linear-gradient(90deg, ${col} ${wpx}px, ${col}55 ${wpx}px)`;
    }
    d.addEventListener('click', () => emit('pickIssue:' + is.id));
    host.append(d);
  }
  for (const n of S.notes.notes || []) {
    const x = xOf(n.t); if (x < -4 || x > w) continue;
    const p = el('div', { class: 'pin', style: `left:${x}px`, title: `${fmtS(n.t)}  ${n.text}` });
    p.addEventListener('click', () => { audio.seek(n.t); S.insp = 'notes'; emit('insp'); });
    host.append(p);
  }
}

// ---------- 叠层：播放头 / 循环 / 悬停 ----------
export function layoutOverlay() {
  const c = $('#center').getBoundingClientRect(), ru = $('#ruler').getBoundingClientRect(), la = $('#lanes').getBoundingClientRect();
  const ov = $('#overlay');
  ov.style.top = ru.top - c.top + 'px'; ov.style.height = la.bottom - ru.top + 'px';
}
export function updateOverlay() {
  const w = laneWidth(), t = audio.now();
  const ph = $('#playhead'), x = xOf(t);
  ph.style.display = x < 0 || x > w ? 'none' : 'block'; ph.style.left = x + 'px';
  const L = S.loop, ls = $('#loopshade');
  if (L.b > L.a) { ls.hidden = false; ls.className = L.on ? '' : 'off'; ls.style.left = xOf(L.a) + 'px'; ls.style.width = Math.max(1, xOf(L.b) - xOf(L.a)) + 'px'; } else ls.hidden = true;
  // 播放时跟随翻页
  if (S.play.playing && (x > w * 0.92 || x < 0)) setView(t - (w / S.view.pps) * 0.08);
}
export function hoverTrack() {
  const c = $('#center');
  c.addEventListener('mousemove', (e) => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left - hdrW();
    const hv = $('#hover'); if (x < 0) { hv.hidden = true; return; }
    hv.hidden = false; hv.style.left = x + 'px';
    $('#st-view').textContent = `光标 ${fmt(tOf(x))}`;
  });
  c.addEventListener('mouseleave', () => { $('#hover').hidden = true; });
}

on((what) => {
  if (what === 'view' || what === 'lanes') { redrawLanes(); drawOverview(); drawRuler(); drawArranger(); drawIssueLane(); persist(); }
  if (what === 'loop') { drawRuler(); updateOverlay(); $('#st-loop').textContent = S.loop.b > S.loop.a ? `循环 ${fmtS(S.loop.a)}–${fmtS(S.loop.b)}${S.loop.on ? '' : '（关）'}` : ''; }
  if (what === 'ab' || what === 'versions' || what === 'diff') { buildLanes(); drawOverview(); }
  if (what === 'mix') redrawLanes();
  if (what === 'trkui') buildLanes();
  if (what === 'notes' || what.startsWith?.('pickIssue') || what === 'issues') drawIssueLane();
  if (what === 'issues' || what === 'seek') drawOverview();
  if (what === 'select') { redrawLanes(); drawIssueLane(); }
});
