import * as THREE from 'three';
import { noise3 } from '../core/math.js';
import { U } from '../core/shared.js';

/** Bakes one tileable RGBA noise atlas on the GPU: R fbm · G ridged · B cell borders · A fine grain. */
export function bakeNoise(renderer, size = 1024) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false,
  });
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: /* glsl */`
      varying vec2 v;
      float h(vec2 p,float s){vec3 q=fract(vec3(p.xyx)*.1031+s*.17);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
      float n(vec2 p,float per,float s){vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);
        #define H(a,b) h(mod(i+vec2(a,b),per),s)
        return mix(mix(H(0.,0.),H(1.,0.),f.x),mix(H(0.,1.),H(1.,1.),f.x),f.y);}
      float fbm(vec2 u,float per,float s){float a=.5,r=0.,w=0.;for(int i=0;i<7;i++){r+=a*n(u*per,per,s+float(i));w+=a;a*=.52;per*=2.;}return r/w;}
      vec2 h2(vec2 p){return vec2(h(p,3.),h(p,8.));}
      float vor(vec2 u,float per){vec2 p=u*per,i=floor(p),f=fract(p),mr;float md=9.;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y);vec2 r=g+h2(mod(i+g,per))-f;float d=dot(r,r);if(d<md){md=d;mr=r;}}
        float e=9.;for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){vec2 g=vec2(x,y);vec2 r=g+h2(mod(i+g,per))-f;vec2 q=r-mr;if(dot(q,q)>1e-4)e=min(e,dot(.5*(mr+r),normalize(q)));}
        return e;}
      void main(){
        float f=fbm(v,6.,1.);
        f=clamp((f-.5)*1.75+.5,0.,1.);
        float r=0.,a=.5,w=0.,per=7.;for(int i=0;i<6;i++){float q=1.-abs(2.*n(v*per,per,40.+float(i))-1.);r+=a*q*q;w+=a;a*=.55;per*=2.;}
        vec2 warp=vec2(fbm(v,8.,60.),fbm(v,8.,70.))-.5;
        float c=min(vor(fract(v+warp*.05),9.),.9);
        float g=fbm(v,64.,90.);
        gl_FragColor=vec4(f,r/w,c,g);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  scene.add(quad);
  renderer.setRenderTarget(rt); renderer.render(scene, new THREE.Camera()); renderer.setRenderTarget(null);
  mat.dispose(); quad.geometry.dispose();
  U.tNoise.value = rt.texture;

  // Tileable 3D noise for the volumetrics
  const N = 48, data = new Uint8Array(N ** 3);
  let i = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 0.55, s = 0, p = 4;
    for (let o = 0; o < 3; o++) { s += a * noise3((x / N) * p, (y / N) * p, (z / N) * p + o * 0, p); a *= 0.5; p *= 2; }
    data[i++] = Math.max(0, Math.min(255, (s / 0.9625) * 255));
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RedFormat; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  U.tNoise3.value = t;
}
