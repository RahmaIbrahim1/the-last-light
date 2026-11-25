import * as THREE from 'three';
import gsap from 'gsap';
import { U, DIM, innerR } from './core/shared.js';
import { V, cyl, clamp, damp } from './core/math.js';
import { LEVER, PLINTHS } from './world/lantern.js';
import { rockH } from './world/rock.js';

/** Things that can be touched: places, bottles, and one lever. */
export class Interactions {
  constructor(ctx) {
    Object.assign(this, ctx); // camera, ctl, input, ui, lantern, products, audio, weather, post
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.lit = false; this.igniting = false; this.leverA = -0.72; this.leverV = 0; this.grab = false; this.seen = new Set();
    this.defineSpots(); this.bindLever(); this.bindCamera();
    this.input.onTap.push(() => this.tap());
  }

  /* ── places ──────────────────────────────────────────────────────────── */
  defineSpots() {
    const go = (n, o) => () => this.travel(n, o);
    this.spots = [
      { id: 'door', label: 'The door', pos: V(0, 11.6, 7.2), modes: ['orbit'], act: go('walk', { at: 'door', focus: V(0, 11.8, 0) }) },
      { id: 'water', label: 'The waterline', pos: V(25, 1, 57), modes: ['orbit'], act: go('low') },
      { id: 'lamp', label: 'The lantern', pos: cyl(3.6, DIM.bayA, 56.5), modes: ['orbit'], when: () => this.seen.has('lantern'), act: () => this.toLantern() },
      { id: 'under', label: 'Below', pos: V(12, -1.2, 40), modes: ['low'], act: () => this.dive() },
      { id: 'enter', label: 'Enter', pos: V(0.2, 11.2, 5.6), modes: ['walk'], when: () => this.ctl.states.walk.p.z > 8, act: go('walk', { at: 'hall', inside: true, yaw: 1.0, speed: 2.2, duration: 6.5 }) },
      { id: 'climb', label: 'Climb', pos: cyl(innerR(DIM.floor) - 0.8, DIM.stairA0 + 0.1, 10.9), modes: ['walk'], when: () => this.ctl.states.walk.p.z < 5, act: go('ascent', { s: 0.004, inside: true, duration: 4.2 }) },
      { id: 'out', label: 'Outside', pos: V(0.1, 11.2, 7.5), modes: ['walk'], when: () => this.ctl.states.walk.p.z < 5, act: () => this.travel('orbit', { th: 1.25, y: 15, r: 48, duration: 9 }) },
      { id: 'lever', label: 'The lever', pos: cyl(LEVER.r + 0.1, LEVER.a, DIM.top + 1.55), modes: ['lantern'], when: () => !this.lit && !this.igniting, act: () => this.pullLever() },
      ...this.products.list.map((f) => ({ id: f.id, label: f.name, pos: this.products.worldPos(f.id, 0.48), modes: ['lantern'], when: () => !this.igniting && (f.id === 'deep' || this.lit || this.seen.has('collection')), act: () => this.inspect(f.id) })),
      { id: 'down', label: 'The stair', pos: cyl(2.9, DIM.stairA0 - 0.5, 54.3), modes: ['lantern'], when: () => !this.igniting, act: () => { this.ctl.states.ascent.s = 0.996; this.travel('ascent', { s: 0.995, inside: true, keep: false, duration: 4 }); } },
      { id: 'leave', label: 'The gallery', pos: cyl(3.6, DIM.bayA, 56.6), modes: ['lantern'], when: () => !this.igniting, act: () => this.travel(this.lit ? 'final' : 'orbit', this.lit ? { duration: 11, focus: V(0, 55.8, 0) } : { th: DIM.bayA + 0.25, y: 58, r: 40, duration: 9, focus: V(0, 55, 0) }) },
      { id: 'return', label: 'Return to the light', pos: cyl(3.2, DIM.bayA, 56.5), modes: ['final'], when: () => this.ctl.states.final.t > 5, act: () => this.toLantern(true) },
    ];
    this.ui.mountSpots(this.spots);
  }
  async travel(name, opts = {}) { if (this.ctl.busy && this.ctl.mode === name) return; this.products.setFocus(null); this.ui.hideProduct(); await this.ctl.go(name, opts); }
  async dive() { await this.travel('below', { duration: 4.2, focus: V(4, 4, 10) }); }
  async toLantern(show = false) {
    this.seen.add('lantern'); if (show) this.seen.add('collection');
    await this.travel('lantern', { th: DIM.bayA + 0.2, r: 2.85, show: show ? 1 : 0 });
  }

