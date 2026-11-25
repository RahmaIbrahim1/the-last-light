import { byId } from '../product/fragranceData.js';

const KEY = 'tll.collection.v1', MAX = 9;
export const money = (n) => '$' + n.toLocaleString('en-US');

export class Cart extends EventTarget {
  constructor() {
    super(); this.lines = {};
    try { const raw = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const id in raw) if (byId[id] && raw[id] > 0) this.lines[id] = Math.min(MAX, raw[id] | 0); } catch { /* corrupt or blocked storage: start empty */ }
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.lines)); } catch { /* private mode */ } this.dispatchEvent(new Event('change')); }
  add(id, n = 1) { this.set(id, (this.lines[id] || 0) + n); }
  set(id, n) { if (n <= 0) delete this.lines[id]; else this.lines[id] = Math.min(MAX, n); this.save(); }
  remove(id) { delete this.lines[id]; this.save(); }
  clear() { this.lines = {}; this.save(); }
  get count() { return Object.values(this.lines).reduce((a, b) => a + b, 0); }
  get subtotal() { return Object.entries(this.lines).reduce((a, [id, n]) => a + byId[id].price * n, 0); }
  get items() { return Object.entries(this.lines).map(([id, n]) => ({ ...byId[id], qty: n, total: byId[id].price * n })); }
  /** No commerce backend is connected: this only closes the loop locally, and the interface says so. */
  async mockCheckout() { const order = { ref: 'TLL-' + Math.random().toString(36).slice(2, 7).toUpperCase(), items: this.items, total: this.subtotal }; await new Promise((r) => setTimeout(r, 900)); this.clear(); return order; }
}
