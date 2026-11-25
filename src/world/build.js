import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Collects transformed geometry per material so a thousand parts become a handful of draw calls. */
export class Builder {
  constructor() { this.parts = new Map(); }
  add(mat, geo, pos, rot, scale) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const m = new THREE.Matrix4();
    const q = rot instanceof THREE.Quaternion ? rot : new THREE.Quaternion().setFromEuler(rot instanceof THREE.Euler ? rot : new THREE.Euler(...(rot || [0, 0, 0])));
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale ? new THREE.Vector3(...scale) : new THREE.Vector3(1, 1, 1);
    m.compose(pos ? (pos.isVector3 ? pos : new THREE.Vector3(...pos)) : new THREE.Vector3(), q, s);
    g.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  box(mat, size, pos, rot) { return this.add(mat, chamferBox(...size), pos, rot); }
  /** Straight bar between two points */
  bar(mat, a, b, r = 0.03, seg = 6, r2 = r) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return this.add(mat, new THREE.CylinderGeometry(r2, r, L, seg, 1), new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q);
  }
  tube(mat, pts, r = 0.03, seg = 64, rad = 6, closed = false) {
    return this.add(mat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), seg, r, rad, closed));
  }
  build(group, { cast = true, receive = true } = {}) {
    const out = {};
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat); list.forEach((g) => g.dispose());
      mesh.castShadow = cast; mesh.receiveShadow = receive; group.add(mesh); out[mat.name] = mesh;
    }
    this.parts.clear(); return out;
  }
}

/** A box whose edges catch light: bevelled, 3-segment-free, 44 triangles. */
export function chamferBox(w, h, d, c = Math.min(w, h, d) * 0.12) {
  const x = w / 2, y = h / 2, z = d / 2;
  const P = []; // 24 points: each corner has 3
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    P.push([sx * x, sy * (y - c), sz * (z - c)], [sx * (x - c), sy * y, sz * (z - c)], [sx * (x - c), sy * (y - c), sz * z]);
  }
  const id = (a, b, e, k) => (a * 4 + b * 2 + e) * 3 + k;
  const tris = [];
  const tri = (a, b, e) => {
    const A = new THREE.Vector3(...P[a]), B = new THREE.Vector3(...P[b]), C = new THREE.Vector3(...P[e]);
    const n = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
    const mid = A.clone().add(B).add(C);
    if (n.dot(mid) < 0) tris.push(a, e, b); else tris.push(a, b, e);
  };
  const quad = (a, b, e, f) => { tri(a, b, e); tri(a, e, f); };
  for (const s of [0, 1]) {
    quad(id(s, 0, 0, 0), id(s, 1, 0, 0), id(s, 1, 1, 0), id(s, 0, 1, 0));
    quad(id(0, s, 0, 1), id(1, s, 0, 1), id(1, s, 1, 1), id(0, s, 1, 1));
    quad(id(0, 0, s, 2), id(1, 0, s, 2), id(1, 1, s, 2), id(0, 1, s, 2));
    for (const t of [0, 1]) {
      quad(id(s, t, 0, 0), id(s, t, 1, 0), id(s, t, 1, 1), id(s, t, 0, 1));
      quad(id(s, 0, t, 0), id(s, 1, t, 0), id(s, 1, t, 2), id(s, 0, t, 2));
      quad(id(0, s, t, 1), id(1, s, t, 1), id(1, s, t, 2), id(0, s, t, 2));
      for (const u of [0, 1]) tri(id(s, t, u, 0), id(s, t, u, 1), id(s, t, u, 2));
    }
  }
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((k, i) => pos.set(P[k], i * 3));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

/** Indexed grid from a point function, with optional hole test per cell. */
export function grid(nu, nv, fn, { closedU = false, skip, flip = false } = {}) {
  const pos = [], idx = [], cols = closedU ? nu : nu + 1;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { const p = fn(i, j); pos.push(p.x, p.y, p.z); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (skip && skip(i, j)) continue;
    const a = j * cols + i, b = j * cols + ((i + 1) % cols), c = a + cols, d = b + cols;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
