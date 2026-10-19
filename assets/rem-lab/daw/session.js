(() => {
  const root = document.querySelector('[data-session]');
  if (!root) return;
  const sessionURL = new URL(root.dataset.session, document.baseURI);
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dbGain = db => 10 ** (db / 20);
  const clock = seconds => {
    const ms = Math.round(Math.max(0, seconds) * 1000);
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  let context;
  let active;
  const decoded = new Map();
  function audioContext() {
    context ||= new AudioContext({ sampleRate: 44100 });
    return context;
  }
  async function buffer(file) {
    if (!decoded.has(file)) {
      const promise = fetch(new URL(file, sessionURL)).then(response => {
        if (!response.ok) throw new Error(`Audio ${response.status}`);
        return response.arrayBuffer();
      }).then(bytes => audioContext().decodeAudioData(bytes));
      decoded.set(file, promise);
      promise.catch(() => decoded.delete(file));
    }
    return decoded.get(file);
  }
  class Transport {
    constructor(host, getConfig, onChange) {
      this.host = host;
      this.getConfig = getConfig;
      this.onChange = onChange;
      this.offset = 0;
      this.nodes = new Map();
      this.state = 'idle';
      this.generation = 0;
      this.loop = true;
    }
    setState(state) {
      this.state = state;
      this.host.dataset.state = state;
      this.onChange();
    }
    position() {
      if (this.state !== 'playing') return this.offset;
      const elapsed = Math.max(0, context.currentTime - this.startedAt) + this.offset;
      return this.loop ? elapsed % this.duration : Math.min(elapsed, this.duration);
    }
    pause(preserve = true) {
      const offset = preserve ? this.position() : 0;
      this.generation++;
      this.nodes.forEach(node => {
        try { node.source.stop(); } catch { /* A source may already have ended. */ }
        node.source.disconnect(); node.gain.disconnect(); node.analyser.disconnect();
      });
      this.nodes.clear();
      this.offset = offset;
      this.setState('paused');
      if (active === this) active = undefined;
    }
    async play() {
      if (this.state === 'playing' || this.state === 'loading') { this.pause(); return; }
      active?.pause();
      active = this;
      document.dispatchEvent(new CustomEvent('rem:media-start', { detail: 'session' }));
      const generation = ++this.generation;
      const config = this.getConfig();
      this.duration = config.duration;
      this.offset = clamp(this.offset, 0, Math.max(0, this.duration - .02));
      this.setState('loading');
      try {
        const ac = audioContext();
        await ac.resume();
        const buffers = await Promise.all(config.items.map(item => buffer(item.file)));
        if (generation !== this.generation) return;
        const start = ac.currentTime + .045;
        this.startedAt = start;
        config.items.forEach((item, i) => {
          const source = ac.createBufferSource();
          const gain = ac.createGain();
          const analyser = ac.createAnalyser();
          analyser.fftSize = 256;
          source.buffer = buffers[i];
          source.loop = this.loop;
          source.loopStart = 0;
          source.loopEnd = Math.min(this.duration, buffers[i].duration);
          gain.gain.value = item.gain;
          source.connect(gain); gain.connect(analyser); analyser.connect(ac.destination);
          this.nodes.set(item.id, { source, gain, analyser, meter: new Float32Array(256) });
          if (i === 0) source.onended = () => {
            if (generation === this.generation && this.state === 'playing' && !this.loop) this.pause(false);
          };
          source.start(start, Math.min(this.offset, buffers[i].duration - .01));
        });
        this.setState('playing');
        frame();
      } catch {
        if (generation !== this.generation) return;
        this.setState('error');
      }
    }
    async restart(reset = false) {
      const wasPlaying = this.state === 'playing' || this.state === 'loading';
      this.pause(!reset);
      if (wasPlaying) await this.play();
    }
    seek(seconds) {
      const wasPlaying = this.state === 'playing';
      this.pause(false);
      this.offset = clamp(seconds, 0, Math.max(0, this.getConfig().duration - .01));
      if (wasPlaying) this.play();
      else this.onChange();
    }
    gain(id, value) {
      const node = this.nodes.get(id);
      if (!node) return;
      node.gain.gain.cancelScheduledValues(context.currentTime);
      node.gain.gain.setTargetAtTime(value, context.currentTime, .012);
    }
    setLoop(loop) {
      this.loop = loop;
      this.nodes.forEach(node => { node.source.loop = loop; });
    }
  }
  let data, scene, selectedCase, mixer, compare;
  let mode = 'master', side = 'b', bus = 'vocal';
  const faders = new Map();
  const muted = new Set();
  const solo = new Set();
  let raf;
  let dirty = true;
  const colors = { a: '#d4b276', b: '#8fc9bb', target: '#879aa8', grid: '#b5cbb511' };

  function surface(canvas) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }
  function paintWave(canvas, peaks, color, progress = 0) {
    const { ctx, width, height } = surface(canvas);
    ctx.fillStyle = `${color}0b`; ctx.fillRect(0, 0, width * progress, height);
    const step = width / peaks.length;
    peaks.forEach((peak, i) => {
      const amplitude = Math.max(.45, Math.min(1, peak) * height * .43);
      ctx.fillStyle = i / peaks.length < progress ? color : `${color}7c`;
      ctx.fillRect(i * step, height / 2 - amplitude, Math.max(.6, step * .68), amplitude * 2);
    });
    ctx.strokeStyle = '#c6d6b91a'; ctx.lineWidth = .5;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(width * i / 4, 0); ctx.lineTo(width * i / 4, height); ctx.stroke(); }
  }
  function drawChart() {
    const { ctx, width, height } = surface($('[data-case-chart]'));
    const left = 38, right = width - 12, top = 27, bottom = height - 35;
    const range = right - left;
    const timeX = absolute => left + (absolute - selectedCase.start) / selectedCase.duration * range;
    ctx.font = '8px Menlo, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#829b8e';
    for (let i = 0; i <= 4; i++) {
      const x = left + i / 4 * range;
      ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      if (selectedCase.kind !== 'spectrum') ctx.fillText((selectedCase.start + i / 4 * selectedCase.duration).toFixed(1) + 's', Math.min(x, right - 28), bottom + 13);
    }
    const a = timeX(selectedCase.focus[0]), b = timeX(selectedCase.focus[1]);
    if (selectedCase.kind !== 'spectrum') {
      ctx.fillStyle = '#93bd9230'; ctx.fillRect(a, top, Math.max(1, b - a), bottom - top);
      ctx.strokeStyle = '#b9cfa23b'; ctx.strokeRect(a, top, b - a, bottom - top);
    }
    function curve(values, xOf, yOf, color, dashed = false, skipZero = true) {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = dashed ? 1 : 1.25; ctx.setLineDash(dashed ? [3, 3] : []);
      let open = false;
      values.forEach((value, i) => {
        if (value == null || (skipZero && value === 0)) { open = false; return; }
        const x = xOf(i), y = yOf(value);
        if (open) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        open = true;
      });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (selectedCase.kind === 'pitch' && bus === 'vocal') {
      const pitch = selectedCase.pitch;
      const all = [...pitch.a, ...pitch.b, ...pitch.target].filter(v => v > 0);
      const midi = hz => 69 + 12 * Math.log2(hz / 440);
      const low = Math.floor(Math.min(...all.map(midi))) - 1, high = Math.ceil(Math.max(...all.map(midi))) + 1;
      const y = hz => bottom - (midi(hz) - low) / (high - low) * (bottom - top);
      for (let n = low; n <= high; n += 2) {
        const yy = bottom - (n - low) / (high - low) * (bottom - top);
        ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
        ctx.fillStyle = '#738e7d'; ctx.fillText(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1), 5, yy + 3);
      }
      const x = i => left + i * pitch.hop / selectedCase.duration * range;
      curve(pitch.target, x, y, colors.target, true); curve(pitch.a, x, y, colors.a); curve(pitch.b, x, y, colors.b);
      $('[data-chart-unit]').textContent = 'MEASURED F0 / NOTES';
    } else if (selectedCase.kind === 'spectrum') {
      const spectrum = selectedCase.spectrum;
      const x = i => left + Math.log(spectrum.hz[i] / 150) / Math.log(12000 / 150) * range;
      const y = db => bottom - clamp((db + 65) / 70) * (bottom - top);
      [300,1000,5000,10000].forEach(hz => {
        const xx = left + Math.log(hz / 150) / Math.log(12000 / 150) * range;
        ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, bottom); ctx.stroke();
        ctx.fillStyle = '#829b8e'; ctx.fillText(hz >= 1000 ? hz / 1000 + 'k' : hz + '', Math.min(xx, right - 20), bottom + 13);
      });
      curve(spectrum.a, x, y, colors.a, false, false); curve(spectrum.b, x, y, colors.b, false, false);
      $('[data-chart-unit]').textContent = 'RELATIVE SPECTRUM / dB';
    } else {
      const pair = selectedCase.buses[bus];
      const limit = Math.max(...pair.map(item => item.peak), .04);
      pair.forEach((item, k) => {
        const center = top + (bottom - top) * (k ? .73 : .27);
        ctx.fillStyle = colors[k ? 'b' : 'a'];
        item.peaks.forEach((peak, i) => {
          const amplitude = peak / limit * (bottom - top) * .2;
          ctx.fillRect(left + i / item.peaks.length * range, center - amplitude, Math.max(.7, range / item.peaks.length * .7), Math.max(.7, amplitude * 2));
        });
        ctx.fillText(k ? 'B' : 'A', 12, center + 3);
      });
      $('[data-chart-unit]').textContent = 'ACTUAL WAVEFORM / SHARED PEAK SCALE';
    }
    if (compare.state === 'playing' || compare.offset > 0) {
      const x = left + compare.position() / selectedCase.duration * range;
      ctx.strokeStyle = '#edf0cda8'; ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, bottom + 2); ctx.stroke();
    }
  }
  function paintFade() {
    const panel = $('[data-splice]');
    panel.hidden = selectedCase.kind !== 'pitch';
    if (panel.hidden) return;
    const { ctx, width, height } = surface($('[data-fade-chart]'));
    const left = 15, right = width - 15, top = 12, bottom = height - 19;
    ctx.font = '7px Menlo, monospace';
    for (let side = 0; side < 2; side++) {
      ctx.beginPath(); ctx.strokeStyle = side ? colors.b : colors.a; ctx.lineWidth = 1.5;
      for (let i = 0; i <= 80; i++) {
        const u = i / 80, theta = (.5 - .5 * Math.cos(u * Math.PI)) * Math.PI / 2;
        const gain = side ? Math.sin(theta) : Math.cos(theta);
        const x = left + u * (right - left), y = bottom - gain * (bottom - top);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#8ca18a'; ctx.fillText('0', left, height - 5); ctx.fillText('40 ms', right - 25, height - 5);
  }
  function gainFor(track) {
    if (muted.has(track.id) || (solo.size && !solo.has(track.id))) return 0;
    return dbGain(faders.get(track.id) || 0) * data.auditionHeadroom;
  }
  function applyGains() {
    scene.tracks.forEach(track => mixer.gain(track.id, gainFor(track)));
    $$('.stem-row').forEach(row => {
      row.classList.toggle('is-muted', muted.has(row.dataset.track) || (solo.size > 0 && !solo.has(row.dataset.track)));
      row.classList.toggle('is-solo', solo.has(row.dataset.track));
    });
    $$('[data-mute]').forEach(button => button.setAttribute('aria-pressed', String(muted.has(button.dataset.mute))));
    $$('[data-solo]').forEach(button => button.setAttribute('aria-pressed', String(solo.has(button.dataset.solo))));
  }
  async function setMode(next) {
    if (mode === next) return;
    mode = next;
    $$('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    $('[data-mixer]').dataset.mode = mode;
    await mixer.restart();
    applyGains();
  }
  function renderTracks() {
    $('[data-stems]').innerHTML = scene.tracks.map(track => `<div class="stem-row" data-track="${track.id}" style="--track-color:${track.color}"><div class="stem-name"><i></i>${escape(track.label)}<small>${escape(track.description)}</small><div class="stem-actions"><button type="button" data-mute="${track.id}" aria-label="Mute ${escape(track.label)}" aria-pressed="${muted.has(track.id)}">M</button><button type="button" data-solo="${track.id}" aria-label="Solo ${escape(track.label)}" aria-pressed="${solo.has(track.id)}">S</button></div></div><button type="button" class="wave-seek" data-track-seek="${track.id}" aria-label="Seek ${escape(track.label)}"><canvas data-track-wave="${track.id}"></canvas><i class="wave-playhead" data-mixer-playhead></i></button><div class="stem-fader"><input type="range" min="-24" max="0" step="0.5" value="${faders.get(track.id) || 0}" data-fader="${track.id}" aria-label="${escape(track.label)} listening gain"/><output data-fader-value="${track.id}">${faders.get(track.id) || 0}dB</output><div class="stem-meter"><i data-meter="${track.id}"></i></div></div></div>`).join('');
    $$('[data-mute]').forEach(button => button.addEventListener('click', () => {
      muted.has(button.dataset.mute) ? muted.delete(button.dataset.mute) : muted.add(button.dataset.mute);
      setMode('stems'); applyGains();
    }));
    $$('[data-solo]').forEach(button => button.addEventListener('click', () => {
      solo.has(button.dataset.solo) ? solo.delete(button.dataset.solo) : solo.add(button.dataset.solo);
      setMode('stems'); applyGains();
    }));
    $$('[data-fader]').forEach(input => input.addEventListener('input', () => {
      faders.set(input.dataset.fader, Number(input.value));
      $(`[data-fader-value="${input.dataset.fader}"]`).textContent = `${Number(input.value).toFixed(1)}dB`;
      setMode('stems'); applyGains();
    }));
    $$('[data-track-seek]').forEach(button => button.addEventListener('click', event => seekFromWave(event, button)));
    applyGains(); dirty = true; frame();
  }
  function seekFromWave(event, button) {
    const rect = button.getBoundingClientRect();
    mixer.seek(clamp((event.clientX - rect.left) / rect.width) * scene.duration);
  }
  function renderCase(index) {
    compare.pause(false);
    selectedCase = data.cases[index];
    if (!selectedCase.buses[bus]) bus = Object.keys(selectedCase.buses)[0];
    $('[data-compare]').dataset.case = selectedCase.id;
    $$('button[data-case]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.case) === index)));
    $('[data-case-label]').textContent = selectedCase.label.toUpperCase();
    $('[data-case-title]').textContent = selectedCase.title;
    $('[data-case-detail]').textContent = selectedCase.detail;
    $('[data-case-facts]').innerHTML = selectedCase.facts.map(fact => `<span>${escape(fact)}</span>`).join('');
    $('[data-case-source]').textContent = selectedCase.source_note.toUpperCase();
    $('[data-case-judgment]').textContent = selectedCase.judgment || '';
    $('[data-bus]').innerHTML = Object.keys(selectedCase.buses).map(name => `<option value="${name}">${name === 'mix' ? '完整混音' : selectedCase.id.startsWith('timing') ? '和声分轨' : '主唱分轨'}</option>`).join('');
    $('[data-bus]').value = bus;
    $('[data-compare-seek]').max = selectedCase.duration;
    $('[data-compare-seek]').value = 0;
    $$('[data-ab]').forEach((button, i) => button.querySelector('span').textContent = selectedCase.versions[i]);
    $('[data-case-metrics]').innerHTML = (selectedCase.metrics || []).map(metric => `<div class="edit-metric">${escape(metric.label)}<strong>${metric.a} <i>→</i> ${metric.b} <small>${escape(metric.unit)}</small></strong></div>`).join('');
    dirty = true; frame();
  }
  function renderChain(kind) {
    $$('[data-chain]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.chain === kind)));
    $('[data-chain-nodes]').innerHTML = data.chain[kind].map(([label, value]) => `<li><span>${escape(label)}</span><strong>${escape(value)}</strong></li>`).join('');
  }
  function updateUI() {
    if (!mixer || !compare || !data) return;
    const mp = mixer.position(), cp = compare.position();
    $('[data-mixer-clock]').textContent = clock(scene.start + mp);
    $('[data-compare-clock]').textContent = clock(selectedCase.start + cp);
    $('[data-mixer]').dataset.position = mp.toFixed(3);
    $('[data-compare]').dataset.position = cp.toFixed(3);
    $('[data-mixer-play]').textContent = mixer.state === 'playing' ? 'Ⅱ' : mixer.state === 'loading' ? '…' : '▶';
    $('[data-mixer-play]').setAttribute('aria-label', mixer.state === 'playing' ? '暂停分轨试听' : '播放分轨试听');
    $('[data-compare-play]').textContent = compare.state === 'playing' ? 'Ⅱ' : compare.state === 'loading' ? '…' : '▶';
    $('[data-compare-play]').setAttribute('aria-label', compare.state === 'playing' ? '暂停处理前后对照' : '播放处理前后对照');
    $('[data-mixer-status]').textContent = mixer.state === 'error' ? '片段载入失败，点击播放重试' : mixer.state === 'loading' ? '正在载入实际音轨…' : mixer.state === 'playing' ? `${mode === 'master' ? '定稿母带 v35' : '工程分轨试听'} / ${scene.title}` : '点击播放 · S 独听 · M 静音';
    $('[data-compare-status]').textContent = compare.state === 'error' ? '片段载入失败，点击播放重试' : compare.state === 'loading' ? '正在载入这一组实际版本…' : compare.state === 'playing' ? `正在试听 ${side.toUpperCase()} / ${selectedCase.versions[side === 'a' ? 0 : 1]} · 同一位置循环` : 'A/B 在同一位置切换 · 保留源版本电平';
    if (document.activeElement !== $('[data-mixer-seek]')) $('[data-mixer-seek]').value = mp;
    if (document.activeElement !== $('[data-compare-seek]')) $('[data-compare-seek]').value = cp;
    $$('[data-mixer-playhead]').forEach(line => { line.style.left = `${mp / scene.duration * 100}%`; });
    if (mixer.state === 'playing' || dirty) {
      paintWave($('[data-master-wave]'), scene.master.peaks, '#91b6a1', mp / scene.duration);
      scene.tracks.forEach(track => paintWave($(`[data-track-wave="${track.id}"]`), track.peaks, track.color, mp / scene.duration));
    }
    scene.tracks.forEach(track => {
      const node = mixer.nodes.get(track.id);
      let level = 0;
      if (node && mixer.state === 'playing') {
        node.analyser.getFloatTimeDomainData(node.meter);
        const rms = Math.sqrt(node.meter.reduce((sum, sample) => sum + sample * sample, 0) / node.meter.length);
        level = clamp((20 * Math.log10(rms + 1e-9) + 60) / 60) * 100;
      }
      $(`[data-meter="${track.id}"]`).style.width = `${level.toFixed(1)}%`;
    });
    if (compare.state === 'playing' || dirty) drawChart();
    paintFade();
    dirty = false;
  }
  function frame() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = undefined; updateUI();
      if (mixer?.state === 'playing' || compare?.state === 'playing') frame();
    });
  }
  function initialize(payload) {
    data = payload; scene = data.scenes[0]; selectedCase = data.cases[0];
    mixer = new Transport($('[data-mixer]'), () => ({ duration: scene.duration, items: mode === 'master' ? [{ id: 'master', file: scene.master.file, gain: .8 }] : scene.tracks.map(track => ({ id: track.id, file: track.file, gain: gainFor(track) })) }), () => { dirty = true; frame(); });
    compare = new Transport($('[data-compare]'), () => ({ duration: selectedCase.duration, items: selectedCase.buses[bus].map((item, i) => ({ id: i ? 'b' : 'a', file: item.file, gain: side === (i ? 'b' : 'a') ? .8 : 0 })) }), () => { dirty = true; frame(); });
    $('[data-cases]').innerHTML = data.cases.map((item, i) => `<button type="button" class="edit-case" data-case="${i}" aria-pressed="${i === 0}" aria-label="Case ${item.number}: ${escape(item.label)}"><span>${item.number}</span><b>${escape(item.label.split(' / ')[1])}<small>${escape(item.label.split(' / ')[0])} / ${escape(item.versions.join(' → '))}</small></b></button>`).join('');
    $$('button[data-case]').forEach(button => button.addEventListener('click', () => renderCase(Number(button.dataset.case))));
    $('[data-mixer-play]').addEventListener('click', () => mixer.play());
    $('[data-compare-play]').addEventListener('click', () => compare.play());
    $$('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
    $('[data-scene]').addEventListener('change', async event => {
      const playing = mixer.state === 'playing' || mixer.state === 'loading';
      mixer.pause(false); scene = data.scenes.find(item => item.id === event.target.value);
      renderTracks(); if (playing) mixer.play();
    });
    $('[data-mixer-seek]').addEventListener('input', event => mixer.seek(Number(event.target.value)));
    $('[data-compare-seek]').addEventListener('input', event => compare.seek(Number(event.target.value)));
    $('[data-seek-wave]').addEventListener('click', event => seekFromWave(event, event.currentTarget));
    $('[data-mixer-loop]').addEventListener('click', event => { mixer.setLoop(!mixer.loop); event.currentTarget.setAttribute('aria-pressed', String(mixer.loop)); });
    $$('[data-ab]').forEach(button => button.addEventListener('click', () => {
      side = button.dataset.ab; $('[data-compare]').dataset.side = side;
      $$('[data-ab]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.ab === side)));
      compare.gain('a', side === 'a' ? .8 : 0); compare.gain('b', side === 'b' ? .8 : 0);
      dirty = true; frame();
    }));
    $('[data-bus]').addEventListener('change', async event => { bus = event.target.value; await compare.restart(); dirty = true; frame(); });
    $$('[data-chain]').forEach(button => button.addEventListener('click', () => renderChain(button.dataset.chain)));
    $('a[href="#session-captures"]').addEventListener('click', () => { $('#session-captures').open = true; });
    const labels = ['Intro','V1','Pre1','Ch1','V2','Pre2','Ch2','Bridge','Peak','Outro'];
    $('[data-automation]').innerHTML = data.automation.gains.map((gain, i) => `<div class="automation-bar${gain < 0 ? ' is-negative' : ''}" style="--gain-size:${Math.abs(gain)}" title="${escape(data.automation.sections[i].name)} / v31 / ${gain > 0 ? '+' : ''}${gain.toFixed(2)} dB"><strong>${gain > 0 ? '+' : ''}${gain.toFixed(2)}</strong><i></i><span>${labels[i]}</span></div>`).join('');
    document.addEventListener('rem:media-start', event => { if (event.detail !== 'session') { mixer.pause(); compare.pause(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { mixer.pause(); compare.pause(); } });
    new ResizeObserver(() => { dirty = true; frame(); }).observe(root);
    renderTracks(); renderCase(0); renderChain('lead');
    root.dataset.ready = 'true';
  }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    fetch(sessionURL).then(response => { if (!response.ok) throw new Error('Session unavailable'); return response.json(); }).then(initialize).catch(() => {
      root.dataset.ready = 'error';
      $('[data-mixer-status]').textContent = '制作记录暂时未载入，请刷新重试';
      $('[data-mixer-play]').disabled = true; $('[data-compare-play]').disabled = true;
    });
  }, { rootMargin: '600px' });
  observer.observe(root);
})();
