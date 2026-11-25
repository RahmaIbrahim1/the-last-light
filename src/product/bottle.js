import * as THREE from 'three';
import { U } from '../core/shared.js';
import { Q } from '../core/quality.js';
import { COMMON } from '../glsl/chunks.js';
import { Builder } from '../world/build.js';

/**
 * THE BOTTLE — a battered monolith (the taper of the tower) cast thick around a single column of liquid.
 * The back face carries a Fresnel bull's-eye, so the column bends and multiplies as you turn it.
 * The cap is a lantern blind: louvred, with one slit the light can leave by.
 *
 * The glass is not a transparent mesh. The fragment shader sphere-traces the ray *through* the solid
 * (outer glass → liquid → outer glass, with total internal reflection) against signed distance fields,
 * then looks up whatever it exits towards in a cube map captured where the bottle stands.
 */
export const BOTTLE_SCALE = 0.27;

const SDF = /* glsl */`
float rbox2(vec2 p,float w,float r){vec2 q=abs(p)-w+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float sdOuter(vec3 p){
  float w=mix(.365,.285,p.y);
  float d=rbox2(p.xz,w,.040),dy=abs(p.y-.5)-.5;
  vec2 k=vec2(d,dy)+.022;
  return (min(max(k.x,k.y),0.)+length(max(k,0.))-.022)*.985;
}
float sdCav(vec3 p){
  float w=mix(.205,.135,p.y);
  float d=length(p.xz)-w,dy=abs(p.y-.60)-.335;
  vec2 k=vec2(d,dy)+.06;
  return (min(max(k.x,k.y),0.)+length(max(k,0.))-.06)*.98;
}
vec3 nOuter(vec3 p){vec2 e=vec2(.0012,0.);return normalize(vec3(sdOuter(p+e.xyy)-sdOuter(p-e.xyy),sdOuter(p+e.yxy)-sdOuter(p-e.yxy),sdOuter(p+e.yyx)-sdOuter(p-e.yyx)));}
vec3 nCav(vec3 p){vec2 e=vec2(.0012,0.);return normalize(vec3(sdCav(p+e.xyy)-sdCav(p-e.xyy),sdCav(p+e.yxy)-sdCav(p-e.yxy),sdCav(p+e.yyx)-sdCav(p-e.yyx)));}
`;

