// Turn Samuel's articulation data ("a", as passed to mouth.play(a)) into keyframes for the /timeline editor.
// It reproduces exactly what pink-trombone-adapter.js schedules in play(), as plain keyframes, in the same
// shape as the TTS page's "download all". Put this file next to pink-trombone-adapter.js.
import { articulationCurves } from "./pink-trombone-adapter.js";

const FADE_S = 0.05; // keep in sync with the adapter: the voice fades out over this long after the last frame
const LIP_INDEX = 43; // the adapter holds the lip constriction at this index
const r = (x) => Math.round(x * 1e4) / 1e4;

/**
 * @param {object} a  articulation data: a.params.* per-frame arrays and a.frame_rate
 * @param {{speed?: number, tractLength?: number, simplify?: boolean | object}} [options]
 *   speed matches play({ speed }); simplify runs cleanupKeyframes (pass an options object to tune it)
 * @returns {object[]}  keyframes: [{ time, frequency, "tongue.index", ... }, ...]
 */
export function articulationKeyframes(
  a,
  { speed = 1, tractLength = 44, simplify = false } = {},
) {
  const c = articulationCurves(a); // same per-frame values the adapter plays (also pads a single frame to two)
  const n = c.frequency.length;
  const dur = n / a.frame_rate / speed;
  const keyframes = Array.from({ length: n }, (_, i) => ({
    // play() spreads the n frames evenly across dur with setValueCurveAtTime, so frame i lands at i * dur / (n - 1)
    time: n > 1 ? r((i * dur) / (n - 1)) : 0,
    frequency: r(c.frequency[i]),
    "tongue.index": r(c.tongueIndex[i]),
    "tongue.diameter": r(c.tongueDiameter[i]),
    "frontConstriction.index": r(c.tipIndex[i]), // the adapter's moving tongue-tip constriction
    "frontConstriction.diameter": r(c.tipDiameter[i]),
    "backConstriction.index": 10.5, // unused by the model: held wide open
    "backConstriction.diameter": 5,
    "lipConstriction.index": LIP_INDEX,
    "lipConstriction.diameter": r(c.lipDiameter[i]),
    tenseness: r(c.tenseness[i]), // = voiceness; /timeline turns this back into its voiceness track
    loudness: r(c.loudness[i]), // = voiceness ** 0.25
    intensity: r(c.intensity[i]),
    tractLength,
  }));
  // after the last frame the adapter ramps intensity to 0 over FADE_S
  keyframes.push({ ...keyframes[n - 1], time: r(dur + FADE_S), intensity: 0 });
  return simplify
    ? cleanupKeyframes(keyframes, simplify === true ? {} : simplify)
    : keyframes;
}

// Parameter ranges used to judge how much an error matters (the same ranges /timeline uses).
const RANGES = {
  frequency: 580,
  "tongue.index": 17,
  "tongue.diameter": 1.45,
  "frontConstriction.index": 16,
  "frontConstriction.diameter": 6,
  "backConstriction.index": 5.5,
  "backConstriction.diameter": 6,
  "lipConstriction.index": 6,
  "lipConstriction.diameter": 6,
  tenseness: 1,
  loudness: 1,
  intensity: 1,
  tractLength: 73,
};

/**
 * Remove keyframes that linear interpolation between their neighbours already reproduces.
 * Keyframes are full poses, so a frame is only dropped when every parameter stays within tolerance.
 * Uses Ramer-Douglas-Peucker on time: the first and last keyframes are always kept, and the frame that
 * deviates most from the straight line between kept frames is kept next, until nothing deviates enough.
 *
 * @param {object[]} keyframes  [{ time, ...parameters }], sorted by time
 * @param {{tolerance?: number, ranges?: object}} [options]
 *   tolerance: allowed error as a fraction of each parameter's range (default 0.005, i.e. 0.5%)
 *   ranges: per-parameter range overrides, for parameters not in the table above
 * @returns {object[]}  a new array of the kept keyframes (the originals are not modified)
 */
export function cleanupKeyframes(
  keyframes,
  { tolerance = 0.005, ranges = {} } = {},
) {
  const n = keyframes.length;
  if (n <= 2) return keyframes.map((k) => ({ ...k }));
  const keys = Object.keys(keyframes[0]).filter(
    (k) => k !== "time" && typeof keyframes[0][k] === "number",
  );
  const range = {};
  for (const k of keys) {
    const vs = keyframes.map((f) => f[k]);
    range[k] =
      ranges[k] ?? RANGES[k] ?? (Math.max(...vs) - Math.min(...vs) || 1);
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = keyframes[i],
      b = keyframes[j],
      span = b.time - a.time;
    let worst = -1,
      worstErr = tolerance;
    for (let m = i + 1; m < j; m++) {
      const f = keyframes[m],
        u = span > 0 ? (f.time - a.time) / span : 0;
      let err = 0;
      for (const k of keys)
        err = Math.max(
          err,
          Math.abs(f[k] - (a[k] + (b[k] - a[k]) * u)) / range[k],
        );
      if (err > worstErr) {
        worstErr = err;
        worst = m;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return keyframes.filter((_, i) => keep[i]).map((k) => ({ ...k }));
}
