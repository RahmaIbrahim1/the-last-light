import * as THREE from 'three';
import { U } from '../core/shared.js';
import { Q } from '../core/quality.js';
import { COMMON, SKY, WAVES, BEAM } from '../glsl/chunks.js';
import { rockH } from './rock.js';

/* wavelength, amplitude, heading(deg), steepness is derived. First five displace geometry, the rest only shade. */
const SPEC = [
  [74, 1.15, 20], [43, 0.72, 41], [27, 0.44, -6], [15.5, 0.25, 58], [9.1, 0.15, 8],
  [5.2, 0.075, 74], [3.1, 0.045, -22], [1.9, 0.024, 33], [1.15, 0.014, 96],
];
const waves = SPEC.map(([L, A, deg]) => {
  const a = (deg * Math.PI) / 180; return new THREE.Vector4(Math.cos(a), Math.sin(a), (Math.PI * 2) / L, A);
});
const G = 9.81, GEO = 5;
export const oceanUniforms = { uWaves: { value: waves.slice(0, Q.waveDetail) }, uWaveScale: { value: 1 } };

const smoothRange = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const tmp = { x: 0, y: 0, z: 0 };
function displace(x, z, t, out) {
  const near = x * x + z * z < 110 * 110;
  const k = (near ? 0.16 + 0.84 * smoothRange(-0.5, -11, rockH(x, z)) : 1) * oceanUniforms.uWaveScale.value;
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < GEO; i++) {
    const w = waves[i], ph = w.z * (w.x * x + w.y * z) - Math.sqrt(G * w.z) * t * 0.82 + i * 1.7;
    const s = Math.sin(ph), c = Math.cos(ph);
    dy += w.w * s; dx += w.x * w.w * 0.72 * c; dz += w.y * w.w * 0.72 * c;
  }
  out.x = dx * k; out.y = dy * k; out.z = dz * k; return out;
}
/** CPU twin of the vertex shader: water height at a world xz (inverts the horizontal drift). */
export function waterHeight(x, z, t = U.uTime.value) {
  let px = x, pz = z;
  for (let i = 0; i < 3; i++) { displace(px, pz, t, tmp); px = x - tmp.x; pz = z - tmp.z; }
  return displace(px, pz, t, tmp).y;
}

const WAVE_FN = /* glsl */`
vec3 waveDisp(vec2 p,float att){
  vec3 d=vec3(0.);
  for(int i=0;i<5;i++){vec4 w=uWaves[i];
    float ph=w.z*dot(w.xy,p)-sqrt(9.81*w.z)*uTime*.82+float(i)*1.7;
    float L=6.2832/w.z; float a=w.w*smoothstep(L*26.,L*7.,att);
    d.y+=a*sin(ph); d.xz+=w.xy*a*.72*cos(ph);}
  return d;
}`;

