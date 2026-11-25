import * as THREE from 'three';
import { U } from '../core/shared.js';
import { COMMON, BEAM } from '../glsl/chunks.js';

/**
 * Every surface is a MeshStandardMaterial whose albedo / roughness / height are *computed* from world position
 * and the baked noise atlas. No UVs, no image downloads; height becomes a bump normal via screen derivatives.
 */
const LIB = /* glsl */`
varying vec3 vWP; varying vec3 vWN;
vec4 tri(vec3 p,vec3 n,float s){vec3 w=pow(abs(n),vec3(4.));w/=w.x+w.y+w.z;p*=s;
  return texture2D(tNoise,p.zy)*w.x+texture2D(tNoise,p.xz+.37)*w.y+texture2D(tNoise,p.xy+.71)*w.z;}
vec3 bumpN(vec3 vp,vec3 N,float h){vec3 sx=dFdx(vp),sy=dFdy(vp);vec3 r1=cross(sy,N),r2=cross(N,sx);float det=dot(sx,r1);
  vec3 g=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);vec3 q=abs(det)*N-g;float l=dot(q,q);return (l>1e-24&&l<1e12)?normalize(mix(q/sqrt(l),N,.0)):N;}
`;
const SURF = {
  rock: /* glsl */`
    vec4 a=tri(vWP,vWN,.045),b=tri(vWP,vWN,.21),c=tri(vWP,vWN,1.1);
    float strata=texture2D(tNoise,vec2(vWP.y*.16+a.r*.4,.3)).r;
    float crack=smoothstep(.06,.0,b.b)*.8+smoothstep(.045,.0,tri(vWP,vWN,.6).b)*.4;
    sAlb=mix(vec3(.028,.031,.035),vec3(.105,.106,.104),b.r*.6+a.r*.5-.15)*(.75+.5*strata);
    sAlb*=1.-.55*crack; sAlb=mix(sAlb,vec3(.15,.145,.12),smoothstep(.6,.8,c.a+a.g*.2)*smoothstep(4.,8.,vWP.y)*.35);
    float wet=smoothstep(8.5,1.5,vWP.y+a.r*4.-2.);
    float algae=smoothstep(3.2,.2,vWP.y+b.r*2.)*smoothstep(-9.,-1.,vWP.y);
    sAlb=mix(sAlb,vec3(.012,.020,.014),algae*.75);
    float barn=smoothstep(.62,.72,c.a)*smoothstep(2.6,1.2,vWP.y)*smoothstep(-2.5,.2,vWP.y)*.5; sAlb=mix(sAlb,vec3(.17,.17,.155),barn);
    sAlb*=mix(1.,.55,wet);
    sRough=mix(.86,.22,wet*(.55+.45*smoothstep(.35,.65,a.g))*smoothstep(-.6,.3,vWP.y))+c.a*.08;
    sRough=mix(sRough,.33,smoothstep(.75,.95,vWN.y)*smoothstep(.45,.6,a.r)); /* standing rain */
    sH=(b.r*.34+c.r*.10+strata*.10-crack*.16)*1.3;
    float cau=pow(texture2D(tNoise,(vWP.xz+uMoonDir.xz*(-vWP.y)*1.2)*.07+uTime*.013).b*texture2D(tNoise,(vWP.xz)*.061-uTime*.011).b*2.2,1.6);
    sEm+=vec3(.02,.075,.075)*cau*smoothstep(.6,-1.2,vWP.y)*exp(vWP.y*.09)*(.4+max(vWN.y,0.))*(.5+uFlash*5.);
    sEm+=uBeamCol*sAlb*uLamp*beamAz(vWP,.10)*.7*max(dot(vWN,normalize(uLampPos-vWP)),0.);
    vec3 ds=vWP-vec3(0.,9.8,6.6);float dl=length(ds);
    sEm+=vec3(1.,.48,.17)*sAlb*(.35+.65*max(dot(vWN,-ds/dl),0.))*smoothstep(.1,.75,ds.z/dl)*3.2/(1.+dl*dl*.32)*step(0.,ds.z);
  `,
  tower: /* glsl */`
    float th=atan(vWP.z,vWP.x),R=length(vWP.xz);
    vec2 uv=vec2(th*6.,vWP.y);
    float row=floor(uv.y/.82); float bw=1.5; float off=fract(row*.5)*bw+hash12(vec2(row,3.))*.3;
    vec2 bl=vec2(mod(uv.x+off,bw),mod(uv.y,.82)); vec2 id=vec2(floor((uv.x+off)/bw),row);
    float jit=texture2D(tNoise,uv*.21).r-.5;
    float jd=min(min(bl.x,bw-bl.x),min(bl.y,.82-bl.y))+jit*.10;
    float joint=smoothstep(.055,.0,jd); float br=hash12(id);
    vec4 n1=texture2D(tNoise,uv*.045),n2=texture2D(tNoise,uv*.17+.4),n3=texture2D(tNoise,uv*.71);
    vec4 st=texture2D(tNoise,vec2(uv.x*.085,uv.y*.011)), st2=texture2D(tNoise,vec2(uv.x*.33,uv.y*.02+.5));
    /* render / limewash surviving in patches, lost toward the weather side and the base */
    float side=.5+.5*cos(th-2.4);
    float loss=n1.r*.95+n2.r*.40+smoothstep(22.,8.,uv.y)*.30+side*.13;
    float plaster=smoothstep(.86,.80,loss);
    float edge=smoothstep(.05,.0,abs(loss-.83));
    vec3 stone=mix(vec3(.075,.076,.078),vec3(.17,.165,.155),br*.6+n2.r*.45); stone*=1.-.6*joint; stone*=.7+.5*n3.r;
    vec3 lime=mix(vec3(.30,.295,.28),vec3(.42,.415,.39),n2.r); 
    float band=smoothstep(.0,.08,sin((uv.y-13.)*.2094+.0)*1.+n2.r*.14-.07); lime=mix(lime,vec3(.075,.085,.092)*(1.+n2.r),band*.92);
    lime*=.8+.35*n3.r;
    sAlb=mix(stone,lime,plaster);
    /* weather: vertical stains, rust weeping from ironwork, algae climbing from the base */
    float drip=smoothstep(.48,.80,st.r*.75+st2.r*.4)*smoothstep(8.,40.,uv.y+st2.r*10.);
    sAlb*=1.-.62*drip;
    float rust=smoothstep(.58,.82,st2.g*.65+st.r*.45)*(smoothstep(45.,53.8,uv.y)+smoothstep(27.,31.6,uv.y)*step(uv.y,31.8)*.9);
    sAlb=mix(sAlb,vec3(.125,.050,.020)*(.6+n3.r),sat(rust)*.8);
    float alg=smoothstep(17.,9.,uv.y+n1.r*7.); sAlb=mix(sAlb,vec3(.026,.034,.026)*(.6+n2.r),alg*.78);
    float ck=smoothstep(.018,.0,texture2D(tNoise,uv*.075+n2.rg*.02).b)*smoothstep(.45,.6,n1.g); sAlb*=1.-.8*ck;
    sRough=mix(.62,.9,n3.r)-drip*.25-alg*.25;
    sH=(plaster*.030-edge*plaster*.01+(1.-plaster)*(-joint*.055+br*.02+n3.r*.030)+n3.a*.012-ck*.06+n2.r*.03)*1.6;
    sEm+=uBeamCol*sAlb*uLamp*smoothstep(42.,54.,vWP.y)*.05;
  `,
  stone: /* glsl */`
    vec4 a=tri(vWP,vWN,.17),b=tri(vWP,vWN,.8);
    sAlb=mix(vec3(.06,.061,.063),vec3(.19,.185,.172),a.r)*(.72+.5*b.r);
    sAlb=mix(sAlb,vec3(.03,.036,.028),smoothstep(.5,.75,a.g)*.6);
    float k=smoothstep(.03,.0,tri(vWP,vWN,.33).b); sAlb*=1.-.6*k;
    sRough=.55+.35*b.r; sH=a.r*.06+b.r*.03-k*.05;
    vec3 ds=vWP-vec3(0.,10.6,6.4);float dl=length(ds);
    sEm+=vec3(1.,.48,.17)*sAlb*smoothstep(-.1,.8,ds.z/dl)*(.4+.6*max(dot(vWN,-ds/dl),0.))*2.6/(1.+dl*dl*.35);
  `,
  inner: /* glsl */`
    float th=atan(vWP.z,vWP.x);
    vec2 uv=vec2(th*4.4,vWP.y);
    float row=floor(uv.y/.30); float bw=.62; float off=fract(row*.5)*bw; 
    vec2 bl=vec2(mod(uv.x+off,bw),mod(uv.y,.30)); float br=hash12(vec2(floor((uv.x+off)/bw),row));
    float jit=texture2D(tNoise,uv*.5).r-.5;
    float joint=smoothstep(.03,.0,min(min(bl.x,bw-bl.x),min(bl.y,.30-bl.y))+jit*.04);
    vec4 n1=texture2D(tNoise,uv*.06),n2=texture2D(tNoise,uv*.24),n3=texture2D(tNoise,uv*.95);
    vec4 st=texture2D(tNoise,vec2(uv.x*.11,uv.y*.018));
    float loss=n1.r*.9+n2.r*.45; float pl=smoothstep(.72,.67,loss);
    vec3 brick=mix(vec3(.085,.070,.058),vec3(.17,.135,.105),br)*(1.-.55*joint)*(.6+.7*n3.r);
    vec3 lime=mix(vec3(.23,.22,.195),vec3(.36,.345,.305),n2.r)*(.75+.4*n3.r);
    float dado=smoothstep(.03,.0,mod(uv.y-9.6,44.4)-1.5)*0.; 
    sAlb=mix(brick,lime,pl); sAlb*=1.-.55*smoothstep(.45,.75,st.r); 
    sAlb=mix(sAlb,vec3(.035,.045,.036),smoothstep(.55,.8,n1.g)*.55);
    sAlb*=mix(.55,1.,smoothstep(9.6,11.2,uv.y+n2.r));
    sRough=.6+.35*n3.r-.25*smoothstep(.45,.75,st.r);
    sH=pl*.02+(1.-pl)*(-joint*.025+br*.012)+n3.r*.016+n2.r*.015;
    sAmb=.34;
  `,
  floor: /* glsl */`
    float r=length(vWP.xz); vec2 q=vWP.xz; 
    vec2 g=vec2(mod(q.x+floor(q.y/.9)*.43,1.2),mod(q.y,.9)); 
    vec4 b=tri(vWP,vWN,.9),a=tri(vWP,vWN,.2);
    float j=smoothstep(.035,.0,min(min(g.x,1.2-g.x),min(g.y,.9-g.y))+(b.r-.5)*.03);
    float id=hash12(vec2(floor((q.x+floor(q.y/.9)*.43)/1.2),floor(q.y/.9)));
    sAlb=mix(vec3(.05,.049,.047),vec3(.13,.125,.115),id*.5+a.r*.5)*(1.-.6*j)*(.7+.5*b.r);
    float puddle=smoothstep(.52,.6,a.r); sRough=mix(.72,.10,puddle); sAlb*=mix(1.,.5,puddle);
    sH=(id*.012-j*.03+b.r*.012)*(1.-puddle); sAmb=.4;
  `,
  iron: /* glsl */`
    vec4 a=tri(vWP,vWN,.4),b=tri(vWP,vWN,1.9);
    float ru=smoothstep(.36,.78,a.r*.7+b.r*.4);
    sAlb=mix(vec3(.030,.033,.036),mix(vec3(.058,.031,.020),vec3(.120,.066,.038),b.r),ru*.9);
    sRough=mix(.42,.92,ru)+b.a*.08; sMetal=mix(.45,.08,ru); sH=ru*.010+b.r*.010;
    sAmb=mix(1.,.45,uInterior);
  `,
  brass: /* glsl */`
    vec4 a=tri(vOP,vON,.9),b=tri(vOP,vON,4.);
    float ta=smoothstep(.36,.62,a.r*.75+b.r*.3);
    sAlb=mix(vec3(.30,.235,.145),vec3(.045,.058,.048),ta*.9); sRough=mix(.36,.8,ta)+b.a*.1; sMetal=mix(.95,.35,ta); sH=b.r*.002; sAmb=.5;
  `,
  wood: /* glsl */`
    vec3 p=vOP; vec3 w=abs(vON);
    vec2 u=w.x>w.z?p.zy:p.xy; if(w.y>.7)u=p.xz;
    float pl=floor(u.x/.19); float gap=smoothstep(.012,.0,abs(fract(u.x/.19)-.0)*.19);
    vec4 g=texture2D(tNoise,vec2(u.x*1.9+pl*.37,u.y*.11+pl*.21)),b=tri(p,vON,.8);
    sAlb=mix(vec3(.035,.028,.022),vec3(.115,.088,.062),g.r)*(.6+.6*b.r)*(1.-.75*gap)*(.75+.4*hash12(vec2(pl,2.)));
    sRough=.7+.2*g.r; sH=g.r*.02-gap*.02; sAmb=.3;
  `,
  copper: /* glsl */`
    vec4 a=tri(vWP,vWN,.3),b=tri(vWP,vWN,1.4); float st=texture2D(tNoise,vec2(atan(vWP.z,vWP.x)*1.5,vWP.y*.05)).r;
    float v=smoothstep(.3,.6,a.r*.6+st*.5);
    sAlb=mix(vec3(.10,.055,.035),vec3(.085,.135,.120),v)*(.6+.6*b.r); sRough=.5+.3*v; sMetal=.7-.55*v; sH=b.r*.01;sAmb=mix(1.,.15,uInterior);
  `,
  basalt: /* glsl */`
    vec4 a=tri(vOP,vON,.9),b=tri(vOP,vON,3.5);
    sAlb=mix(vec3(.018,.021,.025),vec3(.06,.064,.07),a.r*.7+b.r*.3); sRough=mix(.24,.6,smoothstep(.4,.65,a.g)); sH=a.r*.03+b.r*.004;
    float salt=smoothstep(.62,.8,b.a+a.r*.2)*smoothstep(.3,.9,vON.y); sAlb=mix(sAlb,vec3(.22,.23,.24),salt*.22); sRough=mix(sRough,.95,salt); sAmb=.6;
  `,
  char: /* glsl */`
    float cap=step(.7,vON.y);vec2 cu=cap>.5?vec2(length(vOP.xz)*2.6,atan(vOP.z,vOP.x)*.02+.4):vec2(atan(vOP.z,vOP.x)*.9,vOP.y*.35);vec4 a=texture2D(tNoise,cu),b=tri(vOP,vON,3.);
    float ck=smoothstep(.10,.0,texture2D(tNoise,cap>.5?vOP.xz*.8:vec2(atan(vOP.z,vOP.x)*1.1,vOP.y*.9)).b);
    sAlb=mix(vec3(.010,.0095,.009),vec3(.040,.036,.033),a.r)*(1.-ck*.6); sRough=.55+.4*b.r; sH=a.r*.04-ck*.05+b.r*.01; sAmb=.6;
    sEm+=vec3(.55,.11,.015)*ck*smoothstep(.55,.75,texture2D(tNoise,vOP.xz*.4+vOP.y*.3+uTime*.004).r)*.10*uStormy;
  `,
};
export const stormy = { value: 0 };
const EXTERIOR = new Set(['rock', 'tower', 'stone']);

