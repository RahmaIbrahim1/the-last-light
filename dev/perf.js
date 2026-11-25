export function perf() {
  const t = window.__tll; t.pause(true);
  window.J = (n, o, s = 2, k = 0.1) => { const c = t.ctl; c.flight = null; c.seam = null; c.state = c.states[n]; c.state.enter && c.state.enter(o || {}); c.emit('mode', n, 'x'); t.W.weather.schedule(1e9); t.step(k, Math.round(s / k)); };
  const gl = t.renderer.getContext(), px = new Uint8Array(4), { post, renderer, W, camera } = t; const fin = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const T = (f, n = 4) => { f(); fin(); const s = performance.now(); for (let i = 0; i < n; i++) f(); fin(); return +((performance.now() - s) / n).toFixed(1); };
  const sc = () => { renderer.setRenderTarget(post.rtScene); renderer.clear(); renderer.render(W.scene, camera); renderer.setRenderTarget(null); };
  const out = { scale: post.scale, size: [post.rtScene.width, post.rtScene.height] };
  for (const [n, o] of [['distant'], ['orbit', { th: 0.8, y: 16, r: 66 }], ['below'], ['walk', { at: 'hall' }], ['ascent', { s: 0.4 }], ['lantern', { th: 2 }], ['product', { id: 'deep' }], ['final']]) { if (n === 'final') { t.act.lit = true; t.U.uLamp.value = 1; } J(n, o, 1.5); out[n] = [T(() => t.step(0.016)), T(sc), T(() => { post.pass(post.mVol, post.rtVol); renderer.setRenderTarget(null); })].join(' / '); }
  return out;
}
