// 底部抽屉：频谱（可上下对照）、音高（原唱 vs 蕾姆）、拼接候选、混音台。时间轴与轨道区对齐（同一套 xOf / tOf）。
import { S, on, emit, $, $$, el, clamp, fmt, fmtS, fitCanvas, rgba, xOf, tOf, zoomTo, sectionAt, verById, trackById, persist,
  rafThrottle, saveNotes, dbToGain } from './store.js';
import { audio } from './audio.js';
import { drawSpec, selectTrack, layoutOverlay, peaksNow } from './view.js';

import { BASE } from './project.js';
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
const noteName = (m) => { const r = Math.round(m); return NOTE[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
const fRange = () => S.pj.specRange || [60, 11000];
const FREQ_TICKS = [[100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const verColor = () => (S.active === 'A' ? '#e9a94f' : '#5cc8b8');
const st = (id) => (S.trk[id] ||= {});

let cur = { tab: null };               // 当前标签页的元素与缓存
const dh = () => $('#dh'), dc = () => $('#dc');

// ---------- 外壳：标签、收起、拖动高度 ----------
export function initDrawer() {
  for (const b of $$('.dtab[data-tab]')) b.addEventListener('click', () => setDrawerTab(b.dataset.tab));
  $('#dt-toggle').addEventListener('click', toggleDrawer);
  const g = $('#drawer-grip');
  g.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!S.drawer.open) { S.drawer.open = true; applyOpen(); }
    const y0 = e.clientY, h0 = S.drawer.h, maxH = Math.max(160, $('#center').clientHeight - 230);
    document.body.style.cursor = 'ns-resize';
    const mv = (ev) => { S.drawer.h = Math.round(clamp(h0 + (y0 - ev.clientY), 120, maxH)); document.documentElement.style.setProperty('--drawer-h', S.drawer.h + 'px'); };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
      document.body.style.cursor = ''; persist(); layoutOverlay(); renderDrawer();
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
  g.addEventListener('dblclick', toggleDrawer);
  g.title = '拖动改高度，双击收起 / 展开';
  on(onEvent);
  applyOpen();
  renderDrawer();
}
function applyOpen() {
  $('#drawer').classList.toggle('closed', !S.drawer.open);
  $('#dt-toggle').textContent = S.drawer.open ? '▾' : '▴';
  for (const b of $$('.dtab[data-tab]')) b.classList.toggle('on', b.dataset.tab === S.drawer.tab);
}
export function setDrawerTab(tab) {
  S.drawer.tab = tab; S.drawer.open = true;
  applyOpen(); persist(); layoutOverlay(); renderDrawer();
}
export function toggleDrawer() {
  S.drawer.open = !S.drawer.open;
  applyOpen(); persist(); layoutOverlay(); renderDrawer();
}

export function renderDrawer() {
  const H = dh(), C = dc(), X = $('#dt-extra');
  const keep = cur.tab === S.drawer.tab ? { comps: $('.comps', C)?.scrollTop, mixer: $('.mixer', C)?.scrollLeft } : {};
  H.innerHTML = ''; C.innerHTML = ''; X.innerHTML = '';
  cur = { tab: S.drawer.tab };
  if (!S.drawer.open) return;
  cur.w = C.clientWidth;
  ({ spec: renderSpec, pitch: renderPitch, comp: renderComp, mixer: renderMixer }[S.drawer.tab] || renderSpec)();
  if (keep.comps != null && $('.comps', C)) $('.comps', C).scrollTop = keep.comps;
  if (keep.mixer != null && $('.mixer', C)) $('.mixer', C).scrollLeft = keep.mixer;
}
const redraw = rafThrottle(() => { if (cur.draw && S.drawer.open) cur.draw(); });
const rerenderComps = rafThrottle(() => { if (cur.tab === 'comp') renderCompList(); });

function onEvent(w) {
  if (!S.drawer.open) return;
  const tab = cur.tab;
  if (tab === 'spec') {
    if (w === 'select' || w === 'ab' || w === 'versions') renderDrawer();           // 看的对象变了：标签、提示都要换
    else if (w === 'view' || w === 'specload') redraw();
  } else if (tab === 'pitch') {
    if (w === 'view') redraw();
  } else if (tab === 'comp') {
    if (['audition', 'notes', 'play', 'versions', 'select'].includes(w) || (w === 'view' && S.drawer.compFilter === 'view')) rerenderComps();
  } else if (tab === 'mixer') {
    if (w === 'lanes' || w === 'ab' || w === 'versions') buildOrSyncMixer();
    else if (w === 'mix' || w === 'trkui' || w === 'select') syncMixer();
  }
}

// 时间对齐的标签页共用：播放头与循环区两个 div
function timeOverlay(C) {
  cur.dloop = el('div', { class: 'dloop', style: 'display:none' });
  cur.dph = el('div', { class: 'dph', style: 'display:none' });
  C.append(cur.dloop, cur.dph);
  cur.px = null; cur.lk = null;
}
function readout(text) { if (cur.rd) cur.rd.textContent = text; }

// ---------- 频谱 ----------
function itemFor(key) {
  if (!key) return null;
  if (key === '__ver') { const v = verById(S[S.active]); return v && { key, name: `成品 ${S.active} · ${v.label}`, spec: v.spec, color: verColor() }; }
  if (key.startsWith('ver:')) { const v = verById(key.slice(4)); return v && { key, name: `版本 ${v.label}`, spec: v.spec, color: '#a7b0c0' }; }
  const t = trackById(key); return t && { key, name: t.name, spec: t.spec, color: t.color };
}
function specList() {
  return [...S.pj.tracks.filter((t) => t.spec).map((t) => t.name), ...S.pj.versions.filter((v) => v.spec).map((v) => '版本 ' + v.label)];
}
function renderSpec() {
  const H = dh(), C = dc(), X = $('#dt-extra');
  const main = itemFor(S.sel.track && S.sel.track !== '__ver' ? S.sel.track : '__ver');
  const ref = itemFor(S.drawer.ref);
  const split = !!(ref && ref.spec);
  cur.main = main; cur.ref = split ? ref : null;
  // 对照选择
  const sel = el('select', { title: '下半部分放哪一条的频谱来对照' },
    el('option', { value: '' }, '不对照'),
    el('optgroup', { label: '轨道' }, S.pj.tracks.filter((t) => t.spec).map((t) => el('option', { value: t.id }, t.name))),
    el('optgroup', { label: '版本' }, S.pj.versions.filter((v) => v.spec).map((v) => el('option', { value: 'ver:' + v.id }, v.label))));
  sel.value = split ? S.drawer.ref : '';
  sel.addEventListener('change', () => { S.drawer.ref = sel.value; persist(); sel.blur(); renderDrawer(); });
  X.append(el('span', { class: 'muted', style: 'font-size:11px;margin-right:6px' }, '下半对照'), sel);
  // 左栏
  const sw = (c) => el('i', { style: `display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${c}` });
  cur.rd = el('div', { class: 'rd' });
  H.append(el('div', { class: 'big' }, '频谱'),
    el('div', {}, sw(main?.color || '#888'), split ? '上：' : '', el('b', {}, main?.name || '—')),
    split && el('div', { style: 'margin-top:3px' }, sw(ref.color), '下：', el('b', {}, ref.name)),
    el('div', { class: 'hint' }, '看的是轨道区选中的那条（选“成品”就是当前 A/B 版本）。单击跳到该时间，纵轴是对数频率 60 Hz–11 kHz。'),
    cur.rd);
  // 画布
  const cv = el('canvas'); C.append(cv); cur.cv = cv;
  if (!main?.spec) {
    const msg = el('div', { class: 'dmsg', style: split ? 'bottom:50%' : '' },
      el('div', {}, `「${main?.name || '—'}」没有预先算频谱。`, el('br'), '只有部分版本和轨道有：', specList().join('、') || '无'));
    C.append(msg);
  }
  timeOverlay(C);
  cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); audio.seek(tOf(e.clientX - r.left)); });
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hh = cur.ref ? r.height / 2 : r.height, half = cur.ref && y > hh ? 1 : 0;
    const [f0, f1] = fRange(), f = f0 * Math.pow(f1 / f0, 1 - (y - half * hh) / hh);
    const it = half ? cur.ref : cur.main;
    readout(`时间  ${fmt(tOf(x))}\n频率  ${f < 1000 ? f.toFixed(0) + ' Hz' : (f / 1000).toFixed(2) + ' kHz'}  ${noteName(midiOf(f))}\n${cur.ref ? (half ? '下  ' : '上  ') : ''}${it?.name || ''}`);
  });
  cv.addEventListener('mouseleave', () => readout(''));
  cur.draw = drawSpecTab;
  drawSpecTab();
}
function drawSpecTab() {
  const { ctx, w, h } = fitCanvas(cur.cv);
  ctx.clearRect(0, 0, w, h);
  const halves = cur.ref ? [[cur.main, 0, Math.floor(h / 2) - 1], [cur.ref, Math.floor(h / 2) + 1, h - Math.floor(h / 2) - 1]] : [[cur.main, 0, h]];
  for (const [it, y0, hh] of halves) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, w, hh); ctx.clip(); ctx.translate(0, y0);
    if (it?.spec) { drawSpec(ctx, w, hh, it.spec); freqAxis(ctx, w, hh); }
    else { ctx.fillStyle = '#0b0d11'; ctx.fillRect(0, 0, w, hh); }
    if (it) tag(ctx, it.name, it.color, 38, 5);
    ctx.restore();
  }
  if (cur.ref) { ctx.fillStyle = '#323a48'; ctx.fillRect(0, Math.floor(h / 2) - 1, w, 2); }
}
function freqAxis(ctx, w, hh) {
  const [f0, f1] = fRange(), L = Math.log(f1 / f0);
  ctx.font = '10px "SF Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle';
  for (const [f, lab] of FREQ_TICKS) {
    if (f <= f0 || f >= f1) continue;
    const y = hh * (1 - Math.log(f / f0) / L);
    ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(30, Math.round(y), w - 30, 1);
    const ty = clamp(y, 7, hh - 7);
    ctx.fillStyle = 'rgba(8,10,14,0.6)'; ctx.fillRect(0, ty - 6, 29, 12);
    ctx.fillStyle = 'rgba(231,234,240,0.82)'; ctx.fillText(lab, 4, ty);
  }
}
function tag(ctx, text, color, x, y) {
  ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = rgba(color, 0.88);
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, tw + 14, 18, 4); else ctx.rect(x, y, tw + 14, 18); ctx.fill();
  ctx.fillStyle = '#0d1016'; ctx.fillText(text, x + 7, y + 9.5);
}

