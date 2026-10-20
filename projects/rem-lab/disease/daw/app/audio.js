// 音频引擎：Web Audio 缓冲区（按需解码、LRU 释放）、同步起播、A/B 版本无缝切换（两条同时在放，只换增益）、循环、拼接候选试听。
import { S, emit, dbToGain, verById, trackById, clamp } from './store.js';

import { BASE } from './project.js';
const LIMIT = 8;                         // 最多同时留在内存里的解码缓冲（每条立体声 4 分钟约 80 MB）

class Engine {
  constructor() {
    this.ctx = null; this.buf = new Map(); this.pending = new Map(); this.lru = [];
    this.voices = new Map(); this.t0Ctx = 0; this.t0 = 0; this.stopTimer = null; this.busy = 0; this.tok = 0;
    this.levels = [0, 0];
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const sp = ctx.createChannelSplitter(2);
    this.master.connect(sp);
    this.an = [ctx.createAnalyser(), ctx.createAnalyser()];
    this.an.forEach((a, i) => { a.fftSize = 2048; sp.connect(a, i); });
    this.tmp = new Float32Array(2048);
    return ctx;
  }

  async load(file) {
    const url = BASE + file;
    if (this.buf.has(url)) { this.touch(url); return this.buf.get(url); }
    if (this.pending.has(url)) return this.pending.get(url);
    this.ensure();
    this.busy++; emit('decode');
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((b) => { this.buf.set(url, b); this.touch(url); this.evict(); return b; })
      .finally(() => { this.pending.delete(url); this.busy--; emit('decode'); });
    this.pending.set(url, p);
    return p;
  }
  touch(url) { this.lru = this.lru.filter((u) => u !== url); this.lru.push(url); }
  evict() {
    const inUse = new Set([...this.voices.values()].map((v) => v.url));
    while (this.lru.length > LIMIT) {
      const u = this.lru.find((x) => !inUse.has(x));
      if (!u) break;
      this.lru = this.lru.filter((x) => x !== u); this.buf.delete(u);
    }
  }
  isLoaded(file) { return this.buf.has(BASE + file); }

  // 现在该响的声部
  specs() {
    if (S.audition) {
      const a = S.audition, out = [];
      for (const id of ['inst', 'rem_harm', 'rem_bv', 'rem_pad']) {
        const t = trackById(id); if (t) out.push({ key: 'ctx:' + id, file: t.file, gain: 1, pan: 0, offset: 0 });
      }
      out.push({ key: 'take', file: a.file, gain: 1.2, pan: 0, offset: a.t0 });
      return out;
    }
    const st = (id) => S.trk[id] || {};
    const anySolo = st('__ver').solo || S.pj.tracks.some((t) => st(t.id).solo);
    const audible = (id) => !st(id).hidden && (anySolo ? !!st(id).solo : !st(id).mute);
    const out = [];
    if (audible('__ver')) {
      const g = dbToGain(st('__ver').vol ?? 0);
      for (const w of ['A', 'B']) {
        const v = verById(S[w]); if (!v) continue;
        out.push({ key: 'ver:' + w + ':' + v.id, file: v.file, gain: S.active === w ? g : 0, pan: st('__ver').pan ?? 0, offset: 0, ver: w });
      }
    }
    for (const t of S.pj.tracks) if (audible(t.id)) out.push({ key: 'trk:' + t.id, file: t.file, gain: dbToGain(st(t.id).vol ?? 0), pan: st(t.id).pan ?? 0, offset: 0 });
    return out;
  }

  posAt(ctxTime) {
    let p = this.t0 + (ctxTime - this.t0Ctx);
    const L = S.loop;
    if (L.on && !S.audition && this.t0 < L.b && L.b - L.a > 0.05 && p >= L.b) p = L.a + ((p - L.a) % (L.b - L.a));
    return Math.min(p, S.pj.duration);                 // 放到头就停在结尾，不再往后数
  }
  // 每帧调一次：没在循环、也不是试听候选时，放到曲尾就停下（播放头停在结尾，再按播放从头开始）
  tick() {
    if (!S.play.playing || S.audition || !this.ctx) return;
    const raw = this.t0 + (this.ctx.currentTime - this.t0Ctx), L = S.loop;
    const looping = L.on && this.t0 < L.b && L.b - L.a > 0.05;
    if (!looping && raw >= S.pj.duration) { this.pause(); S.play.t = S.pj.duration; emit('seek'); }
  }
  now() { return S.play.playing && this.ctx ? this.posAt(this.ctx.currentTime) : S.play.t; }