  /* ── bottles ─────────────────────────────────────────────────────────── */
  async inspect(id) {
    const ctl = this.ctl; if (this.igniting) return;
    this.seen.add(id); this.products.setFocus(id); this.ui.hideProduct(); this.audio.glass();
    if (id === 'storm') this.weather.strike(0.9);
    const fromInside = ctl.state.node === 'lantern' && Math.hypot(ctl.pos.x, ctl.pos.z) < 4;
    const c = this.products.worldPos(id, 0.18);
    this.token = {}; const tk = this.token;
    await ctl.go('product', { id, inside: fromInside, focus: fromInside ? c : undefined, duration: fromInside ? (ctl.state.name === 'product' ? 4.4 : 3.8) : undefined });
    if (tk === this.token && ctl.mode === 'product') this.ui.showProduct(id);
  }
  async leaveProduct() {
    const id = this.products.focus || 'deep'; this.token = null; this.ui.hideProduct(); this.products.setFocus(null);
    await this.ctl.go('lantern', { th: PLINTHS[id].a + 0.12, r: 2.8, inside: true, duration: 4.2, focus: V(0, 55.4, 0) });
  }
  hit(objs) { this.ndc.set(this.input.x, this.input.y); this.ray.setFromCamera(this.ndc, this.camera); this.ray.far = 12; return this.ray.intersectObjects(objs, false)[0]; }
  tap() {
    if (this.ctl.busy) return;
    if (this.ctl.mode === 'lantern') { const h = this.hit([...this.products.picks, this.lantern.pick]); if (!h) return; if (h.object === this.lantern.pick) { if (!this.lit) this.pullLever(); } else this.inspect(h.object.userData.id); }
  }
  hover() {
    if (this.ctl.busy || this.input.touch) return false;
    if (this.ctl.mode === 'lantern') return !!this.hit([...this.products.picks, ...(this.lit ? [] : [this.lantern.pick])]);
    return false;
  }

  /* ── the lever: spring, stiction, detents, over-centre snap ──────────── */
  bindLever() {
    this.input.onDown.push(() => {
      if (this.ctl.mode !== 'lantern' || this.ctl.busy || this.lit || this.igniting) return false;
      const h = this.hit([this.lantern.pick, ...this.products.picks]); if (h?.object !== this.lantern.pick) return false;
      this.grab = true; this.want = this.leverA; return false || (this.input.captured = true);
    });
    this.input.onUp.push((_, tap) => { if (this.grab) { this.grab = false; if (tap) this.pullLever(); } });
  }
  pullLever() { if (this.lit || this.igniting) return; this.igniting = true; gsap.to(this, { leverA: 0.1, duration: 1.1, ease: 'power1.in', onUpdate: () => this.detent(), onComplete: () => gsap.to(this, { leverA: 0.74, duration: 0.28, ease: 'power3.in', onComplete: () => this.ignite() }) }); }
  detent() { const k = Math.floor((this.leverA + 0.72) / 0.16); if (k !== this._det) { this._det = k; this.audio.ratchet(clamp((this.leverA + 0.72) / 1.4)); this.ctl.kick(0.06); } }
  updateLever(dt) {
    if (this.lit || this.igniting) { this.lantern.arm.rotation.x = this.leverA; return; }
    if (this.grab) {
      this.want = clamp(this.want + (this.input.gy + Math.abs(this.input.gx) * 0.25) * 0.0062, -0.8, 0.95);
      const load = 2.6 - 1.5 * clamp((this.leverA + 0.72) / 1.1);           // stiff at first, yields past centre
      this.leverA = damp(this.leverA, this.want, 7 / load, dt); this.detent();
      if (this.leverA > 0.42) { this.grab = false; this.igniting = true; gsap.to(this, { leverA: 0.74, duration: 0.22, ease: 'power3.in', onComplete: () => this.ignite() }); }
    } else { this.leverV += ((-0.72 - this.leverA) * 30 - this.leverV * 7) * dt; this.leverA += this.leverV * dt; }
    this.lantern.arm.rotation.x = this.leverA;
  }

