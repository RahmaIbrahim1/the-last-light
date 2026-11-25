/** Shared GLSL. Declared once, included by sky / ocean / post so light behaves identically everywhere. */
export const COMMON = /* glsl */`
uniform float uTime,uFogDens,uFlash,uBolt,uBoltSeed,uLamp,uInterior,uFogStart,uCamUnder;
uniform vec3 uMoonDir,uMoonCol,uFogCol,uFlashDir,uLampPos,uBeamDir,uBeamCol,uMood;
uniform vec2 uWind;
uniform sampler2D tNoise;
#define PI 3.14159265
float sat(float x){return clamp(x,0.,1.);}
float hash12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
`;

export const SKY = /* glsl */`
/* Cheap gradient: used for reflections and as the limit colour of the fog. */
vec3 skyBase(vec3 d){
  float h=max(d.y,0.);
  vec3 zen=vec3(.0045,.0085,.0155);
  vec3 c=mix(uFogCol*uMood,zen,pow(h,.42));
  float m=max(dot(d,uMoonDir),0.);
  c+=uMoonCol*(pow(m,5.)*.045+pow(m,28.)*.12)*(.35+.65*smoothstep(-.02,.2,d.y));
  float f=max(dot(normalize(vec3(d.x,0.,d.z)),normalize(vec3(uFlashDir.x,0.,uFlashDir.z))),0.);
  c+=vec3(.36,.46,.62)*uFlash*(.10+.75*pow(f,7.))*exp(-h*1.6);
  return c;
}
float cloudField(vec2 p){
  vec2 w=texture2D(tNoise,p*.021+uTime*.0006).rg-.5;
  float a=texture2D(tNoise,p*.030+w*.22+uWind*uTime*.0013).r;
  float b=texture2D(tNoise,p*.105+w*.35+uWind*uTime*.0028).r;
  float c=texture2D(tNoise,p*.38-w*.2+uWind*uTime*.004).r;
  return a*.62+b*.28+c*.13;
}
float boltLine(vec3 d){
  if(uBolt<.01) return 0.;
  float az=atan(d.x,-d.z)-atan(uFlashDir.x,-uFlashDir.z);
  az=atan(sin(az),cos(az));
  float y=d.y;
  if(y>.42||y<-.01) return 0.;
  float w=0.,s=uBoltSeed;
  float off=(texture2D(tNoise,vec2(y*.35+s,s*.37)).r-.5)*.16+(texture2D(tNoise,vec2(y*1.9+s,s*.7)).g-.5)*.050+(texture2D(tNoise,vec2(y*7.+s,s)).g-.5)*.020+(texture2D(tNoise,vec2(y*21.,s)).r-.5)*.006;
  w+=exp(-abs(az-off)*1500.)*1.6*(.45+.55*smoothstep(.0,.4,y))+exp(-abs(az-off)*70.)*.10;
  float bs=step(y,.26);
  float off2=off+(.26-y)*(.35+.3*sin(s*40.))+(texture2D(tNoise,vec2(y*9.+s*3.,s)).r-.5)*.05;
  w+=bs*step(.06,y)*(exp(-abs(az-off2)*2200.)*.5);
  return w*uBolt*smoothstep(.42,.2,y);
}
vec3 skyFull(vec3 d){
  vec3 c=skyBase(d);
  float h=max(d.y,0.004);
  vec2 p=d.xz/(h+.10)*1.25;
  float n=cloudField(p); float m=max(dot(d,uMoonDir),0.);
  float cover=texture2D(tNoise,p*.007+.2).r; float dens=max(smoothstep(.34-.10*cover,.62,n),.55*pow(m,14.));
  vec2 toMoon=normalize(uMoonDir.xz)*.55;
  float n2=cloudField(p+toMoon);
  float edge=sat((n-n2)*3.2+.35);
  /* moon disc, mostly veiled */
  float disc=smoothstep(.99962,.99980,m);
  float veil=1.-dens*.93;
  c+=uMoonCol*disc*1.7*veil;
  vec3 dark=vec3(.0050,.0078,.0120)*uMood;
  vec3 lit=dark+uMoonCol*(.010+edge*(.020+pow(m,6.)*.22+pow(m,40.)*.5));
  float f=max(dot(normalize(vec3(d.x,.0,d.z)),normalize(vec3(uFlashDir.x,0.,uFlashDir.z))),0.);
  lit+=vec3(.42,.52,.70)*uFlash*(.05+.9*pow(f,5.))*(n*n*1.7)*(.4+edge);
  c=mix(c,lit,dens*smoothstep(.0,.13,d.y));
  /* lamp blooms on the cloud base when lit */
  c+=uBeamCol*uLamp*.010*smoothstep(.5,.0,d.y);
  c=mix(skyBase(normalize(vec3(d.x,0.,d.z))),c,smoothstep(-.01,.10,d.y));
  c+=vec3(.75,.85,1.)*boltLine(d)*5.;
  return c;
}`;

export const WAVES = (n) => /* glsl */`
#define NW ${n}
uniform vec4 uWaves[NW]; /* dir.x dir.z k amp */
uniform float uWaveScale;
uniform sampler2D tShore;
/* height of the rock below/above this point; -60 outside the baked area */
float shoreH(vec2 p){
  vec2 u=p/240.+.5;
  if(u.x<0.||u.y<0.||u.x>1.||u.y>1.) return -60.;
  return texture2D(tShore,u).r;
}
float shoreDamp(float h){return mix(.16,1.,smoothstep(-.5,-11.,h));}
`;

export const BEAM = /* glsl */`
/* azimuthal beam profile at a world point — two opposed beams from one lens */
float beamAz(vec3 p,float width){
  vec2 d=p.xz-uLampPos.xz; float r=length(d)+1e-3;
  float c=abs(dot(d/r,normalize(uBeamDir.xz)));
  float a=acos(min(c,1.));
  return exp(-a*a/(width*width));
}`;
