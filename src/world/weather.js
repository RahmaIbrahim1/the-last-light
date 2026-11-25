import * as THREE from 'three';
import { U } from '../core/shared.js';
import { Q } from '../core/quality.js';
import { rng, TAU, damp } from '../core/math.js';
import { rockH } from './rock.js';

export function createWeather() {
  const group = new THREE.Group(), R = rng(5);
  const live = { rain: { value: 1 }, cam: { value: new THREE.Vector3() }, vel: { value: new THREE.Vector3() } };

  /* rain: streaks wrap in a box carried by the camera, so a few thousand feel endless */
  const n = Q.rain, pos = new Float32Array(n * 6), end = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const x = R(), y = R(), z = R(); pos.set([x, y, z, x, y, z], i * 6); end.set([0, 1], i * 2); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('e', new THREE.BufferAttribute(end, 1));
  const rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
    uniforms: { ...U, uRain: live.rain, uCam: live.cam, uVel: live.vel }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`attribute float e;uniform float uTime,uRain,uFlash,uLamp;uniform vec3 uCam,uVel,uLampPos,uBeamDir;uniform vec2 uWind;varying float vA;varying float vB;
      void main(){
        vec3 box=vec3(44.,30.,44.);
        vec3 v=vec3(uWind.x*7.,-21.,uWind.y*7.);
        vec3 p=position*box+v*uTime*(.85+.3*position.x);
        p=mod(p-uCam+box*.5,box)-box*.5+uCam;
        vec3 streak=(v-uVel*.7)*.022;
        vec3 w=p+streak*e;
        float r=length(w.xz);
        float dry=step(r,mix(6.8,4.5,clamp((w.y-9.)/30.,0.,1.)))*step(w.y,60.6)+step(w.y,.2);
        vec4 m=viewMatrix*vec4(w,1.);float d=-m.z;
        vA=uRain*(1.-min(dry,1.))*smoothstep(.6,3.,d)*smoothstep(22.,7.,d)*(.4+.6*position.z);
        vec2 q=normalize(w.xz-uLampPos.xz);float b=abs(dot(q,normalize(uBeamDir.xz)));
        vB=uLamp*smoothstep(.985,.9995,b)*smoothstep(16.,4.,abs(w.y-uLampPos.y));
        gl_Position=projectionMatrix*m;}`,
    fragmentShader: 'varying float vA;varying float vB;uniform float uFlash;void main(){gl_FragColor=vec4((vec3(.034,.044,.056)*(1.+uFlash*7.)+vec3(1.,.74,.42)*vB*.35)*vA,1.);}',
  }));
  rain.frustumCulled = false; rain.renderOrder = 30; group.add(rain);

  /* spray: ballistic bursts born where the shoreline actually is */
  const sn = Q.spray, sp = new Float32Array(sn * 3), sd = new Float32Array(sn * 4);
  for (let i = 0; i < sn; i++) {
    let x = 0, z = 0, a = R() * TAU;
    if (i % 5) { a = Math.round(a * 3.6) / 3.6 + (R() - 0.5) * 0.16; }
    for (let r = 70; r > 8; r -= 0.8) { x = Math.cos(a) * r; z = Math.sin(a) * r; if (rockH(x, z) > -0.4) break; }
    sp.set([x * 1.02, 0.2, z * 1.02], i * 3);
    sd.set([R(), Math.round(a * 3.6), R(), R()], i * 4);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('d', new THREE.BufferAttribute(sd, 4));
  const spray = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute vec4 d;uniform float uTime,uFlash,uLamp;uniform vec3 uLampPos,uBeamDir,uMoonDir;uniform vec2 uWind;varying float vA;varying vec3 vC;varying float vR;
      float h(float x){return fract(sin(x*127.1)*43758.5453);}
      void main(){
        float per=4.6+h(d.y)*3.4;float k=uTime/per+h(d.y+3.);float cyc=floor(k);float t=fract(k)*per-d.z*.35;
        float big=smoothstep(.25,1.,h(d.y+cyc*7.));
        vec3 out3=normalize(vec3(position.x,0.,position.z));
        vec3 v=vec3(-out3.x*(1.+2.*d.w),(5.+9.*d.x)*(.45+big),-out3.z*(1.+2.*d.w))+vec3(d.w-.5,0.,d.z-.5)*5.+vec3(uWind.x,0.,uWind.y)*2.2;
        vec3 p=position+v*max(t,0.)*.72+vec3(uWind.x,0.,uWind.y)*t*t*.9;p.y-=3.4*t*t;
        float life=smoothstep(0.,.12,t)*smoothstep(2.9,.9,t)*step(0.,t);
        vec4 m=viewMatrix*vec4(p,1.);float ds=-m.z;
        vA=life*(.12+.30*big)*smoothstep(1.,6.,ds)*step(-.4,p.y);vR=d.x*6.28;
        vec2 q=normalize(p.xz-uLampPos.xz);float b=uLamp*smoothstep(.97,1.,abs(dot(q,normalize(uBeamDir.xz))));
        vC=vec3(.05,.065,.08)*(1.+uFlash*8.)+vec3(1.,.74,.42)*b*.16;
        gl_PointSize=min((.5+t*.95)*(.7+d.w)*620./ds,190.);gl_Position=projectionMatrix*m;}`,
    fragmentShader: /* glsl */`uniform sampler2D tNoise;varying float vA;varying vec3 vC;varying float vR;void main(){vec2 c=gl_PointCoord-.5;float s=sin(vR),k=cos(vR);c=mat2(k,-s,s,k)*c;float d=length(c)*2.;float n=texture2D(tNoise,c*.22+vR).r;float a=smoothstep(1.,.1,d)*smoothstep(.30,.72,n+.28*(1.-d));gl_FragColor=vec4(vC,a*vA);}`,
  }));
  spray.frustumCulled = false; spray.renderOrder = 28; group.add(spray);

  /* underwater drift */
  const pn = Q.mobile ? 220 : 900, pp = new Float32Array(pn * 3); for (let i = 0; i < pn * 3; i++) pp[i] = R();
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const snow = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: { ...U, uCam: live.cam }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uTime,uCamUnder;uniform vec3 uCam;varying float vA;void main(){vec3 b=vec3(16.);vec3 p=position*b+vec3(sin(uTime*.2+position.y*30.)*.6+uTime*.12,-uTime*.07*(.5+position.x),cos(uTime*.17+position.x*30.)*.6);p=mod(p-uCam+b*.5,b)-b*.5+uCam;vec4 m=viewMatrix*vec4(p,1.);float d=-m.z;vA=smoothstep(.3,1.2,d)*smoothstep(8.,3.,d)*uCamUnder*step(p.y,-.2)*(.3+.7*position.z);gl_PointSize=clamp((.8+3.*position.z*position.z)*9./d,1.,16.);gl_Position=projectionMatrix*m;}',
    fragmentShader: 'varying float vA;uniform float uFlash;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(vec3(.16,.30,.30)*vA*exp(-d*d*3.)*(.35+uFlash*2.),1.);}',
  })); snow.frustumCulled = false; snow.renderOrder = 31; group.add(snow);

  /* smoke that gathers when The Storm is chosen */
  const mn = 46, mp = new Float32Array(mn * 3), ms = new Float32Array(mn);
  for (let i = 0; i < mn; i++) { const a = R() * TAU, r = 0.4 + R() * 2.9; mp.set([Math.cos(a) * r, 54.1 + R() * 2.2, Math.sin(a) * r], i * 3); ms[i] = R(); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('s', new THREE.BufferAttribute(ms, 1));
  const smokeA = { value: 0 }, smokeC = { value: new THREE.Color(0.1, 0.1, 0.1) };
  const smoke = new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: { ...U, uA: smokeA, uC: smokeC }, transparent: true, depthWrite: false,
    vertexShader: 'attribute float s;uniform float uTime;varying float vS;varying float vA;void main(){vec3 p=position;float k=fract(uTime*.045+s);p.y+=k*1.3;p.x+=sin(uTime*.3+s*30.)*.3;p.z+=cos(uTime*.26+s*50.)*.3;vA=sin(k*3.1416);vS=s*6.28+uTime*.05;vec4 m=modelViewMatrix*vec4(p,1.);vA*=smoothstep(.35,1.1,-m.z);gl_PointSize=min(1050./-m.z,420.);gl_Position=projectionMatrix*m;}',
    fragmentShader: 'uniform sampler2D tNoise;uniform float uA,uFlash;uniform vec3 uC;varying float vS;varying float vA;void main(){vec2 c=gl_PointCoord-.5;float a=cos(vS),b=sin(vS);c=mat2(a,-b,b,a)*c;float n=texture2D(tNoise,c*.18+vS*.3).r;float d=length(c)*2.;gl_FragColor=vec4(uC*(1.+uFlash*5.),smoothstep(1.,.0,d)*smoothstep(.34,.8,n)*vA*uA*.22);}',
  })); smoke.frustumCulled = false; smoke.renderOrder = 26; group.add(smoke);

  /* ── lightning director ──────────────────────────────────────────────── */
  let next = 1e9, strikes = [];
  const api = {
    group, live, rate: 1, rainTarget: 1, smokeTarget: 0, smokeColor: smokeC.value, onThunder: () => {},
    /** A strike is a burst of 2–4 return strokes; thunder follows by distance. */
    strike(power = 1, az = null, quiet = false) {
      const a = az ?? (-Math.PI / 2 + (Math.random() - 0.5) * 3.6);
      U.uFlashDir.value.set(Math.cos(a), 0.22 + Math.random() * 0.2, Math.sin(a)).normalize();
      U.uBoltSeed.value = Math.random() * 10;
      const k = 2 + Math.floor(Math.random() * 3); let t = 0;
      for (let i = 0; i < k; i++) { strikes.push({ t, p: power * (i === 0 ? 0.7 : 0.45 + Math.random() * 0.75) * (Q.reduced ? 0.3 : 1) }); t += 0.06 + Math.random() * 0.16; }
      if (!quiet) api.onThunder(power, 0.9 + Math.random() * 2.6);
    },
    schedule(t) { next = t; },
    update(dt, t, cam, vel, sun) {
      live.cam.value.copy(cam.position); live.vel.value.lerp(vel, 0.1);
      live.rain.value = damp(live.rain.value, api.rainTarget, 0.8, dt);
      smokeA.value = damp(smokeA.value, api.smokeTarget, 0.8, dt); smoke.visible = smokeA.value > 0.01;
      snow.visible = U.uCamUnder.value > 0.01; rain.visible = live.rain.value > 0.02 && U.uCamUnder.value < 0.9;
      if (t > next) { api.strike(0.45 + Math.random() * 0.75); next = t + (9 + Math.random() * 13) / Math.max(0.05, api.rate); }
      let add = 0; strikes = strikes.filter((s) => { s.t -= dt; if (s.t <= 0) { add = Math.max(add, s.p); return false; } return true; });
      U.uFlash.value = Math.max(U.uFlash.value * Math.exp(-dt * 6.5), add); if (U.uFlash.value < 0.002) U.uFlash.value = 0;
      U.uBolt.value = Math.max(U.uBolt.value * Math.exp(-dt * 11), add > 0.5 ? add : 0);
      sun.position.copy(U.uFlashDir.value).multiplyScalar(140).setY(90); sun.intensity = U.uFlash.value * 2.4;
    },
  };
  return api;
}
