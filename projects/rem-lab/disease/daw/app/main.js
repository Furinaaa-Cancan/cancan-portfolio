// 启动：读工程、恢复界面、接走带栏；逐帧刷新播放头、走带屏、电平表。
import { S, on, emit, $, el, fmt, persist, restore, loadNotes, setView, fitAll, verById, sectionAt, toast, rafThrottle } from './store.js';
import { audio } from './audio.js';
import { BASE } from './project.js';
import './host.js';
import { buildLanes, overviewMouse, rulerMouse, hoverTrack, wheel, layoutOverlay, updateOverlay, drawOverview, drawArranger } from './view.js';
import { initSide, renderVersions } from './side.js';
import { initDrawer, renderDrawer, drawDrawerPlayhead } from './drawer.js';
import { initUI, openPalette, openHelp, toggleLoop } from './ui.js';
import { refreshDiff, diffRegions } from './diff.js';

const ICON_PLAY = '<path d="M4 2l10 6-10 6z"/>', ICON_PAUSE = '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>';

// ---------- A / B 选择 ----------
function fillSelects() {
  for (const w of ['A', 'B']) {
    const sel = $('#sel-' + w.toLowerCase());
    sel.innerHTML = '';
    for (const v of S.pj.versions) {
      if (v.status === 'void' && v.id !== S[w]) continue;
      sel.append(el('option', { value: v.id }, v.label + (v.status === 'old' ? '（旧）' : v.status === 'void' ? '（作废）' : '')));
    }
    sel.value = S[w] || '';
    sel.title = `选 ${w} 的版本${verById(S[w])?.note ? '\n' + verById(S[w]).note : ''}`;
  }
}
function syncAB() {
  $('#ab-a').classList.toggle('active', S.active === 'A');
  $('#ab-b').classList.toggle('active', S.active === 'B');
  fillSelects();
}
function wireTop() {
  for (const w of ['A', 'B']) {
    const sel = $('#sel-' + w.toLowerCase());
    sel.addEventListener('change', () => { S[w] = sel.value; sel.blur(); audio.preloadVersions(); audio.sync(); persist(); emit('versions'); });
    $('#ab-' + w.toLowerCase()).addEventListener('click', (e) => { if (e.target.closest('select')) return; audio.setActive(w); });
  }
  $('#ab-swap').addEventListener('click', () => audio.setActive(S.active === 'A' ? 'B' : 'A'));
  $('#bt-home').addEventListener('click', () => audio.seek(0));
  $('#bt-play').addEventListener('click', () => audio.toggle());
  $('#bt-stop').addEventListener('click', () => audio.stop());
  $('#bt-loop').addEventListener('click', toggleLoop);
  $('#bt-fit').addEventListener('click', fitAll);
  $('#bt-pal').addEventListener('click', openPalette);
  $('#bt-help').addEventListener('click', openHelp);
}

// ---------- 左右栏 ----------
const PANES_KEY = () => 'daw:panes:' + (S.pj?.title || 'x');
function setPanes(left, right, save = true) {
  const app = $('#app');
  app.classList.toggle('no-left', !left); app.classList.toggle('no-right', !right);
  $('#bt-left').classList.toggle('on', left); $('#bt-right').classList.toggle('on', right);
  if (save) { try { localStorage.setItem(PANES_KEY(), JSON.stringify({ left, right })); } catch (e) { /* 隐私模式 */ } }
}
function initPanes() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(PANES_KEY()) || 'null'); } catch (e) { /* 坏数据 */ }
  const wide = window.innerWidth >= 1200;
  setPanes(o ? !!o.left : wide, o ? !!o.right : wide, false);
  const flip = (side) => { const app = $('#app'); const l = !app.classList.contains('no-left'), r = !app.classList.contains('no-right'); setPanes(side === 'L' ? !l : l, side === 'R' ? !r : r); };
  $('#bt-left').addEventListener('click', () => flip('L'));
  $('#bt-right').addEventListener('click', () => flip('R'));
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.key === '1') { e.preventDefault(); flip('L'); } else if (e.key === '2') { e.preventDefault(); flip('R'); }
  });
}

// ---------- 电平表 ----------
const meter = { cv: null, ctx: null, w: 0, h: 0, grad: null, txt: '', tTxt: 0, zero: false };
function sizeMeter() {
  const cv = $('#meter'), r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  const g = ctx.createLinearGradient(0, 0, r.width, 0);
  g.addColorStop(0, '#5fb87e'); g.addColorStop(0.72, '#6cc58a'); g.addColorStop(0.8, '#e5b05c'); g.addColorStop(0.93, '#e5b05c'); g.addColorStop(0.97, '#e36a6a'); g.addColorStop(1, '#e36a6a');
  Object.assign(meter, { cv, ctx, w: r.width, h: r.height, grad: g, zero: false });
}
const DB_FLOOR = -48;
const frac = (v) => (v <= 1e-6 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(v) - DB_FLOOR) / -DB_FLOOR)));
function drawMeter(ts) {
  const lv = audio.meter(), pk = Math.max(lv[0], lv[1]);
  const { ctx, w, h } = meter; if (!ctx) return;
  const zero = pk < 1e-5;
  if (!(zero && meter.zero)) {
    ctx.clearRect(0, 0, w, h);
    const bh = Math.max(3, (h - 5) / 2);
    for (let c = 0; c < 2; c++) {
      const y = 1 + c * (bh + 3);
      ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, y, w, bh);
      ctx.fillStyle = meter.grad; ctx.fillRect(0, y, w * frac(lv[c]), bh);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const db of [-36, -24, -12, -6, -3]) ctx.fillRect(Math.round(w * (1 - db / DB_FLOOR)), 0, 1, h);
    meter.zero = zero;
  }
  if (ts - meter.tTxt > 120) {
    meter.tTxt = ts;
    const txt = zero ? '−∞' : `${(20 * Math.log10(pk)).toFixed(1)} dB`.replace('-', '−');
    if (txt !== meter.txt) { meter.txt = txt; $('#meter-v').textContent = txt; }
  }
}

