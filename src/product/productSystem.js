import * as THREE from 'three';
import { U, DIM } from '../core/shared.js';
import { Q } from '../core/quality.js';
import { cyl, damp, clamp, wrapPi, V } from '../core/math.js';
import { PLINTHS } from '../world/lantern.js';
import { stormy } from '../world/materials.js';
import { FRAGRANCES, NEUTRAL, byId } from './fragranceData.js';
import { createBottle, createCarton, BOTTLE_SCALE } from './bottle.js';

export class ProductSystem {
  constructor({ scene, renderer, lantern, weather, post, audio }) {
    Object.assign(this, { scene, renderer, lantern, weather, post, audio });
    this.items = {}; this.focus = null; this.picks = [];
    this.mood = structuredClone(NEUTRAL); this.group = new THREE.Group(); scene.add(this.group);
    for (const f of FRAGRANCES) {
      const p = PLINTHS[f.id], b = createBottle(f); b.group.position.copy(cyl(p.r, p.a, p.y)); const home = -p.a + Math.PI / 2; b.group.rotation.y = home;
      this.group.add(b.group); b.body.userData.id = f.id;
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); pick.position.copy(b.group.position).y += 0.2; pick.userData.id = f.id; this.group.add(pick); this.picks.push(pick);
      const rt = new THREE.WebGLCubeRenderTarget(Q.mobile ? 96 : 192, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cube = new THREE.CubeCamera(0.05, 400, rt); cube.position.copy(b.group.position).y += 0.14; scene.add(cube);
      b.uniforms.tEnv.value = rt.texture;
      b.uniforms.uToLamp.value.copy(U.uLampPos.value).sub(cube.position).normalize(); b.uniforms.uCamAz.value = p.a;
      const ct = createCarton(f); const ca = p.a + (f.id === 'storm' ? -0.28 : 0.30), cr = p.r + 0.32; ct.position.copy(cyl(cr, ca, DIM.top)); ct.rotation.y = -p.a + Math.PI / 2 + 0.35; this.group.add(ct);
      this.items[f.id] = { f, ...b, rt, cube, home, spin: 0, vel: 0, target: null, dirty: true, light: 0, pick };
    }
    this.capN = 0;
  }
  get list() { return FRAGRANCES; }
  worldPos(id, dy = 0.2) { return this.items[id].group.position.clone().add(V(0, dy, 0)); }
  invalidate() { for (const k in this.items) this.items[k].dirty = true; }

  setFocus(id) {
    if (this.focus === id) return; const prev = this.focus; this.focus = id;
    if (prev) { const p = this.items[prev]; p.target = 0; }
    if (id) { this.items[id].target = null; }
    this.audio.mood(id);
  }
  rotate(dx) { const i = this.items[this.focus]; if (!i) return; i.target = null; i.vel += dx * 0.085; }
  face(side) { const i = this.items[this.focus]; if (i) i.target = side === 'back' ? Math.PI : 0; }
  get side() { const i = this.items[this.focus]; return i && Math.abs(wrapPi(i.spin)) > Math.PI / 2 ? 'back' : 'front'; }

  update(dt, camera, near) {
    this.group.visible = near;
    const m = this.mood, to = this.focus ? byId[this.focus].mood : NEUTRAL, L = 0.9;
    for (const k of ['tint', 'fog', 'grade']) m[k] = m[k].map((v, i) => damp(v, to[k][i], L, dt));
    for (const k of ['dens', 'storm', 'rain', 'char', 'wind']) m[k] = damp(m[k], to[k], L, dt);
    U.uMood.value.setRGB(...m.tint); U.uFogCol.value.setRGB(...m.fog); U.uFogDens.value = m.dens; this.post.grade.uGrade.value.setRGB(...m.grade);
    this.weather.rate = m.storm; this.weather.rainTarget = m.rain; this.weather.smokeTarget = m.char; stormy.value = m.char; this.audio.mix.wind = m.wind;
    this.weather.smokeColor.setRGB(0.085, 0.062, 0.046);
    if (!near) return;

    let acc = null;
    for (const id in this.items) {
      const i = this.items[id], on = this.focus === id; i.light = damp(i.light, on ? 1 : 0, on ? 1.3 : 2, dt);
      i.uniforms.uFocus.value = 0.10 + U.uLamp.value * 0.16 + i.light * 0.82;
      if (i.target !== null) { i.vel = 0; i.spin = damp(i.spin, i.spin + wrapPi(i.target - i.spin), 3, dt); } else { i.vel *= Math.exp(-dt * 3.2); i.spin += i.vel * dt; }
      i.group.rotation.y = i.home + i.spin;
      if (on) acc = i;
    }
    const { accent, accent2 } = this.lantern;
    if (acc) {
      const p = acc.group.position, n = cyl(1, PLINTHS[this.focus].a, 0), s = V(-n.z, 0, n.x);
      accent.position.copy(p).addScaledVector(n, 0.7).addScaledVector(s, 0.55).add(V(0, 1.15, 0)); accent.target.position.copy(p).add(V(0, 0.15, 0));
      accent2.position.copy(p).addScaledVector(n, -0.45).addScaledVector(s, -0.4).add(V(0, 0.45, 0));
      accent.color.setRGB(...acc.f.accent).lerp(new THREE.Color(1, 1, 1), 0.35); accent2.color.setRGB(...acc.f.accent);
    }
    const l = Math.max(...Object.values(this.items).map((i) => i.light)); accent.intensity = l * 3.6; accent2.intensity = l * 0.6;

    // refresh at most one reflection probe per frame
    for (const id in this.items) {
      const i = this.items[id]; if (!i.dirty) continue; i.dirty = false;
      const hid = [i.group, this.weather.group]; hid.forEach((h) => (h.visible = false));
      const ui = U.uInterior.value; i.cube.update(this.renderer, this.scene); U.uInterior.value = ui; hid.forEach((h) => (h.visible = true)); this.renderer.setRenderTarget(null); break;
    }
  }
  dispose() { for (const i of Object.values(this.items)) i.rt.dispose(); }
}
