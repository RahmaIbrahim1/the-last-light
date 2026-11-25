import { byId, FRAGRANCES } from './product/fragranceData.js';
import { money } from './shop/cart.js';
import { Q } from './core/quality.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const CHAPTERS = ['Nothing', 'The Distance', 'The Structure', 'Below', 'The Entrance', 'The Ascent', 'The Lantern'];
const HOLD = Q.coarse ? 'Press and hold' : 'Hold';

export class UI {
  constructor({ cart, audio, api }) {
    this.cart = cart; this.audio = audio; this.api = api; this.qty = 1; this.current = null;
    this.el = { title: $('#title'), hint: $('#hint'), line: $('#line'), chapter: $('#chapter'), nav: $('#gauge'), top: $('#top'), spots: $('#spots'), product: $('#product'), reveal: $('#reveal'), drawer: $('#drawer'), cursor: $('#cursor'), count: $('#count'), sound: $('#sound'), veil: $('#veil'), live: $('#live') };
    CHAPTERS.forEach((c, i) => { const b = h(`<button class="tick" type="button" data-i="${i}"><i></i><span>${c}</span></button>`); b.onclick = () => api.chapter(i); this.el.nav.append(b); });
    $('#collection').onclick = () => api.collection();
    $('#cart').onclick = () => this.drawer(true);
    $('#mark').onclick = () => api.chapter(0);
    this.el.sound.onclick = () => { this.soundState(audio.toggle()); };
    this.buildProduct(); this.buildDrawer();
    cart.addEventListener('change', () => this.renderCart()); this.renderCart();
    addEventListener('keydown', (e) => { if (e.code !== 'Escape') return; if (this.open) this.drawer(false); else if (this.current) api.back(); });
  }
  soundState(on) { this.el.sound.setAttribute('aria-pressed', on); this.el.sound.querySelector('span').textContent = on ? 'Sound on' : 'Sound off'; }
  begin() { document.body.classList.add('begun'); }

  /* ── words that come and go ──────────────────────────────────────────── */
  titleOn(v) { this.el.title.classList.toggle('on', v); }
  hint(t) { if (this._hint === t) return; this._hint = t; const e = this.el.hint; e.classList.remove('on'); clearTimeout(this._ht); if (!t) return; this._ht = setTimeout(() => { e.textContent = t; e.classList.add('on'); }, 500); }
  say(html, dur = 6500) { const e = this.el.line; clearTimeout(this._lt); if (!html) { e.classList.remove('on'); return; } e.innerHTML = html; e.classList.add('on'); this._lt = setTimeout(() => e.classList.remove('on'), dur); }
  chapter(i) {
    if (this._ch === i) return; this._ch = i; this.el.nav.querySelectorAll('.tick').forEach((t, k) => { t.classList.toggle('on', k === i); if (k === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); });
    const e = this.el.chapter; e.classList.remove('on'); clearTimeout(this._ct); if (i === 0) return; this._ct = setTimeout(() => { e.innerHTML = `<b>${CHAPTERS[i]}</b>`; e.classList.add('on'); this._ct = setTimeout(() => e.classList.remove('on'), 4200); }, 700);
  }
  reveal(name, line) { const e = this.el.reveal; e.innerHTML = `<h2>${name}</h2><p>${line}</p>`; e.classList.add('on'); clearTimeout(this._rt); this._rt = setTimeout(() => e.classList.remove('on'), 6500); }
  clearReveal() { this.el.reveal.classList.remove('on'); }
  hush(v) { document.body.classList.toggle('hush', v); }
  hintFor(mode, busy, S) {
    if (busy || this.current || this.open) return this.hint('');
    const m = {
      distant: S.distant.t > 11 ? `${HOLD} to approach` : S.distant.t > 5.5 ? 'Move to explore' : '',
      approach: S.approach.u < 0.12 ? `${HOLD} to keep moving` : '', orbit: S.orbit.age < 14 ? 'Drag to go round' : '',
      low: `${HOLD} to go under`, below: S.below.u < 0.35 ? `${HOLD} to swim` : '',
      walk: S.walk.p.z > 8 ? `${HOLD} to walk` : !S.walk.hinted ? `${HOLD} to walk — find the stair` : '', ascent: S.ascent.s < 0.10 ? `${HOLD} to climb` : '',
      lantern: this.api.lit() ? '' : 'Something here still moves', final: '', product: '',
    }[mode];
    this.hint(m || '');
  }

