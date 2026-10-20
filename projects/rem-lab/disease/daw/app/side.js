// 左侧浏览器（版本、轨道）与右侧检查器（问题、标注、详情）。
import { S, on, emit, $, $$, el, fmt, fmtS, persist, zoomTo, sectionAt, verById, trackById, saveNotes, STATUS_HEX, toast } from './store.js';
import { audio } from './audio.js';
import { buildLanes, selectTrack, issueStatus } from './view.js';

const STATUSES = ['未修', '待定', '待试听', '已修待确认', '已修'];
const verColor = () => (S.active === 'A' ? '#e9a94f' : '#5cc8b8');
let noteT = null;                      // 这条标注的时间：开始打字那一刻的播放位置
let lastInsp = null;

export function initSide() {
  $('#bt-void').addEventListener('click', () => { S.hideVoid = !S.hideVoid; persist(); renderVersions(); });
  for (const b of $$('.itab')) b.addEventListener('click', () => { S.insp = b.dataset.tab; persist(); emit('insp'); });
  on((w) => {
    if (w === 'versions' || w === 'ab') { renderTracks(); if (S.insp === 'info') renderInspector(); }
    else if (w === 'lanes' || w === 'trkui') renderTracks();
    else if (w === 'select') {
      for (const n of $$('#trk-list .ti')) n.classList.toggle('sel', n.dataset.id === S.sel.track);
      if (S.insp !== 'notes') renderInspector();
    } else if (w === 'insp') renderInspector();
    else if (w === 'issues') { if (S.insp !== 'notes') renderInspector(); }
    else if (w === 'notes') { if (S.insp === 'notes') renderNoteList(); else if (S.insp === 'info') renderInspector(); }
    else if (w === 'section') { if (S.insp === 'info') renderInspector(); }
    else if (w.startsWith?.('pickIssue:')) pickIssue(w.slice(10));
  });
  renderVersions(); renderTracks(); renderInspector();
}

// ---------- 版本 ----------
export function renderVersions() {
  const box = $('#ver-list'), top = box.scrollTop;
  box.innerHTML = '';
  const nVoid = S.pj.versions.filter((v) => v.status === 'void').length;
  const bt = $('#bt-void');
  bt.textContent = S.hideVoid ? `显示作废（${nVoid}）` : '隐藏作废';
  bt.hidden = !nVoid;
  for (const v of S.pj.versions) {
    const isA = S.A === v.id, isB = S.B === v.id;
    if (v.status === 'void' && S.hideVoid && !isA && !isB) continue;
    const kind = v.status === 'void' ? ' void' : v.status === 'old' ? ' old' : '';
    const d = el('div', { class: 'ver' + kind + (isA ? ' isA' : '') + (isB ? ' isB' : ''), 'data-id': v.id,
      title: `${v.label}${v.status === 'void' ? '（作废）' : v.status === 'old' ? '（旧版）' : ''}\n单击：放到 B 并切到 B\n⌥ / ⌘ 单击：放到 A 并切到 A` },
      el('span', { class: 'dot' }), el('span', { class: 'id' }, v.label),
      el('span', { class: 'tags' }, isA && el('span', { class: 'tag a' }, 'A'), isB && el('span', { class: 'tag b' }, 'B')),
      v.note && el('div', { class: 'note' }, v.note));
    d.addEventListener('click', (e) => setVersion(e.altKey || e.metaKey ? 'A' : 'B', v.id));
    box.append(d);
  }
  box.scrollTop = top;
}
export function setVersion(w, id) {
  S[w] = id; audio.setActive(w); audio.preloadVersions(); persist(); emit('versions');
}

