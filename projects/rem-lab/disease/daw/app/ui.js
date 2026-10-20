// 命令面板（⌘K）、快捷键表（?）与全局键盘。
import { S, emit, $, $$, el, clamp, fmtS, persist, fitAll, zoomTo, setView, laneWidth, sectionAt, trackById, xOf, tOf, toast } from './store.js';
import { audio } from './audio.js';
import { buildLanes, selectTrack, issueStatus } from './view.js';
import { toggleDrawer, setDrawerTab } from './drawer.js';
import { focusNoteInput, setVersion } from './side.js';
import { nextDiff, diffRegions, diffPending } from './diff.js';

// ---------- 走带与视野的小动作（键盘、面板、按钮共用） ----------
export function toggleLoop() {
  const L = S.loop;
  if (!(L.b - L.a > 0.05)) {
    const sec = sectionAt(audio.now());
    if (!sec) { toast('还没有循环区：在时间尺上半拖一段'); return; }
    L.a = sec.t0; L.b = sec.t1;
  }
  L.on = !L.on; persist(); emit('loop');
  toast(L.on ? `循环 ${fmtS(L.a)}–${fmtS(L.b)}` : '循环关');
  if (S.play.playing && !S.audition) { const t = audio.now(); audio.start(L.on && (t < L.a || t >= L.b) ? L.a : t); }
}
function setLoopPoint(k) {
  const t = audio.now(), L = S.loop, dur = S.pj.duration;
  if (k === 'a') { L.a = t; if (L.b <= L.a + 0.05) L.b = Math.min(dur, L.a + 4); }
  else { L.b = t; if (L.a >= L.b - 0.05) L.a = Math.max(0, L.b - 4); }
  persist(); emit('loop'); toast(`循环区 ${fmtS(L.a)}–${fmtS(L.b)}${L.on ? '' : '（循环没开，按 L 打开）'}`);
  if (S.play.playing && L.on && !S.audition) audio.start(audio.now());
}
function swapAB() { audio.setActive(S.active === 'A' ? 'B' : 'A'); }
function zoomLoop() {
  const L = S.loop;
  if (L.b - L.a > 0.05) zoomTo(L.a, L.b);
  else { const sec = sectionAt(audio.now()); if (sec) zoomTo(sec.t0, sec.t1); }
}
function gotoSection(i, loopOn) {
  const sec = (S.pj.sections || [])[i]; if (!sec) return;
  S.loop.a = sec.t0; S.loop.b = sec.t1; if (loopOn) S.loop.on = true;
  persist(); emit('loop'); audio.seek(sec.t0);
  const w = laneWidth(), a = S.view.t0, b = a + w / S.view.pps;
  if (sec.t0 < a || sec.t0 > b) setView(sec.t0 - (b - a) * 0.05);
}
function zoomBy(f) {
  const w = laneWidth();
  let t = audio.now(), x = xOf(t);
  if (x < 0 || x > w) { x = w / 2; t = tOf(x); }
  const pps = clamp(S.view.pps * f, w / (S.pj.duration + 2), 1500);
  setView(t - x / pps, pps);
}
// 下一处 / 上一处 A/B 改动：跳到改动前 0.4 秒；看不到就把视野移过去
export function stepDiff(dir) {
  if (diffPending()) { toast('还在比对 A/B…'); return; }
  if (!diffRegions().length) { toast(S.A === S.B ? 'A 和 B 是同一个版本' : 'A 和 B 没有找到明显不同的地方'); return; }
  const r = nextDiff(audio.now() + (dir > 0 ? 0.45 : 0), dir);      // 跳过去时停在改动前 0.4 秒，往后找要跳过这一段
  if (!r) { toast(dir > 0 ? '后面没有改动处了' : '前面没有改动处了'); return; }
  const t = Math.max(0, r.t0 - 0.4);
  const w = laneWidth(), a = S.view.t0, b = a + w / S.view.pps;
  if (t < a || r.t1 > b) setView(t - (w / S.view.pps) * 0.15);
  audio.seek(t);
  toast(`改动处 ${fmtS(r.t0)}–${fmtS(r.t1)}（最多差 ${r.max.toFixed(0)} dB）`);
}
function stepIssue(dir) {
  const list = [...(S.pj.issues || [])].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  if (!list.length) return;
  const now = audio.now(), si = list.findIndex((x) => x.id === S.sel.issue);
  let j;
  if (si >= 0 && now >= list[si].t0 - 0.6 && now <= Math.max(list[si].t1, list[si].t0 + 2)) j = si + dir;
  else if (dir > 0) j = list.findIndex((x) => x.t0 > now + 0.01);
  else { j = -1; list.forEach((x, k) => { if (x.t0 < now - 0.01) j = k; }); }
  if (j < 0 || j >= list.length) { toast(dir > 0 ? '后面没有问题了' : '前面没有问题了'); return; }
  pickIssue(list[j]);
}
function pickIssue(is) {
  emit('pickIssue:' + is.id);              // 检查器：选中、跳过去、显示卡片
  const w = laneWidth(), a = S.view.t0, b = a + w / S.view.pps;
  if (is.t0 < a || is.t0 > b * 0.98 + a * 0.02) {
    if (is.t1 - is.t0 < (b - a) * 0.7) setView(is.t0 - (b - a) * 0.15); else zoomTo(is.t0, is.t1);
  }
}
function selId() { return S.sel.track || null; }
function toggleFlag(key) {
  const id = selId();
  if (!id) { toast('先在轨道区点一下要操作的轨'); return; }
  const s = (S.trk[id] ||= {}); s[key] = !s[key];
  persist(); audio.sync(); emit('trkui');
  const name = id === '__ver' ? '成品' : trackById(id)?.name || id;
  toast(`${name}：${key === 'solo' ? (s.solo ? '独奏' : '取消独奏') : s.mute ? '静音' : '取消静音'}`);
}
function toggleMode() {
  const id = selId();
  if (!id) { toast('先在轨道区点一下要切换的轨'); return; }
  if (id !== '__ver' && !trackById(id)?.spec) { toast('这条轨没有预先算频谱'); return; }
  const s = (S.trk[id] ||= {}); s.mode = s.mode === 'spec' ? 'wave' : 'spec';
  persist(); buildLanes();
}
function stepTrack(d) {
  const rows = $$('#lanes .trow'), ids = rows.map((r) => r.dataset.id);
  if (!ids.length) return;
  let i = ids.indexOf(S.sel.track);
  i = i < 0 ? (d > 0 ? 0 : ids.length - 1) : clamp(i + d, 0, ids.length - 1);
  selectTrack(ids[i]);
  rows[i].scrollIntoView({ block: 'nearest' });
}
function stopAudition() { if (S.audition) { S.audition = null; emit('audition'); audio.pause(); } }