// ---------- 音高 ----------
const pitchCache = new Map();          // file → {hop, f0} | Promise | null
function pitchNow(file) {
  if (!file) return null;
  const v = pitchCache.get(file);
  if (v && !(v instanceof Promise)) return v;
  if (!pitchCache.has(file)) {
    pitchCache.set(file, fetch(BASE + file).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => { pitchCache.set(file, j); if (cur.tab === 'pitch') redraw(); return j; }));
  }
  return null;
}
function pitchPair() {
  const ts = S.pj.tracks.filter((t) => t.pitch);
  const ref = ts.find((t) => /^orig/.test(t.id)) || ts[0];
  const cmp = ts.find((t) => t !== ref && /^rem/.test(t.id)) || ts.find((t) => t !== ref);
  return { ref, cmp };
}
const GOLD = '#d9b36c', PINK = '#e07a8e', TGT = '#aeb6c4';
function renderPitch() {
  const H = dh(), C = dc();
  const { ref, cmp } = pitchPair();
  cur.tgt = S.pj.pitchTarget || null;
  cur.pair = { ref, cmp };
  cur.rd = el('div', { class: 'rd' });
  cur.stat = el('div', { class: 'hint' });
  H.append(el('div', { class: 'big' }, '音高'),
    el('div', { class: 'legend' },
      el('span', {}, el('i', { style: `background:${GOLD};height:4px` }), ref?.name || '（没有原唱音高）'),
      el('span', {}, el('i', { style: `background:${PINK}` }), cmp?.name || '（没有对比音高）'),
      cur.tgt ? el('span', {}, el('i', { style: `background:repeating-linear-gradient(90deg,${TGT} 0 4px,transparent 4px 7px)` }), '换声用的目标音高') : null,
      el('span', {}, el('i', { style: 'background:rgba(227,106,106,.75);height:8px' }), '差一个八度'),
      el('span', {}, el('i', { style: 'background:#e58c3c' }), '稳定长音上偏 1 个半音以上'),
      el('span', {}, el('i', { style: 'background:rgba(229,140,60,.35)' }), '滑音 / 换音处偏（模型会把快速滑音抹圆）')),
    cur.stat, cur.rd,
    el('div', { class: 'hint' }, '原唱嘶喊或高音时基频很弱、第二泛音最强，实测线可能比耳朵听到的低一个八度（例：3:37–3:42）。'));
  const cv = el('canvas'); C.append(cv); cur.cv = cv;
  if (!ref && !cmp) C.append(el('div', { class: 'dmsg' }, '这个工程没有音高数据（pitch/*.json）。'));
  timeOverlay(C);
  cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); audio.seek(tOf(e.clientX - r.left)); });
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const A = pitchNow(ref?.pitch), B = pitchNow(cmp?.pitch), P = A || B;
    if (!P || !cur.range) return;
    const t = tOf(x), i = Math.round(t / P.hop);
    const fa = A?.f0[i] || 0, fb = B?.f0[i] || 0, ft = pitchNow(cur.tgt)?.f0[i] || 0;
    const [lo, hi] = cur.range, mAt = lo - 0.5 + (1 - y / r.height) * (hi - lo + 1);
    const nm = (f) => (f > 0 ? `${noteName(midiOf(f)).padEnd(4)}${f.toFixed(1)} Hz` : '— 无声');
    let diff = '—';
    if (fa > 0 && fb > 0) {
      const c = Math.round(1200 * Math.log2(fb / fa)), oct = Math.abs(Math.abs(c) / 100 - 12) <= 1.5;
      diff = `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)} 音分${oct ? '（差八度）' : Math.abs(c) > 100 ? '（偏）' : ''}`;
    }
    readout(`${fmt(t)} · 光标 ${noteName(mAt)}\n原唱  ${nm(fa)}\n蕾姆  ${nm(fb)}${cur.tgt ? `\n目标  ${nm(ft)}` : ''}\n相差  ${diff}`);
  });
  cv.addEventListener('mouseleave', () => readout(''));
  cur.draw = drawPitchTab;
  drawPitchTab();
}
function drawPitchTab() {
  const { ctx, w, h } = fitCanvas(cur.cv);
  ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, w, h);
  const { ref, cmp } = cur.pair;
  const A = pitchNow(ref?.pitch), B = pitchNow(cmp?.pitch), P = A || B;
  if (!P) {
    if (ref || cmp) { ctx.fillStyle = '#586070'; ctx.font = '12px -apple-system, "PingFang SC", sans-serif'; ctx.fillText('音高数据载入中…', 14, 22); }
    return;
  }
  const hop = P.hop, i0 = Math.max(0, Math.floor(tOf(0) / hop)), i1 = Math.ceil(tOf(w) / hop);
  // 音域：视野内有声帧的最低到最高，上下各留 2 个半音，至少 12 个半音
  // 音域：按半音计帧数，至少 4 帧（40 毫秒）的半音才算，避免一两帧野值把音域拉得很大
  const hist = new Uint32Array(128);
  let nv = 0, lo = Infinity, hi = -Infinity;
  for (const Q of [A, B]) {
    if (!Q) continue;
    const f = Q.f0, n = Math.min(f.length - 1, i1);
    for (let i = i0; i <= n; i++) if (f[i] > 0) { const m = Math.round(midiOf(f[i])); if (m >= 0 && m < 128) { hist[m]++; nv++; } }
  }
  const need = nv < 40 ? 1 : 4;
  for (let m = 0; m < 128; m++) if (hist[m] >= need) { if (m < lo) lo = m; hi = m; }
  if (!isFinite(lo)) { lo = 57; hi = 69; }
  lo = Math.max(12, Math.floor(lo) - 2); hi = Math.min(120, Math.ceil(hi) + 2);
  if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.round(c - 6); hi = lo + 12; }
  cur.range = [lo, hi];
  const span = hi - lo + 1, rowH = h / span;
  const yOf = (m) => h - ((m - lo + 0.5) / span) * h;
  // 琴键行（白键行亮一点、黑键行暗一点，C 行画线标名）
  ctx.fillStyle = '#161b23'; ctx.fillRect(0, 0, w, h);
  ctx.font = `${Math.min(10.5, Math.max(8, rowH - 1))}px "SF Mono", ui-monospace, monospace`; ctx.textBaseline = 'middle';
  for (let m = lo; m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12, yt = yOf(m + 0.5);
    if (BLACK.has(pc)) { ctx.fillStyle = '#0e1116'; ctx.fillRect(0, yt, w, rowH); }
    if (pc === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(0, Math.round(yt + rowH) - 1, w, 1);
      ctx.fillStyle = 'rgba(184,191,204,0.75)'; ctx.fillText(noteName(m), 4, yt + rowH / 2);
    } else if (pc === 5) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(0, Math.round(yt + rowH) - 1, w, 1); }
  }
  // 差异标记（逐像素列合并）
  let nOct = 0, nOff = 0, nSlide = 0, nBoth = 0;
  const W = Math.ceil(w) + 1, octCol = new Uint8Array(W), offCol = new Uint8Array(W), slideCol = new Uint8Array(W);
  if (A && B) {
    const n = Math.min(A.f0.length, B.f0.length) - 1, fA = A.f0;
    const st = (i) => (fA[i] > 0 ? 12 * Math.log2(fA[i] / 440) : NaN);
    for (let i = i0; i <= Math.min(n, i1); i++) {
      const fa = fA[i], fb = B.f0[i];
      if (!(fa > 0 && fb > 0)) continue;
      nBoth++;
      const d = Math.abs(12 * Math.log2(fb / fa));
      let kind = Math.abs(d - 12) <= 1.5 ? 1 : d > 1 ? 2 : 0;
      if (!kind) continue;
      if (kind === 2) {          // 原唱 ±50 ms 内音高变化超过 0.8 个半音＝滑音/换音处
        const c = st(i);
        for (let k = Math.max(0, i - 5); k <= Math.min(n, i + 5); k++) { const q = st(k); if (Math.abs(q - c) > 0.8) { kind = 3; break; } }
      }
      if (kind === 1) nOct++; else if (kind === 2) nOff++; else nSlide++;
      const xa = Math.max(0, Math.floor(xOf(i * hop))), xb = Math.min(W, Math.ceil(xOf((i + 1) * hop)));
      const col = kind === 1 ? octCol : kind === 2 ? offCol : slideCol;
      for (let x = xa; x < Math.max(xa + 1, xb) && x < W; x++) col[x] = 1;
    }
  }
  const runs = (col, fill, y, hh) => {
    ctx.fillStyle = fill; let s = -1;
    for (let x = 0; x <= col.length; x++) {
      if (col[x] && s < 0) s = x; else if (!col[x] && s >= 0) { ctx.fillRect(s, y, x - s, hh); s = -1; }
    }
  };
  runs(octCol, 'rgba(227,106,106,0.15)', 0, h); runs(octCol, 'rgba(227,106,106,0.9)', 0, 3);
  runs(slideCol, 'rgba(229,140,60,0.3)', h - 5, 5);
  runs(offCol, 'rgba(229,140,60,0.95)', h - 5, 5);
  // 曲线（无声处断开）
  const curve = (Q, color, lw, alpha) => {
    if (!Q) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    const f = Q.f0, n = Math.min(f.length - 1, i1);
    let pen = false;
    for (let i = i0; i <= n; i++) {
      if (f[i] > 0) { const x = xOf(i * Q.hop), y = yOf(midiOf(f[i])); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); ctx.lineTo(x + 0.5, y); } pen = true; } else pen = false;
    }
    ctx.stroke(); ctx.restore();
  };
  if (cur.tgt) { ctx.save(); ctx.setLineDash([4, 3]); curve(pitchNow(cur.tgt), TGT, 1, 0.75); ctx.restore(); }
  curve(A, GOLD, 3, 0.8); curve(B, PINK, 1.6, 1);
  const sec = (k) => (k * hop).toFixed(2);
  cur.stat.textContent = A && B
    ? `视野内同时有声 ${sec(nBoth)} 秒\n差八度 ${nOct} 帧\n稳定长音偏 >1 半音 ${nOff} 帧\n滑音 / 换音处偏 >1 半音 ${nSlide} 帧`
    : '只有一条音高，没法对比';
  cur.stat.style.whiteSpace = 'pre-line';
}

