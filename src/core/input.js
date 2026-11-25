import { damp } from './math.js';
import { Q } from './quality.js';

/** Pointer / touch / keyboard, reduced to intentions: look, drag, hold, wheel, move. */
export class Input {
  constructor(el) {
    this.el = el;
    this.x = 0; this.y = 0;          // raw NDC
    this.sx = 0; this.sy = 0;        // smoothed NDC (cinematic parallax)
    this.dx = 0; this.dy = 0;        // per-frame motion (any)
    this.gx = 0; this.gy = 0;        // per-frame drag
    this.wheel = 0; this.pinch = 0;
    this.down = false; this.downT = 0; this.travel = 0; this.moved = 0; this.touch = false;
    this.keys = new Set();
    this.captured = false;           // something (lever) owns the drag
    this.onDown = []; this.onUp = []; this.onTap = []; this.onFirst = [];
    this._pts = new Map(); this._d0 = 0;
    const first = () => { this.onFirst.forEach((f) => f()); this.onFirst.length = 0; };

    el.addEventListener('pointerdown', (e) => {
      first();
      this.touch = e.pointerType !== 'mouse';
      this._pts.set(e.pointerId, e);
      if (this._pts.size > 1) { this._d0 = this._span(); return; }
      this._set(e); this.down = true; this.downT = performance.now(); this.travel = 0;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      this.captured = this.onDown.some((f) => f(this) === true);
    });
    addEventListener('pointermove', (e) => {
      if (this._pts.has(e.pointerId)) this._pts.set(e.pointerId, e);
      if (this._pts.size > 1) { const d = this._span(); this.pinch += (this._d0 - d) * 0.006; this._d0 = d; return; }
      const ox = this.px ?? e.clientX, oy = this.py ?? e.clientY;
      this._set(e);
      const dx = e.clientX - ox, dy = e.clientY - oy;
      this.dx += dx; this.dy += dy; this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.down) { this.gx += dx; this.gy += dy; this.travel += Math.abs(dx) + Math.abs(dy); }
    }, { passive: true });
    const up = (e) => {
      this._pts.delete(e.pointerId);
      if (!this.down || this._pts.size) return;
      this.down = false;
      const tap = this.travel < 8 && performance.now() - this.downT < 350;
      this.onUp.forEach((f) => f(this, tap));
      if (tap && !this.captured) this.onTap.forEach((f) => f(this));
      this.captured = false;
      if (this.touch) { this.px = this.py = undefined; }
    };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += Math.max(-120, Math.min(120, e.deltaY)) / 100; }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input,textarea,button,[role=dialog]') && e.code !== 'Escape') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      first(); this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.down = false; this._pts.clear(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  _span() { const [a, b] = [...this._pts.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  _set(e) { this.px = e.clientX; this.py = e.clientY; this.x = (e.clientX / innerWidth) * 2 - 1; this.y = 1 - (e.clientY / innerHeight) * 2; }
  /** 0..1 locomotion intent. Holding the pointer anywhere, or W / Space / ↑. */
  get forward() {
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp') || k.has('Space')) return 1;
    if (this.down && !this.captured && performance.now() - this.downT > 160) return 1;
    return 0;
  }
  get back() { return this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0; }
  get strafe() { return (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0); }
  begin(dt) {
    if (this.touch && !this.down) { this.x = damp(this.x, 0, 0.8, dt); this.y = damp(this.y, 0, 0.8, dt); }
    this.sx = damp(this.sx, this.x, 2.2, dt); this.sy = damp(this.sy, this.y, 2.2, dt);
    if (this.pinch) { this.wheel += this.pinch; this.pinch = 0; }
  }
  end() { this.dx = this.dy = this.gx = this.gy = 0; this.wheel = 0; }
}
export const lookGain = Q.coarse ? 0.0052 : 0.0034;
