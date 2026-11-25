import * as THREE from 'three';
import { U, DIM, innerR, stairA, stairY } from '../core/shared.js';
import { TAU, cyl, rng, V, lerp } from '../core/math.js';
import { Q } from '../core/quality.js';
import { COMMON } from '../glsl/chunks.js';
import { surface } from './materials.js';
import { Builder } from './build.js';
import { OPENINGS } from './lighthouse.js';

/** Additive light shaft with drifting dust: moonlight through broken windows. */
function shaftMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uCol: { value: new THREE.Color(...color) }, uS: { value: strength } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vW;varying vec2 vU;varying vec3 vN;void main(){vU=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: `${COMMON}varying vec3 vW;varying vec2 vU;varying vec3 vN;uniform vec3 uCol;uniform float uS;
      void main(){float e=abs(dot(normalize(vN),normalize(cameraPosition-vW)));
        float n=texture2D(tNoise,vec2(vW.x+vW.z,vW.y)*.13+uTime*.006).r;
        float a=pow(e,1.6)*smoothstep(0.,.10,vU.y)*pow(sat(1.-vU.y),1.25)*(.35+n);
        a*=smoothstep(.15,1.6,length(cameraPosition-vW));
        gl_FragColor=vec4(uCol*a*uS*(1.+uFlash*9.),1.);}`,
  });
}