// ---------- 拼接候选 ----------
function compsFiltered() {
  const f = S.drawer.compFilter || 'all', a = tOf(0), b = tOf(cur.w || dc().clientWidth);
  return (S.pj.comps || []).filter((c) => (f === 'view' ? c.t1 >= a && c.t0 <= b : f === 'marked' ? !!S.notes.picks[c.id] : true));
}
function renderComp() {
  const H = dh(), C = dc(), X = $('#dt-extra');
  const sel = el('select', { title: '筛选拼接窗口' }, el('option', { value: 'all' }, '全部'), el('option', { value: 'view' }, '视野内'), el('option', { value: 'marked' }, '我标记过的'));
  sel.value = S.drawer.compFilter || 'all';
  sel.addEventListener('change', () => { S.drawer.compFilter = sel.value; persist(); sel.blur(); renderCompList(); });
  X.append(sel);
  cur.count = el('div', { class: 'hint' });
  H.append(el('div', { class: 'big' }, '拼接候选'),
    el('div', { class: 'hint', style: 'margin-top:4px' },
      '▶ 试听：伴奏＋和声垫底，从窗口前约 1 秒放到窗口后 1 秒。', el('br'),
      '☆ 标记你选的那一条，自动保存在当前浏览器。', el('br'),
      '绿框＝某个版本实际用了这条；“八度 / 断”是自动检测到的错帧数。', el('br'),
      '点左边时间：放大到这个窗口。'),
    cur.count);
  C.append(el('div', { class: 'comps' }));
  renderCompList();
}
function renderCompList() {
  const box = $('.comps', dc()); if (!box) return;
  const top = box.scrollTop; box.innerHTML = '';
  const all = S.pj.comps || [], list = compsFiltered(), f = S.drawer.compFilter || 'all';
  const nPick = all.filter((c) => S.notes.picks[c.id]).length;
  if (cur.count) cur.count.textContent = `已标记 ${nPick} / ${all.length} 个窗口`;
  if (!list.length) box.append(el('div', { class: 'empty' }, f === 'view' ? '视野里没有拼接窗口' : f === 'marked' ? '还没有标记过' : '这个工程没有拼接候选'));
  const now = audio.now();
  for (const c of list) {
    const used = {};
    for (const [vid, tid] of Object.entries(c['选用'] || {})) (used[tid] ||= []).push(vid);
    const sec = sectionAt(c.t0);
    const tm = el('div', { class: 'tm', title: '单击：选中、放大到这个窗口，并跳到窗口前 1 秒' },
      `${fmtS(c.t0)}–${fmtS(c.t1)}`,
      el('small', {}, [c.id, sec?.name, trackById(c.track)?.name || c.track].filter(Boolean).join(' · ')),
      c['说明'] && el('small', {}, c['说明']));
    tm.addEventListener('click', () => {
      S.sel.comp = c.id; zoomTo(c.t0 - 1, c.t1 + 1); audio.seek(Math.max(0, c.t0 - 1)); emit('select');
    });
    const cw = el('div', { class: 'cw' + (now >= c.t0 && now <= c.t1 ? ' cur' : '') + (S.sel.comp === c.id ? ' sel' : ''), 'data-id': c.id },
      tm, el('div', { class: 'takes' }, c.takes.map((tk) => takeChip(c, tk, used[tk.id]))));
    box.append(cw);
  }
  cur.curComp = undefined;
  box.scrollTop = top;
}
function takeChip(c, tk, vers) {
  const picked = S.notes.picks[c.id] === tk.id, playing = S.audition?.file === tk.file;
  const oct = tk['八度错帧'], br = tk['断音帧'], show = (v) => (v == null ? '—' : v);
  const bad = oct > 0 || br > 0;
  const pl = el('button', { class: 'pl', title: playing ? '停止试听' : '试听这条候选' }, playing ? '■' : '▶');
  pl.addEventListener('click', (e) => {
    e.stopPropagation(); pl.blur();
    if (playing) { S.audition = null; emit('audition'); audio.pause(); return; }
    audio.audition({ file: tk.file, t0: tk.t0, t1: c.t1 + 1 });
  });
  const star = el('button', { class: 'st' + (picked ? ' on' : ''), title: picked ? '取消标记' : '标记：我选这条' }, picked ? '★' : '☆');
  star.addEventListener('click', (e) => {
    e.stopPropagation(); star.blur();
    if (picked) delete S.notes.picks[c.id]; else S.notes.picks[c.id] = tk.id;
    saveNotes(); emit('notes');
  });
  return el('div', { class: 'take' + (vers ? ' used' : '') + (playing ? ' playing' : ''), title: `${c.id} · ${tk.id}\n文件 ${tk.file}` },
    pl, el('span', {}, tk.id), star,
    el('span', { class: 'bd' + (bad ? ' bad' : ''), title: '自动检测：八度错帧 / 断音帧（— 表示没测）' }, `八度 ${show(oct)} · 断 ${show(br)}`),
    (vers || []).map((v) => el('span', { class: 'vtag', title: `${verById(v)?.label || v} 用的是这条` }, verById(v)?.label || v)));
}

