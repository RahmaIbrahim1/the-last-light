import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smoother = (t) => clamp(t * t * t * (t * (t * 6 - 15) + 10)); // clamp: float error above 1 breaks arc-length lookups
/** Frame-rate independent exponential damping. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Cylindrical → cartesian. Everything on the island is laid out in (radius, angle, height). */
export const cyl = (r, a, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);

/** Deterministic RNG so the world is the same place every visit. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash3 = (x, y, z) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647 ^ 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export { hash3 };

/** Value noise, optional integer period for tiling. Returns 0..1 */
export function noise3(x, y, z, p = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const m = p ? (n) => ((n % p) + p) % p : (n) => n;
  const h = (i, j, k) => hash3(m(xi + i), m(yi + j), m(zi + k));
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
export function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; a *= 0.5; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; }
  return s / n;
}
/** 3D Worley cell lookup: returns the owning cell hash, its centre, and the border distance. */
export function cell3(x, y, z, out) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 1e9, d2 = 1e9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + hash3(cx, cy, cz), py = cy + hash3(cx + 31, cy, cz), pz = cz + hash3(cx, cy + 57, cz);
    const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (d < d1) { d2 = d1; d1 = d; out.x = px; out.y = py; out.z = pz; out.h = hash3(cx + 7, cy + 13, cz + 5); out.h2 = hash3(cx - 9, cy + 3, cz + 71); out.h3 = hash3(cx + 19, cy - 23, cz); }
    else if (d < d2) d2 = d;
  }
  out.edge = Math.sqrt(d2) - Math.sqrt(d1);
  return out;
}
