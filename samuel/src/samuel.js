// Samuel, local: speech/text -> Pink Trombone articulation in the browser. GPL-3.0. Bundled from web/lib (samuel, pyin, tokenizer, textnorm). Expects ../models/ and ../vendor/ort/ beside it.

// ../web/lib/pyin.js
function betaProbs() {
  const a = 2,
    b = 18,
    n = a + b - 1;
  const cdf = (x) => {
    let s = 0;
    for (let j = a; j <= n; j++)
      s += binom(n, j) * Math.pow(x, j) * Math.pow(1 - x, n - j);
    return s;
  };
  const out = new Float64Array(100);
  let prev = cdf(0);
  for (let i = 1; i <= 100; i++) {
    const c = cdf(i / 100);
    out[i - 1] = c - prev;
    prev = c;
  }
  return out;
}
function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
}
var FFT = class {
  constructor(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }
  // sign -1 forward, +1 inverse (unnormalised)
  run(re, im, sign) {
    const n = this.n,
      rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step],
            s = sign * this.sin[k * step];
          const a = start + k,
            b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
};
var PyinModel = class {
  constructor({
    sr = 44100,
    fmin = 70,
    fmax = 500,
    frameLength = 4096,
    hop = 512,
  } = {}) {
    Object.assign(this, { sr, fmin, fmax, frameLength, hop });
    this.minPeriod = Math.floor(sr / fmax);
    this.maxPeriod = Math.min(Math.ceil(sr / fmin), frameLength - 1);
    this.nPeriods = this.maxPeriod - this.minPeriod + 1;
    this.binsPerSemitone = Math.ceil(1 / 0.1);
    this.nBins =
      Math.floor(12 * this.binsPerSemitone * Math.log2(fmax / fmin)) + 1;
    this.nStates = 2 * this.nBins;
    this.beta = betaProbs();
    this.boltz = 2;
    this.noTrough = 0.01;
    let nfft = 1;
    while (nfft < 2 * frameLength - 1) nfft <<= 1;
    this.fft = new FFT(nfft);
    this.re = new Float64Array(nfft);
    this.im = new Float64Array(nfft);
    this.yin = new Float64Array(this.nPeriods);
    this.d = new Float64Array(this.maxPeriod + 1);
    this.freqs = new Float64Array(this.nBins);
    for (let i = 0; i < this.nBins; i++)
      this.freqs[i] = fmin * Math.pow(2, i / (12 * this.binsPerSemitone));
    this._buildTransition(hop);
  }
  _buildTransition(hop) {
    const nb = this.nBins;
    const maxSemis = roundHalfEven((35.92 * 12 * hop) / this.sr);
    const width = maxSemis * this.binsPerSemitone + 1;
    const w = new Float64Array(width);
    const m = (width + 1) >> 1;
    for (let n = 1; n <= m; n++)
      w[n - 1] = width % 2 ? (2 * n) / (width + 1) : (2 * n - 1) / width;
    for (let i = m; i < width; i++) w[i] = w[width - 1 - i];
    const half = width >> 1;
    this.triLo = new Int32Array(nb);
    this.triVals = [];
    for (let i = 0; i < nb; i++) {
      const lo = Math.max(0, i - half),
        hi = Math.min(nb - 1, i + half);
      const vals = new Float64Array(hi - lo + 1);
      let s = 0;
      for (let k = lo; k <= hi; k++) {
        vals[k - lo] = w[k - i + half];
        s += vals[k - lo];
      }
      for (let k = 0; k < vals.length; k++) vals[k] /= s;
      this.triLo[i] = lo;
      this.triVals.push(vals);
    }
    const tiny = 22250738585072014e-324;
    const thr = Math.log(1e-4 + tiny);
    const sw = [
      [0.99, 0.01],
      [0.01, 0.99],
    ];
    this.pred = [];
    this.predLog = [];
    for (let bj = 0; bj < 2; bj++) {
      for (let j = 0; j < nb; j++) {
        const ks = [],
          ls = [];
        for (let bk = 0; bk < 2; bk++) {
          for (
            let k = Math.max(0, j - half);
            k <= Math.min(nb - 1, j + half);
            k++
          ) {
            const p = sw[bk][bj] * this.triVals[k][j - this.triLo[k]];
            const lp = Math.log(p + tiny);
            if (lp >= thr) {
              ks.push(bk * nb + k);
              ls.push(lp);
            }
          }
        }
        const order = ks.map((_, i) => i).sort((a, b) => ks[a] - ks[b]);
        this.pred.push(Int32Array.from(order.map((i) => ks[i])));
        this.predLog.push(Float64Array.from(order.map((i) => ls[i])));
      }
    }
    this.logPinit = Math.log(1 / this.nStates + tiny);
  }
  // Cumulative mean normalised difference of one frame (librosa's variant).
  _yinFrame(frame) {
    const { re, im, fft, maxPeriod, minPeriod, d, yin } = this;
    const L = frame.length;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < L; i++) re[i] = frame[i];
    fft.run(re, im, -1);
    const n = fft.n;
    for (let i = 0; i < n; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    fft.run(re, im, 1);
    const acf0 = re[0] / n;
    let c = 0;
    d[0] = 0;
    for (let k = 1; k <= maxPeriod; k++) {
      c += frame[k - 1] * frame[k - 1];
      d[k] = 2 * (acf0 - re[k] / n) - c;
    }
    let cum = 0;
    const tiny = 22250738585072014e-324;
    for (let k = 1; k <= maxPeriod; k++) {
      cum += d[k];
      if (k >= minPeriod) yin[k - minPeriod] = d[k] / (cum / k + tiny);
    }
    return yin;
  }
  // Observation probabilities over the 2*nBins states for one frame.
  observe(frame, obs) {
    const yin = this._yinFrame(frame);
    const P = this.nPeriods,
      beta = this.beta,
      nb = this.nBins;
    const troughs = [];
    if (yin[0] < yin[1]) troughs.push(0);
    for (let i = 1; i < P - 1; i++)
      if (yin[i] < yin[i - 1] && yin[i] <= yin[i + 1]) troughs.push(i);
    if (yin[P - 1] < yin[P - 2]) troughs.push(P - 1);
    obs.fill(0);
    const probs = new Float64Array(troughs.length);
    if (troughs.length) {
      const lam = this.boltz,
        el = 1 - Math.exp(-lam);
      for (let t = 0; t < 100; t++) {
        const thr = (t + 1) / 100;
        let nT = 0;
        for (let i = 0; i < troughs.length; i++)
          if (yin[troughs[i]] < thr) nT++;
        if (!nT) continue;
        const norm = 1 - Math.exp(-lam * nT);
        let pos = -1;
        for (let i = 0; i < troughs.length; i++) {
          if (yin[troughs[i]] < thr) {
            pos++;
            probs[i] += ((el * Math.exp(-lam * pos)) / norm) * beta[t];
          }
        }
      }
      let gm = 0;
      for (let i = 1; i < troughs.length; i++)
        if (yin[troughs[i]] < yin[troughs[gm]]) gm = i;
      let below = 0;
      for (let t = 0; t < 100; t++)
        if (!(yin[troughs[gm]] < (t + 1) / 100)) below++;
      let s = 0;
      for (let t = 0; t < below; t++) s += beta[t];
      probs[gm] += this.noTrough * s;
    }
    let vprob = 0;
    for (let i = 0; i < troughs.length; i++) {
      if (!(probs[i] !== 0)) continue;
      const p = troughs[i];
      let shift = 0;
      if (p > 0 && p < P - 1) {
        const a = yin[p + 1] + yin[p - 1] - 2 * yin[p];
        const b = 0.5 * (yin[p + 1] - yin[p - 1]);
        if (Math.abs(b) < Math.abs(a)) shift = -b / a;
      }
      const f0 = this.sr / (this.minPeriod + p + shift);
      let bin = roundHalfEven(
        12 * this.binsPerSemitone * Math.log2(f0 / this.fmin),
      );
      bin = Math.min(Math.max(bin, 0), nb);
      obs[bin] = probs[i];
    }
    for (let i = 0; i < nb; i++) vprob += obs[i];
    vprob = Math.min(Math.max(vprob, 0), 1);
    const u = (1 - vprob) / nb;
    for (let i = nb; i < 2 * nb; i++) obs[i] = u;
    return vprob;
  }
};
function pyin(y, opts = {}) {
  const m = opts.model || new PyinModel(opts);
  const L = m.frameLength,
    hop = m.hop;
  const padded = new Float64Array(y.length + L);
  padded.set(y, L / 2);
  const nFrames = 1 + Math.floor((padded.length - L) / hop);
  const S = m.nStates,
    nb = m.nBins;
  const tiny = 22250738585072014e-324;
  const obs = new Float64Array(S);
  const vprob = new Float32Array(nFrames);
  let value = new Float64Array(S);
  let next = new Float64Array(S);
  const ptr = new Uint16Array(nFrames * S);
  for (let t = 0; t < nFrames; t++) {
    vprob[t] = m.observe(padded.subarray(t * hop, t * hop + L), obs);
    if (t === 0) {
      for (let j = 0; j < S; j++)
        value[j] = Math.log(obs[j] + tiny) + m.logPinit;
      continue;
    }
    for (let j = 0; j < S; j++) {
      const ks = m.pred[j],
        ls = m.predLog[j];
      let best2 = -Infinity,
        arg = 0;
      for (let q = 0; q < ks.length; q++) {
        const c = value[ks[q]] + ls[q];
        if (c > best2) {
          best2 = c;
          arg = ks[q];
        }
      }
      ptr[t * S + j] = arg;
      next[j] = Math.log(obs[j] + tiny) + best2;
    }
    const tmp = value;
    value = next;
    next = tmp;
  }
  const states = new Uint16Array(nFrames);
  let best = -Infinity;
  for (let j = 0; j < S; j++)
    if (value[j] > best) {
      best = value[j];
      states[nFrames - 1] = j;
    }
  for (let t = nFrames - 2; t >= 0; t--)
    states[t] = ptr[(t + 1) * S + states[t + 1]];
  const f0 = new Float32Array(nFrames),
    voiced = new Uint8Array(nFrames);
  for (let t = 0; t < nFrames; t++) {
    voiced[t] = states[t] < nb ? 1 : 0;
    f0[t] = voiced[t] ? m.freqs[states[t] % nb] : 0;
  }
  return { f0, voiced, vprob };
}
function fillUnvoiced(f0, voiced, fmin = 70, fmax = 500) {
  const n = f0.length,
    out = new Float32Array(n);
  const idx = [];
  for (let i = 0; i < n; i++) if (voiced[i]) idx.push(i);
  if (!idx.length) return out.fill(0.5 * (fmin + fmax));
  let k = 0;
  for (let i = 0; i < n; i++) {
    let v;
    if (i <= idx[0]) v = f0[idx[0]];
    else if (i >= idx[idx.length - 1]) v = f0[idx[idx.length - 1]];
    else {
      while (idx[k + 1] < i) k++;
      const a = idx[k],
        b = idx[k + 1];
      v = i === a ? f0[a] : f0[a] + ((f0[b] - f0[a]) * (i - a)) / (b - a);
    }
    out[i] = Math.min(Math.max(v, fmin), fmax);
  }
  return out;
}
var PyinStream = class {
  constructor(opts = {}) {
    this.m = opts.model || new PyinModel(opts);
    const L = this.m.frameLength;
    this.buf = new Float64Array(L);
    this.buf.fill(0);
    this.filled = L / 2;
    this.value = null;
    this.next = new Float64Array(this.m.nStates);
    this.obs = new Float64Array(this.m.nStates);
    this.lastF0 = 0.5 * (this.m.fmin + this.m.fmax);
    this.hasVoiced = false;
  }
  /** hop: Float32Array of exactly m.hop samples. Returns {f0, filled, voiced, vprob} or null. */
  push(hop) {
    const m = this.m,
      L = m.frameLength,
      H = m.hop;
    this.buf.copyWithin(0, H);
    this.buf.set(hop, L - H);
    this.filled += H;
    if (this.filled < L) return null;
    const vp = m.observe(this.buf, this.obs);
    const S = m.nStates,
      tiny = 22250738585072014e-324;
    if (!this.value) {
      this.value = new Float64Array(S);
      for (let j = 0; j < S; j++)
        this.value[j] = Math.log(this.obs[j] + tiny) + m.logPinit;
    } else {
      let mx = -Infinity;
      for (let j = 0; j < S; j++) {
        const ks = m.pred[j],
          ls = m.predLog[j];
        let best2 = -Infinity;
        for (let q = 0; q < ks.length; q++) {
          const c = this.value[ks[q]] + ls[q];
          if (c > best2) best2 = c;
        }
        this.next[j] = Math.log(this.obs[j] + tiny) + best2;
        if (this.next[j] > mx) mx = this.next[j];
      }
      for (let j = 0; j < S; j++) this.value[j] = this.next[j] - mx;
    }
    let arg = 0,
      best = -Infinity;
    for (let j = 0; j < S; j++)
      if (this.value[j] > best) {
        best = this.value[j];
        arg = j;
      }
    const voiced = arg < m.nBins;
    const f0 = voiced ? m.freqs[arg] : 0;
    if (voiced) {
      this.lastF0 = Math.min(Math.max(f0, m.fmin), m.fmax);
      this.hasVoiced = true;
    }
    return { f0, filled: this.lastF0, voiced, vprob: vp };
  }
};

