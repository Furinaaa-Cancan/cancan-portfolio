// 原版 DAW 全局状态与工具。公开嵌入版的个人标注仅保存在当前浏览器。
export const S = {
  pj: null,                         // project.json
  view: { t0: 0, pps: 5 },          // 视野起点（秒）与每秒像素
  play: { t: 0, playing: false, from: 0 },
  loop: { on: false, a: 0, b: 0 },
  A: null, B: null, active: 'B',
  trk: {},                          // id → {mute, solo, vol, pan, hidden, mode:'wave'|'spec', h}
  grp: {},                          // 组名 → {closed}
  sel: { track: null, issue: null, comp: null },
  drawer: { tab: 'spec', h: 270, open: true, ref: 'orig' },
  insp: 'issues', issueFilter: 'all', hideVoid: true,
  notes: { notes: [], picks: {}, issues: {} },
  audition: null,
};

const subs = new Set();
export const on = (f) => subs.add(f);
export function emit(what) { for (const f of subs) { try { f(what); } catch (e) { console.error(e); } } }

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function fmt(t, digits = 3) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0')}`;
}
export const fmtS = (t) => fmt(t, 1);
export const dbToGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function rafThrottle(fn) {
  let p = false;
  return () => { if (!p) { p = true; requestAnimationFrame(() => { p = false; fn(); }); } };
}
export const SEC_COLORS = ['#8fa3c7', '#e0a26a', '#d58aa6', '#e9c46a', '#7fb6d6', '#c6a0e0', '#e88f7c', '#8fcf9f', '#f0b45c', '#a7b0c0'];
export const STATUS = { '已修': 'var(--ok)', '已修待确认': 'var(--info)', '待试听': 'var(--info)', '待定': 'var(--warn)', '未修': 'var(--bad)' };
export const STATUS_HEX = { '已修': '#6cc58a', '已修待确认': '#6fa8ff', '待试听': '#6fa8ff', '待定': '#e5b05c', '未修': '#e36a6a' };

// 坐标
export const xOf = (t) => (t - S.view.t0) * S.view.pps;
export const tOf = (x) => S.view.t0 + x / S.view.pps;
export function laneWidth() { const l = document.getElementById('lanes'); return Math.max(1, (l?.clientWidth || 800) - hdrW()); }
export function hdrW() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-w')) || 216; }
export function setView(t0, pps) {
  const dur = S.pj.duration, w = laneWidth();
  pps = clamp(pps ?? S.view.pps, w / (dur + 2), 1500);
  t0 = clamp(t0 ?? S.view.t0, -0.5, Math.max(-0.5, dur + 0.5 - w / pps));
  S.view.t0 = t0; S.view.pps = pps;
  emit('view');
}
export function fitAll() { const w = laneWidth(); setView(-0.2, w / (S.pj.duration + 0.4)); }
export function zoomTo(a, b, pad = 0.08) { const w = laneWidth(), span = Math.max(0.2, b - a); const pps = w / (span * (1 + 2 * pad)); setView(a - span * pad, pps); }
export function sectionAt(t) { return (S.pj.sections || []).find((s) => t >= s.t0 && t < s.t1); }
export const verById = (id) => S.pj.versions.find((v) => v.id === id);
export const trackById = (id) => S.pj.tracks.find((t) => t.id === id);

// 偏好
const key = () => 'daw:' + (S.pj?.title || 'x');
export function persist() {
  try {
    localStorage.setItem(key(), JSON.stringify({ view: S.view, A: S.A, B: S.B, active: S.active, trk: S.trk, grp: S.grp, drawer: S.drawer,
      loop: S.loop, insp: S.insp, hideVoid: S.hideVoid, t: S.play.t }));
  } catch (e) { /* 隐私模式等 */ }
}
export function restore() {             // 有存档返回 true（首次打开返回 false）
  try {
    const o = JSON.parse(localStorage.getItem(key()) || 'null');
    if (!o) return false;
    Object.assign(S.view, o.view || {}); S.A = o.A ?? S.A; S.B = o.B ?? S.B; S.active = o.active || S.active;
    Object.assign(S.trk, o.trk || {}); Object.assign(S.grp, o.grp || {}); Object.assign(S.drawer, o.drawer || {});
    Object.assign(S.loop, o.loop || {}); S.insp = o.insp || S.insp; S.hideVoid = o.hideVoid ?? S.hideVoid; S.play.t = o.t || 0;
    if (!verById(S.A)) S.A = S.pj.versionA; if (!verById(S.B)) S.B = S.pj.versionB;
    return true;
  } catch (e) { return false; /* 忽略坏数据 */ }
}

// 公开网页没有写回原工程的接口。每位访客的标注、候选与问题状态单独存于浏览器。
const notesKey = () => 'daw:public-notes:' + (S.pj?.title || 'x');
export async function loadNotes() {
  try { S.notes = JSON.parse(localStorage.getItem(notesKey()) || 'null') || {}; }
  catch (e) { S.notes = {}; }
  S.notes.notes ||= []; S.notes.picks ||= {}; S.notes.issues ||= {};
}
let saveTimer = null;
export function saveNotes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(notesKey(), JSON.stringify(S.notes));
      emit('saved:当前浏览器');
    } catch (e) { emit('savefail'); }
  }, 250);
}
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 1800);
}
