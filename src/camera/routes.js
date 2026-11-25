import { DIM, stairA, stairR, stairY, innerR } from '../core/shared.js';
import { V, cyl, lerp, wrapPi, clamp } from '../core/math.js';

/**
 * The island is a graph. A flight from any place to any other is the shortest walk through it, so the camera
 * always passes through real openings: the sea gap, the doorway, the stair well, the missing lantern bay.
 */
export const APPROACH = [V(60, 9, 400), V(70, 7, 350), V(75, 3.8, 304), V(62, 2.3, 262), V(48, 2.5, 222), V(35, 3.6, 178), V(28, 6, 146), V(36, 9.5, 112), V(46, 13.5, 80), V(44, 16, 40)];
const bay = (r, y) => cyl(r, DIM.bayA, y);
const EDGES = {
  far: { orbit: () => APPROACH.slice(1, -1) },
  orbit: { far: () => APPROACH.slice(1, -1).reverse(), low: () => [], below: () => [], door: () => [V(1.2, 12.6, 21)], lantern: () => [bay(17, 58.2), bay(8.5, 57.2), bay(4.6, 56.5)], final: () => [] },
  low: { orbit: () => [], below: () => [] },
  below: { orbit: () => [], low: () => [] },
  door: { orbit: () => [V(1.2, 12.6, 21)], hall: () => [V(0.2, 10.85, 9.2), V(0.2, 11.25, 6.4), V(0.15, 11.25, 4.8)] },
  hall: { door: () => [V(0.15, 11.25, 4.8), V(0.2, 11.25, 6.4), V(0.2, 10.85, 9.2)], ascent: () => [] },
  ascent: { hall: (c) => helix(c.states.ascent.s, 0), lantern: (c) => helix(c.states.ascent.s, 1) },
  lantern: { ascent: () => [], orbit: () => [bay(4.6, 56.5), bay(8.5, 57.2), bay(17, 58.2)], final: () => [bay(4.6, 56.45), bay(7.5, 56.8), bay(16, 58)] },
  final: { orbit: () => [], lantern: () => [bay(17, 58.2), bay(8.5, 57.2), bay(4.6, 56.5)], far: () => [] },
};
function helix(s0, s1) {
  const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) * 110));
  return Array.from({ length: n }, (_, i) => { const s = lerp(s0, s1, i / (n - 1)); return cyl(stairR(s), stairA(s), stairY(s) + 1.62); });
}
const EXT = new Set(['far', 'orbit', 'low', 'final']);

/** Cylindrical interpolation: swings around the tower instead of through it. */
function swing(a, b, rMin, step) {
  const ra = Math.hypot(a.x, a.z), rb = Math.hypot(b.x, b.z), ta = Math.atan2(a.z, a.x), d = wrapPi(Math.atan2(b.z, b.x) - ta);
  const n = clamp(Math.ceil((Math.abs(d) * Math.max(ra, rb)) / step), 1, 9), out = [];
  for (let i = 1; i < n; i++) { const k = i / n, e = k * k * (3 - 2 * k); out.push(cyl(Math.max(rMin, lerp(ra, rb, e)), ta + d * k, lerp(a.y, b.y, e))); }
  return out;
}
function bfs(from, to) {
  const q = [[from]], seen = new Set([from]);
  while (q.length) { const p = q.shift(), n = p[p.length - 1]; if (n === to) return p; for (const k of Object.keys(EDGES[n] || {})) if (!seen.has(k)) { seen.add(k); q.push([...p, k]); } }
  return [from, to];
}

export function route(ctl, from, to, end) {
  const a = from.node, b = to.node, pts = [ctl.pos.clone()];
  const path = a === b ? [a] : bfs(a, b);
  let way = [];
  for (let i = 0; i < path.length - 1; i++) {
    way.push(...EDGES[path[i]][path[i + 1]](ctl).map((p) => ({ p, ext: EXT.has(path[i]) && EXT.has(path[i + 1]) })));
  }
  way = way.map((w) => w.p); way.push(end);
  for (const w of way) {
    const last = pts[pts.length - 1], rl = Math.hypot(last.x, last.z), rw = Math.hypot(w.x, w.z);
    if (last.distanceTo(w) < 0.15) continue;
    const below = last.y < 0 || w.y < 0;
    if (rl > 15 && rw > 12 && !below) pts.push(...swing(last, w, 15, 14));
    else if (last.y > 54.5 && w.y > 54.5 && rl < 3.6 && rw < 4.8) pts.push(...swing(last, w, 2.15, 0.9));
    pts.push(w.clone());
  }
  if (pts.length < 2) pts.push(end.clone().add(V(0, 0.001, 0)));
  if (pts.length === 2) { const m = pts[0].clone().lerp(pts[1], 0.5); if (pts[0].distanceTo(pts[1]) > 6) m.y += 1.2; pts.splice(1, 0, m); }
  return pts;
}