// ---------- 混音台 ----------
function mixerItems() {
  const v = verById(S[S.active]);
  return [{ id: '__ver', name: `成品 ${S.active}`, sub: v?.label || '—', color: verColor() },
    ...S.pj.tracks.filter((t) => !st(t.id).hidden).map((t) => ({ id: t.id, name: t.name, color: t.color }))];
}
const fmtDb = (v) => `${(v ?? 0).toFixed(1)} dB`;
const fmtPan = (p) => { p = p ?? 0; return Math.abs(p) < 0.025 ? '居中' : (p < 0 ? '左 ' : '右 ') + Math.round(Math.abs(p) * 100); };
function audible(id) {
  const anySolo = st('__ver').solo || S.pj.tracks.some((t) => S.trk[t.id]?.solo);
  const s = S.trk[id] || {};
  return !s.hidden && (anySolo ? !!s.solo : !s.mute);
}
function renderMixer() {
  const H = dh(), C = dc();
  H.append(el('div', { class: 'big' }, '混音台'),
    el('div', { class: 'hint', style: 'margin-top:4px' },
      '和轨道区轨头是同一套设置，只影响这里的试听，不改任何文件。', el('br'),
      'M 静音 · S 独奏（⌥ 单击＝只独奏这一条）', el('br'),
      '双击推子归零，双击声像回到中间。', el('br'),
      '电平条按各轨峰值文件估算（推子之后）。'));
  const items = mixerItems();
  const box = el('div', { class: 'mixer' }, items.map(strip));
  C.append(box);
  cur.mixKey = items.map((i) => i.id + ':' + i.name + ':' + (i.sub || '')).join('|');
  cur.strips = $$('.strip', box).map((n) => ({ id: n.dataset.id, n, bar: $('.lvl i', n), lvl: 0, w: '' }));
  syncMixer();
}
function buildOrSyncMixer() {
  const key = mixerItems().map((i) => i.id + ':' + i.name + ':' + (i.sub || '')).join('|');
  if (key !== cur.mixKey) renderDrawer(); else syncMixer();
}
function strip(it) {
  const id = it.id, s = st(id);
  const changed = () => { persist(); audio.sync(); emit('trkui'); };
  const m = el('button', { class: 'ms m', title: '静音' }, 'M');
  const so = el('button', { class: 'ms s', title: '独奏（⌥ 单击＝只独奏这一条）' }, 'S');
  m.addEventListener('click', () => { m.blur(); s.mute = !s.mute; changed(); });
  so.addEventListener('click', (e) => {
    so.blur();
    if (e.altKey || e.metaKey) { for (const k of ['__ver', ...S.pj.tracks.map((t) => t.id)]) st(k).solo = false; s.solo = true; } else s.solo = !s.solo;
    changed();
  });
  const fader = el('input', { type: 'range', class: 'fader', min: -30, max: 6, step: 0.5, value: s.vol ?? 0, title: '音量（双击归零）' });
  const db = el('div', { class: 'db' }, fmtDb(s.vol));
  fader.addEventListener('input', () => { s.vol = +fader.value; db.textContent = fmtDb(s.vol); audio.sync(); });
  fader.addEventListener('change', () => { fader.blur(); persist(); emit('trkui'); });
  fader.addEventListener('dblclick', () => { s.vol = 0; fader.value = 0; db.textContent = fmtDb(0); fader.blur(); changed(); });
  const pan = el('input', { type: 'range', class: 'pan', min: -1, max: 1, step: 0.05, value: s.pan ?? 0, title: '声像（双击回到中间）' });
  const pv = el('div', { class: 'db' }, fmtPan(s.pan));
  pan.addEventListener('input', () => { s.pan = +pan.value; pv.textContent = fmtPan(s.pan); audio.sync(); });
  pan.addEventListener('change', () => { pan.blur(); persist(); emit('trkui'); });
  pan.addEventListener('dblclick', () => { s.pan = 0; pan.value = 0; pv.textContent = fmtPan(0); pan.blur(); changed(); });
  const n = el('div', { class: 'strip', 'data-id': id, title: it.name + (it.sub ? ' · ' + it.sub : '') },
    el('div', { class: 'cb', style: `background:${it.color}` }),
    el('div', { class: 'nm' }, it.name, it.sub && el('br'), it.sub),
    el('div', { class: 'row2' }, m, so),
    el('div', { class: 'lvl' }, el('i')),
    fader, db, pan, pv);
  n.addEventListener('mousedown', () => { if (S.sel.track !== id) selectTrack(id); });
  return n;
}
function syncMixer() {
  for (const n of $$('.mixer .strip', dc())) {
    const id = n.dataset.id, s = S.trk[id] || {};
    n.classList.toggle('sel', S.sel.track === id || (id === '__ver' && !S.sel.track));
    n.classList.toggle('dim', !audible(id));
    $('.ms.m', n).classList.toggle('on', !!s.mute);
    $('.ms.s', n).classList.toggle('on', !!s.solo);
    const [db, pv] = $$('.db', n), f = $('.fader', n), p = $('.pan', n);
    if (document.activeElement !== f) { f.value = s.vol ?? 0; db.textContent = fmtDb(s.vol); }
    if (document.activeElement !== p) { p.value = s.pan ?? 0; pv.textContent = fmtPan(s.pan); }
  }
}
// 各轨电平：取当前时刻附近的峰值（约 60 毫秒窗口）乘推子增益
function peakAt(arr, t) {
  const hopT = S.pj.peaksHop / S.pj.sampleRate, i = Math.floor(t / hopT), n = arr.length / 2;
  let m = 0;
  for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) { const q = Math.max(-arr[2 * k], arr[2 * k + 1]); if (q > m) m = q; }
  return m / 32767;
}
function meterStrips() {
  const t = audio.now(), live = S.play.playing && !S.audition;
  for (const sp of cur.strips || []) {
    let v = 0;
    if (live && audible(sp.id)) {
      const file = sp.id === '__ver' ? verById(S[S.active])?.peaks : trackById(sp.id)?.peaks;
      const a = peaksNow(file);
      if (a) v = peakAt(a, t) * dbToGain(S.trk[sp.id]?.vol ?? 0);
    }
    sp.lvl = Math.max(v, sp.lvl * 0.88);
    const w = sp.lvl < 1e-4 ? '0%' : (clamp((20 * Math.log10(sp.lvl) + 48) / 48, 0, 1) * 100).toFixed(1) + '%';
    if (w !== sp.w) { sp.w = w; sp.bar.style.width = w; }
  }
}

