import { U } from './core/shared.js';
import { clamp, damp, smooth } from './core/math.js';

/** Everything you hear is synthesised: filtered noise for weather, inharmonic partials for iron and brass. */
export class AudioManager {
  constructor() { this.on = false; this.ready = false; this.muted = localStorage.getItem('tll.muted') === '1'; this.mix = { wind: 1 }; }
  /** Must be called from a user gesture. */
  start() {
    if (this.ready) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const c = (this.ctx = new C()); this.ready = true;
    this.master = c.createGain(); this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
    this.under = c.createBiquadFilter(); this.under.type = 'lowpass'; this.under.frequency.value = 18000; this.under.Q.value = 0.3;
    this.master.connect(comp).connect(c.destination);
    this.world = c.createGain(); this.world.connect(this.under).connect(this.master);
    this.dry = c.createGain(); this.dry.connect(this.master);
    this.room = c.createConvolver(); this.room.buffer = this.impulse(3.6, 2.2); this.roomG = c.createGain(); this.roomG.gain.value = 0.5; this.room.connect(this.roomG).connect(this.master);
    this.brown = this.noise('brown', 9); this.white = this.noise('white', 5);
    const bed = (buf, type, f, q, g, dest = this.world) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.96 + Math.random() * 0.08; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const gn = c.createGain(); gn.gain.value = 0; const pan = c.createStereoPanner(); s.connect(fl).connect(gn).connect(pan).connect(dest); s.start(0, Math.random() * 4); return { f: fl, g: gn, pan, base: g, cur: 0 };
    };
    this.b = {
      sea: bed(this.brown, 'lowpass', 380, 0.4, 0.75), swell: bed(this.brown, 'bandpass', 620, 0.7, 0.5), surf: bed(this.white, 'bandpass', 1500, 0.5, 0.085),
      wind: bed(this.white, 'bandpass', 420, 1.6, 0.16), whistle: bed(this.white, 'bandpass', 880, 14, 0.12), rain: bed(this.white, 'highpass', 3600, 0.3, 0.030),
      inside: bed(this.brown, 'lowpass', 160, 0.6, 0.6, this.dry), crack: bed(this.white, 'bandpass', 640, 22, 0.16, this.dry), deep: bed(this.brown, 'lowpass', 95, 1.2, 1.5, this.dry),
      machine: bed(this.brown, 'bandpass', 180, 3, 0.4, this.dry),
    };
    // lamp hum: three slightly disagreeing partials
    this.hum = c.createGain(); this.hum.gain.value = 0; this.hum.connect(this.dry); this.hum.connect(this.room);
    for (const [f, g] of [[55, 0.5], [110.4, 0.22], [164.2, 0.09]]) { const o = c.createOscillator(); o.frequency.value = f; const gg = c.createGain(); gg.gain.value = g; o.connect(gg).connect(this.hum); o.start(); }
    // a tone for each fragrance, barely there
    this.pad = c.createGain(); this.pad.gain.value = 0; this.pad.connect(this.room); this.padO = [0, 0, 0].map(() => { const o = c.createOscillator(); o.type = 'sine'; const g = c.createGain(); g.gain.value = 0.3; o.connect(g).connect(this.pad); o.start(); return o; });
    this.on = true;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, c.currentTime, 2.4);
    document.addEventListener('visibilitychange', () => { if (document.hidden) c.suspend(); else c.resume(); });
  }
  noise(kind, sec) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate), fade = c.sampleRate * 0.5;
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let l = 0; const tmp = new Float32Array(n + fade);
      for (let i = 0; i < n + fade; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { l = (l + 0.02 * w) / 1.02; tmp[i] = l * 3.2; } else tmp[i] = w; }
      for (let i = 0; i < n; i++) d[i] = i < fade ? tmp[i] * Math.sqrt(i / fade) + tmp[n + i] * Math.sqrt(1 - i / fade) : tmp[i]; // seamless loop
    }
    return b;
  }
  impulse(sec, decay) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { const e = Math.pow(1 - i / n, decay * 1.6) * (i < 900 ? i / 900 : 1); lp += ((Math.random() * 2 - 1) - lp) * (0.75 - 0.6 * (i / n)); d[i] = lp * e; } }
    return b;
  }
  toggle() { if (!this.ready) { this.muted = false; this.start(); } else this.muted = !this.muted; localStorage.setItem('tll.muted', this.muted ? '1' : '0'); this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.4); return !this.muted; }

  /** Continuous mix from where the camera physically is. */
  update(dt, cam, st) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime, t = U.uTime.value, b = this.b, ins = U.uInterior.value, und = U.uCamUnder.value, out = 1 - ins;
    const y = cam.position.y, r = Math.hypot(cam.position.x, cam.position.z), top = smooth(50, 55, y) * ins;
    const set = (k, v, tc = 0.35) => { const n = b[k]; n.cur = damp(n.cur, v, 1 / tc, dt); n.g.gain.setTargetAtTime(n.cur * n.base, now, 0.08); };
    const sw = 0.5 + 0.5 * Math.sin(t * 0.52) * Math.sin(t * 0.21 + 1), sw2 = 0.5 + 0.5 * Math.sin(t * 0.83 + 2);
    const near = smooth(80, 22, r) * out, low = smooth(40, 2, y);
    const g = this.mix.wind, gust = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.31 + Math.sin(t * 0.17) * 2), 2);
    set('sea', (0.35 + 0.65 * low) * (0.7 + 0.5 * sw) * (out + ins * 0.14) * (1 - und * 0.6));
    set('swell', (0.25 + 0.75 * low) * sw2 * (out + ins * 0.08)); b.swell.f.frequency.setTargetAtTime(420 + sw2 * 520, now, 0.5);
    set('surf', near * Math.pow(sw2, 2) * (0.3 + low) + low * out * 0.25 * sw); b.surf.pan.pan.setTargetAtTime(Math.sin(t * 0.4) * 0.5, now, 0.3);
    set('wind', (0.25 + 0.75 * smooth(0, 55, y)) * gust * g * (out + top * 0.4 + ins * 0.05) * (1 - und)); b.wind.f.frequency.setTargetAtTime(300 + gust * 380 + y * 2, now, 0.5);
    set('whistle', smooth(22, 8, r) * gust * g * (out * 0.6 + top * 0.5) * smooth(20, 55, y)); b.whistle.f.frequency.setTargetAtTime(700 + gust * 420, now, 0.6);
    set('rain', st.rain * (out + top * 0.6 + ins * 0.1) * (1 - und));
    set('inside', ins * (1 - top * 0.5)); set('crack', ins * gust * (0.35 + 0.3 * smooth(12, 50, y))); b.crack.f.frequency.setTargetAtTime(520 + gust * 240 + Math.sin(t * 0.7) * 40, now, 0.7); b.crack.pan.pan.setTargetAtTime(Math.sin(t * 0.23) * 0.8, now, 0.5);
    set('deep', und, 0.5); set('machine', top * clamp(st.spin * 3), 0.6); b.machine.f.frequency.setTargetAtTime(150 + 30 * Math.sin(t * 3.1), now, 0.1);
    this.hum.gain.setTargetAtTime(U.uLamp.value * (top * 0.07 + out * smooth(120, 20, r) * 0.02), now, 0.4);
    this.under.frequency.setTargetAtTime(und > 0.5 ? 320 : 18000 * (1 - ins * 0.86), now, und > 0.5 ? 0.06 : 0.25);
    // the cable slaps, the structure talks
    if (!this._n || t > this._n) { this._n = t + 5 + Math.random() * 11; if (ins > 0.6) (Math.random() < 0.6 ? this.creak() : this.drip()); }
    if (st.spin > 0.05 && top > 0.2) { this._tick = (this._tick || 0) + dt * st.spin * 9; if (this._tick > 1) { this._tick -= 1; this.iron(1900 + Math.random() * 300, 0.06, 0.016); } }
  }
  env(g, peak, a, d, when = this.ctx.currentTime) { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + a); g.gain.exponentialRampToValueAtTime(0.0001, when + a + d); }
  burst(buf, type, f, q, peak, a, d, { dest = this.dry, wet = 0.4, slide, when = 0, pan = 0 } = {}) {
    if (!this.ready || this.muted) return; const c = this.ctx, t = c.currentTime + when, s = c.createBufferSource(); s.buffer = buf; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (slide) fl.frequency.exponentialRampToValueAtTime(slide, t + a + d);
    const g = c.createGain(); this.env(g, peak, a, d, t); const p = c.createStereoPanner(); p.pan.value = pan; s.connect(fl).connect(g).connect(p).connect(dest); if (wet) { const w = c.createGain(); w.gain.value = wet; p.connect(w).connect(this.room); } s.start(t, Math.random() * 3, a + d + 0.1);
  }
  iron(f, d, peak, when = 0, wet = 0.8) {
    if (!this.ready || this.muted) return; const c = this.ctx, t = c.currentTime + when;
    [1, 1.83, 2.71, 4.12, 5.4].forEach((m, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f * m * (1 + (Math.random() - 0.5) * 0.01); this.env(g, peak / (1 + i * 0.9), 0.002, d / (1 + i * 0.35), t); o.connect(g); g.connect(this.dry); const w = c.createGain(); w.gain.value = wet; g.connect(w).connect(this.room); o.start(t); o.stop(t + d + 0.2); });
  }
  step(kind) {
    const p = (this._foot = -(this._foot || 1)) * 0.15;
    if (kind === 'iron') { this.iron(185 + Math.random() * 40, 0.35, 0.035); this.burst(this.white, 'bandpass', 900, 1, 0.05, 0.002, 0.07, { wet: 0.5, pan: p }); }
    else this.burst(this.brown, 'lowpass', kind === 'rock' ? 900 : 520, 0.8, 0.5, 0.004, 0.11, { wet: kind === 'rock' ? 0.02 : 0.7, pan: p });
  }
  thunder(power, delay) {
    const ins = U.uInterior.value, w = { dest: this.world, wet: ins * 0.3 };
    if (power > 0.8 && delay < 1.8) this.burst(this.white, 'lowpass', 2600, 0.4, 0.16 * power, 0.01, 0.5, { ...w, when: delay, slide: 300 });
    for (let i = 0; i < 4; i++) this.burst(this.brown, 'lowpass', 190 - i * 25, 0.5, (0.9 - i * 0.16) * power * 0.8, 0.15 + i * 0.3, 2.2 + i * 0.9, { ...w, when: delay + i * (0.3 + Math.random() * 0.6), slide: 55, pan: (Math.random() - 0.5) * 1.2 });
  }
  creak() { this.burst(this.white, 'bandpass', 240 + Math.random() * 160, 34, 0.35, 0.3, 0.9, { wet: 1, slide: 170 + Math.random() * 200, pan: Math.random() - 0.5 }); }
  drip() { if (!this.ready || this.muted) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1700, t + 0.06); this.env(g, 0.035, 0.003, 0.09, t); o.connect(g).connect(this.room); o.start(t); o.stop(t + 0.3); }
  ratchet(v) { this.iron(620 + Math.random() * 120, 0.07, 0.03 + v * 0.03, 0, 0.35); }
  clunk() { this.iron(74, 1.4, 0.24); this.iron(212, 0.8, 0.12, 0.02); this.burst(this.brown, 'lowpass', 260, 0.7, 0.9, 0.003, 0.35, { wet: 0.8 }); }
  ignite() {
    if (!this.ready || this.muted) return;
    [0.55, 0.95, 1.5].forEach((w, i) => this.iron(96 + i * 22, 1.1, 0.10, w)); this.burst(this.brown, 'bandpass', 90, 2, 0.9, 1.4, 4, { when: 0.6, slide: 260, wet: 0.5 });
    this.burst(this.white, 'bandpass', 700, 0.8, 0.10, 1.2, 2.4, { when: 3.0, slide: 2600, wet: 0.7 });
    const c = this.ctx, t = c.currentTime + 4.6; [65.4, 98, 130.8, 196, 246.9].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.055 / (1 + i * 0.35), t + 3 + i * 0.3); g.gain.linearRampToValueAtTime(0, t + 12 + i); o.connect(g).connect(this.room); o.start(t); o.stop(t + 15); });
  }
  splash(inn) { this.burst(this.white, 'lowpass', inn ? 1400 : 3800, 0.4, 0.20, 0.01, 0.9, { dest: this.dry, wet: 0, slide: inn ? 160 : 1200 }); this.burst(this.brown, 'lowpass', 220, 0.8, 0.9, 0.02, 0.8, { wet: 0 }); }
  glass() { this.iron(1480, 0.9, 0.014, 0, 1); this.iron(2230, 0.5, 0.006, 0.01, 1); }
  mood(id) {
    if (!this.ready) return; const t = this.ctx.currentTime, ch = { deep: [73.4, 110, 164.8], storm: [69.3, 98, 103.8], light: [87.3, 130.8, 220] }[id];
    if (ch) this.padO.forEach((o, i) => o.frequency.setTargetAtTime(ch[i], t, 0.8)); this.pad.gain.setTargetAtTime(ch ? 0.10 : 0, t, 1.6);
  }
}
