// Find the closest phoneme to Samuel's live articulation.
//
// A configuration is a list of maps. Each map says "this articulation is this phoneme": a phoneme symbol plus one captured
// frame (tongue, front constriction, lip and voiceness). A phoneme may have several maps (variants). A live frame is compared
// with every map, and the closest phoneme is the one owning the nearest map.

// the values a map is matched on: [name, range used to normalise it, group the weight sliders control]
export const DIMENSIONS = [
  ["tongueIndex", 17, "tongue"],
  ["tongueDiameter", 1.45, "tongue"],
  ["constrictionIndex", 24, "front"], // the model's moving tongue-tip ("front") constriction
  ["constrictionDiameter", 5, "front"],
  ["lipDiameter", 5, "lip"],
  ["voiceness", 1, "voice"],
];
// everything stored with a captured frame; frequency and intensity are kept so the sound can be played on Pink Trombone
export const INPUT_KEYS = ["frequency", "intensity", ...DIMENSIONS.map(([name]) => name)];
export const DEFAULT_SETTINGS = { tongue: 1, front: 1, lip: 1, voice: 1, smoothing: 0.3, stability: 3, maxDistance: 0.6, sharpness: 2, gate: -42 };
export const SETTING_RANGES = {
  tongue: [0, 3], front: [0, 3], lip: [0, 3], voice: [0, 3], smoothing: [0, 0.9], stability: [1, 12], maxDistance: [0.05, 2], sharpness: [0.5, 6], gate: [-70, -20],
};

const num = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let counter = 0;
export const newId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const emptyConfig = () => ({ version: 1, name: "", maps: [], settings: { ...DEFAULT_SETTINGS } });

/** Anything parsed from a file or storage -> a clean configuration (nothing is trusted). Throws if it isn't one. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.maps)) throw new Error("not a phoneme configuration");
  const config = emptyConfig(), ids = new Set();
  config.name = typeof raw.name === "string" ? raw.name.slice(0, 80) : "";
  for (const m of raw.maps.slice(0, 1000)) {
    if (!m || typeof m !== "object" || typeof m.phoneme !== "string" || !m.phoneme.trim() || m.phoneme.length > 12) continue;
    const id = typeof m.id === "string" && m.id && m.id.length < 40 && !ids.has(m.id) ? m.id : newId();
    ids.add(id);
    let input = null;
    if (m.input && typeof m.input === "object" && DIMENSIONS.every(([k]) => num(m.input[k]))) {
      input = {};
      for (const k of INPUT_KEYS) if (num(m.input[k])) input[k] = m.input[k];
    }
    config.maps.push({ id, phoneme: m.phoneme.trim(), input });
  }
  if (raw.settings && typeof raw.settings === "object") {
    for (const [k, [lo, hi]] of Object.entries(SETTING_RANGES)) if (num(raw.settings[k])) config.settings[k] = clamp(raw.settings[k], lo, hi);
  }
  return config;
}

/** Distance between two frames: each value normalised by its range, weighted by its group's slider. */
export function distance(a, b, settings) {
  let sum = 0;
  for (const [name, range, group] of DIMENSIONS) {
    const d = (a[name] - b[name]) / range;
    sum += settings[group] * d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Every phoneme that has a map, closest first. `p` is each phoneme's share of inverse-distance weight (sums to 1; the
 * sharpness setting is the power), a rough confidence for display.
 * @returns {{ phoneme: string, distance: number, mapId: string, p: number }[]}
 */
export function rank(frame, maps, settings) {
  const best = new Map();
  for (const m of maps) {
    if (!m.input) continue;
    const d = distance(frame, m.input, settings), cur = best.get(m.phoneme);
    if (!cur || d < cur.distance) best.set(m.phoneme, { phoneme: m.phoneme, distance: d, mapId: m.id });
  }
  const list = [...best.values()].sort((a, b) => a.distance - b.distance);
  if (!list.length) return list;
  if (list[0].distance < 1e-9) list.forEach((r, i) => (r.p = i === 0 ? 1 : 0));
  else {
    const w = list.map((r) => 1 / r.distance ** settings.sharpness), total = w.reduce((x, y) => x + y, 0);
    list.forEach((r, i) => (r.p = w[i] / total));
  }
  return list;
}

export const UNKNOWN = "?"; // nothing was close enough

/**
 * Turns a stream of frames into phonemes. Frames are smoothed, ranked, and a change of phoneme is only accepted once the new
 * winner has held for `stability` frames. Runs of the same phoneme form the transcript. Use one per stream (live or recorded).
 */
export class Recognizer {
  constructor(getMaps, getSettings) { this.getMaps = getMaps; this.getSettings = getSettings; this.reset(); }
  reset() { this.vec = null; this.committed = null; this.candidate = null; this.count = 0; this.transcript = []; this.frame = 0; this.open = false; }
  /**
   * @param frame articulation values (the DIMENSIONS names)
   * @param speech false while the speaker is quiet: that ends the current phoneme and clears the smoothing
   * @returns {{ ranking: object[], raw: string | null, phoneme: string | null, changed: boolean }}
   */
  push(frame, speech) {
    const s = this.getSettings(), n = this.frame++;
    if (!speech) {
      const had = this.committed !== null;
      this.vec = null; this.committed = null; this.candidate = null; this.count = 0; this.open = false;
      return { ranking: [], raw: null, phoneme: null, changed: had };
    }
    const k = this.vec ? 1 - s.smoothing : 1;
    this.vec = this.vec ?? {};
    for (const [name] of DIMENSIONS) this.vec[name] = (this.vec[name] ?? frame[name]) + (frame[name] - (this.vec[name] ?? frame[name])) * k;
    const ranking = rank(this.vec, this.getMaps(), s);
    const raw = ranking.length ? (ranking[0].distance <= s.maxDistance ? ranking[0].phoneme : UNKNOWN) : null;
    let changed = false, moved = 0;
    if (raw !== null && raw !== this.committed) {
      this.count = raw === this.candidate ? this.count + 1 : 1;
      this.candidate = raw;
      if (this.count >= Math.round(s.stability)) { moved = this.count - 1; this.committed = raw; this.candidate = null; this.count = 0; changed = true; }
    } else { this.candidate = null; this.count = 0; }
    if (this.committed !== null) {
      const last = this.transcript[this.transcript.length - 1];
      if (changed) { // the frames that were waiting to confirm this change belong to it, not to the previous phoneme
        if (this.open && last) last.frames = Math.max(0, last.frames - moved);
        this.transcript.push({ phoneme: this.committed, start: n - moved, frames: moved + 1 }); this.open = true;
      } else if (last && this.open) last.frames++;
    }
    return { ranking, raw, phoneme: this.committed, changed };
  }
}