const FRAG = /* glsl */`${COMMON}${SDF}
varying vec3 vP; varying vec3 vRo; varying mat3 vM;
uniform samplerCube tEnv; uniform vec3 uGlassAbs,uLiqAbs,uLiqScat,uAccent,uToLamp; uniform float uFocus,uFill,uCamAz,uEnvK;
vec3 env(vec3 dl){
  vec3 d=normalize(vM*dl);
  vec3 c=textureCube(tEnv,d).rgb*uEnvK;
  /* studio that isn't there: two tall edge lights and a soft overhead, fixed to the viewer's side */
  float az=atan(d.z,d.x)-uCamAz; az=atan(sin(az),cos(az));
  float el=d.y;
  float s1=smoothstep(.22,.10,abs(az-1.18))*smoothstep(-.35,.05,el)*smoothstep(.85,.45,el);
  float s2=smoothstep(.12,.05,abs(az+1.45))*smoothstep(-.45,.0,el)*smoothstep(.9,.5,el);
  float s3=smoothstep(.30,.10,abs(abs(az)-2.65))*smoothstep(-.10,.15,el)*smoothstep(.75,.35,el);
  float s4=smoothstep(.72,.96,el);
  c+=(mix(vec3(.75,.85,1.),uAccent,.45)*(s1*1.5+s2*.95)+uAccent*s3*1.15+vec3(.6,.68,.8)*s4*.35)*(.07+.93*uFocus);
  /* a glow behind it, strongest low: the glass reads as a volume instead of a silhouette */
  float bk=smoothstep(1.0,.0,abs(abs(az)-3.1416)); c+=uAccent*bk*smoothstep(-.45,-.05,el)*smoothstep(.75,.0,el)*.16*(.04+.96*uFocus);
  float l=max(dot(d,uToLamp),0.);
  c+=uBeamCol*uLamp*(pow(l,40.)*9.+pow(l,5.)*.9);
  c+=vec3(.5,.6,.8)*uFlash*smoothstep(-.1,.5,el)*.35;
  return c;
}
float fres(float c,float f0){return f0+(1.-f0)*pow(1.-sat(c),5.);}
void main(){
  vec3 rd=normalize(vP-vRo),p=vP;
  vec3 N=nOuter(p);
  if(dot(N,rd)>0.) N=normalize(vP-vec3(0.,vP.y,0.));
  /* cast-glass life: barely perceptible waviness */
  vec3 wob=vec3(texture2D(tNoise,p.xy*.55+p.z*.4).r,texture2D(tNoise,p.zy*.5+.3).r,texture2D(tNoise,p.xz*.6+.7).r)-.5;
  vec3 Ns=normalize(N+wob*.030);
  float F=fres(-dot(Ns,rd),.042);
  vec3 col=F*env(reflect(rd,Ns));
  vec3 T=vec3(1.)*(1.-F);
  rd=refract(rd,Ns,1./1.5); p+=rd*.004;
  bool done=false;
  for(int b=0;b<4;b++){
    float t=b==0?.010:0.; bool cav=false;
    for(int i=0;i<${Q.glass};i++){
      vec3 q=p+rd*t; float dc=sdCav(q),dO=-sdOuter(q);
      if(dc<.0012){cav=true;break;}
      if(dO<.0012)break;
      t+=max(min(dc,dO),.0016);
    }
    if(b==0&&t<.016){col+=T*env(rd)*.55;done=true;break;} /* grazing a bevel: too thin to trace */
    T*=exp(-uGlassAbs*t); p+=rd*t;
    if(cav){
      vec3 n=nCav(p); float nl=p.y<uFill?1.36:1.0; float ci=-dot(n,rd);
      float f=nl>1.2?fres(ci,.0024):fres(ci,.04);
      vec3 r2=refract(rd,n,1.5/nl);
      if(dot(r2,r2)<.1){ rd=reflect(rd,n); p+=n*.006; continue; }
      col+=T*f*env(reflect(rd,n))*.35; T*=1.-f;
      rd=r2; p+=rd*.006-n*.003;
      float u=0.,liq=0.;
      for(int i=0;i<22;i++){vec3 q=p+rd*u;float d=-sdCav(q);if(d<.0012)break;float s=max(d,.004);if(q.y<uFill)liq+=s;u+=s;}
      /* the meniscus is a mirror seen from below */
      T*=exp(-uLiqAbs*liq);
      vec3 mid=p+rd*u*.5;
      col+=T*uLiqScat*liq*(.10+.9*uFocus+uLamp*1.3*(.4+.6*sat(dot(normalize(vM*rd),uToLamp))))*(.45+.55*smoothstep(.2,.9,mid.y));
      float men=smoothstep(.012,.0,abs(p.y+rd.y*u-uFill))*.5+smoothstep(.010,.0,abs(p.y-uFill))*.5; col+=T*men*mix(vec3(.5),uAccent,.6)*(.04+.30*uFocus);
      p+=rd*u;
      vec3 n2=nCav(p); vec3 r3=refract(rd,-n2,nl/1.5); if(dot(r3,r3)<.1) r3=reflect(rd,-n2);
      rd=r3; p+=n2*.006; continue;
    }
    vec3 n=nOuter(p);
    /* Fresnel bull's-eye cut into the back */
    if(n.z<-.8){
      vec2 c=p.xy-vec2(0.,.56); float r=length(c);
      float saw=fract(r*19.)-.5; float m=smoothstep(.275,.26,r)*smoothstep(.02,.04,r);
      n=normalize(n+vec3(c/max(r,1e-3),0.)*(saw*.36-.10)*m);
    }
    float ci=dot(n,rd);
    vec3 o=refract(rd,-n,1.5);
    if(n.y<-.8){ col+=T*(uAccent*.012*(.2+uFocus)*(1.+2.*smoothstep(.1,.36,abs(p.x)))+textureCube(tEnv,vec3(0.,-1.,0.)).rgb*uEnvK*.35); done=true; break; }
    if(dot(o,o)<.1){ rd=reflect(rd,-n); p-=n*.006; }
    else { float f=fres(ci*1.2,.042); col+=T*(1.-f)*env(o); T*=f; rd=reflect(rd,-n); p-=n*.006; if(f<.25){done=true;break;} }
  }
  if(!done) col+=T*env(vec3(rd.x,abs(rd.y)*.5,rd.z))*.30;
  /* handled glass: faint smears that only show at grazing light */
  float sm=smoothstep(.55,.8,texture2D(tNoise,vP.xy*.8+vP.z).r)*pow(F,.6); col+=sm*.02*(.2+uFocus);
  gl_FragColor=vec4(col,1.);
}`;

