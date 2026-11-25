import * as THREE from 'three';
import { U, DIM, innerR, stairA, stairR, stairY } from '../core/shared.js';
import { clamp, damp, lerp, smooth, wrapPi, V, cyl, TAU } from '../core/math.js';
import { lookGain } from '../core/input.js';
import { waterHeight } from '../world/ocean.js';
import { rockH } from '../world/rock.js';
import { PLINTHS } from '../world/lantern.js';
import { APPROACH } from './routes.js';

const UP = V(0, 1, 0), M = new THREE.Matrix4(), E = new THREE.Euler(0, 0, 0, 'YXZ');
const aim = (pos, tgt, q) => { M.lookAt(pos, tgt, UP); return q.setFromRotationMatrix(M); };
const tilt = (q, yaw, pitch) => { E.set(pitch, yaw, 0); return q.multiply(new THREE.Quaternion().setFromEuler(E)); };
const yawPitch = (q, yaw, pitch) => { E.set(pitch, yaw, 0); return q.setFromEuler(E); };

/** Momentum along a rail: intent accelerates, water and air slow you, you never quite stop unless told to. */
class Rail {
  constructor(curve, { max, accel = 0.9, drag = 0.55, drift = 0 }) { Object.assign(this, { curve, max, accel, drag, drift, d: 0, v: 0 }); curve.arcLengthDivisions = 600; this.L = curve.getLength(); }
  reset(d = 0, v = 0) { this.d = d; this.v = v; }
  step(dt, f, boost = 0) {
    const want = f > 0 ? this.max * f : this.drift;
    this.v = damp(this.v, want, want > this.v ? this.accel : this.drag, dt) + boost;
    this.v = clamp(this.v, -this.max * 0.5, this.max * 1.4);
    this.d = clamp(this.d + this.v * dt, 0, this.L);
    return this.d / this.L;
  }
  at(u, out) { return this.curve.getPointAt(clamp(u), out); }
}