// ---------- 轨道 ----------
export function renderTracks() {
  const box = $('#trk-list'), top = box.scrollTop;
  box.innerHTML = '';
  const v = verById(S[S.active]);
  box.append(trackItem({ id: '__ver', name: `成品 ${S.active} · ${v?.label || '—'}`, color: verColor(), noEye: true }));
  const groups = [];
  for (const t of S.pj.tracks) { let g = groups.find((x) => x.name === t.group); if (!g) groups.push((g = { name: t.group, items: [] })); g.items.push(t); }
  for (const g of groups) {
    const gs = (S.grp[g.name] ||= {});
    const shown = g.items.filter((t) => !S.trk[t.id]?.hidden).length;
    box.append(el('div', { class: 'tg' + (gs.bclosed ? ' closed' : '') },
      el('div', { class: 'tg-h', onclick: () => { gs.bclosed = !gs.bclosed; persist(); renderTracks(); } },
        el('span', { class: 'car' }, '▾'), g.name || '未分组', el('span', { class: 'muted', style: 'font-weight:400;margin-left:auto' }, `${shown}/${g.items.length}`)),
      el('div', { class: 'tg-b' }, g.items.map((t) => trackItem({ id: t.id, name: t.name, color: t.color, t })))));
  }
  box.scrollTop = top;
}
function trackItem({ id, name, color, noEye, t }) {
  const s = S.trk[id] || {};
  const eye = noEye ? el('span', { class: 'eye' })
    : el('button', { class: 'eye', title: s.hidden ? '显示这条轨' : '隐藏这条轨（隐藏后也不出声）' }, s.hidden ? '◌' : '👁');
  if (!noEye) eye.addEventListener('click', (e) => {
    e.stopPropagation();
    const k = (S.trk[id] ||= {}); k.hidden = !k.hidden;
    buildLanes(); audio.sync(); persist();
  });
  const d = el('div', { class: 'ti' + (S.sel.track === id ? ' sel' : '') + (s.hidden ? ' hidden' : ''), 'data-id': id, title: t ? `${t.name}\n${t.file}` : '成品（当前 A/B 版本）' },
    el('span', { class: 'sw', style: `background:${color}` }), el('span', { class: 'nm' }, name),
    s.mute && el('span', { class: 'mu', title: '已静音' }, 'M'), s.solo && el('span', { class: 'so', title: '独奏中' }, 'S'), eye);
  d.addEventListener('click', () => { selectTrack(id); revealRow(id); });
  return d;
}
function revealRow(id) {
  const q = () => $(`#lanes .trow[data-id="${CSS.escape(id)}"]`);
  let row = q();
  if (!row && id !== '__ver') {
    const t = trackById(id), gs = t && S.grp[t.group];
    if (gs?.closed && !S.trk[id]?.hidden) { gs.closed = false; persist(); buildLanes(); row = q(); }
  }
  row?.scrollIntoView({ block: 'nearest' });
}

// ---------- 检查器 ----------
export function renderInspector() {
  for (const b of $$('.itab')) b.classList.toggle('on', b.dataset.tab === S.insp);
  const box = $('#ibody'), top = box.scrollTop, same = lastInsp === S.insp;
  lastInsp = S.insp;
  box.innerHTML = '';
  if (S.insp === 'notes') renderNotes(box);
  else if (S.insp === 'info') renderInfo(box);
  else renderIssues(box);
  box.scrollTop = same ? top : 0;
}