  /* ── the light: a chain of causes, eleven seconds long ───────────────── */
  ignite() {
    const { audio, ctl, lantern, products, ui, post } = this; this.igniting = true; ui.hush(true);
    audio.clunk(); ctl.kick(0.75); audio.ignite();
    const st = ctl.states.lantern; gsap.to(st, { tr: 2.95, duration: 5, ease: 'sine.inOut' }); gsap.to(st, { el: 0.12, duration: 6, ease: 'sine.inOut' });
    const tl = gsap.timeline({ onComplete: () => { this.lit = true; this.igniting = false; this.seen.add('collection'); products.invalidate(); ui.hush(false); ui.say('', 0); this.travel('final', { duration: 12, focus: V(0, 56.2, 0) }); } });
    tl.call(() => { lantern.targetSpin = 0.34; }, null, 0.7)                                   // mechanism, then lens
      .to(U.uLamp, { value: 0.05, duration: 0.10 }, 3.0).to(U.uLamp, { value: 0.012, duration: 0.25 }, 3.12) // it catches…
      .to(U.uLamp, { value: 0.09, duration: 0.08 }, 3.7).to(U.uLamp, { value: 0.03, duration: 0.4 }, 3.8)     // …falters…
      .call(() => ctl.kick(0.25), null, 4.4)
      .to(U.uLamp, { value: 0.30, duration: 2.0, ease: 'power2.in' }, 4.4)                    // …and fills the room
      .to(U.uLamp, { value: 1.0, duration: 3.0, ease: 'power1.inOut' }, 6.4)                  // beam leaves the glass
      .call(() => products.invalidate(), null, 9.2)
      .to({}, { duration: 1.4 }, 9.4);
  }

  /* ── story beats driven by where the camera gets to ──────────────────── */
  bindCamera() {
    const { ctl, audio, ui } = this;
    ctl.on('step', (k) => audio.step(k));
    ctl.on('dive', () => this.dive());
    ctl.on('hall', () => ui.say('', 0));
    ctl.on('summit', () => { if (ctl.busy || ctl.mode !== 'ascent') return; this.seen.add('lantern'); ctl.go('lantern', { th: PLINTHS.deep.a + 0.42, r: 2.7, inside: true, duration: 8, focus: this.products.worldPos('deep', 0.2) }).then(() => { if (!this.revealed && ctl.mode === 'lantern') { this.revealed = true; ui.reveal('The Deep', 'The memory of water.'); } }); });
    ctl.on('beamPass', () => { if (this.lit) ctl.kick(0.22); });
  }
  update(dt) {
    this.updateLever(dt);
    const m = this.ctl.mode;
    if (m === 'product' && !this.ctl.busy && this.input.down) this.products.rotate(this.input.gx);
    const show = !this.ctl.busy && !this.igniting;
    const anchor = V(0, 0, 0), d = V(0, 0, 0);
    for (const s of this.spots) {
      let on = show && s.modes.includes(m) && (!s.when || s.when());
      if (on) {
        anchor.copy(s.pos).project(this.camera); d.copy(s.pos).sub(this.camera.position); const dist = d.length();
        if (anchor.z > 1 || Math.abs(anchor.x) > 0.96 || Math.abs(anchor.y) > 0.92) on = false;
        else if (m === 'orbit' && s.id !== 'water') { // hidden by the tower itself?
          const n = Math.hypot(s.pos.x, s.pos.z) || 1; const f = (s.pos.x / n) * (this.camera.position.x - s.pos.x) + (s.pos.z / n) * (this.camera.position.z - s.pos.z); if (f / dist < 0.06) on = false;
        } else if (m === 'lantern' && Math.abs(this.lineMiss(s.pos)) < 0.75 && dist > 2.6) on = false;
        s.sx = (anchor.x * 0.5 + 0.5) * innerWidth; s.sy = (0.5 - anchor.y * 0.5) * innerHeight;
      }
      this.ui.spot(s, on);
    }
  }
  /** horizontal distance from the lamp axis to the sight line */
  lineMiss(p) { const c = this.camera.position, dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz); const t = -(c.x * dx + c.z * dz) / (l * l); if (t < 0 || t > 1) return 9; return (c.x * dz - c.z * dx) / l; }
}