// ---------- 逐帧 ----------
const lcd = { t: '', s: '', sec: undefined, ov: 0 };
function frame(ts) {
  try {
    audio.tick();
    const t = audio.now();
    updateOverlay(); drawDrawerPlayhead();
    const tt = fmt(t); if (tt !== lcd.t) { lcd.t = tt; $('#lcd-t').textContent = tt; }
    const sec = sectionAt(t);
    const ss = (sec?.name || '—') + (S.loop.on ? ' · 循环' : '') + (S.audition ? ' · 试听候选' : '');
    if (ss !== lcd.s) { lcd.s = ss; $('#lcd-s').textContent = ss; }
    if (sec !== lcd.sec) { lcd.sec = sec; drawArranger(); emit('section'); }
    drawMeter(ts);
    if (S.play.playing && ts - lcd.ov > 66) { lcd.ov = ts; drawOverview(); }
  } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}

// ---------- 事件 ----------
on((w) => {
  if (w === 'play' || w === 'audition') {
    $('#ic-play').innerHTML = S.play.playing ? ICON_PAUSE : ICON_PLAY;
    $('#bt-play').title = S.play.playing ? '暂停（空格）' : '播放（空格）';
    $('#st-play').textContent = S.audition ? '试听候选中' : S.play.playing ? '播放中' : '已停止';
  } else if (w === 'decode') {
    const d = $('#st-dec'); d.textContent = audio.busy > 0 ? `解码中 ${audio.busy}` : ''; d.classList.toggle('busy', audio.busy > 0);
  } else if (w.startsWith?.('saved:')) {
    $('#st-save').textContent = `标注已保存 ${w.slice(6)}`;
  } else if (w === 'savefail') {
    $('#st-save').textContent = '标注没存上';
    toast('标注没存上：请检查浏览器是否允许本地存储');
  } else if (w === 'ab' || w === 'versions') {
    syncAB(); renderVersions(); refreshDiff();
  } else if (w === 'diff') {
    const n = diffRegions().length;
    $('#st-diff').textContent = S.A === S.B ? '' : n ? `A/B 不同 ${n} 处 · ] 下一处` : 'A/B 没找到明显不同';
  } else if (w === 'loop') {
    $('#bt-loop').classList.toggle('on', !!S.loop.on);
  }
});

async function boot() {
  const r = await fetch(BASE + 'project.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`读不到 project.json（HTTP ${r.status}）`);
  const pj = (S.pj = await r.json());
  pj.sections ||= []; pj.issues ||= []; pj.comps ||= []; pj.tracks ||= []; pj.versions ||= [];
  document.title = `${pj.title || '多轨台'} · 多轨台`;
  $('#pj-title').textContent = pj.title || '多轨台';
  $('#pj-sub').textContent = [pj.song, fmt(pj.duration, 0), `${pj.versions.length} 个版本`].filter(Boolean).join(' · ');
  S.A = pj.versionA; S.B = pj.versionB;
  const had = restore();
  // 工程的默认 A/B 换了（例如出了新版本），就不沿用浏览器里记住的旧 A/B
  const revKey = 'daw:rev:' + (pj.title || 'x');
  try {
    if (pj.defaultsRev && localStorage.getItem(revKey) !== pj.defaultsRev) {
      S.A = pj.versionA; S.B = pj.versionB; S.active = 'B';
      localStorage.setItem(revKey, pj.defaultsRev);
    }
  } catch (e) { /* 隐私模式 */ }
  S.trk.__ver ||= {};
  for (const t of pj.tracks) { const s = (S.trk[t.id] ||= {}); s.mute ??= !!t.muted; }
  document.documentElement.style.setProperty('--drawer-h', S.drawer.h + 'px');
  await loadNotes();
  wireTop(); syncAB(); initPanes(); refreshDiff();
  buildLanes(); overviewMouse(); rulerMouse(); hoverTrack();
  initSide(); initDrawer(); initUI();
  $('#center').addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) && e.target.closest?.('.mixer, .comps, .dh')) return;   // 抽屉里的列表自己滚
    wheel(e);
  }, { passive: false });
  layoutOverlay();
  const v = S.view;
  if (!had || !(Number.isFinite(v.t0) && Number.isFinite(v.pps) && v.pps > 0)) fitAll(); else setView();
  emit('play'); emit('loop'); emit('decode');
  sizeMeter();
  const ro = new ResizeObserver(rafThrottle(() => { layoutOverlay(); setView(); renderDrawer(); sizeMeter(); }));
  ro.observe($('#center')); ro.observe($('#lanes'));
  window.addEventListener('pointerdown', () => audio.preloadVersions(), { once: true });   // 第一次点击后才建音频环境，避免浏览器自动播放警告
  window.addEventListener('pagehide', persist);
  requestAnimationFrame(frame);
  $('#loading').style.display = 'none';
  emit('ready');
}

boot().catch((e) => {
  console.error(e);
  const l = $('#loading'); l.style.display = ''; l.textContent = '载入失败：' + (e?.message || e);
});