// ../web/lib/tokenizer.js
var SPACE = "\u2581";
var UNK_PENALTY = 10;
var Tokenizer = class {
  constructor({ pieces, unk_id }) {
    this.unkId = unk_id;
    this.trie = /* @__PURE__ */ new Map();
    this.bytes = /* @__PURE__ */ new Map();
    let minScore = Infinity;
    pieces.forEach(([piece, score, type], id) => {
      if (type === 6) {
        this.bytes.set(parseInt(piece.slice(3, 5), 16), id);
        return;
      }
      if (type !== 1 && type !== 4) return;
      if (type === 1) minScore = Math.min(minScore, score);
      const cps = Array.from(piece);
      const key = cps[0];
      if (!this.trie.has(key)) this.trie.set(key, []);
      this.trie.get(key).push({ cps, id, score: type === 4 ? 0 : score });
    });
    for (const list of this.trie.values())
      list.sort((a, b) => a.cps.length - b.cps.length);
    this.unkScore = minScore - UNK_PENALTY;
  }
  encode(text) {
    if (text === "") return [];
    const cps = Array.from(SPACE + text.replace(/ /g, SPACE));
    const n = cps.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const piece = new Int32Array(n + 1).fill(-1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      const cands = this.trie.get(cps[i]) || [];
      let single = false;
      for (const c of cands) {
        const L = c.cps.length;
        if (i + L > n) break;
        let ok = true;
        for (let k = 1; k < L; k++)
          if (cps[i + k] !== c.cps[k]) {
            ok = false;
            break;
          }
        if (!ok) continue;
        if (L === 1) single = true;
        const s = best[i] + c.score;
        if (from[i + L] === -1 || s > best[i + L]) {
          best[i + L] = s;
          from[i + L] = i;
          piece[i + L] = c.id;
        }
      }
      if (!single) {
        const s = best[i] + this.unkScore;
        if (from[i + 1] === -1 || s > best[i + 1]) {
          best[i + 1] = s;
          from[i + 1] = i;
          piece[i + 1] = this.unkId;
        }
      }
    }
    const segs = [];
    for (let e = n; e > 0; e = from[e]) segs.push([from[e], e, piece[e]]);
    segs.reverse();
    const ids = [];
    const enc = new TextEncoder();
    for (const [s, e, id] of segs) {
      if (id === this.unkId) {
        for (const b of enc.encode(cps.slice(s, e).join("")))
          ids.push(this.bytes.get(b) ?? this.unkId);
      } else ids.push(id);
    }
    return ids;
  }
};

