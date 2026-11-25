import * as THREE from 'three';
import { U } from './core/shared.js';
import { Q } from './core/quality.js';
import { bakeNoise } from './world/noiseTextures.js';
import { bakeShore, createRock } from './world/rock.js';
import { createSky } from './world/sky.js';
import { createOcean } from './world/ocean.js';
import { createLighthouse } from './world/lighthouse.js';
import { createInterior } from './world/interior.js';
import { createLantern } from './world/lantern.js';
import { createWeather } from './world/weather.js';

const breathe = () => new Promise((r) => setTimeout(r));

/** Builds the world in slices so the page stays responsive while it is still dark. */
export async function createWorld(renderer) {
  const scene = new THREE.Scene();
  bakeNoise(renderer, Q.mobile ? 512 : 1024); bakeShore(); await breathe();
  const sky = createSky(); scene.add(sky);
  const ocean = createOcean(); scene.add(ocean); await breathe();
  const rock = createRock(); scene.add(rock); await breathe();
  const house = createLighthouse(); scene.add(house); await breathe();
  const interior = createInterior(); scene.add(interior); await breathe();
  const lantern = createLantern(house.userData.paneGeometry); scene.add(lantern.group); await breathe();
  const weather = createWeather(); scene.add(weather.group);

  /* light: one moon, one sky, one storm. Shadows are baked once because nothing that casts them moves. */
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.30, 0.40, 0.52), new THREE.Color(0.05, 0.07, 0.085), 0.55));
  const dir = (color, int, size) => {
    const l = new THREE.DirectionalLight(color, int); l.castShadow = true; l.shadow.mapSize.set(size, size);
    Object.assign(l.shadow.camera, { left: -62, right: 62, top: 70, bottom: -50, near: 10, far: 330 }); l.shadow.bias = -0.0006; l.shadow.normalBias = 0.06; l.target.position.set(0, 24, 0); scene.add(l, l.target); return l;
  };
  const moon = dir(new THREE.Color(0.55, 0.69, 0.90), 1.5, Q.shadow); moon.position.copy(U.uMoonDir.value).multiplyScalar(150).add(moon.target.position);
  const sun = new THREE.DirectionalLight(new THREE.Color(0.72, 0.82, 1), 0); scene.add(sun); // lightning

  /* reflections for metal and wet stone: the sky itself, prefiltered */
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(), s2 = createSky(); es.add(s2); U.uFlash.value = 0;
  const env = pm.fromScene(es, 0.01, 0.1, 10); scene.environment = env.texture; scene.environmentIntensity = 2.2; pm.dispose(); s2.geometry.dispose();
  renderer.shadowMap.needsUpdate = true;
  return { scene, sky, ocean, rock, house, interior, lantern, weather, moon, sun };
}