const VERT = /* glsl */`varying vec3 vP;varying vec3 vRo;varying mat3 vM;
void main(){vP=position;vRo=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;vM=mat3(modelMatrix)/length(modelMatrix[0].xyz);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** Hull that matches sdOuter exactly, so rasterised entry points sit on the field's surface. */
function hullGeometry() {
  const NS = 64, r = 0.04, bev = 0.022;
  const prof = []; // [y, inset]
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; prof.push([bev - Math.cos(a) * bev, bev - Math.sin(a) * bev]); }
  for (let i = 1; i < 10; i++) prof.push([bev + (1 - 2 * bev) * (i / 10), 0]);
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; prof.push([1 - bev + Math.sin(a) * bev, bev - Math.cos(a) * bev]); }
  const pos = [], idx = [];
  const ring = [];
  for (let c = 0; c < 4; c++) for (let k = 0; k < NS / 4; k++) { const a = (c + k / (NS / 4 - 1)) * Math.PI / 2; ring.push([Math.cos(a), Math.sin(a), [1, -1, -1, 1][c], [1, 1, -1, -1][c]]); }
  for (const [y, ins] of prof) { const w = 0.365 + (0.285 - 0.365) * y - ins; for (const [cx, cz, sx, sz] of ring) pos.push(sx * (w - r) + cx * r, y, sz * (w - r) + cz * r); }
  const n = ring.length;
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < n; i++) { const a = j * n + i, b = j * n + ((i + 1) % n); idx.push(a, a + n, b, b, a + n, b + n); }
  const b0 = pos.length / 3; pos.push(0, 0, 0); const t0 = b0 + 1; pos.push(0, 1, 0); const L = (prof.length - 1) * n;
  for (let i = 0; i < n; i++) { idx.push(b0, i, (i + 1) % n); idx.push(t0, L + ((i + 1) % n), L + i); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

function text(ctx, s, x, y, size, font, track, align = 'left', alpha = 1) {
  ctx.globalAlpha = alpha; ctx.font = `${size}px ${font}`; ctx.letterSpacing = `${track}px`; ctx.textAlign = align; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
}
const TITLE = "'Castoro Titling', serif", SANS = "'Hanken Grotesk Variable', sans-serif", ITAL = "italic %px 'Castoro', serif";
function decal(f, back) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 1152;
  const x = c.getContext('2d'); x.fillStyle = '#fff';
  if (!back) {
    text(x, f.no, 60, 120, 54, TITLE, 4);
    x.globalAlpha = 0.7; x.fillRect(60, 150, 2, 560); x.globalAlpha = 1;
    f.labelName.forEach((s, i) => text(x, s, 56, 838 + i * 92, 92, TITLE, 10));
    text(x, 'THE LAST LIGHT', 60, 1000 + (f.labelName.length - 2) * 92, 25, SANS, 12);
    text(x, 'EAU DE PARFUM   100 ML', 60, 1044 + (f.labelName.length - 2) * 92, 21, SANS, 7, 'left', 0.8);
  } else {
    x.font = ITAL.replace('%', '40'); x.textAlign = 'left'; x.letterSpacing = '1px'; x.fillText(f.line, 60, 880);
    f.notes.forEach((s, i) => text(x, s.toUpperCase(), 60, 940 + i * 36, 22, SANS, 6, 'left', 0.85));
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.generateMipmaps = true; return t;
}

const hull = hullGeometry();
const metal = {};
export function createBottle(f) {
  const g = new THREE.Group();
  const uniforms = { ...U, tEnv: { value: null }, uGlassAbs: { value: new THREE.Vector3(...f.glass.abs) }, uLiqAbs: { value: new THREE.Vector3(...f.liquid.abs) }, uLiqScat: { value: new THREE.Vector3(...f.liquid.scatter) }, uAccent: { value: new THREE.Color(...f.accent) }, uToLamp: { value: new THREE.Vector3(0, 1, 0) }, uFocus: { value: 0 }, uFill: { value: 0.84 }, uCamAz: { value: 0 }, uEnvK: { value: 2.2 } };
  const body = new THREE.Mesh(hull, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }));
  body.castShadow = true; g.add(body);

  // ink: screen-printed ivory, sitting on the glass
  const uni = { uAccent: uniforms.uAccent, uFocus: uniforms.uFocus };
  for (const back of [false, true]) {
    const tex = decal(f, back), w = 0.50, h = 0.75;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({
      uniforms: { ...U, ...uni, t: { value: tex } }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `${COMMON}uniform sampler2D t;uniform vec3 uAccent;uniform float uFocus;varying vec2 v;void main(){float a=texture2D(t,v).a;float wear=smoothstep(.18,.34,texture2D(tNoise,v*.9).r+.1);
        gl_FragColor=vec4(mix(vec3(.86,.83,.76),uAccent,.12)*(.05+.62*uFocus+uLamp*.12),a*wear*.92);}`,
    }));
    const y = 0.5, tilt = Math.atan(0.08);
    m.position.set(0, y, (0.365 - 0.08 * y + 0.0035) * (back ? -1 : 1)); m.rotation.set(back ? tilt : -tilt, back ? Math.PI : 0, 0, 'YXZ');
    if (back) m.rotation.set(-tilt, Math.PI, 0, 'YXZ');
    m.renderOrder = 24; g.add(m);
  }

  /* collar + louvred blind */
  metal.dark ||= new THREE.MeshPhysicalMaterial({ color: 0x15171a, metalness: 0.92, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  metal.steel ||= new THREE.MeshStandardMaterial({ color: 0x8f9296, metalness: 1, roughness: 0.26 });
  const B = new Builder();
  B.add(metal.steel, new THREE.LatheGeometry([[0, 1.0], [0.17, 1.0], [0.172, 1.006], [0.172, 1.03], [0.16, 1.036], [0.155, 1.05], [0, 1.05]].map(([r, y]) => new THREE.Vector2(r, y)), 72));
  const gap = 0.36, pr = [[0.0, 1.05], [0.196, 1.05], [0.2, 1.056]];
  for (let k = 0; k < 9; k++) { const y = 1.062 + k * 0.036; pr.push([0.2, y], [0.2, y + 0.011], [0.172, y + 0.026]); }
  pr.push([0.2, 1.388], [0.2, 1.418], [0.192, 1.426], [0.05, 1.426], [0.045, 1.420], [0, 1.420]);
  B.add(metal.dark, new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 96, gap / 2, Math.PI * 2 - gap));
  B.add(metal.dark, new THREE.LatheGeometry([[0, 1.386], [0.2, 1.386], [0.203, 1.39], [0.203, 1.422], [0.196, 1.43], [0.06, 1.43], [0.052, 1.424], [0, 1.424]].map(([r, y]) => new THREE.Vector2(r, y)), 80));
  B.add(metal.dark, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 80), [0, 1.058, 0]);
  for (const s of [-1, 1]) { const a = s * gap / 2; B.box(metal.steel, [0.085, 0.33, 0.004], [Math.sin(a) * 0.155, 1.224, Math.cos(a) * 0.155], [0, a - Math.PI / 2, 0]); }
  B.build(g, { cast: true });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.33, 28), new THREE.ShaderMaterial({
    uniforms: { ...U, ...uni }, vertexShader: 'varying vec3 n;varying vec2 v;varying vec3 w;void main(){v=uv;n=normalize(normalMatrix*normal);vec4 m=modelViewMatrix*vec4(position,1.);w=normalize(-m.xyz);gl_Position=projectionMatrix*m;}',
    fragmentShader: `${COMMON}uniform vec3 uAccent;uniform float uFocus;varying vec3 n;varying vec2 v;varying vec3 w;void main(){float c=max(dot(n,w),0.);float g=pow(c,2.5)*(.35+.65*smoothstep(0.,.5,v.y));gl_FragColor=vec4(uAccent*g*(.05+.75*uFocus+uLamp*.5)+pow(1.-c,4.)*.15,1.);}` }));
  core.position.y = 1.224; g.add(core);

  g.scale.setScalar(BOTTLE_SCALE);
  return { group: g, body, uniforms };
}

/** The carton: matte board, blind-embossed, the same slit cut through to the same colour. */
export function createCarton(f) {
  const g = new THREE.Group(), B = new Builder();
  const board = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.82, metalness: 0.0 });
  B.box(board, [0.25, 0.46, 0.25], [0, 0.23, 0]); B.build(g);
  const c = document.createElement('canvas'); c.width = 512; c.height = 942; const x = c.getContext('2d'); x.fillStyle = '#fff';
  text(x, f.no, 56, 100, 40, TITLE, 4); f.labelName.forEach((s, i) => text(x, s, 52, 720 + i * 66, 62, TITLE, 7)); text(x, 'THE LAST LIGHT', 56, 874, 18, SANS, 8);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.46), new THREE.MeshStandardMaterial({ color: 0xcfc8b8, alphaMap: null, map: new THREE.CanvasTexture(c), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(0, 0.23, 0.127); g.add(m);
  const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.17), new THREE.MeshBasicMaterial({ color: new THREE.Color(...f.accent).multiplyScalar(0.35), polygonOffset: true, polygonOffsetFactor: -2 })); slit.position.set(0.085, 0.36, 0.1265); g.add(slit);
  return g;
}
