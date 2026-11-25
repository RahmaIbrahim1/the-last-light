import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, DIM } from '../core/shared.js';
import { Q } from '../core/quality.js';
import { clamp, lerp, smooth, noise3, fbm3, cell3, rng } from '../core/math.js';
import { surface } from './materials.js';

const c0 = {}, c1 = {};
const outline = (a) => 25 + 8 * (noise3(Math.cos(a) * 1.4 + 5, Math.sin(a) * 1.4 + 5, 1.3) - 0.5) * 2 + 3.5 * (noise3(Math.cos(a) * 4 + 9, Math.sin(a) * 4 + 9, 7.1) - 0.5) * 2;

/** Analytic island height. Same function drives mesh, shoreline foam, wave damping and camera collision. */
export function rockH(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  if (r > 112) return -60;
  // ragged coast: domain warp before measuring distance to it
  const wx = x + (noise3(x * 0.09 + 3, z * 0.09, 2) - 0.5) * 9, wz = z + (noise3(x * 0.09, z * 0.09 + 8, 5) - 0.5) * 9;
  const q = (Math.hypot(wx / 1.22, wz) / outline(a)) * 1.02;
  let h = q < 0.42 ? DIM.ground : q < 1.0 ? lerp(DIM.ground, -1.0, Math.pow((q - 0.42) / 0.58, 1.35)) : -1.0 - (q - 1.0) * 22 - Math.pow(Math.max(0, q - 1.0), 2) * 9;
  // basalt: every cell is a tilted slab with its own height
  const amp = smooth(0.30, 0.75, q) * (1 - 0.5 * smooth(1.6, 3, q));
  cell3(x * 0.17, h * 0.05, z * 0.17, c0);
  h += ((c0.h - 0.45) * 5.6 + (x * 0.17 - c0.x) * (c0.h2 - 0.5) * 7 + (z * 0.17 - c0.z) * (c0.h3 - 0.5) * 7) * amp;
  cell3(x * 0.52 + 4, 0.5, z * 0.52, c1);
  h += ((c1.h - 0.5) * 1.5 + (x * 0.52 + 4 - c1.x) * (c1.h2 - 0.5) * 1.6) * amp;
  h += (fbm3(x * 0.6, z * 0.6, 3, 3) - 0.5) * 1.1 * (0.15 + amp);
  // cleared ground: tower footing and the approach to the door
  const foot = smooth(11.5, 8.2, r);
  const path = smooth(3.2, 1.7, Math.abs(x + Math.sin(z * 0.35) * 0.5)) * smooth(4, 7, z) * smooth(21, 16, z);
  return lerp(h, DIM.ground + (noise3(x * 1.3, z * 1.3, 0) - 0.5) * 0.12, Math.max(foot, path));
}

export function bakeShore() {
  const N = 256, S = 240, data = new Uint16Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) data[j * N + i] = THREE.DataUtils.toHalfFloat(rockH(((i + 0.5) / N - 0.5) * S, ((j + 0.5) / N - 0.5) * S));
  const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  U.tShore.value = t;
}

function stackGeometry(seed, detail) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone();
    cell3(n.x * 1.5 + seed, n.y * 0.9, n.z * 1.5, c0);
    cell3(n.x * 4.2, n.y * 2.6 + seed, n.z * 4.2, c1);
    const flat = (c0.x - (n.x * 1.5 + seed)) * n.x + (c0.y - n.y * 0.9) * n.y + (c0.z - n.z * 1.5) * n.z;
    let r = 0.80 + (c0.h - 0.5) * 0.24 + flat * 0.30 + (c1.h - 0.5) * 0.055 + (fbm3(n.x * 5 + seed, n.y * 5, n.z * 5, 3) - 0.5) * 0.16;
    const taper = 1 - 0.28 * clamp(n.y);
    v.set(n.x * r * taper, n.y * r, n.z * r * taper);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Sea stacks and skerries. Positions are composed for the approach path, not scattered. */