// ---------- 逐帧：播放头、循环区、当前拼接窗口、混音台电平 ----------
export function drawDrawerPlayhead() {
  if (!S.drawer.open || !cur.tab) return;
  if (cur.dph) {
    const x = xOf(audio.now()), vis = x >= 0 && x <= cur.w, px = vis ? Math.round(x) : -1;
    if (px !== cur.px) { cur.px = px; cur.dph.style.display = vis ? '' : 'none'; if (vis) cur.dph.style.left = px + 'px'; }
    const L = S.loop, has = L.b - L.a > 0.01;
    const xa = has ? Math.round(xOf(L.a)) : 0, xb = has ? Math.round(xOf(L.b)) : 0;
    const lk = has && xb >= 0 && xa <= cur.w ? `${xa}|${xb}|${L.on}` : '';
    if (lk !== cur.lk) {
      cur.lk = lk;
      if (!lk) cur.dloop.style.display = 'none';
      else Object.assign(cur.dloop.style, { display: '', left: xa + 'px', width: Math.max(1, xb - xa) + 'px', opacity: L.on ? '1' : '0.4' });
    }
  } else if (cur.tab === 'comp') {
    const t = audio.now(), c = (S.pj.comps || []).find((k) => t >= k.t0 && t <= k.t1), id = c ? c.id : null;
    if (id !== cur.curComp) { cur.curComp = id; for (const n of $$('.cw', dc())) n.classList.toggle('cur', n.dataset.id === id); }
  } else if (cur.tab === 'mixer') meterStrips();
}