  /* ── spatial labels ──────────────────────────────────────────────────── */
  mountSpots(list) { for (const s of list) { s.el = h(`<button class="spot" type="button" tabindex="-1"><i></i><span>${s.label}</span></button>`); s.el.onclick = () => s.act(); this.el.spots.append(s.el); s.on = false; } }
  spot(s, on) { if (on !== s.on) { s.on = on; s.el.classList.toggle('on', on); s.el.tabIndex = on ? 0 : -1; } if (on) { s.el.style.transform = `translate3d(${s.sx.toFixed(1)}px,${s.sy.toFixed(1)}px,0)`; s.el.classList.toggle('flip', s.sx > innerWidth * 0.72); } }

  /* ── product: words set in the dark beside the glass ─────────────────── */
  buildProduct() {
    this.el.product.innerHTML = `
      <div class="p-head"><p class="p-no"></p><h2></h2><p class="p-line"></p></div>
      <div class="p-body"><p class="p-meta">Eau de Parfum<br>100 ml</p><ul class="p-notes"></ul></div>
      <div class="p-buy"><p class="p-price"></p>
        <div class="qty" role="group" aria-label="Quantity"><button type="button" data-q="-1" aria-label="Fewer">–</button><output>1</output><button type="button" data-q="1" aria-label="More">+</button></div>
        <button type="button" class="act add">Add to collection</button></div>
      <div class="p-tools"><button type="button" data-side>Turn to back</button><button type="button" data-back>Return to the room</button></div>
      <nav class="p-switch" aria-label="Fragrances"></nav>`;
    const p = this.el.product; p.inert = true;
    FRAGRANCES.forEach((f) => { const b = h(`<button type="button" data-id="${f.id}">${f.name}</button>`); b.onclick = () => { if (f.id !== this.current) this.api.inspect(f.id); }; $('.p-switch', p).append(b); });
    p.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { this.qty = Math.max(1, Math.min(9, this.qty + +b.dataset.q)); $('output', p).textContent = this.qty; this.price(); }));
    $('.add', p).onclick = () => { const id = this.current; if (!id) return; this.cart.add(id, this.qty); this.audio.glass(); const b = $('.add', p); b.textContent = 'Added'; clearTimeout(this._at); this._at = setTimeout(() => (b.textContent = 'Add to collection'), 1800); this.el.live.textContent = `${byId[id].name} added`; this.qty = 1; $('output', p).textContent = 1; this.price(); };
    $('[data-back]', p).onclick = () => this.api.back();
    $('[data-side]', p).onclick = () => this.api.flip();
  }
  price() { $('.p-price', this.el.product).textContent = money(byId[this.current].price * this.qty); }
  showProduct(id) {
    this.el.reveal.classList.remove('on'); const f = byId[id], p = this.el.product; this.current = id; this.qty = 1; $('output', p).textContent = 1;
    $('.p-no', p).textContent = f.no; $('h2', p).textContent = f.name; $('.p-line', p).textContent = f.line; $('.p-notes', p).innerHTML = f.notes.map((n) => `<li>${n}</li>`).join(''); this.price();
    p.querySelectorAll('[data-id]').forEach((b) => { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    p.style.setProperty('--accent', `rgb(${f.accent.map((c) => Math.round(c * 255)).join(' ')})`);
    p.inert = false; p.classList.add('on');
  }
  side(s) { const b = $('[data-side]', this.el.product), t = s === 'back' ? 'Turn to front' : 'Turn to back'; if (b.textContent !== t) b.textContent = t; }
  hideProduct() { this.current = null; this.el.product.classList.remove('on'); this.el.product.inert = true; }

  /* ── the collection drawer ───────────────────────────────────────────── */
  buildDrawer() {
    const d = this.el.drawer; d.inert = true;
    d.innerHTML = `<div class="d-in"><header><h2>Your collection</h2><button type="button" class="d-x">Close</button></header><div class="d-list"></div><footer></footer></div>`;
    $('.d-x', d).onclick = () => this.drawer(false); $('#scrim').onclick = () => this.drawer(false);
  }
  drawer(v) { this.open = v; this.step = 'bag'; document.body.classList.toggle('drawer', v); this.el.drawer.inert = !v; if (v) { this.renderCart(); this._ret = document.activeElement; $('.d-x', this.el.drawer).focus({ preventScroll: true }); } else this._ret?.focus?.({ preventScroll: true }); }
  renderCart() {
    const c = this.cart, d = this.el.drawer, list = $('.d-list', d), foot = $('footer', d); this.el.count.textContent = c.count; $('#cart').setAttribute('aria-label', `Collection, ${c.count} items`);
    if (this.step === 'done') return;
    if (!c.count) { this.step = 'bag'; list.innerHTML = `<p class="d-empty">Nothing kept yet.</p>`; foot.innerHTML = `<button type="button" class="act">See the fragrances</button>`; $('.act', foot).onclick = () => { this.drawer(false); this.api.collection(); }; return; }
    list.innerHTML = '';
    for (const i of c.items) {
      const r = h(`<article><div class="d-sw" style="--a:rgb(${i.accent.map((x) => Math.round(x * 255)).join(' ')})"></div><div class="d-t"><h3>${i.name}</h3><p>Eau de Parfum, 100 ml</p>
        <div class="qty" role="group" aria-label="Quantity of ${i.name}"><button type="button" aria-label="Fewer">–</button><output>${i.qty}</output><button type="button" aria-label="More">+</button></div></div>
        <div class="d-r"><p>${money(i.total)}</p><button type="button" class="rm">Remove</button></div></article>`);
      const [a, b] = r.querySelectorAll('.qty button'); a.onclick = () => c.set(i.id, i.qty - 1); b.onclick = () => c.set(i.id, i.qty + 1); $('.rm', r).onclick = () => c.remove(i.id); list.append(r);
    }
    if (this.step === 'review') {
      foot.innerHTML = `<dl><div><dt>Subtotal</dt><dd>${money(c.subtotal)}</dd></div><div><dt>Delivery</dt><dd>Not calculated</dd></div></dl><p class="d-note">This is a demonstration. No payment system is connected, so nothing will be charged or shipped.</p><button type="button" class="act">Place demonstration order</button><button type="button" class="lnk">Back</button>`;
      $('.lnk', foot).onclick = () => { this.step = 'bag'; this.renderCart(); };
      $('.act', foot).onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'One moment'; this.step = 'done'; const o = await c.mockCheckout(); this.el.count.textContent = 0; list.innerHTML = `<div class="d-done"><h3>Kept.</h3><p>Demonstration order ${o.ref}</p><p>${o.items.map((i) => `${i.name} × ${i.qty}`).join('<br>')}</p><p>${money(o.total)}, not charged</p></div>`; foot.innerHTML = `<button type="button" class="act">Return to the light</button>`; $('.act', foot).onclick = () => this.drawer(false); };
    } else { foot.innerHTML = `<dl><div><dt>Subtotal</dt><dd>${money(c.subtotal)}</dd></div></dl><button type="button" class="act">Checkout</button>`; $('.act', foot).onclick = () => { this.step = 'review'; this.renderCart(); }; }
  }

  cursor(inp, hold, hot) {
    if (Q.coarse) return; const c = this.el.cursor; c.style.transform = `translate3d(${(inp.px ?? -99).toFixed(1)}px,${(inp.py ?? -99).toFixed(1)}px,0)`; c.style.setProperty('--h', hold.toFixed(3)); c.classList.toggle('hot', hot); c.classList.toggle('down', inp.down);
  }
}