export function createInterior() {
  const group = new THREE.Group(), B = new Builder(), R = rng(99);
  const M = { floor: surface('floor'), iron: surface('iron'), wood: surface('wood'), stone: surface('inner', { side: THREE.DoubleSide }), brass: surface('brass') };

  /* ground floor */
  B.add(M.floor, new THREE.CylinderGeometry(innerR(DIM.floor) + 0.4, innerR(DIM.floor) + 0.4, 0.3, 72), [0, DIM.floor - 0.15, 0]);
  B.box(M.floor, [1.6, 0.3, 2.6], [0, DIM.floor - 0.16, 5.9]);

  /* ── staircase: cantilevered treads, continuous stringer, balustrade ──── */
  const total = DIM.top - DIM.floor, n = Math.round(total / 0.2), stepA = (DIM.turns * TAU) / n;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n, a = stairA(s), y = stairY((i + 1) / n), ro = innerR(y) + 0.05, w = DIM.stairW + 0.05, rm = ro - w / 2;
    const depth = stepA * rm;
    if (i > 40 && (i * 7919) % 53 === 0) { B.box(M.iron, [w * 0.45, 0.05, depth * 1.1], cyl(ro - w * 0.25, a, y - 0.03), [0, -a, 0.04]); continue; }
    B.box(M.iron, [w, 0.045, depth * 1.22], cyl(rm, a, y - 0.025), [0, -a, (R() - 0.5) * 0.012]);
    B.box(M.iron, [w * 0.94, 0.05, 0.05], cyl(rm, a - stepA * 0.5, y - 0.075), [0, -a, 0]);
  }
  const helix = (dr, dy, s0, s1, k) => Array.from({ length: k }, (_, i) => { const s = lerp(s0, s1, i / (k - 1)), y = stairY(s); return cyl(innerR(y) - DIM.stairW + dr, stairA(s), y + dy); });
  {
    const N = n * 2, pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const s = i / N, y = stairY(s), a = stairA(s), r = innerR(y) - DIM.stairW; for (const [dr, dy] of [[0, -0.26], [-0.05, -0.26], [-0.05, 0.1], [0, 0.1]]) { const p = cyl(r + dr, a, y + dy); pos.push(p.x, p.y, p.z); } }
    for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b = i * 4 + ((k + 1) % 4); idx.push(a, b, a + 4, b, b + 4, a + 4); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const gg = g.toNonIndexed(); gg.computeVertexNormals(); B.add(M.iron, gg);
  }
  const RAIL = Q.mobile ? 420 : 900;
  B.tube(M.brass, helix(-0.02, 0.98, 0.004, 1, 260), 0.032, RAIL, 6);
  B.tube(M.iron, helix(-0.02, 0.52, 0.004, 1, 260), 0.014, RAIL, 4);
  for (let i = 0; i < n; i += 2) { if (i > 90 && (i * 31) % 67 < 4) continue; const s = i / n, y = stairY(s), r = innerR(y) - DIM.stairW - 0.02, a = stairA(s); B.bar(M.iron, cyl(r, a, y), cyl(r, a, y + 0.97), 0.013, 4); }
  const nr = innerR(DIM.floor) - DIM.stairW - 0.02;
  B.bar(M.iron, cyl(nr, stairA(0), DIM.floor), cyl(nr, stairA(0), DIM.floor + 1.15), 0.06, 10);
  B.add(M.brass, new THREE.SphereGeometry(0.09, 14, 10), cyl(nr, stairA(0), DIM.floor + 1.2));

  /* ── the well: weight tube, chains, clockwork weights ────────────────── */
  B.bar(M.iron, V(0, 33, 0), V(0, DIM.top, 0), 0.26, 16);
  for (let y = 33; y < 54; y += 3.4) B.add(M.iron, new THREE.TorusGeometry(0.28, 0.04, 6, 20), [0, y, 0], [Math.PI / 2, 0, 0]);
  const link = new THREE.TorusGeometry(0.055, 0.016, 5, 10); link.scale(1, 1.5, 1);
  for (const [x, z, yb] of [[0.12, 0.0, 17.5], [-0.12, 0.05, 25]]) {
    for (let y = yb, k = 0; y < 33; y += Q.mobile ? 0.27 : 0.135, k++) B.add(M.iron, link, [x, y, z], [0, k % 2 ? Math.PI / 2 : 0, 0]);
    for (let k = 0; k < 5; k++) B.add(M.iron, new THREE.CylinderGeometry(0.3 - k * 0.012, 0.3 - k * 0.012, 0.2, 20), [x, yb - 0.25 - k * 0.22, z]);
    B.add(M.brass, new THREE.TorusGeometry(0.1, 0.03, 6, 14), [x, yb - 0.05, z]);
  }
  // tie beams crossing the void: they make the height legible
  for (const [y, a] of [[21, 0.5], [32.6, 2.0], [43.5, 1.1]]) { const r = innerR(y) - DIM.stairW - 0.1; B.bar(M.wood, cyl(r, a, y), cyl(r, a + Math.PI, y), 0.13, 6); }

  /* ── things the keeper left ──────────────────────────────────────────── */
  const H = innerR(DIM.floor), fy = DIM.floor;
  const barrel = (p) => {
    const prof = [0, 0.08, 0.25, 0.5, 0.75, 0.92, 1].map((t) => new THREE.Vector2(0.27 + Math.sin(t * Math.PI) * 0.09, t * 0.9));
    B.add(M.wood, new THREE.LatheGeometry([new THREE.Vector2(0, 0.03), ...prof, new THREE.Vector2(0, 0.87)], 18), p, [0, R() * 6, 0]);
    for (const t of [0.14, 0.34, 0.66, 0.86]) B.add(M.iron, new THREE.TorusGeometry(0.275 + Math.sin(t * Math.PI) * 0.09, 0.016, 5, 24), [p[0], p[1] + t * 0.9, p[2]], [Math.PI / 2, 0, 0]);
  };
  const A = (r, a, y = 0) => { const p = cyl(r, a, fy + y); return [p.x, p.y, p.z]; };
  barrel(A(H - 0.55, 0.15)); barrel(A(H - 0.62, 0.36)); barrel(A(H - 0.5, 0.26, 0.9));
  B.box(M.wood, [1.0, 0.5, 0.6], A(H - 0.6, -0.5, 0.25), [0, 0.6, 0]); B.box(M.wood, [0.7, 0.4, 0.5], A(H - 0.65, -0.52, 0.7), [0, 0.9, 0.02]);
  const tp = A(H - 1.0, 5.55); B.box(M.wood, [1.5, 0.07, 0.8], [tp[0], fy + 0.82, tp[2]], [0, 0.75, 0]);
  for (const sx of [-0.65, 0.65]) for (const sz of [-0.3, 0.3]) { const v = V(sx, 0, sz).applyAxisAngle(V(0, 1, 0), 0.75); B.bar(M.wood, V(tp[0] + v.x, fy, tp[2] + v.z), V(tp[0] + v.x * 0.96, fy + 0.8, tp[2] + v.z * 0.96), 0.045, 6); }
  B.box(M.wood, [0.3, 0.05, 0.22], [tp[0] + 0.25, fy + 0.88, tp[2] + 0.1], [0, 0.4, 0]); B.box(M.stone, [0.28, 0.02, 0.2], [tp[0] + 0.25, fy + 0.91, tp[2] + 0.1], [0, 0.4, 0]);
  const cp = [tp[0] - 0.5, fy, tp[2] + 0.8]; B.box(M.wood, [0.44, 0.05, 0.44], [cp[0], fy + 0.45, cp[2]], [0, 1.2, 0]);
  for (const [x, z] of [[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]]) B.bar(M.wood, V(cp[0] + x, fy, cp[2] + z), V(cp[0] + x, fy + 0.45 + (z > 0 ? 0.5 : 0), cp[2] + z), 0.022, 5);
  B.tube(M.wood, Array.from({ length: 90 }, (_, i) => { const a = i * 0.42, r = 0.34 - (i % 30) * 0.005; const c = A(H - 0.8, 0.95); return V(c[0] + Math.cos(a) * r, fy + 0.04 + i * 0.0035, c[2] + Math.sin(a) * r); }), 0.028, 260, 5);
  for (let k = 0; k < 5; k++) B.bar(M.iron, cyl(H + 0.1, 2.35 + k * 0.09, fy + 1.9), cyl(H - 0.18, 2.35 + k * 0.09, fy + 1.98), 0.015, 5);
  B.box(M.wood, [1.5, 0.05, 0.28], A(H - 0.12, 0.62, 1.7), [0, -0.62 + Math.PI / 2, 0]);
  for (let k = 0; k < 6; k++) B.add(M.brass, new THREE.CylinderGeometry(0.05, 0.07, 0.2 + R() * 0.12, 10), A(H - 0.16, 0.5 + k * 0.05, 1.83));
  B.build(group, { cast: true });

  /* ── lamps ───────────────────────────────────────────────────────────── */
  const lamps = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 4.6, 1.5) });
  const haloMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U },
    vertexShader: 'varying vec2 v;void main(){v=uv*2.-1.;vec4 c=modelViewMatrix*vec4(0.,0.,0.,1.);c.xy+=position.xy;gl_Position=projectionMatrix*c;}',
    fragmentShader: 'varying vec2 v;void main(){float d=length(v);float a=exp(-d*d*5.)*.10*(1.-smoothstep(.7,1.,d));gl_FragColor=vec4(vec3(1.,.5,.17)*a,1.);}' });
  const lamp = (p, intensity, dist, hang) => {
    const L = new Builder(), g = new THREE.Group(); g.position.copy(p);
    L.add(M.brass, new THREE.CylinderGeometry(0.12, 0.14, 0.09, 16), [0, 0, 0]); L.add(M.brass, new THREE.CylinderGeometry(0.03, 0.12, 0.1, 16), [0, 0.42, 0]);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; L.bar(M.iron, V(Math.cos(a) * 0.11, 0.03, Math.sin(a) * 0.11), V(Math.cos(a) * 0.1, 0.38, Math.sin(a) * 0.1), 0.006, 4); }
    L.add(M.iron, new THREE.TorusGeometry(0.09, 0.008, 5, 16), [0, 0.55, 0]);
    if (hang) L.bar(M.iron, V(0, 0.62, 0), hang.clone().sub(p), 0.012, 5);
    L.build(g, { cast: false });
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), flameMat); f.scale.set(0.8, 2.1, 0.8); f.position.y = 0.17; g.add(f);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), haloMat); halo.position.y = 0.17; g.add(halo);
    const light = new THREE.PointLight(new THREE.Color(1, 0.55, 0.22), intensity, dist, 1.7); light.position.copy(p).add(V(0, 0.22, 0)); group.add(light);
    group.add(g); lamps.push({ light, base: intensity, flame: f, seed: R() * 100 });
  };
  lamp(V(tp[0] - 0.3, fy + 0.9, tp[2] - 0.2), 34, 15);
  const wallLamp = (s, i) => { const y = stairY(s) + 2.5, a = stairA(s); lamp(cyl(innerR(y) - 0.42, a, y), i, 17, cyl(innerR(y) + 0.1, a, y + 0.9)); };
  wallLamp(0.16, 14); wallLamp(0.5, 14); wallLamp(0.83, 15);

  /* moonlight through the windows that face it */
  const sm = shaftMaterial([0.30, 0.42, 0.60], 0.16), sw = shaftMaterial([0.24, 0.34, 0.5], 0.07);
  for (const o of OPENINGS) {
    if (o.type !== 'window') continue;
    const nrm = cyl(1, o.a, 0); const facing = nrm.dot(U.uMoonDir.value);
    const y = (o.y0 + o.y1) / 2, r = innerR(y) + 0.2;
    const dir = facing > 0.1 ? U.uMoonDir.value.clone().negate() : nrm.clone().negate().setY(-0.45).normalize();
    const L = 5.2, g = new THREE.CylinderGeometry(1.15, 0.55, L, 14, 1, true); g.translate(0, L / 2, 0);
    const m = new THREE.Mesh(g, facing > 0.35 ? sm : sw);
    m.position.copy(nrm).multiplyScalar(r).setY(y); m.quaternion.setFromUnitVectors(V(0, 1, 0), dir); group.add(m);
  }

  /* dust */
  const dn = Q.dust, dp = new Float32Array(dn * 3), ds = new Float32Array(dn);
  for (let i = 0; i < dn; i++) { const r = Math.sqrt(R()) * 4.2, a = R() * TAU; dp.set([Math.cos(a) * r, DIM.floor + R() * 49, Math.sin(a) * r], i * 3); ds[i] = R(); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('s', new THREE.BufferAttribute(ds, 1));
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uTime,uInterior,uLamp,uFlash;attribute float s;varying float vA;void main(){vec3 p=position;p.x+=sin(uTime*.13+s*40.)*.35;p.z+=cos(uTime*.11+s*70.)*.35;p.y+=sin(uTime*.07+s*20.)*.6;vec4 m=modelViewMatrix*vec4(p,1.);float d=-m.z;vA=uInterior*smoothstep(9.,2.,d)*smoothstep(.2,.8,d)*(.25+.75*pow(.5+.5*sin(uTime*.5+s*90.),3.))*(.6+uFlash*2.+uLamp);gl_PointSize=min((1.2+s*2.2)*7./d,14.);gl_Position=projectionMatrix*m;}',
    fragmentShader: 'varying float vA;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(vec3(.95,.72,.48)*vA*.30*exp(-d*d*4.),1.);}',
  })); dust.frustumCulled = false; group.add(dust);

  group.userData.update = (t, reduced) => {
    for (const l of lamps) {
      const f = reduced ? 1 : 0.86 + 0.09 * Math.sin(t * 7.3 + l.seed) + 0.07 * Math.sin(t * 13.1 + l.seed * 2) + 0.06 * Math.sin(t * 2.1 + l.seed);
      l.light.intensity = l.base * f; l.flame.scale.set(0.8, 2.1 * (0.85 + f * 0.2), 0.8);
    }
  };
  return group;
}
