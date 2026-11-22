// Compact streaming of Samuel's articulation between two peers.
//
// Sender: every frame (about 86 per second) goes through a per-channel "swing filter", an online piecewise-linear
// simplifier: a channel only emits a key when a straight line from its last key can no longer stay within the channel's
// tolerance of every sample since. Silence sends nothing. Keys are batched into packets of [channel, ms, value].
// Receiver: keys wait in a small jitter buffer and are interpolated at (now - clock offset - playout delay), the same way
// the sender's frames were spaced, so the partner's articulation comes out smooth and in time.

// name, tolerance at quality 1 (absolute, in the parameter's own units), decimals kept, [min, max] accepted from the network
export const CHANNELS = [
  { name: "frequency", tol: 2, dec: 1, lo: 20, hi: 1000 },
  { name: "voiceness", tol: 0.025, dec: 3, lo: 0, hi: 1 },
  { name: "intensity", tol: 0.025, dec: 3, lo: 0, hi: 1 },
  { name: "tongueIndex", tol: 0.25, dec: 2, lo: 0, hi: 44 },
  { name: "tongueDiameter", tol: 0.05, dec: 2, lo: 0, hi: 5 },
  { name: "constrictionIndex", tol: 0.4, dec: 2, lo: 0, hi: 44 },
  { name: "constrictionDiameter", tol: 0.1, dec: 2, lo: -1, hi: 5 },
  { name: "lipDiameter", tol: 0.1, dec: 2, lo: -1, hi: 5 },
];
export const INTENSITY = CHANNELS.findIndex((c) => c.name === "intensity");

export class Encoder {
  constructor({ quality = 1, maxSegmentMs = 100 } = {}) {
    this.quality = quality; // multiplies every tolerance: 0 keeps every frame, larger sends less
    this.maxSegmentMs = maxSegmentMs; // a key is forced at least this often, which bounds the added latency
    this.reset();
  }
  reset() {
    this.active = false;
    this.s = CHANNELS.map(() => ({ p0: null, last: null, lo: -Infinity, hi: Infinity }));
  }
  _q(i, v) { const f = 10 ** CHANNELS[i].dec; return Math.round(v * f) / f; }
  _end(i) { // where the current segment's line is at its last sample
    const s = this.s[i], slope = Number.isFinite(s.lo) && Number.isFinite(s.hi) ? (s.lo + s.hi) / 2 : 0;
    return this._q(i, s.p0.v + slope * (s.last.t - s.p0.t));
  }
  /** One frame at time t (ms): returns the keys [channel, t, value, step] it makes ready (usually none). */
  push(t, values) {
    const out = [];
    if (!this.active) { this.active = true; this.s.forEach((s) => (s.p0 = null)); } // speech begins: start fresh segments
    CHANNELS.forEach((c, i) => {
      const v = values[c.name], s = this.s[i];
      if (!Number.isFinite(v)) return;
      if (!s.p0) { // first sample of a stretch of speech is sent as it is, with a flag that makes it jump instead of glide
        const q = this._q(i, v);
        out.push([i, t, q, 1]); Object.assign(s, { p0: { t, v: q }, last: { t, v: q }, lo: -Infinity, hi: Infinity });
        return;
      }
      if (t <= s.last.t) return;
      const tol = c.tol * this.quality, dt = t - s.p0.t;
      const lo = Math.max(s.lo, (v - tol - s.p0.v) / dt), hi = Math.min(s.hi, (v + tol - s.p0.v) / dt);
      if (lo <= hi && dt <= this.maxSegmentMs) { s.lo = lo; s.hi = hi; s.last = { t, v }; return; }
      if (s.last.t > s.p0.t) { // close the segment at the previous sample and start the next one from there
        const ev = this._end(i);
        out.push([i, s.last.t, ev]);
        s.p0 = { t: s.last.t, v: ev };
      }
      const d = t - s.p0.t;
      s.lo = (v - tol - s.p0.v) / d; s.hi = (v + tol - s.p0.v) / d; s.last = { t, v };
    });
    return out;
  }
  /** Speech stopped at time t: finish every segment and fade the voice out. */
  end(t) {
    const out = [];
    if (!this.active) return out;
    this.active = false;
    this.s.forEach((s, i) => { if (s.p0 && s.last.t > s.p0.t) out.push([i, s.last.t, this._end(i)]); s.p0 = null; });
    out.push([INTENSITY, t + 20, 0]);
    return out;
  }
}

/** Keys -> one small network packet; times are relative to the packet's own timestamp b (sender clock, ms). */
export function pack(keys, b) {
  b = Math.round(b);
  return { b, k: keys.map(([i, t, v, step]) => (step ? [i, Math.round(t - b), v, 1] : [i, Math.round(t - b), v])) };
}

export class Playout {
  constructor() { this.reset(); }
  reset() {
    this.offset = null; // receiver clock - sender clock, tracked as the smallest transit time seen
    this.q = CHANNELS.map(() => []);
    this.cur = CHANNELS.map(() => null);
  }
  /** Accepts a packet from the network (untrusted); `now` is the receiver's clock in ms. Returns the number of keys used. */
  receive(p, now) {
    if (!p || !Number.isFinite(p.b) || !Array.isArray(p.k) || p.k.length > 4000) return 0;
    const est = now - p.b;
    this.offset = this.offset == null || est < this.offset ? est : Math.min(est, this.offset + 0.05); // creep up to follow clock drift
    let n = 0;
    for (const k of p.k) {
      if (!Array.isArray(k)) continue;
      const [i, dt, v, step] = k, c = CHANNELS[i];
      if (!c || !Number.isFinite(dt) || !Number.isFinite(v)) continue;
      const q = this.q[i];
      q.push({ t: p.b + Math.max(-5000, Math.min(5000, dt)), v: Math.max(c.lo, Math.min(c.hi, v)), s: step === 1 });
      if (q.length > 4000) q.shift();
      n++;
    }
    return n;
  }
  /** Parameter values to play at receiver time `now`, or null before anything has arrived. */
  sample(now, delayMs) {
    if (this.offset == null) return null;
    const t = now - this.offset - delayMs, out = {};
    for (let i = 0; i < CHANNELS.length; i++) {
      const q = this.q[i];
      while (q.length > 1 && q[1].t <= t) q.shift();
      const a = q[0], b = q[1];
      let v = this.cur[i];
      if (a && a.t <= t) v = !b || b.s ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
      else if (a && v == null) v = a.v;
      this.cur[i] = v;
      out[CHANNELS[i].name] = v;
    }
    return this.cur.every((v) => v != null) ? out : null;
  }
}
