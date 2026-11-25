// Dev-only: plays the whole journey on logic frames and reports camera continuity.
export async function flow() {
  const t = window.__tll, c = t.ctl, inp = t.input, log = []; t.pause(true);
  const rd = t.post.render; t.post.render = () => {};
  const RUN = (name, n, stop, each) => {
    let mx = 0, mr = 0, p = t.camera.position.clone(), q = t.camera.quaternion.clone(), tt = 0, at = '', pt = '';
    for (let i = 0; i < n; i++) {
      each?.(i); t.step(1 / 30); tt += 1 / 30; const d = p.distanceTo(t.camera.position), a = q.angleTo(t.camera.quaternion);
      if (d > mx) { mx = d; pt = tt.toFixed(1); } if (a > mr) { mr = a; at = c.mode + '@' + tt.toFixed(1); } p.copy(t.camera.position); q.copy(t.camera.quaternion); if (stop && stop()) break;
    }
    log.push(`${name}: ${c.mode}${c.busy ? '*' : ''} ${tt.toFixed(1)}s  ${(mx * 30).toFixed(1)}m/s@${pt}  ${(mr * 30 * 57.3).toFixed(0)}deg/s ${at} [${t.camera.position.toArray().map((x) => x.toFixed(1))}]`);
  };
  const hold = (v) => { inp.down = v; inp.downT = 0; }, spot = (id) => t.act.spots.find((s) => s.id === id).act(), done = () => !c.busy;
  t.step(0.1, 60); hold(true); RUN('approach', 3000, () => c.mode === 'orbit'); hold(false); RUN('orbit', 120);
  spot('water'); RUN('to low', 900, done); hold(true); RUN('dive', 3000, () => c.mode === 'orbit'); hold(false); RUN('surfaced', 150);
  spot('door'); RUN('to door', 900, done); hold(true); RUN('walk in', 330); hold(false); RUN('rest', 60); log.push('walk ' + c.states.walk.p.toArray().map((x) => x.toFixed(2)) + c.states.walk.node);
  spot('climb'); RUN('to stair', 400, done); hold(true); RUN('climb', 4000, () => c.mode === 'lantern'); hold(false); RUN('to lantern', 600, done); await 0; RUN('settle', 30);
  log.push('spots ' + t.act.spots.filter((s) => s.on).map((s) => s.id));
  spot('deep'); RUN('deep', 400, done); await new Promise((r) => setTimeout(r)); t.step(0.03, 2); log.push('product ' + t.ui.current);
  t.ui.api.inspect('storm'); RUN('storm', 400, done); t.ui.api.inspect('light'); RUN('light', 400, done); t.ui.api.back(); RUN('back', 300, done);
  spot('lever'); for (let i = 0; i < 500 && !t.act.lit; i++) t.step(1 / 30); log.push('lit ' + t.act.lit + ' lamp ' + t.U.uLamp.value + ' ' + c.mode);
  RUN('final', 600, done); RUN('final hold', 300); spot('return'); RUN('return', 600, done);
  spot('leave'); RUN('leave', 600, done); t.ui.api.chapter(5); RUN('outside→ascent', 900, done); t.ui.api.chapter(0); RUN('ascent→distant', 900, done); t.ui.api.collection(); RUN('distant→lantern', 900, done);
  t.post.render = rd; return log;
}
