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
    this.s = CHANNELS.map(() => ({
      p0: null,
      last: null,
      lo: -Infinity,
      hi: Infinity,
    }));
  }
  _q(i, v) {
    const f = 10 ** CHANNELS[i].dec;
    return Math.round(v * f) / f;
  }
  _end(i) {
    // where the current segment's line is at its last sample
    const s = this.s[i],
      slope =
        Number.isFinite(s.lo) && Number.isFinite(s.hi) ? (s.lo + s.hi) / 2 : 0;
    return this._q(i, s.p0.v + slope * (s.last.t - s.p0.t));
  }
  /** One frame at time t (ms): returns the keys [channel, t, value, step] it makes ready (usually none). */
  push(t, values) {
    const out = [];
    if (!this.active) {
      this.active = true;
      this.s.forEach((s) => (s.p0 = null));
    } // speech begins: start fresh segments
    CHANNELS.forEach((c, i) => {
      const v = values[c.name],
        s = this.s[i];
      if (!Number.isFinite(v)) return;
      if (!s.p0) {
        // first sample of a stretch of speech is sent as it is, with a flag that makes it jump instead of glide
        const q = this._q(i, v);
        out.push([i, t, q, 1]);
        Object.assign(s, {
          p0: { t, v: q },
          last: { t, v: q },
          lo: -Infinity,
          hi: Infinity,
        });
        return;
      }
      if (t <= s.last.t) return;
      const tol = c.tol * this.quality,
        dt = t - s.p0.t;
      const lo = Math.max(s.lo, (v - tol - s.p0.v) / dt),
        hi = Math.min(s.hi, (v + tol - s.p0.v) / dt);
      if (lo <= hi && dt <= this.maxSegmentMs) {
        s.lo = lo;
        s.hi = hi;
        s.last = { t, v };
        return;
      }
      if (s.last.t > s.p0.t) {
        // close the segment at the previous sample and start the next one from there
        const ev = this._end(i);
        out.push([i, s.last.t, ev]);
        s.p0 = { t: s.last.t, v: ev };
      }
      const d = t - s.p0.t;
      s.lo = (v - tol - s.p0.v) / d;
      s.hi = (v + tol - s.p0.v) / d;
      s.last = { t, v };
    });
    return out;
  }
  /** Speech stopped at time t: finish every segment and fade the voice out. */
  end(t) {
    const out = [];
    if (!this.active) return out;
    this.active = false;
    this.s.forEach((s, i) => {
      if (s.p0 && s.last.t > s.p0.t) out.push([i, s.last.t, this._end(i)]);
      s.p0 = null;
    });
    out.push([INTENSITY, t + 20, 0]);
    return out;
  }
}

/** Keys -> one small network packet; times are relative to the packet's own timestamp b (sender clock, ms). */
export function pack(keys, b) {
  b = Math.round(b);
  return {
    b,
    k: keys.map(([i, t, v, step]) =>
      step ? [i, Math.round(t - b), v, 1] : [i, Math.round(t - b), v],
    ),
  };
}

export class Playout {
  constructor() {
    this.reset();
  }
  reset() {
    this.offset = null; // receiver clock - sender clock, tracked as the smallest transit time seen
    this.q = CHANNELS.map(() => []);
    this.cur = CHANNELS.map(() => null);
  }
  /** Accepts a packet from the network (untrusted); `now` is the receiver's clock in ms. Returns the number of keys used. */
  receive(p, now) {
    if (!p || !Number.isFinite(p.b) || !Array.isArray(p.k) || p.k.length > 4000)
      return 0;
    const est = now - p.b;
    this.offset =
      this.offset == null || est < this.offset
        ? est
        : Math.min(est, this.offset + 0.05); // creep up to follow clock drift
    let n = 0;
    for (const k of p.k) {
      if (!Array.isArray(k)) continue;
      const [i, dt, v, step] = k,
        c = CHANNELS[i];
      if (!c || !Number.isFinite(dt) || !Number.isFinite(v)) continue;
      const q = this.q[i];
      q.push({
        t: p.b + Math.max(-5000, Math.min(5000, dt)),
        v: Math.max(c.lo, Math.min(c.hi, v)),
        s: step === 1,
      });
      if (q.length > 4000) q.shift();
      n++;
    }
    return n;
  }
  /** Parameter values to play at receiver time `now`, or null before anything has arrived. */
  sample(now, delayMs) {
    if (this.offset == null) return null;
    const t = now - this.offset - delayMs,
      out = {};
    for (let i = 0; i < CHANNELS.length; i++) {
      const q = this.q[i];
      while (q.length > 1 && q[1].t <= t) q.shift();
      const a = q[0],
        b = q[1];
      let v = this.cur[i];
      if (a && a.t <= t)
        v = !b || b.s ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
      else if (a && v == null) v = a.v;
      this.cur[i] = v;
      out[CHANNELS[i].name] = v;
    }
    return this.cur.every((v) => v != null) ? out : null;
  }
}

// ---------------------------------------------------------------- binary wire format (lossless)
// Exactly the keys the encoder made, in far fewer bytes: per channel, the time gap and the change in value (as an integer
// count of that channel's rounding step, which is what the encoder already rounds to) are written as variable-length
// integers. Messages are then deflated when that makes them smaller. Nothing is rounded again, so the receiver ends up with
// the same keys as the sender, and the speech is unchanged.
const FORMAT_LIVE = 1,
  FORMAT_MSG = 2,
  FORMAT_MSG_DEFLATE = 3;
const MAX_KEYS = 100000,
  MAX_INFLATED = 8 * 1024 * 1024;