export function surface(kind, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ side: opts.side ?? THREE.FrontSide });
  m.name = kind;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uStormy: stormy });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;varying vec3 vWN;varying vec3 vOP;varying vec3 vON;')
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
        vec4 wp4=vec4(transformed,1.); vec3 on4=normal;
        vOP=transformed; vON=normal;
        #ifdef USE_INSTANCING
          wp4=instanceMatrix*wp4; on4=mat3(instanceMatrix)*on4;
        #endif
        vWP=(modelMatrix*wp4).xyz; vWN=normalize(mat3(modelMatrix)*on4);`);
    let lights = THREE.ShaderChunk.lights_fragment_begin;
    // interior lamps have no shadow maps; stone outside must simply not know about them
    if (EXTERIOR.has(kind)) lights = lights.replace(/NUM_POINT_LIGHTS/g, '0').replace(/NUM_SPOT_LIGHTS/g, '0');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#undef PI_HALF\n${COMMON.replace('#define PI 3.14159265', '')}${BEAM}${LIB}varying vec3 vOP;varying vec3 vON;uniform float uStormy;`)
      .replace('#include <color_fragment>', `vec3 sAlb=vec3(.2),sEm=vec3(0.);float sRough=.8,sMetal=0.,sH=0.,sAmb=1.;{${SURF[kind]}}diffuseColor.rgb=sAlb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=clamp(sRough,.14,1.);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor=sMetal;')
      .replace('#include <normal_fragment_maps>', 'normal=bumpN(-vViewPosition,normal,sH*smoothstep(160.,20.,length(vViewPosition)));')
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse*=sAmb;reflectedLight.indirectSpecular*=sAmb;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance+=sEm;');
  };
  m.customProgramCacheKey = () => 'tll-' + kind;
  return m;
}