// 问题
function renderIssues(box) {
  const all = [...(S.pj.issues || [])].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  const cnt = { all: all.length };
  for (const is of all) { const k = issueStatus(is); cnt[k] = (cnt[k] || 0) + 1; }
  if (S.issueFilter !== 'all' && !STATUSES.includes(S.issueFilter)) S.issueFilter = 'all';
  box.append(el('div', { class: 'filters' }, [['all', '全部'], ...STATUSES.map((s) => [s, s])].map(([k, lab]) =>
    el('button', { class: 'fchip' + (S.issueFilter === k ? ' on' : ''), style: !cnt[k] && k !== 'all' ? 'opacity:.5' : '', onclick: () => { S.issueFilter = k; renderInspector(); } },
      k !== 'all' && el('i', { style: `background:${STATUS_HEX[k]}` }), lab, el('span', { class: 'muted' }, String(cnt[k] || 0))))));
  const list = all.filter((is) => S.issueFilter === 'all' || issueStatus(is) === S.issueFilter);
  if (!list.length) box.append(el('div', { class: 'empty' }, all.length ? '这个状态下没有问题' : '这个工程没有登记问题'));
  for (const is of list) box.append(issueCard(is));
}
function issueCard(is) {
  const status = issueStatus(is), ov = S.notes.issues?.[is.id];
  const stsel = el('select', { class: 'stsel', title: '改状态（存进标注文件，不改工程）' }, STATUSES.map((s) => el('option', { value: s }, s)));
  stsel.value = status;
  stsel.addEventListener('change', () => {
    S.notes.issues[is.id] = { status: stsel.value, at: new Date().toISOString() };
    saveNotes(); stsel.blur(); emit('issues');
  });
  const acts = el('div', { class: 'acts', onclick: (e) => e.stopPropagation() },
    el('button', { class: 'btn pri', title: '前后各多留 0.5 秒，循环播放', onclick: () => loopIssue(is) }, '循环试听'),
    el('button', { class: 'btn', title: '把视野放大到这一处', onclick: () => zoomTo(is.t0 - 0.5, is.t1 + 0.5) }, '放大'),
    stsel);
  const card = el('div', { class: 'card' + (S.sel.issue === is.id ? ' sel' : ''), 'data-id': is.id },
    el('div', { class: 'h' }, el('span', { class: 'tm' }, `${fmtS(is.t0)}–${fmtS(is.t1)}`),
      el('span', { class: `st-chip s-${status}`, title: ov ? `你改过状态（工程里原来是“${is.status}”，${ov.at?.slice(0, 16).replace('T', ' ') || ''}）` : '工程里登记的状态' }, status + (ov && ov.status !== is.status ? ' ·改' : ''))),
    el('div', { class: 'tt' }, is.title),
    is.detail && el('div', { class: 'dd' }, is.detail),
    acts);
  card.addEventListener('click', () => { S.sel.issue = is.id; audio.seek(is.t0); emit('select'); });
  return card;
}
function loopIssue(is) {
  Object.assign(S.loop, { on: true, a: Math.max(0, is.t0 - 0.5), b: Math.min(S.pj.duration, is.t1 + 0.5) });
  persist(); emit('loop'); audio.start(S.loop.a);
}
function pickIssue(id) {
  const is = (S.pj.issues || []).find((x) => x.id === id); if (!is) return;
  S.sel.issue = id;
  if (S.issueFilter !== 'all' && issueStatus(is) !== S.issueFilter) S.issueFilter = 'all';
  audio.seek(is.t0);
  if (S.insp !== 'issues') { S.insp = 'issues'; persist(); }
  emit('select');                        // 会重画检查器与问题条
  if (S.insp === 'issues' && !$('#ibody .card.sel')) renderInspector();
  $(`#ibody .card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// 标注
function renderNotes(box) {
  const inp = el('input', { id: 'note-input', placeholder: '在当前播放位置写标注，回车保存', autocomplete: 'off' });
  const when = el('div', { class: 'muted', style: 'font-size:11px;margin:-4px 4px 10px' }, '时间取开始打字那一刻的播放位置');
  const add = () => {
    const text = inp.value.trim(); if (!text) return;
    S.notes.notes.push({ id: Date.now().toString(36), t: noteT ?? audio.now(), text, at: new Date().toISOString() });
    saveNotes(); inp.value = ''; noteT = null; when.textContent = '已添加，接着写下一条也行';
    emit('notes');
  };
  inp.addEventListener('input', () => {
    if (!inp.value.trim()) { noteT = null; return; }
    if (noteT == null) { noteT = audio.now(); when.textContent = `将记在 ${fmtS(noteT)}${sectionAt(noteT) ? ' · ' + sectionAt(noteT).name : ''}`; }
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); }
    else if (e.key === 'Escape') inp.blur();
  });
  box.append(el('div', { class: 'note-in' }, inp, el('button', { class: 'btn pri', onclick: add }, '添加')), when, el('div', { id: 'note-list' }));
  renderNoteList();
}
export function renderNoteList() {
  const box = $('#note-list'); if (!box) return;
  box.innerHTML = '';
  const list = [...(S.notes.notes || [])].sort((a, b) => a.t - b.t);
  if (!list.length) box.append(el('div', { class: 'empty' }, '还没有标注。播放时按回车，写一句就能记下当前位置。'));
  for (const n of list) {
    const x = el('button', { class: 'x', title: '删除这条标注', style: 'margin-left:auto' }, '×');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      S.notes.notes = S.notes.notes.filter((k) => k.id !== n.id);
      saveNotes(); emit('notes'); toast('已删除标注（服务端每次保存前都留了备份）');
    });
    const c = el('div', { class: 'card', 'data-id': n.id, title: n.at ? `写于 ${n.at.slice(0, 16).replace('T', ' ')}` : '' },
      el('div', { class: 'h' }, el('span', { class: 'tm' }, fmtS(n.t)), el('span', { class: 'muted', style: 'font-size:11px' }, sectionAt(n.t)?.name || ''), x),
      el('div', { class: 'tx' }, n.text));
    c.addEventListener('click', () => audio.seek(n.t));
    box.append(c);
  }
}
export function focusNoteInput() {
  if (S.insp !== 'notes') { S.insp = 'notes'; persist(); emit('insp'); }
  const i = $('#note-input'); if (i) { i.focus(); i.select(); }
}

// 详情
function renderInfo(box) {
  const pj = S.pj, vs = pj.versions, c = (k) => vs.filter((v) => v.status === k).length;
  const A = verById(S.A), B = verById(S.B), act = verById(S[S.active]), sec = sectionAt(audio.now());
  const id = S.sel.track, t = id && id !== '__ver' ? trackById(id) : null;
  const selTxt = t ? `${t.name} · ${t.group}\n${t.file}` : `成品（当前 ${S.active}）· ${act?.label || '—'}\n${act?.file || ''}`;
  const nPick = (pj.comps || []).filter((k) => S.notes.picks[k.id]).length;
  const rows = [
    ['歌曲', pj.song || pj.title || '—'],
    ['时长', fmt(pj.duration, 1)],
    ['版本数', `${vs.length}（可用 ${c('ok')} · 旧 ${c('old')} · 作废 ${c('void')}）`],
    ['A', A ? `${A.label}${S.active === 'A' ? '（正在听）' : ''}` : '—'],
    ['B', B ? `${B.label}${S.active === 'B' ? '（正在听）' : ''}` : '—'],
    ['当前段落', sec ? `${sec.name}  ${fmtS(sec.t0)}–${fmtS(sec.t1)}` : '—'],
    ['选中轨', selTxt],
    ['拼接窗口', `${(pj.comps || []).length} 个 · 已标记 ${nPick}`],
    ['标注', `${(S.notes.notes || []).length} 条 · 改过状态的问题 ${Object.keys(S.notes.issues || {}).length} 个`],
    ['标注文件', pj.notesFile || '标注/用户标注.json'],
  ];
  box.append(el('div', { class: 'kv', style: 'margin-top:6px' }, rows.flatMap(([k, v]) => [el('div', {}, k), el('div', { style: 'white-space:pre-line;word-break:break-all' }, v)])));
  box.append(el('div', { class: 'sechead' }, `当前版本说明 · ${S.active} ${act?.label || ''}`),
    el('div', { class: 'card', style: 'cursor:default' }, el('div', { class: 'tx' }, act?.note || '（没有说明）')));
}