export function createOcean() {
  const seg = Q.oceanSeg, rings = Q.oceanRings, growth = Math.pow(6500 / 0.5, 1 / rings);
  const pos = new Float32Array((rings + 1) * seg * 3 + 3), idx = [];
  let o = 3;
  for (let i = 0; i <= rings; i++) {
    const r = 0.5 * Math.pow(growth, i);
    for (let j = 0; j < seg; j++) { const a = ((j + (i & 1) * 0.5) / seg) * Math.PI * 2; pos[o++] = Math.cos(a) * r; pos[o++] = 0; pos[o++] = Math.sin(a) * r; }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = 1 + i * seg + j, b = 1 + i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...U, ...oceanUniforms, uCenter: { value: new THREE.Vector2() } },
    vertexShader: /* glsl */`${COMMON}${WAVES(Q.waveDetail)}${WAVE_FN}
      uniform vec2 uCenter; varying vec3 vW; varying vec2 vP; varying float vShore;
      void main(){
        vec2 p=position.xz+uCenter; float r=length(position.xz);
        float sh=shoreH(p); vShore=sh;
        vec3 d=waveDisp(p,r)*shoreDamp(sh)*uWaveScale;
        vP=p; vec3 w=vec3(p.x,0.,p.y)+d;
        /* planet curvature, so the sea ends in a horizon rather than an edge */
        w.y-=r*r*4e-6*smoothstep(300.,1500.,r);
        vW=w; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
      }`,
    fragmentShader: /* glsl */`${COMMON}${SKY}${WAVES(Q.waveDetail)}${BEAM}
      varying vec3 vW; varying vec2 vP; varying float vShore;
      vec3 towerRefl(vec3 ro,vec3 rd,vec3 bg){
        /* analytic lighthouse: the reflection is a ray-traced tapering column, broken up by the wave normals */
        float tca=-dot(ro.xz,rd.xz)/max(dot(rd.xz,rd.xz),1e-4);
        if(tca<0.) return bg;
        vec2 cp=ro.xz+rd.xz*tca; float y=ro.y+rd.y*tca; float d=length(cp);
        float R=mix(6.4,4.3,sat((y-9.)/30.));
        float m=smoothstep(R+.8,R-.3,d)*step(y,61.)*smoothstep(4.,9.,y);
        float rock=smoothstep(1.,-1.5,length(cp/vec2(1.25,1.))-mix(27.,12.,sat(y/10.)))*step(y,9.5);
        vec3 c=vec3(.006,.008,.011)+vec3(.05,.06,.08)*uFlash*.5;
        bg=mix(bg,c,max(m,rock)*.9);
        float l=exp(-dot(vec2(d,y-56.5),vec2(d,y-56.5))*.06);
        return bg+uBeamCol*l*(uLamp*5.+.05);
      }
      void main(){
        vec3 V=cameraPosition-vW; float dist=length(V); V/=dist;
        float sd=shoreDamp(vShore);
        vec2 pn=texture2D(tNoise,vP*.0031).ra-.5+(texture2D(tNoise,vP*.0117+.3).rg-.5)*.6; float foot=dist*.0015/max(abs(V.y),.05);
        vec3 n=vec3(0.,1.,0.); float crest=0.,jac=1.;
        for(int i=0;i<NW;i++){vec4 w=uWaves[i];
          float L=6.2832/w.z; float a=w.w*(i<5?sd:1.)*smoothstep(L*.55,L*.10,foot)*uWaveScale;
          float ph=w.z*dot(w.xy,vP)-sqrt(9.81*w.z)*uTime*.82+float(i)*1.7+(i>2?(pn.x*float(i)-pn.y*3.)*2.6:(pn.y*2.2*smoothstep(60.,300.,dist)));
          float wa=w.z*a; n.xz-=w.xy*wa*cos(ph); if(i<5){float sq=.72*wa*sin(ph); n.y-=sq; jac-=sq; crest+=a*sin(ph);}
        }
        /* capillary detail */
        float det=smoothstep(170.,6.,dist);
        vec2 q=vP*.11;
        vec2 g1=texture2D(tNoise,q+uWind*uTime*.016).ga-.5, g2=texture2D(tNoise,q*2.3-uWind.yx*uTime*.022).ag-.5;
        n.xz+=(g1+g2)*(.10+.24*det);
        float gust=texture2D(tNoise,vP*.0042+uWind*uTime*.004).r;
        n.xz*=.72+.6*gust;
        n=normalize(n);
        vec3 col;
        if(!gl_FrontFacing){
          /* ── seen from below: Snell's window ── */
          vec3 N=-normalize(vec3(n.x*.75,n.y,n.z*.75));
          vec3 R=refract(-V,N,1.333);
          float cc=sat(dot(N,V)); float tir=1.-smoothstep(.655,.73,cc);
          if(dot(R,R)<.1) R=normalize(vec3(-V.x,.02,-V.z));
          float c=sat(dot(N,V));
          vec3 sky=skyBase(normalize(R+vec3(0.,1e-3,0.)))*2.2;
          sky=towerRefl(vW,R,sky);
          vec3 deep=vec3(.0035,.013,.016);
          vec3 rr=reflect(-V,N);
          vec3 refl=deep*(1.+.8*sat(rr.x*.3+.5));
          float F=mix(1.,.02+.98*pow(1.-c,4.),1.-tir);
          col=mix(sky*vec3(.55,.85,.9),refl,sat(max(F,tir)));
          float foam=smoothstep(.55,.95,texture2D(tNoise,vP*.05+uTime*.004).r+crest*.22);
          col+=vec3(.035,.06,.065)*foam*(.5+uFlash*2.);
        } else {
          float nv=max(dot(n,V),0.);
          /* distant sea: average over unresolved slopes */
          float far=smoothstep(60.,1400.,dist);
          float F=.02+.98*pow(1.-mix(nv,max(nv,.16),far),5.);
          vec3 R=reflect(-V,n); R.y=abs(R.y)+.015+far*.06; R=normalize(R);
          vec3 refl=skyBase(R);
          /* one cloud tap keeps the reflection from being a gradient */
          float cl=texture2D(tNoise,R.xz/(R.y+.15)*.035+uWind*uTime*.0013).r;
          refl*=.55+.9*cl;
          refl=towerRefl(vW,R,refl);
          vec3 deep=vec3(.0022,.0068,.0098)*uMood;
          /* light carried through thin crests */
          float back=pow(sat(dot(normalize(V.xz+1e-4),-uMoonDir.xz)),2.);
          float sss=sat(crest*.42+.25)*pow(1.-nv,1.5);
          deep+=vec3(.010,.034,.037)*sss*(.30+back*1.1+uFlash*2.2);
          float shallow=smoothstep(-9.,-.4,vShore);
          deep=mix(deep,vec3(.010,.024,.027),shallow*.7);
          col=mix(deep,refl,F);
          /* moon path */
          vec3 H=normalize(uMoonDir+V);
          float nh=max(dot(n,H),0.);
          float sp=mix(420.,60.,far);
          float cov=.35+.65*smoothstep(.35,.6,texture2D(tNoise,vP*.0011+uTime*.0012).r);
          col+=uMoonCol*(pow(nh,sp)*mix(2.6,.55,far)+pow(nh,26.)*.018)*cov;
          /* lightning sheen */
          vec3 HF=normalize(uFlashDir+V);
          col+=vec3(.55,.65,.85)*uFlash*(pow(max(dot(n,HF),0.),90.)*1.1+.006+sss*.05);
          /* the lamp: a sweep of warm light, glinting off whichever facets face it */
          vec3 L=uLampPos-vW; float ld=length(L); L/=ld;
          float bz=beamAz(vW,.075)+.10*beamAz(vW,.30);
          float lf=uLamp*(1./(1.+ld*.0075));
          vec3 HL=normalize(L+V);
          col+=uBeamCol*lf*bz*(pow(max(dot(n,HL),0.),mix(160.,30.,far))*3.8+.13*max(dot(n,L),0.)+sss*.16);
          /* static glow from the lantern on near water */
          col+=uBeamCol*lf*.02*pow(max(dot(n,HL),0.),40.);
          /* ── foam ── */
          vec2 fp=vP+crest*.5;
          float f1=texture2D(tNoise,fp*.052+uWind*uTime*.006).r, f2=texture2D(tNoise,fp*.19-uWind*uTime*.011).b, f3=texture2D(tNoise,fp*.63+uTime*.01).a;
          float lace=sat((.34-f2)*2.6)*.8+f3*.35;
          float cap=smoothstep(.62,1.55,crest*.62+(1.-jac)*.8+f1*1.05-.28)*sd;
          float bands=sin(-vShore*1.15-uTime*.85+f1*7.)*.5+.5;
          float surf=smoothstep(-7.5,-.2,vShore+(f1-.5)*6.)*(.35+.75*bands);
          float swirl=smoothstep(-16.,-4.,vShore)*smoothstep(.5,.78,texture2D(tNoise,fp*.021+uTime*.003).r)*.45;
          float foam=sat(cap*.75+surf*1.2+swirl)*smoothstep(.22,.95,lace+sat(surf)*.45+cap*.25);
          foam*=smoothstep(900.,150.,dist);
          float fl=.020+.075*max(dot(n,uMoonDir),0.)+uFlash*.30+lf*bz*.55;
          vec3 fc=mix(vec3(.62,.75,.85),uBeamCol,sat(lf*bz*1.6))*fl*(.65+.7*f3);
          col=mix(col,fc+uBeamCol*lf*bz*.06,foam*.92);
        }
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  mesh.userData.update = (cam) => { mat.uniforms.uCenter.value.set(cam.position.x, cam.position.z); };
  return mesh;
}
