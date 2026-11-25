import * as THREE from 'three';
import { Q } from './quality.js';

export function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  r.setPixelRatio(1);                              // resolution is owned by postProcessing.js
  r.outputColorSpace = THREE.LinearSRGBColorSpace; // the final grade does its own transfer
  r.toneMapping = THREE.NoToneMapping;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  r.shadowMap.autoUpdate = false;                  // the architecture is static: bake once
  r.setClearColor(0x000000, 1);
  return r;
}