const zig = (n) => (n >= 0 ? n * 2 : -n * 2 - 1),
  unzig = (z) => (z % 2 ? -(z + 1) / 2 : z / 2);

class Writer {
  constructor() {
    this.b = [];
  }
  byte(x) {
    this.b.push(x);
  }
  varint(n) {
    while (n >= 128) {
      this.b.push((n % 128) | 128);
      n = Math.floor(n / 128);
    }
    this.b.push(n);
  }
  signed(n) {
    this.varint(zig(n));
  }
  bytes(u8) {
    for (const x of u8) this.b.push(x);
  }
  done() {
    return Uint8Array.from(this.b);
  }
}
class Reader {
  constructor(u8) {
    this.u = u8;
    this.p = 0;
  }
  byte() {
    if (this.p >= this.u.length) throw new Error("truncated");
    return this.u[this.p++];
  }
  varint() {
    let n = 0,
      m = 1;
    for (let i = 0; i < 8; i++) {
      const x = this.byte();
      n += (x & 127) * m;
      if (x < 128) return n;
      m *= 128;
    }
    throw new Error("bad number");
  }
  signed() {
    return unzig(this.varint());
  }
  bytes(len) {
    if (len < 0 || this.p + len > this.u.length) throw new Error("truncated");
    const s = this.u.subarray(this.p, this.p + len);
    this.p += len;
    return s;
  }
}
function writeKeys(w, keys) {
  // keys: [channel, ms, value, step?]; each channel's keys keep their order
  CHANNELS.forEach((c, i) => {
    const ks = keys.filter(
        (k) => k[0] === i && Number.isFinite(k[1]) && Number.isFinite(k[2]),
      ),
      q = 10 ** c.dec;
    w.varint(ks.length);
    let pt = 0,
      pv = 0;
    for (const [, t, v, step] of ks) {
      const it = Math.round(t),
        iv = Math.round(v * q);
      w.varint(zig(it - pt) * 2 + (step ? 1 : 0));
      w.signed(iv - pv);
      pt = it;
      pv = iv;
    }
  });
}
function readKeys(r) {
  const keys = [];
  let total = 0;
  CHANNELS.forEach((c, i) => {
    const n = r.varint(),
      q = 10 ** c.dec;
    if ((total += n) > MAX_KEYS) throw new Error("too many keys");
    let pt = 0,
      pv = 0;
    for (let j = 0; j < n; j++) {
      const f = r.varint(),
        t = pt + unzig(Math.floor(f / 2)),
        iv = pv + r.signed();
      keys.push(f % 2 ? [i, t, iv / q, 1] : [i, t, iv / q]);
      pt = t;
      pv = iv;
    }
  });
  return keys;
}

/** A live packet {b, k} (from pack()) as bytes. */
export function encodePacket(p) {
  const w = new Writer();
  w.byte(FORMAT_LIVE);
  w.varint(Math.max(0, Math.round(p.b)));
  writeKeys(w, p.k);
  return w.done();
}
/** Bytes -> {b, k}, or null if they aren't a packet we understand (they come from the network, so nothing is trusted). */
export function decodePacket(u8) {
  try {
    const r = new Reader(u8);
    if (r.byte() !== FORMAT_LIVE) return null;
    const b = r.varint();
    return { b, k: readKeys(r) };
  } catch {
    return null;
  }
}

async function deflate(u8) {
  const cs = new CompressionStream("deflate-raw"),
    writer = cs.writable.getWriter();
  writer.write(u8);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflate(u8) {
  const ds = new DecompressionStream("deflate-raw"),
    writer = ds.writable.getWriter();
  writer.write(u8).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader(),
    parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > MAX_INFLATED) {
      reader.cancel();
      throw new Error("too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const utf8 = new TextEncoder(),
  utf8d = new TextDecoder("utf-8", { fatal: true });

/** A whole message {id, text?, k} as bytes (deflated too, when the browser can and it helps). */
export async function encodeMessage({ id, text = "", k }) {
  const w = new Writer(),
    idBytes = utf8.encode(String(id).slice(0, 40)),
    textBytes = utf8.encode(String(text).slice(0, 2000));
  w.varint(idBytes.length);
  w.bytes(idBytes);
  w.varint(textBytes.length);
  w.bytes(textBytes);
  writeKeys(w, k);
  const payload = w.done();
  let packed = null;
  if (typeof CompressionStream === "function") {
    try {
      packed = await deflate(payload);
    } catch {
      packed = null;
    }
  }
  const useDeflate = packed && packed.length < payload.length,
    body = useDeflate ? packed : payload,
    out = new Uint8Array(body.length + 1);
  out[0] = useDeflate ? FORMAT_MSG_DEFLATE : FORMAT_MSG;
  out.set(body, 1);
  return out;
}
/** Bytes -> {id, text, k}, or null if unusable. */
export async function decodeMessage(u8) {
  try {
    const format = u8[0];
    if (format !== FORMAT_MSG && format !== FORMAT_MSG_DEFLATE) return null;
    const payload =
        format === FORMAT_MSG_DEFLATE
          ? await inflate(u8.subarray(1))
          : u8.subarray(1),
      r = new Reader(payload);
    const idLength = r.varint();
    if (idLength > 160) return null;
    const id = utf8d.decode(r.bytes(idLength)),
      textLength = r.varint();
    if (textLength > 8000) return null;
    return { id, text: utf8d.decode(r.bytes(textLength)), k: readKeys(r) };
  } catch {
    return null;
  }
}

/** What PeerJS hands us -> a Uint8Array (or null). */
export const asBytes = (data) =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null;
/** Bytes -> an ArrayBuffer of exactly that size, which PeerJS sends as binary as it is. */
export const toWire = (u8) =>
  u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? u8.buffer
    : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
