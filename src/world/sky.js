import * as THREE from 'three';
import { U } from '../core/shared.js';
import { COMMON, SKY } from '../glsl/chunks.js';

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: U, depthWrite: false, depthTest: true, side: THREE.BackSide,
    vertexShader: 'varying vec3 vD;void main(){vD=position;vec4 p=projectionMatrix*mat4(mat3(modelViewMatrix))*vec4(position,1.);gl_Position=p.xyww;}',
    fragmentShader: `${COMMON}${SKY}varying vec3 vD;void main(){gl_FragColor=vec4(skyFull(normalize(vD)),1.);}`,
  });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), mat);
  m.frustumCulled = false; m.renderOrder = 10; // after opaque: only shades what is really sky
  return m;
}
