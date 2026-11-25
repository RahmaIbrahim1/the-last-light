import '@fontsource/castoro-titling/latin-400.css';
import '@fontsource/castoro/latin-400-italic.css';
import '@fontsource-variable/hanken-grotesk/wght.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { Q, Governor } from './core/quality.js';
import { U, DIM, innerR } from './core/shared.js';
import { clamp, damp, smooth } from './core/math.js';
import { createRenderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { createWorld } from './scene.js';
import { Post } from './postProcessing.js';
import { CameraController } from './camera/cameraController.js';
import { waterHeight } from './world/ocean.js';
import { ProductSystem } from './product/productSystem.js';
import { Interactions } from './interactions.js';
import { AudioManager } from './audioManager.js';
import { Cart } from './shop/cart.js';
import { UI } from './ui.js';

const canvas = document.getElementById('gl');

gsap.ticker.remove(gsap.updateRoot); // tweens run on world time, so they pause and slow with the place

async function boot() {
  const renderer = createRenderer(canvas);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.12, 9000);
  const input = new Input(canvas), audio = new AudioManager(), cart = new Cart();
  const fonts = Promise.all([document.fonts.load("40px 'Castoro Titling'"), document.fonts.load("italic 40px 'Castoro'"), document.fonts.load("20px 'Hanken Grotesk Variable'")]).catch(() => {});
  const W = await createWorld(renderer); await fonts;
  const post = new Post(renderer);
  const ctl = new CameraController(camera, input);
  let act;
  const api = {
    lit: () => act.lit,
    inspect: (id) => act.inspect(id), back: () => act.leaveProduct(), flip: () => products.face(products.side === 'front' ? 'back' : 'front'),
    collection: () => { if (act.igniting) return; started = true; act.seen.add('collection'); if (ctl.mode === 'lantern' && !ctl.busy) { ctl.states.lantern.show = 1; return; } if (ctl.mode === 'product') return act.leaveProduct(); act.toLantern(true); },
    chapter: (i) => {
      if (act.igniting) return; started = true;
      [() => act.travel('distant'), () => ctl.mode === 'distant' ? ctl.handover('approach') : act.travel('distant').then(() => ctl.mode === 'distant' && ctl.handover('approach')), () => act.travel('orbit', { th: 0.73, y: 16, r: 58 }), () => act.travel('low'), () => act.travel('walk', { at: 'door' }),
        () => act.travel('ascent', { s: 0.004, inside: Math.hypot(ctl.pos.x, ctl.pos.z) < 4.5 }), () => act.toLantern(false)][i]();
    },
  };
  const ui = new UI({ cart, audio, api });
  const products = new ProductSystem({ scene: W.scene, renderer, lantern: W.lantern, weather: W.weather, post, audio });
  act = new Interactions({ camera, ctl, input, ui, lantern: W.lantern, products, audio, weather: W.weather, post });
  ui.soundState(false);
  input.onFirst.push(() => { if (!audio.muted) { audio.start(); ui.soundState(true); } });
  W.weather.onThunder = (p, d) => audio.thunder(p, d);

  const resize = () => { camera.aspect = innerWidth / innerHeight; post.resize(innerWidth, innerHeight, devicePixelRatio || 1); };
  addEventListener('resize', resize); resize();
  const gov = new Governor((s) => post.setScale(s)); post.setScale(gov.scale);

  /* ── opening ─────────────────────────────────────────────────────────── */
  let started = false, T0 = -1, time = 0, said = false, holdRing = 0, wetLens = 0, wasUnder = false, spent = 0;
  const opening = () => {
    ui.begin(); T0 = time;
    const at = (s, f) => setTimeout(() => { if (!started || s < 1) f(); }, s * 1000);
    at(0.1, () => W.weather.schedule(time + 13));
    setTimeout(() => W.weather.strike(1.25, -1.15), 3600); setTimeout(() => W.weather.strike(0.8, -1.9), 7600);
    at(4.6, () => ui.titleOn(true));
  };
  ctl.on('mode', (name) => {
    ui.clearReveal();
    if (name !== 'distant') { started = true; ui.titleOn(false); document.body.classList.add('nav'); W.weather.schedule(Math.min(time + 6, 1e8)); }
    if (name === 'orbit') ctl.states.orbit.age = 0; if (name !== 'product') document.body.classList.remove('has-product');
    if (name === 'ascent') ctl.states.walk.hinted = true;
  });
  ctl.on('arrive', (n) => { if (n === 'product') document.body.classList.add('has-product'); if (n === 'distant') ui.titleOn(true); });

  /* ── frame ───────────────────────────────────────────────────────────── */
  function frame(dt) {
    time += dt; U.uTime.value = time; gsap.updateRoot(time); input.begin(dt);
    if (ctl.mode === 'distant' && !ctl.busy && ctl.states.distant.t > 4 && input.forward) { spent += dt; holdRing = Math.min(1, spent / 0.7); if (spent > 0.7) { ctl.handover('approach', { seam: 2 }); spent = 0; } } else { spent = 0; holdRing = damp(holdRing, 0, 4, dt); }
    ctl.states.orbit.age = (ctl.states.orbit.age || 0) + (ctl.mode === 'orbit' ? dt : 0);
    ctl.update(dt);

    const p = camera.position, r = Math.hypot(p.x, p.z);
    const inTower = p.y > DIM.floor - 0.5 && p.y < 59 ? smooth(innerR(p.y) + (p.y > 53.9 ? 0.6 : 1.9), innerR(p.y) - 0.1, r) : 0;
    U.uInterior.value = inTower; U.uFogStart.value = inTower * (p.y > 53.5 ? 3.5 : 7.5);
    const wh = waterHeight(p.x, p.z); post.cu.uWaterH.value = wh; post.cu.uWaterG.value.set((waterHeight(p.x + 0.4, p.z) - wh) / 0.4, (waterHeight(p.x, p.z + 0.4) - wh) / 0.4).clampLength(0, 0.6);
    const under = smooth(0.15, -0.25, p.y - wh) * (r > 9 ? 1 : 0); U.uCamUnder.value = under;
    const isU = under > 0.5; if (isU !== wasUnder) { wasUnder = isU; audio.splash(isU); if (!isU) wetLens = 1.2; }

    // opening exposure: the eye adapts out of nothing
    const E = smooth(0, 11, time - T0); let exp = T0 >= 0 ? 0.10 + 0.90 * E : 0; exp *= ({ distant: 0.72, approach: 1.15, orbit: 1.55, low: 1.35, below: 1.3, final: 1.45, walk: 1.5 }[ctl.mode] ?? 1.15) * (1 + inTower * 0.1); post.grade.uExposure.value = damp(post.grade.uExposure.value, exp, 2, dt);
    // the lens gets wet: rain, spray at sea level, and surfacing
    const spray = ctl.mode === 'approach' ? (ctl.states.approach.low || 0) * 0.55 : ctl.mode === 'low' ? 0.5 : 0; wetLens = damp(wetLens, spray * (1 - under), under > 0.5 ? 6 : 0.55, dt); post.grade.uWet.value = wetLens * (1 - inTower);
    // the lamp has good nights: a ghost of itself in the opening
    if (!act.lit && !act.igniting) { const g = ctl.mode === 'distant' || ctl.mode === 'approach' ? Math.pow(Math.max(0, Math.sin(time * 0.23 - 1.4)), 60) * 0.16 : 0; U.uLamp.value = damp(U.uLamp.value, E > 0.6 ? g : 0, 4, dt); if (!act.igniting) W.lantern.targetSpin = g > 0.01 ? 0.1 : 0; }

    W.ocean.userData.update(camera); W.interior.userData.update(time, Q.reduced); W.lantern.update(dt, time);
    W.interior.visible = r < 75 && p.y > -1; W.lantern.group.visible = r < 420 && under < 0.9; W.rock.visible = true;
    const nearLantern = p.y > 46 && r < 12;
    products.update(dt, camera, nearLantern); ui.side(products.side);
    W.weather.update(dt, time, camera, ctl.vel, W.sun);
    act.update(dt);
    ui.chapter(ctl.state.chapter); ui.hintFor(ctl.mode, ctl.busy, ctl.states);
    if (ctl.mode === 'approach' && !said && ctl.states.approach.u > 0.2) { said = true; ui.say('There is a place<br>where the sea never rests.', 7500); }
    if (!input.touch) ui.cursor(input, ctl.mode === 'low' ? clamp(ctl.states.low.hold / 0.7) : ctl.mode === 'distant' ? holdRing : input.forward && ['approach', 'below', 'walk', 'ascent'].includes(ctl.mode) ? 1 : 0, act.hover());
    audio.update(dt, camera, { rain: W.weather.live.rain.value, spin: W.lantern.spinVel });
    post.render(W.scene, camera); input.end();
  }

  // compile everything while the screen is still black, then begin
  camera.position.set(60, 9, 400); ctl.update(0); for (let i = 0; i < 3; i++) products.update(0, camera, true); // one reflection probe per call W.weather.group.children.forEach((c) => (c.visible = true));
  try { await renderer.compileAsync(W.scene, camera); } catch { /* compiles lazily instead */ }
  post.render(W.scene, camera);
  let last = performance.now(), run = true;
  const tick = (now) => { if (!run) return; requestAnimationFrame(tick); const raw = (now - last) / 1000; last = now; gov.tick(raw); frame(Math.min(raw, 0.1)); };
  requestAnimationFrame((n) => { last = n; opening(); tick(n); });
  if (import.meta.env.DEV) window.__tll = { W, ctl, act, ui, U, post, products, input, gov, camera, renderer, cart, audio, step: (s, n = 1) => { for (let i = 0; i < n; i++) frame(s); }, pause: (v) => { run = !v; if (run) requestAnimationFrame((n) => { last = n; tick(n); }); } };
  addEventListener('pagehide', (e) => { if (e.persisted) return; run = false; products.dispose(); post.dispose(); renderer.dispose(); audio.ctx?.close(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); run = false; ui.hint('The light went out. Reload to return.'); });
  if (import.meta.hot) import.meta.hot.accept(() => location.reload());
}

boot().catch((e) => { console.error(e); const v = document.getElementById('hint'); v.textContent = 'This place needs WebGL 2 to be seen.'; v.classList.add('on'); document.getElementById('veil').style.opacity = 0.6; });