// ../web/lib/textnorm.js
var UNIT = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
var TEEN = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
var TEN = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
var MILL = [
  " ",
  " thousand",
  " million",
  " billion",
  " trillion",
  " quadrillion",
  " quintillion",
  " sextillion",
  " septillion",
  " octillion",
  " nonillion",
  " decillion",
];
var ORDINAL = {
  ty: "tieth",
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};
function mill(i) {
  if (i >= MILL.length)
    throw new RangeError("number out of range (more than 36 digits)");
  return MILL[i];
}
function tenfn(tens, units, mindex = 0) {
  if (tens !== 1)
    return `${TEN[tens]}${tens && units ? "-" : ""}${UNIT[units]}${mill(mindex)}`;
  return `${TEEN[units]}${mill(mindex)}`;
}
function hundfn(h, t, u, mindex, andword) {
  if (h)
    return `${UNIT[h]} hundred${t || u ? ` ${andword} ` : ""}${tenfn(t, u)}${mill(mindex)}, `;
  if (t || u) return `${tenfn(t, u)}${mill(mindex)}, `;
  return "";
}
function enword0(num, args) {
  if (/^0+$/.test(num)) return args.zero;
  if (/^0*1$/.test(num)) return args.one;
  let digits = num.replace(/^0+/, "");
  let tail = "";
  let m = 0;
  while (digits.length >= 3) {
    const d = digits.slice(-3);
    tail = hundfn(+d[0], +d[1], +d[2], m, args.andword) + tail;
    m++;
    digits = digits.slice(0, -3);
  }
  if (digits.length === 2)
    tail = `${tenfn(+digits[0], +digits[1], m)}, ` + tail;
  else if (digits.length === 1) tail = `${UNIT[+digits]}${mill(m)}, ` + tail;
  return tail;
}
function enword2(num, args) {
  const head = ((num.length - 1) % 2) + 1;
  const parts = [num.slice(0, head)];
  for (let i = head; i < num.length; i += 2) parts.push(num.slice(i, i + 2));
  return parts
    .map((p) => {
      if (p.length === 1) return +p ? `${UNIT[+p]}, ` : ` ${args.zero}, `;
      const t = +p[0],
        u = +p[1];
      if (t) return `${tenfn(t, u)}, `;
      if (u) return ` ${args.zero} ${UNIT[u]}, `;
      return ` ${args.zero} ${args.zero}, `;
    })
    .join("");
}
function subOrd(val) {
  const m = val.match(/(ty|one|two|three|five|eight|nine|twelve)$/);
  return m ? val.slice(0, -m[1].length) + ORDINAL[m[1]] : val + "th";
}
function numberToWords(
  input,
  { andword = "and", zero = "zero", one = "one", group = 0 } = {},
) {
  const args = { andword, zero, one };
  let num = String(input);
  const myord = ["st", "nd", "rd", "th"].includes(num.slice(-2));
  if (myord) num = num.slice(0, -2);
  let chunk = num.replace(/\D/g, "") || "0";
  chunk = group === 2 ? enword2(chunk, args) : enword0(chunk, args);
  if (chunk.slice(-2) === ", ") chunk = chunk.slice(0, -2);
  chunk = chunk.replace(/\s+,/g, ",");
  if (group === 0) {
    chunk = chunk.replace(/, (\S+)\s+$/, ` ${andword} $1`);
    chunk = chunk.replace(/\s+,/g, ",");
  }
  chunk = chunk.replace(/\s+/g, " ").trim();
  const numchunks = chunk.split(", ");
  if (myord && numchunks.length)
    numchunks[numchunks.length - 1] = subOrd(numchunks[numchunks.length - 1]);
  return numchunks.join(", ");
}
var words = (n, opts) => numberToWords(n, opts).replace(/,/g, "");
function expandDollars(_m, amount) {
  const parts = amount.replace(/,/g, "").split(".");
  if (parts.length > 2) return amount + " dollars";
  const dollars = parts[0] ? parseInt(parts[0], 10) : 0;
  const cents = parts.length > 1 && parts[1] ? parseInt(parts[1], 10) : 0;
  const du = dollars === 1 ? "dollar" : "dollars";
  const cu = cents === 1 ? "cent" : "cents";
  if (dollars && cents) return `${dollars} ${du}, ${cents} ${cu}`;
  if (cents) return `${cents} ${cu}`;
  return `${dollars} ${du}`;
}
function expandNumber(m) {
  const n = m.length <= 15 ? parseInt(m, 10) : Infinity;
  if (n > 1e3 && n < 3e3) {
    if (n === 2e3) return "two thousand";
    if (n > 2e3 && n < 2010) return "two thousand " + words(String(n % 100));
    if (n % 100 === 0) return words(String(Math.floor(n / 100))) + " hundred";
    return words(String(n), { andword: "", zero: "oh", group: 2 });
  }
  return words(m, { andword: "" });
}
function normalizeNumbers(text) {
  text = text.replace(/£([0-9.,]*[0-9]+)/g, "$1 pounds");
  text = text.replace(/\$([0-9.,]*[0-9]+)/g, expandDollars);
  text = text.replace(/\b([0-9]{1,3}(?:,[0-9]{3})+)\b/g, (_m, g) =>
    words(g.replace(/,/g, ""), { andword: "" }),
  );
  text = text.replace(/([0-9])\s*%/g, "$1 percent");
  text = text.replace(
    /(?<=[0-9])\.([0-9]+)/g,
    (_m, d) => ` point ${d.split("").join(" ")}`,
  );
  text = text.replace(/[0-9]+(st|nd|rd|th)\b/g, (m) => words(m));
  text = text.replace(/[0-9]+/g, expandNumber);
  return text;
}
var TERMINAL = ".!?\u2026";
var WEAK = ",;:-\u2013\u2014";
var CLOSERS = `"'\u201D\u2019)]\xBB`;
function rstripChars(s, chars) {
  let e = s.length;
  while (e > 0 && chars.includes(s[e - 1])) e--;
  return s.slice(0, e);
}
function ensureTerminalPunctuation(text) {
  const core = rstripChars(text, CLOSERS + " ");
  const closers = text.slice(core.length).trim();
  if (!core || TERMINAL.includes(core[core.length - 1])) return text;
  if (WEAK.includes(core[core.length - 1]))
    return rstripChars(core, WEAK + " ") + "." + closers;
  return text + ".";
}
function preparePrompt(text) {
  text = text.trim();
  if (text === "") throw new Error("Text prompt cannot be empty");
  text = text.replace(/\n/g, " ").replace(/\r/g, " ").replaceAll("  ", " ");
  text = text[0].toUpperCase() + text.slice(1);
  return ensureTerminalPunctuation(text);
}
function ttsPrompt(text) {
  return preparePrompt(normalizeNumbers(text));
}

