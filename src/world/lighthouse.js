import * as THREE from 'three';
import { DIM, towerR, innerR, stairA, stairY } from '../core/shared.js';
import { TAU, cyl, rng, noise3, fbm3, smooth, V } from '../core/math.js';
import { surface } from './materials.js';
import { Builder, grid, chamferBox } from './build.js';
import { rockH } from './rock.js';

const SEG = 144, DY = 0.25, Y0 = 8.2, NV = Math.round((DIM.top - 0.2 - Y0) / DY);
const cellOf = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * SEG);

/** Openings are cut out of the real masonry: outer skin, inner skin and the reveal between them. */
export const OPENINGS = [];
export function layoutOpenings() {
  OPENINGS.length = 0;
  OPENINGS.push({ type: 'door', c: cellOf(DIM.doorA), w: 6, y0: 9.45, y1: 12.45 });
  const ss = [0.115, 0.205, 0.29, 0.375, 0.465, 0.55, 0.635, 0.72, 0.81, 0.895];
  ss.forEach((s, i) => {
    const y = stairY(s) + 1.0, a = stairA(s);
    OPENINGS.push({ type: 'window', i, c: cellOf(a), w: i % 3 === 1 ? 6 : 4, y0: Math.round((y - Y0) / DY) * DY + Y0, y1: Math.round((y + 1.75 - Y0) / DY) * DY + Y0, s });
  });
  // door onto the half-way balcony (seen from outside; boarded)
  OPENINGS.push({ type: 'balcony', c: cellOf(2.55), w: 4, y0: 31.95, y1: 34.2 });
  for (const o of OPENINGS) { o.a = (o.c / SEG) * TAU; o.half = ((o.w / 2) / SEG) * TAU; o.j0 = Math.round((o.y0 - Y0) / DY); o.j1 = Math.round((o.y1 - Y0) / DY); o.i0 = o.c - o.w / 2; }
}
const inside = (i, j) => OPENINGS.some((o) => { const k = ((i - o.i0) % SEG + SEG) % SEG; return k < o.w && j >= o.j0 && j < o.j1; });

function wallPoint(i, j, outer) {
  const a = (i / SEG) * TAU, y = Y0 + j * DY;
  let r = outer ? towerR(y) : innerR(y);
  if (outer) {
    // stone courses, string-courses and settlement: the profile is never a clean lathe
    r += (noise3(Math.cos(a) * 3.2, y * 0.35, Math.sin(a) * 3.2) - 0.5) * 0.16;
    r += 0.16 * smooth(0.5, 0.2, Math.abs(y - 13.2)) + 0.14 * smooth(0.45, 0.2, Math.abs(y - 31.2)) + 0.16 * smooth(0.5, 0.2, Math.abs(y - 48.5));
    r += 0.55 * smooth(10.4, 9.2, y);
    const spall = fbm3(Math.cos(a) * 2 + 7, y * 0.16, Math.sin(a) * 2, 3);
    r -= 0.22 * smooth(0.62, 0.72, spall);
  } else r += (noise3(Math.cos(a) * 4 + 30, y * 0.8, Math.sin(a) * 4) - 0.5) * 0.06;
  return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
}