export function createStates(ctl) {
  const inp = ctl.input, tmp = V(0, 0, 0), tmp2 = V(0, 0, 0);
  const S = {};

  /* ── A · DISTANT ─ a breath held on open water ───────────────────────── */
  S.distant = {
    name: 'distant', node: 'far', chapter: 0, t: 0, lx: 0, ly: 0,
    enter() { this.t = 0; },
    pose(dt, o) {
      this.t += dt; this.lx = damp(this.lx, inp.sx, 0.9, dt); this.ly = damp(this.ly, inp.sy, 0.9, dt);
      const t = U.uTime.value;
      o.pos.set(60 + Math.sin(t * 0.05) * 3 + this.lx * 7, 9 + Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.13 + 1) * 0.7 + this.ly * 2.2, 400 + Math.cos(t * 0.04) * 3);
      aim(o.pos, tmp.set(this.lx * 26, 24, 0), o.quat); tilt(o.quat, -this.lx * 0.22, this.ly * 0.07);
      o.fov = 30; o.shake = 1.1;
    },
  };

  /* ── C · APPROACH (with D folded into its middle third) ──────────────── */
  S.approach = {
    name: 'approach', node: 'far', chapter: 1, rail: new Rail(new THREE.CatmullRomCurve3(APPROACH, false, 'centripetal'), { max: 21, accel: 0.55, drag: 0.3, drift: 2.6 }), lx: 0, ly: 0, wake: 0,
    enter() { this.rail.reset(0, 2); this.start = ctl.pos.clone(); },
    pose(dt, o, live) {
      const u = live === false ? 0 : this.rail.step(dt, inp.forward, clamp(-inp.wheel, -1, 1) * 1.2);
      this.u = u; this.rail.at(u, o.pos);
      o.pos.lerp(this.start, 1 - smooth(0, 0.06, u));
      // ride the swell while low
      const low = smooth(8, 3, o.pos.y); this.low = low;
      const h = waterHeight(o.pos.x, o.pos.z); this.wake = damp(this.wake, h, 1.7, dt || 0.016);
      o.pos.y += this.wake * 0.75 * low + low * 0.35;
      this.lx = damp(this.lx, inp.sx, 1.2, dt); this.ly = damp(this.ly, inp.sy, 1.2, dt);
      this.rail.at(Math.min(1, u + 0.09), tmp2);
      tmp.set(0, lerp(26, 34, u), 0).lerp(tmp2.setY(tmp2.y + 4), 0.22 * (1 - u) + 0.08 * low);
      aim(o.pos, tmp, o.quat); tilt(o.quat, -this.lx * 0.5, this.ly * 0.22);
      o.fov = lerp(32, 52, smooth(0.0, 0.55, u)) + low * 6 + clamp(this.rail.v * 0.12, 0, 3); o.shake = 1.2 + low * 0.8;
      if (live && u > 0.992) { S.orbit.seed(o.pos); ctl.handover('orbit', { seam: 2.4 }); }
    },
  };

  /* ── B · ORBIT ─ heavy, like a boat with a long rudder ───────────────── */
  S.orbit = {
    name: 'orbit', node: 'orbit', chapter: 2, th: 0.73, r: 66, y: 16, vt: 0, vy: 0, vr: 0, idle: 0, tr: 66, sink: 0, yS: 16,
    seed(p) { this.th = Math.atan2(p.z, p.x); this.r = this.tr = clamp(Math.hypot(p.x, p.z), 30, 80); this.tr = Math.max(this.tr, 68); this.y = this.yS = p.y; this.vt = this.vy = 0; },
    enter(opts, from) { if (opts?.th !== undefined) { this.th = opts.th; } if (opts?.y !== undefined) this.y = this.yS = opts.y; if (opts?.r) this.r = this.tr = opts.r; this.sink = 0; if (from?.name === 'below') { this.y = this.yS = 5; } },
    pose(dt, o, live) {
      if (live) {
        this.vt += inp.gx * 0.0046 + inp.strafe * dt * -0.8; this.vy += inp.gy * 0.13 + ((inp.keys.has('ArrowUp') || inp.keys.has('KeyW') ? 1 : 0) - inp.back) * dt * 30; this.tr = clamp(this.tr + inp.wheel * 3.2, 23, 84);
        this.idle = inp.down || Math.abs(inp.wheel) ? 0 : this.idle + dt;
      }
      this.vt *= Math.exp(-dt * 1.9); this.vy *= Math.exp(-dt * 2.4);
      const drift = 0.018 * smooth(4, 9, this.idle);
      this.th += (this.vt + drift) * dt * 1.0; this.y += this.vy * dt;
      if (this.y < 1.4) { if (live && inp.down && inp.gy < 0) this.sink += -inp.gy; this.y = lerp(this.y, 1.4, 1 - Math.exp(-dt * 4)); } else this.sink = Math.max(0, this.sink - dt * 60);
      this.y = clamp(this.y, 0.6, 70);
      this.r = damp(this.r, this.tr, 1.6, dt);
      const x = Math.cos(this.th) * this.r, z = Math.sin(this.th) * this.r;
      let floor = -10; for (const k of [-0.05, 0, 0.05]) floor = Math.max(floor, rockH(Math.cos(this.th + k) * (this.r - 2), Math.sin(this.th + k) * (this.r - 2)) + 2.2);
      const wh = waterHeight(x, z) + 1.0;
      this.yS = damp(this.yS, Math.max(this.y, floor, wh), 2.4, dt);
      o.pos.set(x, this.yS, z);
      const low = smooth(14, 2, this.yS);
      const ty = lerp(lerp(30, 54, smooth(16, 62, this.yS)), 33, low * 0.8) - smooth(50, 24, this.r) * lerp(7, 0, low);
      aim(o.pos, tmp.set(0, ty, 0), o.quat);
      if (!inp.down) tilt(o.quat, -inp.sx * 0.06, inp.sy * 0.05);
      o.fov = lerp(54, 60, low) + smooth(40, 23, this.r) * 6; o.shake = 1;
      if (live && this.sink > 130 && rockH(x, z) < -6) { this.sink = 0; ctl.emit('dive'); }
    },
  };

  /* ── D · LOW ANGLE ─ the eye of something swimming ───────────────────── */
  const LOW = V(25, 0, 57);
  S.low = {
    name: 'low', node: 'low', chapter: 3, lx: 0, ly: 0, w: 0, hold: 0, wet: true, dry: false,
    enter() { this.hold = 0; },
    pose(dt, o, live) {
      this.lx = damp(this.lx, inp.sx, 1.5, dt); this.ly = damp(this.ly, inp.sy, 1.5, dt);
      this.w = damp(this.w, waterHeight(LOW.x, LOW.z), 3.2, dt || 0.02);
      if (live) this.hold = inp.forward ? this.hold + dt : Math.max(0, this.hold - dt * 1.5);
      o.pos.set(LOW.x - this.lx, this.w + lerp(0.75, 0.15, smooth(0, 0.7, this.hold)), LOW.z);
      aim(o.pos, tmp.set(-2, 25, 0), o.quat); tilt(o.quat, -this.lx * 0.55, this.ly * 0.2);
      o.fov = 62; o.shake = 1.6;
      if (live && this.hold > 0.7) { this.hold = 0; ctl.handover('below', { seam: 1.2 }); }
    },
  };

  /* ── E · UNDERWATER ─ the same momentum, in a thicker medium ─────────── */
  const DIVE = [V(25, 0.2, 57), V(23.5, -1.6, 54.5), V(20, -5, 51), V(12, -8, 47.5), V(1, -9.2, 46), V(-11, -8.2, 45), V(-22, -5.4, 44), V(-29, -1.8, 46), V(-35, 3.0, 50)];
  S.below = {
    name: 'below', node: 'below', chapter: 3, wet: true, dry: false, wind: 0, rail: new Rail(new THREE.CatmullRomCurve3(DIVE, false, 'centripetal'), { max: 4.4, accel: 0.6, drag: 0.5, drift: 1.35 }), lx: 0, ly: 0,
    enter() { this.rail.reset(0, 1.2); this.w = waterHeight(25, 57); },
    pose(dt, o, live) {
      const u = live === false ? 0 : this.rail.step(dt, inp.forward, clamp(-inp.wheel, -1, 1) * 0.25); this.u = u; this.rail.at(u, o.pos);
      this.w = damp(this.w ?? 0, waterHeight(o.pos.x, o.pos.z), 1.6, dt || 0.02);
      o.pos.y += this.w * Math.max(smooth(0.12, 0, u), smooth(0.86, 0.97, u)) * 0.9;
      const t = U.uTime.value, deep = smooth(0.05, 0.25, u) * smooth(1, 0.85, u);
      o.pos.x += Math.sin(t * 0.43) * 0.35 * deep; o.pos.y = Math.max(o.pos.y + Math.sin(t * 0.6) * 0.28 * deep, rockH(o.pos.x, o.pos.z) + 1.5);
      this.lx = damp(this.lx, inp.sx, 0.9, dt); this.ly = damp(this.ly, inp.sy, 0.9, dt);
      this.rail.at(Math.min(1, u + 0.08), tmp2);
      tmp.set(0, lerp(25, lerp(4, 16, smooth(0.3, 0.6, u)), smooth(0.0, 0.16, u)), 8); tmp.y = lerp(tmp.y, 24, smooth(0.8, 1, u)); tmp.lerp(tmp2, 0.25 * deep);
      aim(o.pos, tmp, o.quat); tilt(o.quat, -this.lx * 0.7, this.ly * 0.4);
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.sin(t * 0.37) * 0.035 * deep); o.quat.multiply(q);
      o.fov = lerp(62, 68, deep); o.shake = 0.5;
      if (live && u > 0.985) { S.orbit.seed(o.pos); S.orbit.y = 7; ctl.handover('orbit', { seam: 3 }); }
    },
  };

  /* ── F · FIRST PERSON ─ from the rock, through the door, into the hall ── */
  S.walk = {
    name: 'walk', node: 'door', chapter: 4, p: V(0.2, 0, 15), yaw: 0, pitch: 0, tp: 0, ty: 0, v: V(0, 0, 0), bob: 0, y: 10.65, gaze: 0, near: 0.06, entered: false, bank: 0.4,
    enter(opts = {}) {
      const at = opts.at || 'door'; this.node = at; this.v.set(0, 0, 0);
      if (at === 'door') { this.p.set(0.2, 0, 14.2); this.ty = this.yaw = 0; this.tp = this.pitch = 0.10; } else { this.p.set(0.3, 0, 1.9); this.ty = this.yaw = opts.yaw ?? 1.0; this.tp = this.pitch = 0.1; }
      this.y = this.ground() + 1.65;
    },
    ground() { const r = Math.hypot(this.p.x, this.p.z); if (r < 6.9) return DIM.floor; return lerp(DIM.floor, rockH(this.p.x, this.p.z), smooth(6.9, 8.6, r)); },
    collide() {
      const p = this.p, R = innerR(DIM.floor) - 0.55;
      if (p.z > 6.9 && p.z < 8.4) p.x = clamp(p.x, -0.6, 0.9);
      if (p.z >= 8.4) { p.x = clamp(p.x, -1.35, 1.35); p.z = Math.min(p.z, 17); return; }
      if (p.z > R - 0.25 && Math.abs(p.x) < 1.2) { p.x = clamp(p.x, -0.12, 0.5); return; }
      const r = Math.hypot(p.x, p.z), a = (Math.atan2(p.z, p.x) + TAU) % TAU, under = a > 3.62 && a < 5.5;
      const lim = under ? R - 1.15 : R; if (r > lim) { p.x *= lim / r; p.z *= lim / r; }
    },
    pose(dt, o, live) {
      if (live) {
        const g = lookGain * (inp.down && !inp.touch ? 0.9 : 1);
        const edge = inp.touch ? 0 : Math.sign(inp.x) * Math.pow(smooth(0.72, 1, Math.abs(inp.x)), 2) * 1.0;
        this.ty -= inp.dx * g * (inp.touch ? (inp.down ? 1 : 0) : 1) + edge * dt; this.tp = clamp(this.tp - inp.dy * g * 0.8 * (inp.touch ? (inp.down ? 1 : 0) : 1), -0.9, 1.15);
        if (Math.abs(inp.dx) + Math.abs(inp.dy) > 3) this.gaze *= Math.exp(-dt * 2);
      }
      this.yaw += (this.ty - this.yaw) * (1 - Math.exp(-dt * 5)); this.gaze = damp(this.gaze, 0, 0.28, dt);
      this.lift = damp(this.lift || 0, this.gaze, 0.9, dt); this.pitch = damp(this.pitch, this.tp + this.lift, 3.2, dt);
      const f = live ? clamp(inp.forward - inp.back + clamp(-inp.wheel, -1, 1) * 2, -1, 2) : 0, s = live ? inp.strafe : 0;
      tmp.set(-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s, 0, -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s).multiplyScalar(this.p.z > 7 ? 2.3 : 1.9);
      this.v.lerp(tmp, 1 - Math.exp(-dt * 3.4)); this.p.addScaledVector(this.v, dt); this.collide();
      const sp = this.v.length(); const b0 = this.bob; this.bob += sp * dt * 2.1;
      if (live && sp > 0.5 && Math.floor(b0 / Math.PI) !== Math.floor(this.bob / Math.PI)) ctl.emit('step', this.p.z > 7 ? 'rock' : 'stone');
      const inside = Math.hypot(this.p.x, this.p.z) < 4.6; this.node = inside ? 'hall' : 'door'; this.chapter = 4;
      if (inside && !this.entered && live) { this.entered = true; this.gaze = 1.5; ctl.emit('hall'); }
      this.y = damp(this.y, this.ground() + 1.65, 6, dt);
      o.pos.set(this.p.x, this.y + Math.abs(Math.sin(this.bob)) * 0.035 * Math.min(1, sp), this.p.z);
      o.pos.x += Math.cos(this.yaw) * Math.sin(this.bob) * 0.02 * Math.min(1, sp);
      yawPitch(o.quat, this.yaw, this.pitch); o.fov = 60; o.shake = 0.45;
      if (live && inside) { const foot = cyl(innerR(DIM.floor) - 0.75, DIM.stairA0 - 0.12, 0); if (Math.hypot(this.p.x - foot.x, this.p.z - foot.z) < 0.85) { S.ascent.s = 0.004; ctl.handover('ascent', { seam: 1.8, keep: true }); } }
    },
  };

  /* ── G · SPIRAL ASCENT ─ seven turns, on foot ────────────────────────── */
  S.ascent = {
    name: 'ascent', node: 'ascent', chapter: 5, s: 0, v: 0, lx: 0, ly: 0, near: 0.06, bank: 0.5, look: 0, len: 172,
    enter(opts) { if (!opts?.keep) this.s = opts?.s ?? 0.004; this.v = 0; this.look = 1; },
    pose(dt, o, live) {
      const want = live ? (inp.forward - inp.back) * 3.1 : 0;
      this.v = damp(this.v, want, Math.abs(want) > Math.abs(this.v) ? 1.1 : 2.2, dt); if (live) this.v += clamp(-inp.wheel, -1, 1) * 0.35; this.v = clamp(this.v, -3, 3.8);
      const n0 = Math.floor(this.s * 110); this.s = clamp(this.s + (this.v / this.len) * dt, 0, 1);
      if (live && Math.floor(this.s * 110) !== n0) ctl.emit('step', 'iron');
      this.look = damp(this.look, 0, 0.5, dt);
      const a = stairA(this.s), r = stairR(this.s), bob = Math.sin(this.s * 110 * TAU);
      o.pos.copy(cyl(r + Math.sin(this.s * 55 * TAU) * 0.025, a, stairY(this.s) + 1.62 + bob * 0.016 * Math.min(1, Math.abs(this.v))));
      // face along the climb, leaning toward the void
      this.lx = damp(this.lx, inp.sx, 2, dt); this.ly = damp(this.ly, inp.sy, 2, dt);
        const base = Math.atan2(Math.sin(a), -Math.cos(a)); // tangent is (-sin a, cos a)
      yawPitch(o.quat, base - 0.42 - this.lx * 1.75, 0.16 + this.look * 0.45 + this.ly * 0.85 - Math.abs(this.lx) * 0.05);
      o.fov = 64; o.shake = 0.4;
      if (live && this.s > 0.9985) ctl.emit('summit');
      if (live && this.s < 0.0015 && this.v < -0.2) { S.walk.enter({ at: 'hall' }); const f = cyl(innerR(DIM.floor) - 1.9, DIM.stairA0 - 0.35, 0); S.walk.p.set(f.x, 0, f.z); ctl.handover('walk', { seam: 1.8, at: 'hall' }); S.walk.p.set(f.x, 0, f.z); }
    },
  };

  /* ── H · LANTERN ROOM ─ slow inspection of a machine ─────────────────── */
  S.lantern = {
    name: 'lantern', node: 'lantern', chapter: 6, th: 2.2, vt: 0, el: 0, r: 2.75, tr: 2.75, near: 0.06, idle: 0, beam: 0, bank: 0.3, auto: 0, show: 0,
    enter(opts = {}) { if (opts.th !== undefined) this.th = opts.th; this.vt = 0; this.el = opts.el ?? 0; this.tr = this.r = opts.r ?? 2.75; this.show = opts.show ?? 0; },
    pose(dt, o, live) {
      if (live && !inp.captured) { this.vt += inp.gx * 0.0050 + inp.strafe * -dt * 1.4; this.el = clamp(this.el + inp.gy * 0.0016, -0.45, 0.6); this.tr = clamp(this.tr + inp.wheel * 0.14, 2.05, 2.95); this.idle = inp.down ? 0 : this.idle + dt; if (inp.down) this.show = 0; }
      this.vt *= Math.exp(-dt * 2.2); this.th += (this.vt + this.show * 0.16) * dt; this.r = damp(this.r, this.tr, 2, dt);
      o.pos.copy(cyl(this.r, this.th, 55.62 + this.el * 1.3));
      // the room turns with the light: gaze leans after the beam
      this.beam = damp(this.beam, U.uLamp.value, 0.6, dt);
      const bd = U.uBeamDir.value, side = bd.x * -Math.sin(this.th) + bd.z * Math.cos(this.th);
      tmp.set(0, 55.5 + this.beam * 0.35 - this.el * 0.3, 0); aim(o.pos, tmp, o.quat);
      tilt(o.quat, -inp.sx * 0.16 - side * Math.sign(bd.x * Math.cos(this.th) + bd.z * Math.sin(this.th)) * 0.06 * this.beam, inp.sy * 0.10 + this.beam * 0.03);
      o.fov = 62; o.shake = 0.35;
    },
  };

  /* ── H′ · PRODUCT ─ the camera as a hand ─────────────────────────────── */
  S.product = {
    name: 'product', node: 'lantern', chapter: 6, id: 'deep', dist: 0.95, td: 0.95, near: 0.04, bank: 0.2, ax: 0, ay: 0,
    enter(opts = {}) { this.id = opts.id || this.id; this.td = this.dist = 0.98; },
    pose(dt, o, live) {
      const p = PLINTHS[this.id], c = cyl(p.r, p.a, p.y + 0.185);
      if (live) this.td = clamp(this.td + inp.wheel * 0.055, 0.44, 1.2);
      this.dist = damp(this.dist, this.td, 2.6, dt); this.ax = damp(this.ax, inp.down ? 0 : inp.sx, 1.6, dt); this.ay = damp(this.ay, inp.down ? 0 : inp.sy, 1.6, dt);
      const a = p.a + this.ax * 0.10, d = this.dist;
      o.pos.set(c.x + Math.cos(a) * d, c.y + 0.10 * d + this.ay * 0.05, c.z + Math.sin(a) * d);
      // compose off-centre: the words need the dark
      const port = ctl.camera.aspect < 0.9, rt = tmp2.set(Math.sin(a), 0, -Math.cos(a));
      const z = smooth(0.5, 0.95, d);
      tmp.copy(c).addScaledVector(rt, port ? 0 : -0.235 * z * Math.min(1, ctl.camera.aspect / 1.6)); if (port) tmp.y -= 0.16 * z; else tmp.y += lerp(0.05, 0.0, z);
      aim(o.pos, tmp, o.quat); o.fov = 34; o.shake = 0.10;
    },
  };

  /* ── I · FINAL ─ out through the broken pane, and up ─────────────────── */
  S.final = {
    name: 'final', node: 'final', chapter: 6, t: 0, th: DIM.bayA, lx: 0, ly: 0, wind: 1.4, vt: 0,
    enter() { this.t = 0; this.th = DIM.bayA + 0.10; this.vt = 0; },
    pose(dt, o, live) {
      if (live) { this.t += dt; this.vt += inp.gx * 0.0030; } this.vt *= Math.exp(-dt * 1.8);
      this.th += (0.022 * smooth(0, 8, this.t) + this.vt) * dt;
      const k = smooth(0, 46, this.t); const r = lerp(105, 235, k), y = lerp(50, 112, k * k * 0.4 + k * 0.6);
      this.lx = damp(this.lx, inp.sx, 0.7, dt); this.ly = damp(this.ly, inp.sy, 0.7, dt);
      o.pos.copy(cyl(r, this.th, y)); aim(o.pos, tmp.set(0, lerp(50, 44, k), 0), o.quat);
      const bd = U.uBeamDir.value, sweep = Math.abs(bd.x * Math.cos(this.th) + bd.z * Math.sin(this.th));
      if (sweep > 0.998 && !this.hit) { this.hit = true; ctl.emit('beamPass'); } else if (sweep < 0.9) this.hit = false;
      tilt(o.quat, -this.lx * 0.16, this.ly * 0.10); o.fov = lerp(50, 44, k); o.shake = 1.1;
    },
  };
  return S;
}