  voice(spec, when, pos) {
    const buf = this.buf.get(BASE + spec.file); if (!buf) return;
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf;
    const L = S.loop;
    if (L.on && !S.audition && pos < L.b && L.b - L.a > 0.05) {
      src.loop = true; src.loopStart = Math.max(0, L.a - spec.offset); src.loopEnd = Math.max(0.01, L.b - spec.offset);
    }
    const g = ctx.createGain(); g.gain.value = spec.gain;
    const pn = ctx.createStereoPanner(); pn.pan.value = clamp(spec.pan, -1, 1);
    src.connect(g).connect(pn).connect(this.master);
    let off = pos - spec.offset, w = when;
    if (off < 0) { w = when - off; off = 0; }
    if (off >= buf.duration) return;
    src.start(w, off);
    this.voices.set(spec.key, { src, g, pn, url: BASE + spec.file });
  }

  stopAll() {
    for (const v of this.voices.values()) { try { v.src.stop(); } catch (e) { /* 已停 */ } v.src.disconnect(); }
    this.voices.clear();
  }

  async start(t) {
    const ctx = this.ensure(), tok = ++this.tok;      // 解码期间又点了播放/暂停/别的候选：只让最后一次生效
    await ctx.resume();
    this.stopAll(); clearTimeout(this.stopTimer);
    const specs = this.specs();
    await Promise.all(specs.map((s) => this.load(s.file).catch((e) => console.error(e))));
    if (tok !== this.tok) return;
    this.stopAll();
    const when = ctx.currentTime + 0.05;
    this.t0Ctx = when; this.t0 = t;
    for (const s of specs) this.voice(s, when, t);
    S.play.playing = true; S.play.from = t;
    if (S.audition) {
      const end = S.audition.t1;
      this.stopTimer = setTimeout(() => { S.audition = null; this.pause(); emit('audition'); }, Math.max(0, (end - t) * 1000 + 80));
    }
    emit('play');
  }
  pause() { this.tok++; if (S.play.playing) S.play.t = this.now(); this.stopAll(); S.play.playing = false; clearTimeout(this.stopTimer); emit('play'); }
  toggle() {
    if (S.play.playing) { if (S.audition) { S.audition = null; emit('audition'); } this.pause(); }
    else this.start(S.play.t >= S.pj.duration - 0.05 ? 0 : S.play.t);     // 已经在结尾：从头放
  }
  stop() {
    if (S.audition) { S.audition = null; emit('audition'); }
    const back = S.play.playing ? S.play.from : 0;
    this.pause(); S.play.t = back; emit('seek');
  }
  seek(t) {
    t = clamp(t, 0, S.pj.duration);
    if (S.audition) { S.audition = null; emit('audition'); }
    if (S.play.playing) this.start(t); else { S.play.t = t; emit('seek'); }
  }

  // 播放中改了静音/独奏/音量/版本：只增删需要的声部、渐变增益，不重启
  async sync() {
    if (!S.play.playing || !this.ctx) { emit('mix'); return; }
    const ctx = this.ctx, specs = this.specs(), keys = new Set(specs.map((s) => s.key));
    for (const [k, v] of [...this.voices]) {
      if (!keys.has(k)) { v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.01); try { v.src.stop(ctx.currentTime + 0.06); } catch (e) { /* */ } this.voices.delete(k); }
    }
    for (const s of specs) {
      const v = this.voices.get(s.key);
      if (v) { v.g.gain.setTargetAtTime(s.gain, ctx.currentTime, 0.012); v.pn.pan.setTargetAtTime(clamp(s.pan, -1, 1), ctx.currentTime, 0.02); continue; }
      this.load(s.file).then(() => {
        if (!S.play.playing || this.voices.has(s.key)) return;
        if (!this.specs().some((x) => x.key === s.key)) return;
        const when = this.ctx.currentTime + 0.04;
        this.voice(s, when, this.posAt(when));
      }).catch((e) => console.error(e));
    }
    emit('mix');
  }

  setActive(w) { S.active = w; this.sync(); emit('ab'); }
  async preloadVersions() { for (const w of ['A', 'B']) { const v = verById(S[w]); if (v) this.load(v.file).catch(() => {}); } }

  audition(a) { S.audition = a; emit('audition'); this.start(a.t0); }

  meter() {
    if (!this.ctx || !S.play.playing) { this.levels = this.levels.map((x) => x * 0.85); return this.levels; }
    this.an.forEach((a, i) => {
      a.getFloatTimeDomainData(this.tmp);
      let pk = 0; for (let k = 0; k < this.tmp.length; k++) { const v = Math.abs(this.tmp[k]); if (v > pk) pk = v; }
      this.levels[i] = Math.max(pk, this.levels[i] * 0.9);
    });
    return this.levels;
  }
}
export const audio = new Engine();
