import * as THREE from 'three';

/**
 * One uniform block shared (by reference) by every custom shader in the world.
 * Change a value here and sky, sea, stone, fog and glass all agree about it.
 */
export const U = {
  uTime: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.30, 0.34, -0.89).normalize() },
  uMoonCol: { value: new THREE.Color(0.55, 0.68, 0.85) },
  uFogCol: { value: new THREE.Color(0.030, 0.043, 0.056) },
  uFogDens: { value: 1 },
  uFlash: { value: 0 },
  uFlashDir: { value: new THREE.Vector3(0.5, 0.25, -0.8).normalize() },
  uBolt: { value: 0 },
  uBoltSeed: { value: 0 },
  uLamp: { value: 0 },              // 0..1 main lamp
  uLampPos: { value: new THREE.Vector3(0, 56.55, 0) },
  uBeamDir: { value: new THREE.Vector3(1, 0, 0) },
  uBeamCol: { value: new THREE.Color(1.0, 0.74, 0.42) },
  uInterior: { value: 0 },          // 1 inside the tower
  uFogStart: { value: 0 },
  uMood: { value: new THREE.Color(1, 1, 1) },
  uWind: { value: new THREE.Vector2(1, 0.35) },
  uPointer: { value: new THREE.Vector2() },
  uCamUnder: { value: 0 },
  tNoise: { value: null },
  tNoise3: { value: null },
  tShore: { value: null },
};

/** Architectural dimensions — the single source of truth for geometry, collision and camera. */
export const DIM = {
  ground: 9.0,
  floor: 9.6,
  top: 54,                // lantern floor
  lanternR: 3.55,
  glassY0: 54.95,
  glassY1: 58.3,
  turns: 7,
  stairA0: (200 * Math.PI) / 180,
  stairW: 1.3,
  doorA: Math.PI / 2,
  bayA: (36 * Math.PI) / 180,   // missing glazing bay: the way in and out of the lantern
  galleryR: 5.7,
};
export const towerR = (y) => { const t = Math.min(1, Math.max(0, (y - DIM.ground) / 45)); return 4.35 + 2.35 * Math.pow(1 - t, 2.3); };
export const innerR = (y) => { const t = Math.min(1, Math.max(0, (y - DIM.ground) / 45)); return DIM.lanternR + 1.25 * Math.pow(1 - t, 1.6); };
/** Stair parametrisation: s 0..1 → angle / height */
export const stairA = (s) => DIM.stairA0 + s * DIM.turns * Math.PI * 2;
export const stairY = (s) => DIM.floor + s * (DIM.top - DIM.floor);
export const stairR = (s) => innerR(stairY(s)) - 0.72;