// ---------- 命令面板 ----------
let items = [], shown = [], idx = 0;
const palOpen = () => !$('#pal-bg').hidden;
function commands() {
  const C = [], add = (gp, ttl, run, sub = '', k = '') => C.push({ gp, ttl, run, sub, k });
  add('命令', '播放 / 暂停', () => audio.toggle(), '', '空格');
  add('命令', '停止', () => audio.stop(), '回到播放起点；再按回到开头');
  add('命令', '循环开关', toggleLoop, S.loop.b > S.loop.a ? `${fmtS(S.loop.a)}–${fmtS(S.loop.b)}` : '没有循环区就用当前段', 'L');
  add('命令', 'A/B 切换', swapAB, `现在听的是 ${S.active}`, 'V');
  add('命令', '下一处 A/B 改动', () => stepDiff(1), `${diffRegions().length} 处`, ']');
  add('命令', '上一处 A/B 改动', () => stepDiff(-1), '', '[');
  add('命令', '看全曲', fitAll, '', '0');
  add('命令', '放大到循环区', zoomLoop, '没有循环区就放大到当前段', 'Z');
  add('命令', S.drawer.open ? '抽屉收起' : '抽屉展开', toggleDrawer, '底部编辑抽屉', 'D');
  for (const [k, n] of [['spec', '频谱'], ['pitch', '音高'], ['comp', '拼接'], ['mixer', '混音台']]) add('命令', `打开 ${n}`, () => setDrawerTab(k), '底部抽屉');
  add('命令', '添加标注', focusNoteInput, '记在当前播放位置', 'Enter');
  add('命令', '快捷键', openHelp, '', '?');
  (S.pj.sections || []).forEach((s, i) => add('段落', s.name, () => gotoSection(i, true), `${fmtS(s.t0)}–${fmtS(s.t1)} · 跳到并循环`, i < 9 ? String(i + 1) : ''));
  for (const is of [...(S.pj.issues || [])].sort((a, b) => a.t0 - b.t0)) add('问题', is.title, () => pickIssue(is), `${fmtS(is.t0)} · ${issueStatus(is)}`);
  for (const v of S.pj.versions) {
    const tag = v.status === 'void' ? '（作废）' : v.status === 'old' ? '（旧）' : '';
    add('版本', `设为 A：${v.label}${tag}`, () => setVersion('A', v.id), v.note || '');
    add('版本', `设为 B：${v.label}${tag}`, () => setVersion('B', v.id), v.note || '');
  }
  for (const t of S.pj.tracks) {
    const s = S.trk[t.id] || {};
    add('轨道', `选中：${t.name}`, () => { selectTrack(t.id); $(`#lanes .trow[data-id="${CSS.escape(t.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }, t.group);
    add('轨道', `独奏：${t.name}`, () => { selectTrack(t.id); toggleFlag('solo'); }, s.solo ? '现在：独奏中（再选一次取消）' : t.group);
    add('轨道', `静音：${t.name}`, () => { selectTrack(t.id); toggleFlag('mute'); }, s.mute ? '现在：已静音（再选一次取消）' : t.group);
  }
  return C;
}
function subseq(hay, q) { let i = 0; for (const ch of hay) { if (ch === q[i]) i++; if (i === q.length) return true; } return q.length === 0; }
function filterItems(q) {
  if (!q) return items;
  const out = [];
  for (const it of items) {
    const ttl = it.ttl.toLowerCase(), all = (it.gp + ' ' + it.ttl).toLowerCase();
    const score = ttl.includes(q) ? 0 : all.includes(q) ? 1 : subseq(all, q) ? 2 : -1;
    if (score >= 0) out.push([score, it]);
  }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}
function renderPal() {
  shown = filterItems($('#pal-in').value.trim().toLowerCase());
  idx = clamp(idx, 0, Math.max(0, shown.length - 1));
  const list = $('#pal-list'); list.innerHTML = '';
  if (!shown.length) { list.append(el('div', { class: 'empty' }, '没有匹配的命令')); return; }
  shown.slice(0, 300).forEach((it, i) => {
    const d = el('div', { class: 'it' + (i === idx ? ' on' : ''), 'data-i': i },
      el('span', { class: 'gp' }, it.gp), el('span', { class: 'ttl' }, it.ttl), it.sub && el('span', { class: 'sub2' }, it.sub), it.k && el('span', { class: 'k kbd' }, it.k));
    d.addEventListener('mousemove', () => setIdx(i, false));
    d.addEventListener('click', () => runPal(i));
    list.append(d);
  });
}
function setIdx(i, scroll = true) {
  if (!shown.length) return;
  i = clamp(i, 0, Math.min(shown.length, 300) - 1);
  if (i === idx && !scroll) return;
  idx = i;
  for (const n of $$('#pal-list .it')) n.classList.toggle('on', +n.dataset.i === i);
  if (scroll) $(`#pal-list .it[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
}
function runPal(i) {
  const it = shown[i]; closePalette();
  if (it) { try { it.run(); } catch (e) { console.error(e); toast('命令出错：' + e.message); } }
}
export function openPalette() {
  closeHelp();
  items = commands(); idx = 0;
  const inp = $('#pal-in'); inp.value = '';
  $('#pal-bg').hidden = false; renderPal(); inp.focus();
}
function closePalette() { $('#pal-bg').hidden = true; $('#pal-in').blur(); }

// ---------- 快捷键表 ----------
const HELP = [
  ['播放 / 暂停', ['空格']], ['在播放位置写标注', ['Enter']],
  ['循环开关（没有循环区就用当前段）', ['L']], ['循环起点 / 终点设在播放头', ['I', 'O']],
  ['A/B 切换（同一时间点）', ['V']], ['下一个 / 上一个问题', ['N', 'P']],
  ['下一处 / 上一处 A/B 改动', [']', '[']],
  ['后退 / 前进 1 秒', ['←', '→']], ['± 5 秒 / ± 0.1 秒', ['⇧', '⌥']],
  ['回到开头', ['Home']], ['看全曲', ['0']],
  ['放大到循环区（没有就当前段）', ['Z']], ['第 n 段设为循环区并跳过去', ['1–9']],
  ['以播放头为中心放大 / 缩小', ['=', '-']], ['选中轨 独奏 / 静音', ['S', 'M']],
  ['上一条 / 下一条轨', ['↑', '↓']], ['选中轨 波形 / 频谱', ['F']],
  ['底部抽屉 收起 / 展开', ['D']], ['命令面板', ['⌘K']],
  ['左栏 / 右栏 显示或隐藏', ['⌘1', '⌘2']],
  ['关闭浮层 / 停止试听', ['Esc']], ['这张表', ['?']],
  ['缩放（鼠标）', ['⌘ / Ctrl', '滚轮']], ['左右平移（鼠标）', ['⇧', '滚轮']],
  ['设循环区', ['时间尺上半或轨道上拖']], ['A 版本换成点的版本', ['⌥', '单击版本']],
];
export function openHelp() {
  const box = $('#help-list');
  if (!box.childElementCount) {
    for (const [lab, keys] of HELP) {
      box.append(el('div', { class: 'r' }, el('span', {}, lab),
        el('span', { style: 'display:flex;gap:4px;align-items:center;flex:none' }, keys.map((k) => el('span', { class: 'kbd' }, k)))));
    }
  }
  $('#help-bg').hidden = false;
}
function closeHelp() { $('#help-bg').hidden = true; }

// ---------- 键盘 ----------
function onKey(e) {
  const code = e.code, tgt = e.target, tag = tgt?.tagName;
  if (palOpen()) {                                               // 面板的输入框自己处理；焦点跑到别处时 Esc 也能关
    if (tgt !== $('#pal-in') && code === 'Escape') { e.preventDefault(); closePalette(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && code === 'KeyK') { e.preventDefault(); openPalette(); return; }
  if (!$('#help-bg').hidden) { if (code === 'Escape' || e.key === '?') { e.preventDefault(); closeHelp(); } return; }
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || tgt?.isContentEditable || (tag === 'INPUT' && !['range', 'checkbox', 'button', 'radio'].includes(tgt.type));
  if (typing) { if (code === 'Escape') tgt.blur(); return; }
  if (e.metaKey || e.ctrlKey) return;                            // 留给浏览器
  const run = (f) => { e.preventDefault(); if (tag === 'BUTTON' || tag === 'INPUT') tgt.blur(); f(); };
  if (e.key === '?' || (code === 'Slash' && e.shiftKey)) return run(openHelp);
  const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
  const dig = /^(Digit|Numpad)([0-9])$/.exec(code);
  if (dig) { const n = +dig[2]; return run(() => (n === 0 ? fitAll() : gotoSection(n - 1, false))); }
  switch (code) {
    case 'Space': return run(() => audio.toggle());
    case 'Enter': case 'NumpadEnter': return run(focusNoteInput);
    case 'KeyL': return run(toggleLoop);
    case 'KeyI': return run(() => setLoopPoint('a'));
    case 'KeyO': return run(() => setLoopPoint('b'));
    case 'KeyV': return run(swapAB);
    case 'BracketRight': return run(() => stepDiff(1));
    case 'BracketLeft': return run(() => stepDiff(-1));
    case 'KeyN': return run(() => stepIssue(1));
    case 'KeyP': return run(() => stepIssue(-1));
    case 'ArrowLeft': return run(() => audio.seek(audio.now() - step));
    case 'ArrowRight': return run(() => audio.seek(audio.now() + step));
    case 'ArrowUp': return run(() => stepTrack(-1));
    case 'ArrowDown': return run(() => stepTrack(1));
    case 'Home': return run(() => audio.seek(0));
    case 'KeyZ': return run(zoomLoop);
    case 'Equal': case 'NumpadAdd': return run(() => zoomBy(1.5));
    case 'Minus': case 'NumpadSubtract': return run(() => zoomBy(1 / 1.5));
    case 'KeyS': return run(() => toggleFlag('solo'));
    case 'KeyM': return run(() => toggleFlag('mute'));
    case 'KeyD': return run(toggleDrawer);
    case 'KeyF': return run(toggleMode);
    case 'Escape': return run(() => { closeHelp(); stopAudition(); });
  }
}

export function initUI() {
  window.addEventListener('keydown', onKey);
  const inp = $('#pal-in');
  inp.addEventListener('input', () => { idx = 0; renderPal(); });
  inp.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(idx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPal(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') { e.preventDefault(); closePalette(); }
  });
  $('#pal-bg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closePalette(); });
  $('#help-bg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeHelp(); });
  $('#help-bg').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeHelp(); });
}