function reveals() {
  const pos = [];
  const quad = (a, b, c, d) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  for (const o of OPENINGS) {
    const i0 = o.i0, i1 = o.i0 + o.w;
    for (let j = o.j0; j < o.j1; j++) {
      quad(wallPoint(i0, j, true), wallPoint(i0, j + 1, true), wallPoint(i0, j + 1, false), wallPoint(i0, j, false));
      quad(wallPoint(i1, j, true), wallPoint(i1, j, false), wallPoint(i1, j + 1, false), wallPoint(i1, j + 1, true));
    }
    for (let i = i0; i < i1; i++) {
      quad(wallPoint(i, o.j0, true), wallPoint(i, o.j0, false), wallPoint(i + 1, o.j0, false), wallPoint(i + 1, o.j0, true));
      quad(wallPoint(i, o.j1, true), wallPoint(i + 1, o.j1, true), wallPoint(i + 1, o.j1, false), wallPoint(i, o.j1, false));
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}

export function createLighthouse() {
  layoutOpenings();
  const group = new THREE.Group(), B = new Builder(), R = rng(7);
  const M = { tower: surface('tower'), inner: surface('inner'), stone: surface('stone', { side: THREE.DoubleSide }), iron: surface('iron'), wood: surface('wood'), copper: surface('copper') };

  const outer = new THREE.Mesh(grid(SEG, NV, (i, j) => wallPoint(i, j, true), { closedU: true, skip: inside }), M.tower);
  const inner = new THREE.Mesh(grid(SEG, NV, (i, j) => wallPoint(i, j, false), { closedU: true, skip: inside, flip: true }), M.inner);
  inner.material.shadowSide = THREE.DoubleSide; outer.material.shadowSide = THREE.DoubleSide;
  for (const m of [outer, inner]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  const rev = new THREE.Mesh(reveals(), M.stone); rev.castShadow = rev.receiveShadow = true; group.add(rev);

  /* ── dressed surrounds, sills, broken sashes ─────────────────────────── */
  for (const o of OPENINGS) {
    const n = cyl(1, o.a, 0), t = V(-Math.sin(o.a), 0, Math.cos(o.a)), yaw = -o.a + Math.PI / 2, mid = (o.y0 + o.y1) / 2;
    const r = towerR(mid) + 0.02, w = 2 * Math.sin(o.half) * r, h = o.y1 - o.y0;
    const at = (u, y, d = 0) => n.clone().multiplyScalar(r + d).addScaledVector(t, u).setY(y);
    // quoins: alternating long/short jamb stones
    for (let k = 0, y = o.y0; y < o.y1 - 0.05; k++) {
      const sh = 0.3 + R() * 0.12; const long = k % 2 ? 0.48 : 0.30;
      for (const s of [-1, 1]) { const rr = towerR(y) - towerR(mid); B.box(M.stone, [long, sh - 0.025, 0.36], at(s * (w / 2 + long / 2 - 0.02), y + sh / 2, -0.05 + rr), [0, yaw, (R() - 0.5) * 0.03]); }
      y += sh;
    }
    // voussoirs: a shallow relieving arch
    const nv = 7; for (let k = 0; k < nv; k++) {
      const f = (k - (nv - 1) / 2) / nv; B.box(M.stone, [w / nv * 1.45, 0.5 + (k === 3 ? 0.14 : 0), 0.42], at(f * w * 1.35, o.y1 + 0.2 - f * f * 0.6, -0.03), [0, yaw, -f * 0.55]);
    }
    if (o.type !== 'door') {
      B.box(M.stone, [w + 0.7, 0.2, 0.62], at(0, o.y0 - 0.08, 0.02), [0, yaw, 0.01]);
      // timber sash, half the bars gone
      const rr = innerR(mid) + (towerR(mid) - innerR(mid)) * 0.55;
      const s = (u, y, d = 0) => n.clone().multiplyScalar(rr + d).addScaledVector(t, u).setY(y);
      const iw = 2 * Math.sin(o.half) * rr;
      for (const k of [-1, 1]) B.box(M.wood, [0.09, h, 0.09], s(k * (iw / 2 - 0.04), mid), [0, yaw, 0]);
      B.box(M.wood, [iw, 0.09, 0.09], s(0, o.y0 + 0.05), [0, yaw, 0]); B.box(M.wood, [iw, 0.09, 0.09], s(0, o.y1 - 0.05), [0, yaw, 0]);
      if (R() > 0.25) B.box(M.wood, [0.05, h * (0.4 + R() * 0.55), 0.05], s(0, o.y1 - h * 0.38), [0, yaw, (R() - 0.5) * 0.18]);
      if (R() > 0.3) B.box(M.wood, [iw, 0.05, 0.05], s(0, mid + 0.1), [0, yaw, (R() - 0.5) * 0.1]);
      if (o.type === 'balcony') for (let k = 0; k < 4; k++) B.box(M.wood, [w * 1.3, 0.22, 0.05], at((R() - 0.5) * 0.1, o.y0 + 0.4 + k * 0.5, -0.1), [0, yaw, (R() - 0.5) * 0.35]);
    }
  }

  /* ── the door: hung open on one hinge, thirty degrees short of welcoming ── */
  {
    const r = towerR(11) - 0.95, hinge = V(-0.78, 0, r);
    const door = new THREE.Group(); door.position.set(hinge.x, 9.52, hinge.z); door.rotation.y = 1.28;
    const D = new Builder();
    for (let k = 0; k < 6; k++) D.box(M.wood, [0.245, 2.8 - (k === 4 ? 0.22 : 0), 0.085], [0.13 + k * 0.25, 1.42 + (k === 4 ? 0.1 : 0), 0]);
    for (const y of [0.5, 1.4, 2.35]) { D.box(M.iron, [1.42, 0.09, 0.14], [0.72, y, 0]); for (let k = 0; k < 6; k++) D.add(M.iron, new THREE.SphereGeometry(0.03, 8, 6), [0.13 + k * 0.25, y, 0.075]); }
    D.add(M.iron, new THREE.TorusGeometry(0.1, 0.018, 8, 20), [1.3, 1.25, 0.1]); D.build(door);
    group.add(door);
    // steps and threshold
    for (let k = 0; k < 3; k++) B.box(M.stone, [2.6 + k * 0.5, 0.22, 0.65], [0.04 * k, 9.5 - k * 0.2, towerR(9.6) + 0.55 + k * 0.55], [0, (R() - 0.5) * 0.03, 0.012 * (k - 1)]);
    // porch hood on brackets
    B.box(M.stone, [3.0, 0.26, 1.1], [0, 13.05, towerR(13) + 0.28], [0.07, 0, 0.015]);
    for (const s of [-1, 1]) B.add(M.stone, chamferBox(0.3, 0.8, 0.5), [s * 1.15, 12.6, towerR(12.6) + 0.14], [-0.25, 0, 0]);
    // dead lamp on a swan-neck
    B.tube(M.iron, [V(1.6, 12.2, 6.2), V(1.65, 12.75, 6.75), V(1.65, 12.7, 7.2), V(1.65, 12.4, 7.25)], 0.03, 16, 6);
    B.add(M.iron, new THREE.CylinderGeometry(0.06, 0.22, 0.2, 12, 1, true), [1.65, 12.3, 7.25]);
  }

  /* ── battered buttresses round the footing ─────────────────────────────── */
  for (let k = 0; k < 8; k++) {
    const a = DIM.doorA + ((k + 0.5) / 8) * TAU; if (Math.abs(Math.sin(a - DIM.doorA)) < 0.3 && Math.cos(a - DIM.doorA) > 0) continue;
    const hgt = 3.6 + R() * 1.6;
    const g = new THREE.CylinderGeometry(0.55, 1.15, hgt, 4, 5); g.rotateY(Math.PI / 4);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { p.setX(i, p.getX(i) * 0.85 + (noise3(i, 1, 2) - 0.5) * 0.1); p.setZ(i, p.getZ(i) * 1.25); } g.computeVertexNormals();
    B.add(M.stone, g, cyl(6.55, a, 8.6 + hgt / 2), [0, -a + Math.PI / 2, 0]);
  }

  /* ── keeper's house: roof gone, gable standing ─────────────────────────── */
  {
    const hx = -13.2, hz = 1.5, W = 7.5, L = 9, base = 8.2, yaw = 0.16;
    const H = new Builder();
    const wall = (len, x, z, ry, gable) => {
      const n = Math.round(len / 0.62), rows = 9;
      for (let j = 0; j < rows + (gable ? 5 : 0); j++) for (let i = 0; i < n; i++) {
        const u = (i + 0.5 + (j % 2) * 0.35) / n - 0.5; if (Math.abs(u) > 0.5) continue;
        const gableLim = j > rows ? 0.5 - (j - rows) / 11 : 0.5; if (Math.abs(u) > gableLim) continue;
        const ruin = fbm3(u * 3 + x, j * 0.12, z, 3) * 12 + (gable ? 5 : 0.5); if (j > ruin) continue;
        if (Math.abs(u - 0.18) < 0.085 && j > 2 && j < 7) continue; if (!gable && Math.abs(u + 0.22) < 0.08 && j > 2 && j < 7) continue;
        const px = u * len; const p = V(px, j * 0.42 + 0.2, 0).applyAxisAngle(V(0, 1, 0), ry);
        H.box(M.stone, [0.62 + (R() - 0.5) * 0.1, 0.405, 0.5 + R() * 0.12], [x + p.x, p.y, z + p.z], [(R() - 0.5) * 0.03, ry + (R() - 0.5) * 0.06, (R() - 0.5) * 0.03]);
      }
    };
    wall(L, 0, W / 2, 0, false); wall(L, 0, -W / 2, 0, false); wall(W, -L / 2, 0, Math.PI / 2, true); wall(W, L / 2, 0, Math.PI / 2, false);
    for (let k = 0; k < 4; k++) if (k !== 2) H.bar(M.wood, V(-L / 2 + 1 + k * 1.5, 3.6, W / 2), V(-L / 2 + 1 + k * 1.5 + 0.1, 5.8 - k * 0.5, k === 3 ? 0.9 : 0), 0.11, 5);
    H.bar(M.wood, V(1, 0.3, 1), V(3.2, 3.2, W / 2 - 0.2), 0.12, 5);
    H.box(M.stone, [1.1, 3.2, 1.0], [-L / 2 - 0.1, 5.6, 0], [0, 0, 0.01]);
    const hg = new THREE.Group(); hg.position.set(hx, base, hz); hg.rotation.y = yaw; H.build(hg); group.add(hg);
  }

  /* ── half-way balcony ──────────────────────────────────────────────────── */
  {
    const y = 31.75, a0 = 2.55 - 0.75, a1 = 2.55 + 0.85, r0 = towerR(y) - 0.1, r1 = r0 + 1.25, n = 14;
    for (let k = 0; k < n; k++) {
      const a = a0 + ((k + 0.5) / n) * (a1 - a0); if (k === 10) continue;
      B.box(M.iron, [((a1 - a0) / n) * (r0 + 0.7) * 0.94, 0.06, 1.25], cyl((r0 + r1) / 2, a, y - (k > 10 ? 0.06 : 0)), [k === 11 ? 0.06 : 0, -a + Math.PI / 2, 0]);
    }
    for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (a1 - a0); B.bar(M.iron, cyl(r0 - 0.1, a, y - 1.3), cyl(r1 - 0.1, a, y - 0.05), 0.06); B.bar(M.iron, cyl(r0, a, y - 0.1), cyl(r1, a, y - 0.1), 0.05); }
    for (let k = 0; k <= 16; k++) { if (k === 9 || k === 10 || k === 13) continue; const a = a0 + (k / 16) * (a1 - a0); const lean = k > 7 && k < 14 ? 0.14 : 0; B.bar(M.iron, cyl(r1 - 0.05, a, y), cyl(r1 - 0.05 + lean, a, y + 1.02), 0.018, 5); }
    const rail = (hgt, from, to, sag) => B.tube(M.iron, Array.from({ length: 12 }, (_, i) => { const t = from + (i / 11) * (to - from); return cyl(r1 - 0.05 + sag * Math.sin(t * 9) * 0.1, a0 + t * (a1 - a0), y + hgt - sag * t * t * 0.5); }), 0.028, 30, 6);
    rail(1.05, 0, 0.55, 0.15); rail(0.55, 0, 1, 0.3); rail(1.05, 0.72, 1, 0.1);
    B.bar(M.iron, cyl(r1 - 0.05, a0 + 0.55 * (a1 - a0), y + 0.98), cyl(r1 + 0.5, a0 + 0.62 * (a1 - a0), y - 0.5), 0.028);
    // ladder up to the gallery
    const la = a0 - 0.12; for (const s of [-1, 1]) B.tube(M.iron, Array.from({ length: 8 }, (_, i) => { const yy = y - 0.2 + (i / 7) * 21; return cyl(towerR(yy) + 0.28, la + s * 0.045, yy); }), 0.03, 24, 5);
    for (let k = 0; k < 58; k++) { if (k === 21 || k === 22 || k === 40) continue; const yy = y + k * 0.36; const p = cyl(towerR(yy) + 0.28, la - 0.045, yy), q = cyl(towerR(yy) + 0.28, la + 0.045, yy - (k === 30 ? 0.18 : 0)); B.bar(M.iron, p, q, 0.018, 5); }
  }

  /* ── gallery: corbels, deck, rail, guano and loss ─────────────────────── */
  const top = DIM.top, gr = DIM.galleryR;
  {
    const nC = 28; for (let k = 0; k < nC; k++) {
      const a = (k / nC) * TAU, n = cyl(1, a, 0); if (k === 11) continue;
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(1.45, 0); sh.lineTo(1.45, -0.28); sh.bezierCurveTo(1.0, -0.36, 0.7, -0.7, 0.62, -1.0); sh.bezierCurveTo(0.45, -1.15, 0.28, -1.5, 0, -2.1); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.36, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1, curveSegments: 6 }); g.translate(0, 0, -0.18);
      B.add(M.stone, g, n.clone().multiplyScalar(towerR(top) - 0.12).setY(top - 0.32), [0, -a, 0]);
    }
    const prof = [[3.4, top - 0.32], [gr - 0.1, top - 0.32], [gr, top - 0.24], [gr + 0.06, top - 0.1], [gr, top - 0.02], [gr - 0.05, top], [3.4, top]].map(([r, y]) => new THREE.Vector2(r, y));
    B.add(M.stone, new THREE.LatheGeometry(prof, 96));
    const nB = 84; for (let k = 0; k < nB; k++) {
      const a = (k / nB) * TAU; const gone = (k > 17 && k < 23) || k === 40 || k === 41 || k === 63; if (gone && k % 2) continue;
      const bend = (R() - 0.5) * (gone ? 0.6 : 0.05); B.bar(M.iron, cyl(gr - 0.12, a, top), cyl(gr - 0.12 + bend, a + bend * 0.1, top + 1.08 * (gone ? 0.5 + R() * 0.4 : 1)), 0.017, 5);
    }
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; B.bar(M.iron, cyl(gr - 0.12, a, top), cyl(gr - 0.12, a, top + 1.22), 0.045, 8, 0.035); B.add(M.iron, new THREE.SphereGeometry(0.07, 10, 8), cyl(gr - 0.12, a, top + 1.28)); B.bar(M.iron, cyl(gr - 0.75, a, top), cyl(gr - 0.12, a, top + 0.7), 0.02, 5); }
    const ring = (h, a0, a1, w = 0) => B.tube(M.iron, Array.from({ length: 40 }, (_, i) => { const t = i / 39, a = a0 + t * (a1 - a0); return cyl(gr - 0.12 + w * Math.sin(t * Math.PI * 7) * 0.03, a, top + h - w * t * t * 0.16); }), 0.03, 90, 6);
    const g0 = (23 / nB) * TAU, g1 = (17.4 / nB) * TAU + TAU; ring(1.1, g0, g1, 1); ring(0.55, g0, g1, 0.4);
    B.tube(M.iron, [cyl(gr - 0.12, g1, top + 1), cyl(gr + 0.2, g1 + 0.1, top + 0.4), cyl(gr + 0.15, g1 + 0.13, top - 1.4), cyl(gr + 0.4, g1 + 0.12, top - 2.6)], 0.028, 20, 6);
    // cable torn loose, swinging down the weather side
    B.tube(M.iron, [cyl(5.5, 4.2, top - 0.2), cyl(5.2, 4.22, 46), cyl(5.35, 4.28, 36), cyl(6.3, 4.4, 27), cyl(6.6, 4.5, 24)], 0.025, 50, 5);
  }

  /* ── lantern house: parapet, diagonal astragals, cupola ───────────────── */
  const lr = DIM.lanternR + 0.12, y0 = DIM.glassY0, y1 = DIM.glassY1, BAYS = 12;
  const bay0 = DIM.bayA - TAU / BAYS / 2; // bay index 0 is centred on the opening
  {
    const pr = [[lr - 0.18, top], [lr + 0.12, top], [lr + 0.12, top + 0.12], [lr + 0.05, top + 0.2], [lr + 0.05, y0 - 0.16], [lr + 0.14, y0 - 0.1], [lr + 0.14, y0], [lr - 0.18, y0], [lr - 0.18, top]].map(([r, y]) => new THREE.Vector2(r, y));
    B.add(M.iron, new THREE.LatheGeometry(pr, 72));
    for (let k = 0; k < 36; k++) B.add(M.iron, new THREE.SphereGeometry(0.035, 6, 5), cyl(lr + 0.06, (k / 36) * TAU, top + 0.32)).add(M.iron, new THREE.SphereGeometry(0.035, 6, 5), cyl(lr + 0.06, (k / 36) * TAU, y0 - 0.24));
    const rows = 3, hR = (y1 - y0) / rows;
    for (let j = 0; j < rows; j++) for (let k = 0; k < BAYS; k++) {
      const a = bay0 + (k / BAYS) * TAU, b = bay0 + ((k + 1) / BAYS) * TAU, y = y0 + j * hR;
      if (k === 0) continue;
      B.bar(M.iron, cyl(lr, j % 2 ? b : a, y), cyl(lr, j % 2 ? a : b, y + hR), 0.032, 6);
      B.bar(M.iron, cyl(lr, (a + b) / 2, y), cyl(lr, j % 2 ? b : a, y + hR * 0.5), 0.02, 5);
    }
    for (let k = 0; k < BAYS; k++) { const a = bay0 + (k / BAYS) * TAU; B.bar(M.iron, cyl(lr, a, y0), cyl(lr, a, y1), 0.05, 8); }
    for (let j = 1; j < rows; j++) for (let k = 1; k < BAYS; k++) B.bar(M.iron, cyl(lr, bay0 + (k / BAYS) * TAU, y0 + j * hR), cyl(lr, bay0 + ((k + 1) / BAYS) * TAU, y0 + j * hR), 0.026, 6);
    // bent remains in the missing bay
    const a = bay0 + 0.1; B.tube(M.iron, [cyl(lr, a, y1), cyl(lr + 0.1, a + 0.05, y1 - 0.6), cyl(lr + 0.5, a + 0.02, y1 - 1.0)], 0.028, 12, 5);
    B.tube(M.iron, [cyl(lr, bay0 + 0.45, y0), cyl(lr + 0.14, bay0 + 0.42, y0 + 0.4), cyl(lr + 0.35, bay0 + 0.33, y0 + 0.6)], 0.028, 12, 5);
    // eaves gutter + cupola (ogee) with ribs, vent drum, ball, vane
    const cup = [[lr - 0.2, y1], [lr + 0.22, y1], [lr + 0.34, y1 + 0.08], [lr + 0.34, y1 + 0.2], [lr + 0.16, y1 + 0.26], [lr + 0.02, y1 + 0.5], [lr - 0.35, y1 + 1.0], [lr - 0.95, y1 + 1.5], [lr - 1.7, y1 + 1.88], [lr - 2.5, y1 + 2.1], [0.62, y1 + 2.22], [0.58, y1 + 2.3]].map(([r, y]) => new THREE.Vector2(r, y));
    const cg = new THREE.LatheGeometry(cup, 48); { const p = cg.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = (noise3(v.x * 1.4, v.y * 2, v.z * 1.4) - 0.5) * 0.08; p.setXYZ(i, v.x * (1 + k * 0.3), v.y + k * 0.5, v.z * (1 + k * 0.3)); } cg.computeVertexNormals(); }
    const copperD = surface('copper', { side: THREE.DoubleSide });
    const cm = new THREE.Mesh(cg, copperD); cm.castShadow = cm.receiveShadow = true; group.add(cm);
    for (let k = 0; k < 12; k++) { const a = bay0 + (k / 12) * TAU; B.tube(M.copper, cup.slice(4, 11).map((p) => cyl(p.x + 0.02, a, p.y + 0.03)), 0.045, 16, 5); }
    const vent = [[0.58, 0], [0.62, 0.05], [0.5, 0.1], [0.5, 0.5], [0.72, 0.55], [0.74, 0.62], [0.35, 0.86], [0.14, 0.95], [0.1, 1.1]].map(([r, y]) => new THREE.Vector2(r, y1 + 2.28 + y));
    B.add(M.copper, new THREE.LatheGeometry(vent, 28)); B.add(M.copper, new THREE.SphereGeometry(0.3, 20, 14), [0, y1 + 3.6, 0]);
    B.bar(M.iron, V(0, y1 + 3.8, 0), V(0.09, y1 + 6.1, 0.04), 0.03, 6, 0.008);
    const vane = y1 + 4.7; B.bar(M.iron, V(-0.75, vane, -0.2), V(0.85, vane + 0.05, 0.24), 0.018, 5); B.add(M.iron, new THREE.ConeGeometry(0.1, 0.28, 6), [0.95, vane + 0.05, 0.27], [0, -0.25, -Math.PI / 2]);
    B.box(M.iron, [0.42, 0.34, 0.02], [-0.66, vane, -0.18], [0, -0.26, 0.06]);
    // storm rail around the cupola, half gone
    for (let k = 0; k < 8; k++) if (k !== 3 && k !== 4) { const a = k / 8 * TAU; B.bar(M.iron, cyl(lr + 0.05, a, y1 + 0.5), cyl(lr + 0.05, a, y1 + 1.1), 0.018, 5); }
    B.tube(M.iron, Array.from({ length: 30 }, (_, i) => cyl(lr + 0.05, (5 / 8 + (i / 29) * 0.62) * TAU, y1 + 1.08)), 0.02, 60, 5);
  }
  // glass: separate, transparent, some panes simply missing
  {
    const rows = 3, hR = (y1 - y0) / rows; const pos = [], uv = [];
    for (let k = 1; k < BAYS; k++) for (let j = 0; j < rows; j++) for (let t = 0; t < 2; t++) {
      if (R() < 0.13) continue;
      const a = bay0 + (k / BAYS) * TAU, b = bay0 + ((k + 1) / BAYS) * TAU, y = y0 + j * hR, yy = y + hR, f = j % 2;
      const P = f ? (t ? [[a, y], [b, y], [a, yy]] : [[b, y], [b, yy], [a, yy]]) : (t ? [[a, y], [b, y], [b, yy]] : [[a, y], [b, yy], [a, yy]]);
      for (const [q, h] of P) { const p = cyl(lr, q, h); pos.push(p.x, p.y, p.z); uv.push(q * 2, h); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    group.userData.paneGeometry = g;
  }
  B.build(group);

  // landing stage, down by the water
  {
    const L = new Builder(); const p0 = V(3.5, 0, 25);
    for (let k = 0; k < 16; k++) { if (k === 5 || k === 11) continue; const x = p0.x + k * 0.55; L.box(M.wood, [0.48, 0.09, 2.4], [x, 3.0 - k * 0.04 + (R() - 0.5) * 0.05, p0.z + 8 + Math.sin(k) * 0.05], [(R() - 0.5) * 0.06, (R() - 0.5) * 0.08, (R() - 0.5) * 0.03]); }
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) L.bar(M.wood, V(p0.x + k * 2, -4, p0.z + 8 + s * 1.0), V(p0.x + k * 2 + (R() - 0.5) * 0.3, 3.4 + R() * 0.9, p0.z + 8 + s * 1.05), 0.16, 7, 0.13);
    L.build(group);
    // iron handrail up the rock path to the door
    const H = new Builder(), pts = []; for (let k = 0; k <= 9; k++) { const z = 8.5 + k * 1.25, x = 1.75 + Math.sin(k) * 0.12; const y = rockH(x, z); H.bar(M.iron, V(x, y - 0.2, z), V(x + (R() - 0.5) * 0.12, y + 1, z), 0.025, 6); pts.push(V(x, y + 1 - (k === 5 ? 0.25 : 0), z)); }
    H.tube(M.iron, pts, 0.022, 40, 5); H.build(group);
  }
  return group;
}
