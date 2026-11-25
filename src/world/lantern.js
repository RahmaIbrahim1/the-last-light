import * as THREE from 'three';
import { U, DIM, stairA } from '../core/shared.js';
import { TAU, cyl, rng, V, clamp, damp } from '../core/math.js';
import { COMMON } from '../glsl/chunks.js';
import { surface } from './materials.js';
import { Builder } from './build.js';

const T = DIM.top;
/** Where the three fragrances live. Three materials, three heights, three corners of the machine. */
export const PLINTHS = {
  deep: { a: (118 * Math.PI) / 180, r: 1.72, y: T + 0.98 },
  storm: { a: (322 * Math.PI) / 180, r: 2.05, y: T + 0.72 },
  light: { a: (245 * Math.PI) / 180, r: 1.36, y: T + 1.16 },
};
export const LEVER = { a: (66 * Math.PI) / 180, r: 1.72 };

const VS = 'varying vec3 vW;varying vec3 vN;varying vec2 vU;void main(){vU=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
const glassFrag = /* glsl */`${COMMON}
varying vec3 vW;varying vec3 vN;varying vec2 vU;
void main(){
  vec3 V=normalize(cameraPosition-vW),N=normalize(vN);float nv=abs(dot(N,V));
  float F=.03+.97*pow(1.-nv,4.);
  vec3 R=reflect(-V,N);
  vec3 c=vec3(.16,.22,.26)*F*(.35+.65*smoothstep(-.2,.6,R.y));
  c+=uMoonCol*pow(max(dot(R,uMoonDir),0.),60.)*.6+vec3(.6,.7,.9)*uFlash*F*.6;
  vec3 l=normalize(vec3(.9,55.2,-1.2)-vW);c+=vec3(1.,.55,.22)*pow(max(dot(R,l),0.),140.)*.9;
  float lit=uLamp; float facing=pow(abs(dot(N,normalize(uBeamDir))),6.);
  c+=uBeamCol*lit*(.05+pow(1.-nv,1.5)*.42+facing*.55);
  c+=vec3(.7,.35,.12)*(1.-lit)*pow(1.-nv,3.)*.05;
  gl_FragColor=vec4(c,.10+F*.55+lit*.12);
}`;
const paneFrag = /* glsl */`${COMMON}varying vec3 vW;varying vec2 vU;void main(){
  vec3 N=normalize(vec3(vW.x,0.,vW.z)),V=normalize(cameraPosition-vW);float nv=abs(dot(N,V));float F=.04+.96*pow(1.-nv,5.);
  float g=texture2D(tNoise,vU*.17).r,s=texture2D(tNoise,vec2(vU.x*.7,vU.y*.06)).r;
  float run=smoothstep(.60,.75,texture2D(tNoise,vec2(vU.x*2.1,vU.y*.10+uTime*.018)).r)*smoothstep(.4,.6,texture2D(tNoise,vec2(vU.x*1.1,vU.y*.5+uTime*.07)).r);
  float dirt=smoothstep(.45,.85,g*.7+s*.5)*.34+smoothstep(57.9,58.35,vW.y)*.3+smoothstep(55.5,54.95,vW.y)*.3;
  vec3 c=vec3(.020,.026,.031)*dirt*1.4+vec3(.10,.14,.18)*F*.35+vec3(.3,.38,.5)*uFlash*(dirt*.5+F*.4+run*.2)+vec3(.05,.07,.09)*run;
  c+=uBeamCol*uLamp*(dirt*.18+run*.15+.01)*(.3+pow(abs(dot(N,normalize(uBeamDir))),12.)*1.6);
  gl_FragColor=vec4(c,sat(dirt*.6+F*.35+run*.16));}`;

/** One bull's-eye panel: a central lens and prismatic rings wrapped on a cylinder — a true Fresnel profile. */
function fresnelPanel(radius, width, height) {
  const parts = [];
  const wrap = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i); const z = p.getZ(i);
      x = clamp(x, -width / 2, width / 2); y = clamp(y, -height / 2, height / 2);
      const a = x / radius, r = radius + z - 0.22 * Math.pow(Math.abs(y) / (height / 2), 2);
      p.setXYZ(i, Math.sin(a) * r, y, Math.cos(a) * r);
    }
    g.computeVertexNormals(); return g;
  };
  const lens = new THREE.LatheGeometry([0.17, 0.14, 0.1, 0.05, 0].map((r) => new THREE.Vector2(r, 0.075 * (1 - (r / 0.17) ** 2))), 40); lens.rotateX(Math.PI / 2); parts.push(wrap(lens));
  for (let k = 0; k < 10; k++) {
    const r0 = 0.185 + k * 0.1, r1 = r0 + 0.088, h = 0.085;
    const g = new THREE.LatheGeometry([[r0, 0], [r1, 0], [r1 - 0.004, 0.012], [r0 + 0.012, h], [r0, h * 0.9], [r0, 0]].map(([x, y]) => new THREE.Vector2(x, y)), 72);
    g.rotateX(Math.PI / 2); parts.push(wrap(g));
  }
  return parts;
}

