import * as THREE from 'three';
import { U } from '../core/shared.js';
import { Q } from '../core/quality.js';
import { clamp, damp, lerp, noise3, smooth, smoother, wrapPi, V } from '../core/math.js';
import { waterHeight } from '../world/ocean.js';
import { createStates } from './cameraStates.js';
import { route } from './routes.js';

const UP = V(0, 1, 0), M = new THREE.Matrix4();
export function lookQuat(from, to, out) { M.lookAt(from, to, UP); return out.setFromRotationMatrix(M); }

/**
 * Rig = [ mode pose | flight pose ] → physical layers (handheld, wind, impacts, banking) → lens.
 * A mode owns what the camera *wants*; a flight is a choreographed spline between two wants. There are no cuts:
 * flights leave with the velocity the camera already had and land on the live pose of the mode they arrive in.
 */
export class CameraController {
  constructor(camera, input) {
    this.camera = camera; this.input = input;
    this.pos = V(60, 9, 400); this.quat = new THREE.Quaternion(); this.fov = 40; this.vel = V(0, 0, 0);
    this.prev = this.pos.clone(); this.prevQuat = new THREE.Quaternion(); this.bank = 0; this.impact = 0; this.trauma = 0;
    this.out = { pos: V(0, 0, 0), quat: new THREE.Quaternion(), fov: 45, shake: 1 };
    this.flight = null; this.listeners = {};
    this.states = createStates(this);
    this.state = this.states.distant; this.state.enter?.();
    this.aspectK = 1;
  }
  on(ev, f) { (this.listeners[ev] ||= []).push(f); return this; }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }
  get mode() { return this.state.name; }
  get busy() { return !!this.flight; }

  /** Hand over instantly when two modes share a pose (rail → orbit, hall → stair…). */
  handover(name, opts) { const from = this.state; this.state = this.states[name]; this.state.enter?.(opts, from); this.seam = { pos: this.pos.clone(), quat: this.quat.clone(), fov: this.fov, t: 0, d: opts?.seam ?? 1.6 }; this.emit('mode', name, from.name); }

  /** Choreographed move to another mode. Returns a promise for arrival. */
  go(name, opts = {}) {
    const to = this.states[name], from = this.state;
    to.enter?.(opts, from);
    to.pose(0, this.out);
    const pts = route(this, from, to, this.out.pos.clone(), opts);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); curve.arcLengthDivisions = Math.max(200, pts.length * 14);
    const L = curve.getLength();
    const speed = opts.speed ?? (opts.inside ? 1.15 : lerp(4, 17, smooth(10, 240, L)));
    const d = opts.duration ?? clamp(L / speed, 2.8, 26);
    this.flight?.done?.();
    this.flight = { curve, t: 0, d, L, q0: this.quat.clone(), f0: this.fov, v0: this.vel.clone().clampLength(0, 12), end: pts[pts.length - 1].clone(), focus: opts.focus, inside: opts.inside, qs: this.quat.clone(), first: true };
    this.state = to; this.seam = null;
    this.emit('mode', name, from.name); this.emit('depart', name, from.name);
    return new Promise((res) => { this.flight.done = res; });
  }

  kick(p) { this.trauma = Math.min(1, this.trauma + p); }

  update(dt) {
    const o = this.out, t = U.uTime.value;
    this.state.pose(dt, o, !this.flight);
    const P = V(0, 0, 0), Qn = new THREE.Quaternion(); let F = o.fov;
    if (this.flight) {
      const f = this.flight; f.t += dt; const k = clamp(f.t / f.d), u = smoother(k);
      f.curve.getPointAt(u, P);
      P.addScaledVector(o.pos.clone().sub(f.end), smooth(0.45, 1, u));
      P.addScaledVector(f.v0, f.t * Math.exp(-f.t * 2.2) * (1 - k));
      // gaze: where we are going, bent toward what matters
      const ahead = f.curve.getPointAt(Math.min(1, u + clamp(5 / f.L, 0.02, 0.22)));
      const target = ahead.clone(); const r = Math.hypot(P.x, P.z);
      if (f.focus) target.lerp(f.focus, 0.9);
      else if (!f.inside) target.lerp(V(0, lerp(26, 46, smooth(0, 60, P.y)), 0), smooth(9, 26, r) * 0.85);
      if (target.distanceToSquared(P) < 0.01) target.copy(o.pos).add(V(0, 0, -1).applyQuaternion(o.quat));
      const qp = f.inside && !f.focus ? o.quat.clone() : lookQuat(P, target, new THREE.Quaternion());
      if (f.first) { f.qs.copy(f.q0); f.first = false; }
      f.qs.slerp(qp, 1 - Math.exp(-dt * 2.4 * smooth(0, 0.12, k)));
      Qn.copy(f.q0).slerp(f.qs, smooth(0, 0.18, k)).slerp(o.quat, smoother(clamp((k - 0.55) / 0.45)));
      F = lerp(f.f0, o.fov, smooth(0.1, 0.95, k)) + Math.sin(k * Math.PI) * Math.min(7, f.L * 0.05);
      if (k >= 1) { this.flight = null; f.done?.(); this.state.arrive?.(); this.emit('arrive', this.state.name); }
    } else {
      P.copy(o.pos); Qn.copy(o.quat);
      if (this.seam) { const s = this.seam; s.t += dt; const k = smoother(clamp(s.t / s.d)); P.lerpVectors(s.pos, P, k); Qn.copy(s.quat.clone().slerp(o.quat, k)); F = lerp(s.fov, F, k); if (k >= 1) this.seam = null; }
    }
    // the head has mass: angular speed is capped while the camera is being flown, and eased back to direct control
    this.heavy = this.flight ? 1 : Math.max(0, (this.heavy || 0) - dt / 1.2);
    if (this.heavy > 0 && dt > 0) { const lim = lerp(9, 1.15, this.heavy); const g = this.prevQuat.clone(); g.slerp(Qn, 1 - Math.exp(-dt * lerp(30, 4.5, this.heavy))); const ang = this.prevQuat.angleTo(g); if (ang > lim * dt) g.copy(this.prevQuat).rotateTowards(Qn, lim * dt); Qn.copy(g); }
    this.pos.copy(P); this.quat.copy(Qn); this.fov = F;

    /* ── physical layers ───────────────────────────────────────────────── */
    if (dt > 0) this.vel.lerp(P.clone().sub(this.prev).divideScalar(dt), 1 - Math.exp(-dt * 6));
    const e0 = new THREE.Euler().setFromQuaternion(this.prevQuat, 'YXZ'), e1 = new THREE.Euler().setFromQuaternion(Qn, 'YXZ');
    const yawRate = dt > 0 ? clamp(wrapPi(e1.y - e0.y) / dt, -2, 2) : 0;
    this.prev.copy(P); this.prevQuat.copy(Qn);
    this.bank = damp(this.bank, yawRate * 0.055 * (this.state.bank ?? 1), 1.6, dt);
    this.trauma = damp(this.trauma, 0, 1.3, dt);
    const calm = Q.reduced ? 0.15 : 1, inside = U.uInterior.value;
    const wind = (1 - inside) * (this.state.wind ?? 1) * smooth(0, 30, P.y + 8);
    const a = calm * o.shake, N = (k, s) => noise3(t * s, k * 13.7, 4.2) + 0.5 * noise3(t * s * 2.1, k * 7.1, 9.1) - 0.75;
    const tr = this.trauma * this.trauma * calm;
    const jit = (k) => noise3(t * 11, k * 5.5, 2.2) - 0.5;
    this.camera.position.copy(P).add(V(N(1, 0.32), N(2, 0.36), N(3, 0.30)).multiplyScalar(a * (0.030 + wind * 0.10))).add(V(jit(1), jit(2), jit(3)).multiplyScalar(tr * 0.16));
    // never let the lens skim through the sea by accident
    if (this.state.dry !== false && !(this.flight && this.state.wet) && Math.hypot(P.x, P.z) > 16 && P.y < 8) { const h = waterHeight(this.camera.position.x, this.camera.position.z) + 0.65; if (this.camera.position.y < h && !this.wetLeg) { this.lift = damp(this.lift || 0, h - this.camera.position.y, 8, dt); } else this.lift = damp(this.lift || 0, 0, 2, dt); this.camera.position.y += this.lift; } else if (this.lift > 0.001) { this.lift = damp(this.lift, 0, 2, dt); this.camera.position.y += this.lift; }
    const gust = wind * (noise3(t * 0.21, 1, 1) - 0.5);
    this.camera.quaternion.copy(Qn).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
      N(4, 0.4) * a * 0.0065 + jit(4) * tr * 0.02,
      N(5, 0.35) * a * 0.0080 + jit(5) * tr * 0.02,
      this.bank + N(6, 0.28) * a * 0.0055 + gust * 0.012 * a + jit(6) * tr * 0.03, 'YXZ')));
    // portrait lenses keep the same horizontal story
    const asp = this.camera.aspect, vf = asp < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(F) / 2) * lerp(1, 1.5, clamp((1 - asp) / 0.55)))) : F;
    this.camera.fov = vf; this.camera.near = this.state.near && !this.flight ? this.state.near : inside > 0.4 ? 0.06 : 0.12;
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }
}
