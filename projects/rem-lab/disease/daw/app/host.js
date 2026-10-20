// Public host integration; all editing and playback remain in the original DAW.
import { S, on, emit, persist, zoomTo } from './store.js';
import { audio } from './audio.js';
import { selectTrack } from './view.js';
import { setDrawerTab } from './drawer.js';
let ready = false;
const reply = (type, extra = {}) => {
  if (window.parent !== window) window.parent.postMessage({ type, ...extra }, location.origin);
};
on(what => {
  if (what === 'ready') { ready = true; reply('rem:daw-ready'); }
  if (what === 'play' && S.play.playing) reply('rem:daw-playing');
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === 'rem:daw-pause') { audio.pause(); return; }
  if (message?.type === 'rem:daw-status') { if (ready) reply('rem:daw-ready'); return; }
  if (message?.type !== 'rem:daw-cue' || !ready) return;
  const cue = message.cue;
  if (!cue || !['lead', 'compare', 'comp', 'scene'].includes(cue.mode) || !Number.isFinite(cue.time)) return;
  const time = Math.max(0, Math.min(cue.time, S.pj.duration - .1));
  audio.pause();
  S.A = S.pj.versionA; S.B = S.pj.versionB; S.active = 'B';
  for (const id of ['__ver', ...S.pj.tracks.map(t => t.id)]) {
    const state = (S.trk[id] ||= {});
    state.solo = cue.mode === 'lead' && id === 'rem_lead';
    state.mute = id !== '__ver';
  }
  const span = cue.mode === 'scene' ? 12 : cue.mode === 'comp' ? 3 : 1.8;
  S.loop.on = cue.mode !== 'scene'; S.loop.a = time; S.loop.b = Math.min(S.pj.duration, time + span);
  if (cue.mode === 'comp') {
    S.sel.comp = S.pj.comps.reduce((best, c) => Math.abs(c.t0 - time) < Math.abs(best.t0 - time) ? c : best, S.pj.comps[0])?.id;
    S.drawer.compFilter = 'all';
  }
  emit('versions'); emit('trkui'); emit('mix'); emit('loop');
  selectTrack(cue.mode === 'lead' ? 'rem_lead' : '__ver');
  setDrawerTab(cue.mode === 'comp' ? 'comp' : cue.mode === 'scene' ? 'spec' : 'pitch');
  audio.seek(time); zoomTo(Math.max(0, time - .5), Math.min(S.pj.duration, time + span + .5));
  persist();
  reply('rem:daw-cue-applied', { mode: cue.mode, time });
});
window.addEventListener('pagehide', () => audio.pause());