const STACKS = [
  // x, z, height radius, width radius, y, yaw, variant
  [54, 296, 6.5, 6.5, -2, 0.4, 0], [42, 262, 5, 7, -1.5, 1.2, 1], [90, 238, 13, 9, -3, 2.2, 2],
  [8, 226, 4.5, 6, -1.4, 0.9, 0], [64, 176, 8, 8, -2, 3.0, 1], [20, 150, 6, 5, -1.5, 5.1, 2],
  [72, 112, 12, 8, -2, 4.1, 0], [-18, 104, 5, 7, -1.5, 0.2, 1], [50, 66, 10, 6, -2, 1.8, 2], [36, 47, 5, 4.5, -1, 2.8, 0],
  [-46, 38, 9, 6, -2, 3.6, 1], [-60, 8, 16, 8, -3, 0.7, 2], [-42, -30, 7, 6, -2, 5.5, 0], [52, -26, 12, 7, -2, 2.0, 1], [24, -50, 6, 6, -1, 4.4, 2],
  [-30, 62, 3, 4, -0.8, 1.0, 0], [-8, 44, 3.4, 4, -1, 2.4, 1], [16, 41, 3, 3.4, -0.8, 0.5, 2],
  // far silhouettes
  [-330, -260, 40, 34, -8, 0.4, 2], [-390, -190, 30, 24, -6, 2.0, 0], [300, -420, 50, 40, -8, 1.1, 1], [380, -340, 34, 30, -5, 3.0, 2], [240, 120, 20, 18, -4, 2.2, 0], [-210, 180, 40, 22, -5, 0.3, 1],
];

export function createRock() {
  const group = new THREE.Group();
  const seg = Q.rockSeg, rings = Q.rockRings, R = 100;
  const pos = new Float32Array((rings + 1) * seg * 3), idx = [];
  let o = 0;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, r = 3 + t * 47 + Math.pow(t, 5) * (R - 50);
    for (let j = 0; j < seg; j++) {
      const a = ((j + (i & 1) * 0.5) / seg) * Math.PI * 2;
      let x = Math.cos(a) * r, z = Math.sin(a) * r, y = rockH(x, z);
      // undercut the cliffs so it is not a heightfield
      const k = smooth(9.5, 16, r);
      const onPath = smooth(4, 2.2, Math.abs(x)) * smooth(5, 7, z) * smooth(22, 18, z);
      const u = k * (1 - onPath);
      x += (noise3(x * 0.3, y * 0.42, z * 0.3 + 9) - 0.5) * 2.6 * u; z += (noise3(x * 0.3 + 40, y * 0.42, z * 0.3) - 0.5) * 2.6 * u;
      y += (noise3(x * 0.9, y * 0.9, z * 0.9) - 0.5) * 0.7 * u;
      pos[o++] = x; pos[o++] = y; pos[o++] = z;
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    if (i & 1) idx.push(a, b, d, a, d, c); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const mat = surface('rock');
  const island = new THREE.Mesh(g, mat); island.castShadow = island.receiveShadow = true;
  group.add(island);

  for (let v = 0; v < 3; v++) {
    const list = STACKS.filter((s) => s[6] === v);
    const inst = new THREE.InstancedMesh(stackGeometry(v * 7.3 + 2, Q.stacks), mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach(([x, z, h, w, y, yaw], i) => {
      e.set(Math.sin(yaw * 9) * 0.14, yaw, Math.cos(yaw * 5) * 0.14); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, w * 0.85)); inst.setMatrixAt(i, m);
    });
    inst.computeBoundingSphere(); inst.castShadow = inst.receiveShadow = true; group.add(inst);
  }
  // fallen blocks around the footing and shore
  const rand = rng(41), n = Q.mobile ? 70 : 150;
  const boulders = new THREE.InstancedMesh(stackGeometry(3.1, Q.name === 'high' ? 5 : 3), mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0, k = 0; k < n && i < 4000; i++) {
    const a = rand() * Math.PI * 2, r = 10.5 + rand() * 26, x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r;
    if (Math.abs(x) < 3.4 && z > 0 && z < 24) continue;
    const s = 0.25 + Math.pow(rand(), 3) * 1.9;
    e.set(rand() * 6, rand() * 6, rand() * 6); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, rockH(x, z) + s * 0.15, z), q, new THREE.Vector3(s * (1 + rand() * 0.6), s * 0.75, s));
    boulders.setMatrixAt(k++, m);
  }
  boulders.castShadow = boulders.receiveShadow = true; boulders.computeBoundingSphere(); group.add(boulders);
  return group;
}
export { STACKS };