function gearGeometry(r, t, teeth) {
  const s = new THREE.Shape(), st = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * st;
    for (const [f, rr] of [[0, r - 0.028], [0.22, r], [0.5, r], [0.72, r - 0.028]]) {
      const x = Math.cos(a + f * st) * rr, y = Math.sin(a + f * st) * rr;
      if (i === 0 && f === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
  }
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU, h = new THREE.Path(); h.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.2, 0, TAU, true); s.holes.push(h); }
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 8 });
}

export function createLantern(paneGeometry) {
  const group = new THREE.Group(), B = new Builder(), R = rng(1234);
  const M = { iron: surface('iron'), ironD: surface('iron', { side: THREE.DoubleSide }), brass: surface('brass'), wood: surface('wood'), basalt: surface('basalt'), char: surface('char'), stone: surface('floor') };
  const glass = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: VS, fragmentShader: glassFrag });

  /* ── panes: grime, salt bloom, rain runs ─────────────────────────────── */
  const pane = new THREE.Mesh(paneGeometry, new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: VS, fragmentShader: paneFrag }));
  pane.renderOrder = 22; group.add(pane);

  /* ── floor with the stair hatch ──────────────────────────────────────── */
  {
    const a1 = stairA(1), a0 = a1 - 2.15, rIn = DIM.lanternR - DIM.stairW - 0.1, rOut = DIM.lanternR + 0.3, pos = [];
    const N = 96, push = (p, q, r, s) => pos.push(...p, ...q, ...r, ...p, ...r, ...s);
    const P = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, b = ((i + 1) / N) * TAU, m = (((a + b) / 2 - a0) % TAU + TAU) % TAU, hole = m < a1 - a0;
      const bands = hole ? [[0.2, rIn]] : [[0.2, rIn], [rIn, rOut]];
      for (const [r0, r1] of bands) { push(P(r0, a, T), P(r0, b, T), P(r1, b, T), P(r1, a, T)); push(P(r0, a, T - 0.14), P(r1, a, T - 0.14), P(r1, b, T - 0.14), P(r0, b, T - 0.14)); }
      if (hole) push(P(rIn, a, T), P(rIn, b, T), P(rIn, b, T - 0.14), P(rIn, a, T - 0.14));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    B.add(M.ironD, g);
    for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; B.bar(M.iron, cyl(0.4, a, T - 0.2), cyl(rIn, a, T - 0.2), 0.04, 4); }
    const K = 9; for (let k = 0; k < K; k++) { const a = a0 + (k / K) * (a1 - a0); B.bar(M.iron, cyl(rIn - 0.04, a, T), cyl(rIn - 0.04, a, T + 0.86), 0.018, 6); }
    B.tube(M.brass, Array.from({ length: 16 }, (_, i) => cyl(rIn - 0.04, a0 + (i / 15) * (a1 - a0), T + 0.88)), 0.026, 40, 6);
  }

  /* ── pedestal, clockwork, gear train ─────────────────────────────────── */
  const ped = [[0.02, 0], [0.98, 0], [0.98, 0.1], [0.82, 0.16], [0.6, 0.34], [0.5, 0.7], [0.5, 1.05], [0.62, 1.2], [0.9, 1.26], [0.9, 1.34], [0.02, 1.34]].map(([r, y]) => new THREE.Vector2(r, T + y));
  B.add(M.iron, new THREE.LatheGeometry(ped, 56));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; B.box(M.iron, [0.42, 0.62, 0.05], cyl(0.6, a, T + 0.42), [0, -a, 0]); B.add(M.brass, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), cyl(0.9, a + 0.2, T + 0.12)); }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; B.add(M.brass, new THREE.CylinderGeometry(0.055, 0.055, 0.1, 14), cyl(0.8, a, T + 1.39), [0, -a, Math.PI / 2]); }
  const ca = LEVER.a, cs = cyl(1.12, ca, T);
  const loc = (u, y, d) => V(cs.x + Math.cos(ca) * d - Math.sin(ca) * u, T + y, cs.z + Math.sin(ca) * d + Math.cos(ca) * u);
  for (const u of [-0.36, 0.36]) B.box(M.iron, [0.5, 1.0, 0.045], loc(u, 0.52, 0), [0, -ca, 0]);
  B.box(M.iron, [0.56, 0.06, 0.82], loc(0, 1.04, 0), [0, -ca, 0]); B.box(M.iron, [0.62, 0.1, 0.86], loc(0, 0.05, 0), [0, -ca, 0]);
  const gears = [];
  for (const [u, y, r, teeth, sp, d] of [[-0.02, 0.42, 0.27, 44, 1, 0.1], [0.2, 0.74, 0.13, 20, -2.2, 0.1], [-0.2, 0.78, 0.16, 26, -1.7, 0.04], [0.1, 0.42, 0.1, 16, 2.6, 0.2]]) {
    const m = new THREE.Mesh(gearGeometry(r, 0.04, teeth), M.brass), p = new THREE.Group();
    p.position.copy(loc(u, y, d + 0.05)); p.rotation.y = -ca + Math.PI / 2; p.add(m); group.add(p); gears.push({ m, sp });
    B.bar(M.iron, loc(u, y, -0.12), loc(u, y, d + 0.14), 0.02, 8);
  }
  B.add(M.wood, new THREE.CylinderGeometry(0.14, 0.14, 0.6, 18), loc(0, 0.7, -0.14), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(-Math.sin(ca), 0, Math.cos(ca))));

  /* switchboard: knife switches, gauge, conduit */
  {
    const a = LEVER.a - 0.8, p = cyl(1.28, a, T), n = cyl(1, a, 0);
    B.box(M.iron, [0.09, 1.1, 0.62], [p.x, T + 0.62, p.z], [0, -a, 0]); B.box(M.wood, [0.04, 0.72, 0.5], cyl(1.34, a, T + 0.76), [0, -a, 0]);
    for (let k = 0; k < 3; k++) {
      const q = cyl(1.4, a - 0.11 + k * 0.11, T + 0.66);
      B.bar(M.brass, V(q.x, q.y - 0.12, q.z), V(q.x, q.y + 0.1, q.z).addScaledVector(n, 0.10), 0.013, 6);
      B.add(M.iron, new THREE.SphereGeometry(0.028, 10, 8), V(q.x, q.y + 0.12, q.z).addScaledVector(n, 0.11));
      for (const dy of [-0.13, 0.1]) B.box(M.brass, [0.05, 0.03, 0.05], [q.x, q.y + dy, q.z], [0, -a, 0]);
    }
    B.add(M.brass, new THREE.CylinderGeometry(0.11, 0.12, 0.06, 28), cyl(1.4, a, T + 0.98), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n));
    B.tube(M.iron, [cyl(1.3, a, T + 0.1), cyl(1.9, a + 0.2, T + 0.05), cyl(2.9, a + 0.3, T + 0.05), cyl(3.4, a + 0.32, T + 0.4)], 0.028, 24, 6);
  }

  /* ── plinths: basalt block, charred mooring post, brass tripod ───────── */
  {
    const p = PLINTHS.deep; B.box(M.stone, [0.62, 0.3, 0.6], cyl(p.r, p.a, T + 0.15), [0, 0.3, 0]);
    const g = new THREE.CylinderGeometry(0.25, 0.33, 0.68, 7, 8); const at = g.attributes.position;
    for (let i = 0; i < at.count; i++) if (Math.abs(at.getY(i)) < 0.33) at.setX(i, at.getX(i) * (1 + (R() - 0.5) * 0.05));
    const gg = g.toNonIndexed(); gg.computeVertexNormals();
    const b = new THREE.Mesh(gg, M.basalt); b.position.copy(cyl(p.r, p.a, T + 0.64)); b.rotation.y = 0.5; b.castShadow = b.receiveShadow = true; group.add(b);
    for (let k = 0; k < 9; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04 + R() * 0.05, 2), M.basalt); m.scale.y = 0.6; const a = R() * TAU; m.position.copy(cyl(p.r, p.a, T)).add(V(Math.cos(a) * (0.42 + R() * 0.15), 0.03, Math.sin(a) * (0.42 + R() * 0.15))); group.add(m); }
  }
  {
    const p = PLINTHS.storm, g = new THREE.CylinderGeometry(0.24, 0.27, 0.72, 26, 14), at = g.attributes.position;
    for (let i = 0; i < at.count; i++) { const x = at.getX(i), z = at.getZ(i), a = Math.atan2(z, x), k = 1 + Math.sin(a * 9 + at.getY(i) * 3) * 0.025; at.setXYZ(i, x * k, at.getY(i), z * k); } g.computeVertexNormals();
    const m = new THREE.Mesh(g, M.char); m.position.copy(cyl(p.r, p.a, T + 0.36)); m.castShadow = m.receiveShadow = true; group.add(m);
    for (const y of [0.14, 0.58]) B.add(M.iron, new THREE.TorusGeometry(0.27, 0.022, 6, 36), cyl(p.r, p.a, T + y), [Math.PI / 2, 0, 0]);
  }
  {
    const p = PLINTHS.light, c = cyl(p.r, p.a, T);
    B.add(M.brass, new THREE.CylinderGeometry(0.24, 0.24, 0.035, 48), [c.x, p.y - 0.018, c.z]); B.add(M.brass, new THREE.TorusGeometry(0.24, 0.014, 8, 48), [c.x, p.y - 0.015, c.z], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.4; B.tube(M.brass, [V(c.x + Math.cos(a) * 0.17, p.y - 0.03, c.z + Math.sin(a) * 0.17), V(c.x + Math.cos(a) * 0.1, T + 0.6, c.z + Math.sin(a) * 0.1), V(c.x + Math.cos(a) * 0.26, T, c.z + Math.sin(a) * 0.26)], 0.018, 20, 8); }
    B.add(M.brass, new THREE.TorusGeometry(0.11, 0.01, 6, 30), [c.x, T + 0.58, c.z], [Math.PI / 2, 0, 0]);
  }
  B.build(group, { cast: true });

  // an oil lamp on a hook: the only warmth up here until the light
  const oil = new THREE.PointLight(new THREE.Color(1, 0.56, 0.24), 14, 9, 1.6); oil.position.set(0.9, T + 1.5, -1.5);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 1.3) })); flame.position.copy(oil.position); flame.scale.set(0.8, 2, 0.8);
  {
    const L = new Builder(); L.add(M.brass, new THREE.CylinderGeometry(0.1, 0.12, 0.08, 16), [0.9, T + 1.36, -1.5]); L.add(M.brass, new THREE.CylinderGeometry(0.03, 0.1, 0.08, 16), [0.9, T + 1.72, -1.5]);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; L.bar(M.iron, V(0.9 + Math.cos(a) * .09, T + 1.38, -1.5 + Math.sin(a) * .09), V(0.9 + Math.cos(a) * .085, T + 1.7, -1.5 + Math.sin(a) * .085), 0.005, 4); }
    L.bar(M.iron, V(0.9, T + 1.7, -1.5), V(0.9, T + 5.2, -1.5), 0.01, 5); L.build(group, { cast: false });
  }
  group.add(oil, flame);

  /* ── the lens ────────────────────────────────────────────────────────── */
  const lens = new THREE.Group(); lens.position.y = U.uLampPos.value.y; group.add(lens);
  const lr = 0.86, PN = 4, LB = new Builder(), W = (TAU * lr) / PN * 0.97;
  const panel = fresnelPanel(lr, W, 2.0);
  for (let k = 0; k < PN; k++) {
    const a = (k / PN) * TAU; panel.forEach((g) => LB.add(glass, g, [0, 0, 0], [0, a, 0]));
    const e = a + Math.PI / PN; const ring = (y) => cyl(lr - 0.22 * y * y + 0.03, -e + Math.PI / 2, y);
    LB.tube(M.brass, [-1.02, -0.5, 0, 0.5, 1.02].map(ring), 0.032, 20, 8);
    LB.bar(M.brass, ring(1.02), V(0, 1.42, 0), 0.02, 6);
  }
  for (const y of [-1.03, 1.03]) LB.add(M.brass, new THREE.TorusGeometry(lr - 0.2, 0.045, 8, 64), [0, y, 0], [Math.PI / 2, 0, 0]);
  LB.add(M.brass, new THREE.CylinderGeometry(0.75, 0.8, 0.1, 56), [0, -1.12, 0]); LB.add(M.brass, new THREE.SphereGeometry(0.1, 16, 12), [0, 1.45, 0]);
  const tg = gearGeometry(0.82, 0.05, 96); tg.rotateX(Math.PI / 2); LB.add(M.iron, tg, [0, -1.16, 0]);
  LB.add(M.brass, new THREE.CylinderGeometry(0.08, 0.14, 0.75, 16), [0, -0.72, 0]);
  LB.build(lens, { cast: false });
  lens.children.forEach((c) => { if (c.material === glass) c.renderOrder = 20; });
  const mantleMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const mantle = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 6, 16), mantleMat); lens.add(mantle);
  const lampLight = new THREE.PointLight(new THREE.Color(1, 0.72, 0.4), 0, 14, 1.5); lampLight.position.copy(U.uLampPos.value); group.add(lampLight);
  // shared highlight for whichever bottle has attention
  const accent = new THREE.SpotLight(0xffffff, 0, 5, 0.42, 0.9, 1.4); group.add(accent, accent.target);
  const accent2 = new THREE.PointLight(0xffffff, 0, 2.6, 1.8); group.add(accent2);

  /* ── the lever ───────────────────────────────────────────────────────── */
  const lever = new THREE.Group(); lever.position.copy(cyl(LEVER.r, LEVER.a, T + 0.42)); lever.rotation.y = -LEVER.a + Math.PI / 2;
  const base = new THREE.Group(), arm = new THREE.Group(); lever.add(base, arm); group.add(lever);
  {
    const b = new Builder();
    b.box(M.iron, [0.42, 0.42, 0.34], [0, -0.21, 0]);
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape(); sh.absarc(0, 0, 0.34, 0.25, Math.PI - 0.25, false); sh.absarc(0, 0, 0.12, Math.PI - 0.25, 0.25, true);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 1 }); g.rotateY(Math.PI / 2);
      b.add(M.iron, g, [s * 0.1 - 0.0125, 0.02, 0]);
    }
    for (let k = 0; k < 9; k++) { const a = 0.45 + k * 0.28; b.box(M.brass, [0.22, 0.02, 0.02], [0, 0.02 + Math.sin(a) * 0.335, Math.cos(a) * 0.335], [-a, 0, 0]); }
    b.add(M.brass, new THREE.CylinderGeometry(0.055, 0.055, 0.34, 16), [0, 0.04, 0], [0, 0, Math.PI / 2]); b.build(base, { cast: false });
    const g = new Builder();
    g.bar(M.iron, V(0, 0, 0), V(0, 0.92, 0), 0.032, 10, 0.024); g.add(M.wood, new THREE.CapsuleGeometry(0.043, 0.2, 5, 14), [0, 1.02, 0]);
    g.add(M.brass, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), [0, 0.89, 0]); g.add(M.brass, new THREE.SphereGeometry(0.046, 14, 10), [0, 1.18, 0]);
    g.bar(M.brass, V(0.045, 0.4, 0), V(0.045, 0.98, 0.02), 0.009, 6); g.box(M.brass, [0.05, 0.1, 0.06], [0.03, 0.38, 0]); g.build(arm, { cast: false });
  }
  const pick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 1.1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); pick.position.y = 0.5; lever.add(pick);
  arm.rotation.x = -0.72;

  let spin = 0, vel = 0;
  return {
    group, lens, lever, arm, pick, lampLight, accent, accent2, mantle, oil, targetSpin: 0,
    get spinVel() { return vel; },
    update(dt, t) {
      vel = damp(vel, this.targetSpin, 0.35, dt); spin += vel * dt;
      lens.rotation.y = -spin;
      U.uBeamDir.value.set(Math.cos(spin + Math.PI / 2), 0, Math.sin(spin + Math.PI / 2));
      for (const g of gears) g.m.rotation.z = spin * 5 * g.sp;
      const l = U.uLamp.value; mantleMat.color.setRGB(14 * l + 0.02, 9 * l + 0.015, 4.2 * l + 0.01);
      lampLight.intensity = l * 14 * (0.75 + 0.25 * Math.sin(spin * 4));
      oil.intensity = (14 - l * 6) * (0.9 + 0.08 * Math.sin(t * 8.1) + 0.05 * Math.sin(t * 3.3));
    },
  };
}
