import * as THREE from 'three';
import { U } from './core/shared.js';
import { Q } from './core/quality.js';
import { COMMON, SKY, BEAM } from './glsl/chunks.js';

/**
 * Frame graph
 *   scene (HDR, MSAA, depth) → volumetrics (reduced res, ray-marched) → fog resolve → bloom pyramid → grade
 * All fog, the beam and the whole underwater medium live here, so every material in the world sits in the same air.
 */
const quadVS = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const HF = { type: THREE.HalfFloatType, depthBuffer: false };

export class Post {
  constructor(renderer) {
    this.r = renderer; this.scale = 1;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad);

    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Q.samples });
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.rtVol = new THREE.WebGLRenderTarget(4, 4, HF);
    this.rtFog = new THREE.WebGLRenderTarget(4, 4, HF);
    this.down = []; this.up = [];
    for (let i = 0; i < Q.bloomLevels; i++) { this.down.push(new THREE.WebGLRenderTarget(4, 4, HF)); this.up.push(new THREE.WebGLRenderTarget(4, 4, HF)); }

    const cu = {
      tColor: { value: this.rtScene.texture }, tDepth: { value: this.rtScene.depthTexture }, tVol: { value: this.rtVol.texture },
      uIPV: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2() }, uVolRes: { value: new THREE.Vector2() },
      uWaterH: { value: 0 }, uWaterG: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uFar: { value: 8000 }, uNear: { value: 0.1 },
    };
    this.cu = cu;
    const WORLD = /* glsl */`
      uniform sampler2D tDepth;uniform mat4 uIPV;uniform vec3 uCam;uniform float uWaterH;uniform vec2 uWaterG;
      vec3 worldAt(vec2 uv,float z){vec4 c=uIPV*vec4(vec3(uv,z)*2.-1.,1.);return c.xyz/c.w;}
      /* which side of the water film is this pixel on? evaluated half a metre out, i.e. on the lens */
      float lensUnder(vec3 rd){vec3 q=uCam+rd*.55;float rip=sin(q.x*9.+uTime*3.)*.010+sin(q.z*7.-uTime*2.3)*.012;float h=uWaterH+dot(uWaterG,q.xz-uCam.xz)+rip;return h-q.y;}`;

    this.mVol = new THREE.ShaderMaterial({
      uniforms: { ...U, ...cu }, vertexShader: quadVS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`${COMMON}${SKY}${BEAM}
        precision highp sampler3D; uniform sampler3D tNoise3; uniform float uFrame;
        varying vec2 vUv;${WORLD}
        float n3(vec3 p){return texture(tNoise3,p).r;}
        float fogDens(vec3 p,float t){
          vec3 w=vec3(uWind.x,.0,uWind.y)*uTime;
          float bank=n3(p*vec3(.0021,.006,.0021)+w*.0006);
          float wisp=n3(p*vec3(.011,.022,.011)+w*.0032+bank);
          float hgt=exp(-max(p.y-1.,0.)*.026);
          float d=smoothstep(.34,.78,bank)*.8+.16; d*=.45+1.25*wisp;
          /* mist the swell throws up around the rock */
          float r=length(p.xz/vec2(1.2,1.)); float mist=smoothstep(46.,24.,r)*smoothstep(7.,14.,r)*exp(-max(p.y,0.)*.16)*(.3+1.4*wisp);
          return d*hgt*.0052+mist*.030;
        }
        vec4 cone(vec3 ro,vec3 rd,float tmax,float dither){
          /* two opposed beams = one infinite double cone; march only where the ray is inside it */
          vec3 o=ro-uLampPos,B=normalize(uBeamDir);
          float c2=.984,db=dot(rd,B),ob=dot(o,B);           /* outer half-angle ≈ 6° */
          float A=db*db-c2,Bq=db*ob-c2*dot(rd,o),C=ob*ob-c2*dot(o,o);
          float disc=Bq*Bq-A*C; float t0=0.,t1=tmax;
          if(disc<0.){ if(A<0.) return vec4(0.); }
          else { float s=sqrt(disc);float ra=(-Bq-s)/A,rb=(-Bq+s)/A;float lo=min(ra,rb),hi=max(ra,rb);
            if(A<0.){t0=max(lo,0.);t1=min(hi,tmax);}
            else if(C>0.&&lo>0.){t1=min(lo,tmax);}
            else if(C<=0.&&hi>0.){t0=hi;} }
          if(t1<=t0) return vec4(0.);
          t1=min(t1,t0+1400.);
          vec3 sum=vec3(0.); const int N=${Q.beamSteps};
          float near=max(t0,1.); float ratio=t1/near;
          for(int i=0;i<N;i++){
            float f=(float(i)+dither)/float(N),f2=(float(i)+dither+1.)/float(N);
            float a=near*pow(ratio,f)-near+t0,b=near*pow(ratio,f2)-near+t0; float k=(t1-t0)/max(t1-near+1e-3,1e-3);
            float t=t0+(a-t0)*k,dt=(b-a)*k;
            vec3 p=ro+rd*t-uLampPos; float r=length(p)+1e-3; vec3 pd=p/r; float m=abs(dot(pd,B));
            float ang=acos(min(m,1.));
            float perp=r*sin(min(ang,1.5)),w1=.85+.027*r,w2=2.+.07*r; float prof=exp(-perp*perp/(w1*w1))+.14*exp(-perp*perp/(w2*w2));
            vec3 wp=p+uLampPos;
            /* the beam is only visible because there is something in the air */
            float n=n3(wp*.013+vec3(uWind.x,0.,uWind.y)*uTime*.008);float n2=n3(wp*.055-vec3(0.,uTime*.02,0.));
            float air=.30+2.1*n*n*n+1.0*(n2-.42)*smoothstep(260.,20.,r);
            /* astragals: the lantern's own bars stripe the light */
            float bars=.82+.18*smoothstep(.0,.35,abs(sin(atan(wp.z,wp.x)*6.+.35)));
            float ph=dot(rd,pd); float hg=.28+1.9*pow(.5+.5*-ph,7.)+.35*pow(.5+.5*ph,4.);
            float fall=1./(5.+r*.30+r*r*.0055)*smoothstep(.7,2.6,r);
            sum+=prof*max(air,0.)*bars*hg*fall*dt*exp(-r*.0011);
          }
          return vec4(sum*uBeamCol*uLamp*1.8,0.);
        }
        float shaft(vec3 p){
          vec2 q=p.xz+uMoonDir.xz/max(uMoonDir.y,.25)*(-p.y);
          float a=texture2D(tNoise,q*.018+uTime*.0028).r,b=texture2D(tNoise,q*.047-uTime*.0045).r;
          return pow(sat(a*.75+b*.55-.30),2.2)*3.2;
        }
        void main(){
          float z=texture2D(tDepth,vUv).x; vec3 wp=worldAt(vUv,z); vec3 rd=wp-uCam; float d=length(rd); rd/=d;
          bool sky=z>=.99999; float dm=sky?6000.:min(d,6000.);
          float dither=fract(ign(gl_FragCoord.xy)+uFrame*.61803);
          float und=lensUnder(rd);
          vec3 sc=vec3(0.),T=vec3(1.);
          if(und>0.){
            /* ── inside the water ── */
            float tm=min(dm,90.); const int N=${Q.volSteps};
            vec3 sig=vec3(.150,.050,.044)*.95;
            float pt=0.;
            for(int i=0;i<N;i++){
              float f=(float(i)+dither)/float(N); float t=tm*f*f; float dt=tm*(2.*f)/float(N);
              vec3 p=uCam+rd*t; float depth=max(uWaterH-p.y,0.);
              vec3 down=exp(-sig*depth*1.35);
              float ph=.4+1.5*pow(max(dot(rd,normalize(vec3(uMoonDir.x,uMoonDir.y+.5,uMoonDir.z))),0.),5.);
              vec3 L=vec3(.028,.072,.078)*(.16+shaft(p)*ph)*(1.+uFlash*9.)+uBeamCol*uLamp*.02*beamAz(p,.12);
              sc+=T*L*down*dt*.075; T*=exp(-sig*dt);
            }
            T=exp(-sig*tm);
            gl_FragColor=vec4(sc+skyBase(vec3(0.,.05,-1.))*0.,-dot(T,vec3(.333))-1e-4);
            return;
          }
          float tr=1.; float start=uFogStart; float tm=min(dm,620.);
          if(tm>start){
            const int N=${Q.volSteps};
            for(int i=0;i<N;i++){
              float f=(float(i)+dither)/float(N); float t=start+(tm-start)*f*f; float dt=(tm-start)*2.*f/float(N);
              vec3 p=uCam+rd*t;
              float dn=fogDens(p,t)*uFogDens*dt;
              /* forward scatter of moon + lightning, plus the wash from the lamp as it passes */
              float ph=pow(max(dot(rd,uMoonDir),0.),6.);
              vec3 L=uFogCol*uMood*(.75+1.1*ph)+vec3(.30,.38,.50)*uFlash*(.10+.55*pow(max(dot(rd,uFlashDir),0.),3.));
              vec3 lp=p-uLampPos; float lr=length(lp);
              L+=uBeamCol*uLamp*(.55/(1.+lr*lr*.006))+uBeamCol*uLamp*beamAz(p,.10)*.11*exp(-lr*.004);
              float a=1.-exp(-dn); sc+=tr*a*L; tr*=1.-a;
            }
          }
          /* beyond the march: analytic aerial perspective to the horizon */
          if(dm>620.){ float ext=(dm-620.)*.00052*uFogDens*exp(-max(uCam.y+rd.y*1400.,0.)*.0016)*exp(-max(rd.y,0.)*16.); float a=1.-exp(-ext); sc+=tr*a*skyBase(normalize(vec3(rd.x,max(rd.y,.0),rd.z))); tr*=1.-a; }
          if(uLamp>.003){
            sc+=cone(uCam,rd,min(dm,1500.),dither).rgb;
            /* glow of the source itself, closed form */
            vec3 o=uLampPos-uCam; float b=dot(o,rd); float h=sqrt(max(dot(o,o)-b*b,1e-3))+.35;
            float g=(atan((min(dm,4000.)-b)/h)+atan(b/h))/h;
            sc+=uBeamCol*uLamp*g*.034*(1.-uInterior*.82);
          }
          gl_FragColor=vec4(sc,tr);
        }`,
    });

    this.mFog = new THREE.ShaderMaterial({
      uniforms: { ...U, ...cu }, vertexShader: quadVS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`${COMMON}
        uniform sampler2D tColor,tVol;uniform vec2 uRes,uVolRes;uniform float uNear,uFar;varying vec2 vUv;${WORLD}
        float lin(float z){return uNear*uFar/(uFar-z*(uFar-uNear));}
        void main(){
          vec2 uv=vUv; float z0=texture2D(tDepth,uv).x; vec3 rd=normalize(worldAt(uv,z0)-uCam);
          float und=lensUnder(rd);
          if(und>0.){ /* refractive shimmer of the medium */
            float a=smoothstep(0.,.12,und);
            uv+=a*(vec2(sin(uv.y*13.+uTime*1.1)+sin(uv.x*9.-uTime*.8),cos(uv.x*11.+uTime*.9))*.0022);
            z0=texture2D(tDepth,uv).x;
          }
          vec3 c=texture2D(tColor,uv).rgb; float zl=lin(z0);
          /* depth-aware 9-tap upsample: hides the dither without bleeding air over edges */
          vec4 acc=vec4(0.);float w=0.; vec2 px=1./uVolRes;
          for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
            vec2 o=uv+vec2(x,y)*px*.95; float z=lin(texture2D(tDepth,o).x);
            float k=exp(-abs(z-zl)/(zl*.08+.02))*(1.-.22*float(abs(x)+abs(y)))+1e-4; acc+=texture2D(tVol,o)*k; w+=k;
          }
          acc/=w;
          if(und>0.){
            vec3 wp=worldAt(uv,z0); float d=z0>=.99999?90.:min(length(wp-uCam),90.);
            vec3 sig=vec3(.150,.050,.044)*.95; float dep=max(uWaterH-uCam.y,0.);
            vec3 T=exp(-sig*d); c=c*T*exp(-sig*dep*.35)+max(acc.rgb,0.);
            /* body colour floor: water is never black, just very far away */
            c+=vec3(.0022,.0078,.0092)*(1.-T)*exp(-dep*.03);
          } else c=c*clamp(acc.a,0.,1.)+acc.rgb;
          /* meniscus: the film itself, thick and bright at the lip */
          float film=exp(-abs(und)*95.); float lip=smoothstep(.0,.012,und)*exp(-max(und,0.)*52.);
          c=mix(c,c*.35+vec3(.012,.026,.030),film*.75*step(-.05,und)); c+=vec3(.045,.075,.085)*lip*(.35+uFlash);
          gl_FragColor=vec4(c,1.);
        }`,
    });

    this.mDown = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2() }, first: { value: 0 } }, vertexShader: quadVS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`uniform sampler2D t;uniform vec2 px;uniform float first;varying vec2 vUv;
        vec3 s(vec2 o){vec3 c=min(texture2D(t,vUv+o*px).rgb,vec3(40.));if(first>.5){float l=max(c.r,max(c.g,c.b));c*=smoothstep(.10,1.1,l);c/=1.+l*.05;}return c;}
        void main(){vec3 c=s(vec2(0))*.25+(s(vec2(1,1))+s(vec2(-1,1))+s(vec2(1,-1))+s(vec2(-1,-1)))*.125+(s(vec2(2,0))+s(vec2(-2,0))+s(vec2(0,2))+s(vec2(0,-2)))*.0625;gl_FragColor=vec4(c,1.);}` });
    this.mUp = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, b: { value: null }, px: { value: new THREE.Vector2() }, k: { value: 1 } }, vertexShader: quadVS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`uniform sampler2D t,b;uniform vec2 px;uniform float k;varying vec2 vUv;
        void main(){vec3 c=texture2D(t,vUv).rgb*.25;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){if(x==0&&y==0)continue;c+=texture2D(t,vUv+vec2(x,y)*px*1.2).rgb*(x==0||y==0?.125:.0625);}gl_FragColor=vec4(texture2D(b,vUv).rgb+c*k,1.);}` });

    this.grade = { uGrade: { value: new THREE.Color(1, 1, 1) }, uExposure: { value: 0 }, uWet: { value: 0 }, uGrain: { value: 1 }, uVig: { value: 1 }, uSmear: { value: 0 } };
    this.mOut = new THREE.ShaderMaterial({
      uniforms: { ...U, ...this.grade, t: { value: this.rtFog.texture }, tBloom: { value: this.up[0].texture }, uRes: cu.uRes }, vertexShader: quadVS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`${COMMON}
        uniform sampler2D t,tBloom;uniform vec2 uRes;uniform vec3 uGrade;uniform float uExposure,uWet,uGrain,uVig;varying vec2 vUv;
        vec2 drops(vec2 uv,float s,float sp){ /* beads and runs on the lens */
          vec2 g=uv*vec2(s*uRes.x/uRes.y,s); g.y+=uTime*sp; vec2 id=floor(g),f=fract(g)-.5; float r=hash12(id+s);
          vec2 c=(vec2(hash12(id+3.1),hash12(id+7.7))-.5)*.6; float life=fract(r*7.+uTime*(.05+r*.08)); float sz=(.06+.16*r*r)*smoothstep(1.,.55,life)*smoothstep(0.,.06,life)*step(.62,r+uWet*.4);
          vec2 d=f-c; d.x*=1.15; float l=length(d); return l<sz?d/sz*(1.-pow(l/sz,4.))*.9:vec2(0.); }
        vec3 aces(vec3 x){const mat3 a=mat3(.59719,.076,.0284,.35458,.90834,.13383,.04823,.01566,.83777);const mat3 b=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602);
          x=a*x;x=(x*(x+.0245786)-.000090537)/(x*(.983729*x+.4329510)+.238081);return clamp(b*x,0.,1.);}
        void main(){
          vec2 uv=vUv,c=uv-.5;
          if(uWet>.01){vec2 d=drops(uv,7.,.02)+drops(uv+.37,15.,.05);uv-=d*.030*min(uWet,1.);}
          float ca=dot(c,c)*.0022;
          vec3 col=vec3(texture2D(t,uv+c*ca).r,texture2D(t,uv).g,texture2D(t,uv-c*ca).b);
          vec3 bl=texture2D(tBloom,uv).rgb; col+=bl*.052;
          col*=uExposure*uGrade;
          col*=1.-uVig*smoothstep(.18,.95,dot(c,c)*1.9)*.62;
          col=aces(col*1.55);
          /* print: shadows lean blue-green, highlights toward candle */
          float l=dot(col,vec3(.2126,.7152,.0722));
          col=mix(col,col*vec3(.90,1.01,1.07),(1.-smoothstep(.0,.35,l))*.55);
          col=mix(vec3(l),col,.94);
          col=pow(max(col,0.),vec3(1./2.2));
          float gr=hash12(gl_FragCoord.xy+fract(uTime*7.13)*431.)-.5; col+=gr*(.030*(1.-l*.7))*uGrain;
          gl_FragColor=vec4(col,1.);
        }`,
    });
    this.frame = 0;
  }

  resize(w, h, dpr) { this.w = w; this.h = h; this.dpr = dpr; this.r.setSize(w, h, false); this.apply(); }
  setScale(s) { this.scale = s; this.apply(); }
  apply() {
    const k = Math.min(this.dpr, Q.maxDpr) * this.scale;
    const W = Math.max(2, Math.round(this.w * k)), H = Math.max(2, Math.round(this.h * k));
    this.r.setSize(W, H, false);
    this.rtScene.setSize(W, H); this.rtFog.setSize(W, H);
    const vw = Math.ceil(W * Q.volScale), vh = Math.ceil(H * Q.volScale); this.rtVol.setSize(vw, vh);
    this.cu.uRes.value.set(W, H); this.cu.uVolRes.value.set(vw, vh);
    let a = W, b = H; for (let i = 0; i < this.down.length; i++) { a = Math.max(2, a >> 1); b = Math.max(2, b >> 1); this.down[i].setSize(a, b); this.up[i].setSize(a, b); }
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.qs, this.cam); }
  render(scene, camera) {
    const c = this.cu; c.uCam.value.copy(camera.position); c.uNear.value = camera.near; c.uFar.value = camera.far;
    c.uIPV.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert(); c.uFrame.value = this.frame++ % 64;
    this.r.setRenderTarget(this.rtScene); this.r.clear(); this.r.render(scene, camera);
    this.pass(this.mVol, this.rtVol);
    this.pass(this.mFog, this.rtFog);
    let src = this.rtFog;
    this.down.forEach((d, i) => { const m = this.mDown.uniforms; m.t.value = src.texture; m.px.value.set(1 / src.width, 1 / src.height); m.first.value = i === 0 ? 1 : 0; this.pass(this.mDown, d); src = d; });
    for (let i = this.down.length - 1; i >= 0; i--) {
      const m = this.mUp.uniforms, last = i === this.down.length - 1; m.t.value = last ? this.down[i].texture : this.up[i + 1].texture; m.b.value = this.down[i].texture; m.k.value = last ? 0 : 1.0;
      m.px.value.set(1 / this.down[Math.min(i + 1, this.down.length - 1)].width, 1 / this.down[Math.min(i + 1, this.down.length - 1)].height); this.pass(this.mUp, this.up[i]);
    }
    this.pass(this.mOut, null);
  }
  dispose() { [this.rtScene, this.rtVol, this.rtFog, ...this.down, ...this.up].forEach((t) => t.dispose()); [this.mVol, this.mFog, this.mDown, this.mUp, this.mOut].forEach((m) => m.dispose()); }
}