// ../web/lib/samuel.js
var SAMPLE_RATE = 44100;
var PARAM_NAMES = [
  "frequency",
  "voiceness",
  "intensity",
  "tongueIndex",
  "tongueDiameter",
  "vibratoWobble",
  "vibratoFrequency",
  "vibratoGain",
  "tractLength",
  "constrictionIndex",
  "constrictionDiameter",
  "lipDiameter",
];
var here = new URL(".", import.meta.url);
async function loadOrt({
  backend = "wasm",
  base = new URL("../vendor/ort/", here).href,
} = {}) {
  const file = backend === "webgpu" ? "ort.webgpu.min.mjs" : "ort.wasm.min.mjs";
  const ort = await import(
    /* @vite-ignore */
    base + file
  );
  ort.env.wasm.wasmPaths = base;
  const threads = globalThis.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  ort.env.wasm.numThreads = threads;
  return ort;
}
async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
function gaussianRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let sm = seed >>> 0;
  const splitmix = () => {
    sm = (sm + 2654435769) >>> 0;
    let z = sm;
    z = Math.imul(z ^ (z >>> 16), 2246822507);
    z = Math.imul(z ^ (z >>> 13), 3266489909);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix(),
    b = splitmix(),
    c = splitmix(),
    d = 1;
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  let spare = null;
  return () => {
    if (spare !== null) {
      const v2 = spare;
      spare = null;
      return v2;
    }
    let u = 0,
      v = 0;
    while (u === 0) u = next();
    v = next();
    const r = Math.sqrt(-2 * Math.log(u)),
      th = 2 * Math.PI * v;
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}
async function resampleTo44k(audio, sampleRate) {
  if (sampleRate === SAMPLE_RATE) return audio;
  const n = Math.ceil((audio.length * SAMPLE_RATE) / sampleRate);
  if (typeof OfflineAudioContext !== "undefined") {
    const ctx = new OfflineAudioContext(1, n, SAMPLE_RATE);
    const buf = ctx.createBuffer(1, audio.length, sampleRate);
    buf.copyToChannel(audio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    return (await ctx.startRendering()).getChannelData(0).slice();
  }
  const out = new Float32Array(n),
    r = sampleRate / SAMPLE_RATE;
  for (let i = 0; i < n; i++) {
    const x = i * r,
      i0 = Math.floor(x),
      f = x - i0;
    out[i] = (audio[i0] ?? 0) * (1 - f) + (audio[i0 + 1] ?? 0) * f;
  }
  return out;
}
function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(Math.max(s / Math.max(1, x.length), 1e-12));
}
var Samuel = class _Samuel {
  /**
   * @param {object} o
   * @param {object} o.ort         onnxruntime-web module (see loadOrt)
   * @param {string} [o.models]    base URL of the models folder
   * @param {boolean} [o.tts=true] also load the text-to-speech model (~29 MB)
   * @param {string[]} [o.executionProviders] e.g. ["webgpu", "wasm"]
   * @param {(stage:string, got:number, total:number)=>void} [o.onProgress]
   */
  static async load({
    ort,
    models = new URL("../models/", here).href,
    tts = true,
    executionProviders = ["wasm"],
    onProgress,
  } = {}) {
    if (!ort) ort = await loadOrt();
    const s = new _Samuel();
    s.ort = ort;
    s.ep = executionProviders;
    const j = async (f) => {
      const res = await fetch(models + f);
      if (!res.ok) throw new Error(`${models + f}: HTTP ${res.status}`);
      return res.json();
    };
    s.meta = await j("controller.json");
    const opts = { executionProviders, graphOptimizationLevel: "all" };
    const prog = (stage) => (got, total) => onProgress?.(stage, got, total);
    s.controller = await ort.InferenceSession.create(
      await fetchBytes(models + "controller_stream.onnx", prog("speech")),
      opts,
    );
    s.pyinModel = new PyinModel({
      sr: SAMPLE_RATE,
      ...s.meta.pyin,
      frameLength: s.meta.pyin.frame_length,
      hop: s.meta.samples_per_frame,
    });
    if (tts) {
      s.ttsMeta = await j("tts.json");
      s.tokenizer = new Tokenizer(await j("tokenizer.json"));
      const small = {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      };
      s.ttsText = await ort.InferenceSession.create(
        await fetchBytes(models + "tts_text.onnx", prog("text")),
        small,
      );
      s.ttsBackbone = await ort.InferenceSession.create(
        await fetchBytes(models + "tts_backbone.onnx", prog("text")),
        small,
      );
      s.ttsFlow = await ort.InferenceSession.create(
        await fetchBytes(models + "tts_flow.onnx", prog("text")),
        small,
      );
    }
    return s;
  }
  get frameRate() {
    return this.meta.frame_rate;
  }
  /** Free the ONNX Runtime sessions. The instance is unusable afterwards. */
  async dispose() {
    const sessions = [
      this.controller,
      this.ttsText,
      this.ttsBackbone,
      this.ttsFlow,
    ].filter(Boolean);
    this.controller = this.ttsText = this.ttsBackbone = this.ttsFlow = null;
    await Promise.all(sessions.map((x) => x.release()));
  }
  _zeroStates() {
    const T = this.ort.Tensor;
    return this.meta.stream_states.map(
      ([c, p]) => new T("float32", new Float32Array(c * p), [1, c, p]),
    );
  }
  /** Run the causal controller over 44.1 kHz audio already RMS-normalised,
   *  length a multiple of 512, in chunks, threading the conv state. */
  async _controller(x, states, chunk = 512 * 64) {
    const T = this.ort.Tensor,
      n = this.meta.stream_states.length,
      nt = this.meta.trainable.length;
    const K = this.meta.n_buckets,
      frames = x.length / 512;
    const params = new Float32Array(frames * nt),
      probs = new Float32Array(frames * nt * K);
    let f = 0;
    for (let i = 0; i < x.length; i += chunk) {
      const piece = x.subarray(i, Math.min(x.length, i + chunk));
      const feeds = { x: new T("float32", piece, [1, 1, piece.length]) };
      for (let k = 0; k < n; k++) feeds["s" + k] = states[k];
      const out = await this.controller.run(feeds);
      const nf = piece.length / 512;
      params.set(out.params.data, f * nt);
      probs.set(out.probs.data, f * nt * K);
      for (let k = 0; k < n; k++) states[k] = out["o" + k];
      f += nf;
    }
    return { params, probs, states };
  }
  _assemble(nFrames, trainable, f0, voiced, extra = {}) {
    const nt = this.meta.trainable.length;
    const params = {};
    for (const name of PARAM_NAMES) params[name] = new Float32Array(nFrames);
    params.frequency.set(f0.subarray(0, nFrames));
    for (const [k, v] of Object.entries(this.meta.frozen_values))
      params[k].fill(v);
    this.meta.trainable.forEach((name, p) => {
      const a = params[name];
      for (let t = 0; t < nFrames; t++) a[t] = trainable[t * nt + p];
    });
    return {
      frame_rate: this.meta.frame_rate,
      n_frames: nFrames,
      duration_s: nFrames / this.meta.frame_rate,
      params,
      voiced: Array.from(voiced.subarray(0, nFrames), (v) => !!v),
      ...extra,
    };
  }
  /**
   * Speech -> articulation (the server's /api/synthesize).
   * @param {Float32Array} audio mono samples
   * @param {number} sampleRate
   * @returns {Promise<object>} {frame_rate, n_frames, duration_s, params, voiced, probs, timing}
   */
  async mimic(audio, sampleRate = SAMPLE_RATE) {
    const t0 = performance.now();
    let y = await resampleTo44k(audio, sampleRate);
    if (y.some((v) => !Number.isFinite(v)))
      y = y.map((v) => (Number.isFinite(v) ? v : 0));
    if (y.length < 512) throw new Error("audio too short");
    if (y.length < 1024) {
      const z = new Float32Array(1024);
      z.set(y);
      y = z;
    }
    const T = Math.ceil(y.length / 512);
    const t1 = performance.now();
    const p = pyin(y, { model: this.pyinModel });
    const f0raw = new Float32Array(T),
      vraw = new Uint8Array(T);
    f0raw.set(p.f0.subarray(0, T));
    vraw.set(p.voiced.subarray(0, T));
    const f0 = fillUnvoiced(
      f0raw,
      vraw,
      this.meta.pyin.fmin,
      this.meta.pyin.fmax,
    );
    const t2 = performance.now();
    const x = new Float32Array(T * 512);
    const g = this.meta.target_rms / rms(y);
    for (let i = 0; i < y.length; i++) x[i] = y[i] * g;
    const { params, probs } = await this._controller(x, this._zeroStates());
    const t3 = performance.now();
    return this._assemble(T, params, f0, vraw, {
      probs,
      source: "speech",
      timing: {
        resample: t1 - t0,
        pitch: t2 - t1,
        model: t3 - t2,
        total: t3 - t0,
      },
      input: y,
    });
  }
  /**
   * Text -> articulation (the server's /api/tts).
   * @param {string} text  at most 300 characters
   * @param {object} [o]
   * @param {number} [o.temp=0.3] sampling temperature
   * @param {number} [o.cfg=2.0]  classifier-free guidance
   * @param {number} [o.seed]     for repeatable output
   * @param {(l:{index:number, frames:Float32Array, attempt:number})=>void} [o.onLatent]
   *        called with each new latent as it is generated, for playback that
   *        starts before generation ends. frames is 8 control frames × 8
   *        values (the 7 trainable params in controller.json order, then f0
   *        in Hz). If an attempt runs on and is retried, the retry starts
   *        again at index 0 with attempt + 1: drop what you had, or pass
   *        retries: 0 when streaming.
   * @param {AbortSignal} [o.signal]
   * @param {number|"auto"} [o.maxSeconds="auto"] length cap; auto = 1.5 s + 0.5 s per token (≤ 20 s)
   * @param {number} [o.retries=2] new seeds to try when the model doesn't stop by the cap
   */
  async speak(text, opts = {}) {
    const { retries = 2 } = opts;
    let seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
    for (let attempt = 0; ; attempt++) {
      const out = await this._speakOnce(text, { ...opts, seed, attempt });
      if (!out.ran_on || attempt >= retries || opts.normals) return out;
      seed = (seed + 1) >>> 0;
    }
  }
  async _speakOnce(
    text,
    {
      temp,
      cfg,
      seed,
      onLatent,
      signal,
      normals,
      maxSeconds = "auto",
      attempt = 0,
    } = {},
  ) {
    if (!this.ttsText) throw new Error("text-to-speech not loaded");
    const m = this.ttsMeta;
    temp ??= m.temp;
    cfg ??= m.cfg;
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty text");
    if (trimmed.length > m.max_chars)
      throw new Error(`text longer than ${m.max_chars} characters`);
    const t0 = performance.now();
    const prompt = ttsPrompt(trimmed);
    const ids = this.tokenizer.encode(prompt);
    const T = this.ort.Tensor;
    const tok = new T(
      "int64",
      BigInt64Array.from(ids, (v) => BigInt(v)),
      [1, ids.length],
    );
    const { cond, uncond } = await this.ttsText.run({ tokens: tok });
    const L = m.n_layers,
      H = m.n_heads,
      D = m.head_dim;
    const empty = () => new T("float32", new Float32Array(0), [L, 1, H, 0, D]);
    const bb = (x, k, v) => this.ttsBackbone.run({ x, past_k: k, past_v: v });
    let c = await bb(cond, empty(), empty());
    let u = await bb(uncond, empty(), empty());
    const capSeconds =
      maxSeconds === "auto"
        ? Math.min(m.max_seconds, 1.5 + 0.5 * ids.length)
        : Math.min(m.max_seconds, maxSeconds);
    const maxFrames = Math.floor(capSeconds * m.latent_rate);
    let stopped = false;
    const rng = gaussianRng(seed);
    const sd = Math.sqrt(temp);
    const zbuf = new Float32Array(m.d_model),
      nbuf = new Float32Array(m.ldim);
    const frames = [];
    for (let t = 0; t < maxFrames; t++) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const zc = c.z.data,
        zu = u.z.data;
      for (let i = 0; i < zbuf.length; i++)
        zbuf[i] = zu[i] + cfg * (zc[i] - zu[i]);
      for (let i = 0; i < nbuf.length; i++)
        nbuf[i] = sd * (normals ? normals[t][i] : rng());
      const out2 = await this.ttsFlow.run({
        z: new T("float32", zbuf.slice(), [1, m.d_model]),
        noise: new T("float32", nbuf.slice(), [1, m.ldim]),
      });
      if (out2.eos.data[0] > m.eos_threshold) {
        stopped = true;
        break;
      }
      const fr = out2.frames.data;
      frames.push(fr.slice());
      onLatent?.({ index: t, frames: fr.slice(), attempt });
      [c, u] = [
        await bb(out2.next_x, c.k, c.v),
        await bb(out2.next_x, u.k, u.v),
      ];
    }
    if (!frames.length) throw new Error("the model said nothing; try again");
    const nF = frames.length * m.stack;
    const nt = this.meta.trainable.length;
    const trainable = new Float32Array(nF * nt),
      f0 = new Float32Array(nF),
      voiced = new Uint8Array(nF);
    const vIdx = this.meta.trainable.indexOf("voiceness");
    frames.forEach((fr, li) => {
      for (let k = 0; k < m.stack; k++) {
        const t = li * m.stack + k;
        for (let p = 0; p < nt; p++) trainable[t * nt + p] = fr[k * 8 + p];
        f0[t] = fr[k * 8 + 7];
        voiced[t] = fr[k * 8 + vIdx] >= 0.5 ? 1 : 0;
      }
    });
    const out = this._assemble(nF, trainable, f0, voiced, {
      source: "text",
      prompt,
      tokens: ids,
      seed,
      ran_on: !stopped,
      timing: { total: performance.now() - t0, latents: frames.length },
    });
    out.frame_rate = 44100 / 512;
    return out;
  }
  /**
   * Live, causal mimicry. Feed 512-sample hops of 44.1 kHz audio; get one
   * articulation frame per hop. A frame comes out 3 hops after its own hop
   * arrives (46 ms after its centre), when pYIN's centred 4096-sample window
   * is complete. Call close() when done.
   * @param {object} o
   * @param {(frame:object)=>void} o.onFrame  {t, params:{name:value}, voiced, level}
   */
  liveMimic({ onFrame } = {}) {
    const self = this;
    const states = this._zeroStates();
    const pitch = new PyinStream({ model: this.pyinModel });
    const pending = [];
    const nt = this.meta.trainable.length;
    let t = 0;
    let level = 0.05;
    let busy = Promise.resolve();
    let queued = 0;
    const hopBuf = new Float32Array(512);
    let closed = false;
    const live = {
      dropped: 0,
      /** Stop: later pushes are ignored and queued frames are not delivered. */
      close() {
        closed = true;
        pending.length = 0;
      },
      /** hop: Float32Array(512) at 44.1 kHz. Hops arriving while more than 8
       *  are still queued are dropped (pitch and controller alike, so they stay
       *  aligned) rather than letting latency grow. */
      push(hop) {
        if (closed) return busy;
        if (queued > 8) {
          live.dropped++;
          return busy;
        }
        const frameRms = rms(hop);
        if (frameRms > 3e-3) level = level * 0.97 + frameRms * 0.03 * 1.6;
        const g = Math.min(
          Math.max(self.meta.target_rms / Math.max(level, 1e-4), 0.05),
          60,
        );
        const x = new Float32Array(512);
        for (let i = 0; i < 512; i++) x[i] = hop[i] * g;
        hopBuf.set(hop);
        const pr = pitch.push(hopBuf);
        queued++;
        busy = busy
          .then(async () => {
            if (closed) return;
            let r = null;
            try {
              r = await self._controller(x, states, 512);
            } catch (e) {
              console.error("Samuel live frame failed:", e);
            }
            if (r) {
              for (let k = 0; k < states.length; k++) states[k] = r.states[k];
              pending.push({ params: r.params, probs: r.probs, rms: frameRms });
            } else pending.push(null);
            if (!pr || closed) return;
            const c = pending.shift();
            if (!c) return;
            const params = {};
            self.meta.trainable.forEach(
              (name, p) => (params[name] = c.params[p]),
            );
            params.frequency = pr.filled;
            for (const [k, v] of Object.entries(self.meta.frozen_values))
              params[k] = v;
            onFrame?.({
              t: t++,
              params,
              voiced: pr.voiced,
              vprob: pr.vprob,
              level: c.rms,
              probs: c.probs,
              nt,
            });
          })
          .catch((e) => console.error("Samuel live onFrame failed:", e))
          .finally(() => queued--);
        return busy;
      },
      get latencyFrames() {
        return 3;
      },
    };
    return live;
  }
};
export {
  PARAM_NAMES,
  SAMPLE_RATE,
  Samuel,
  gaussianRng,
  loadOrt,
  resampleTo44k,
};
