// Mapping from Samuel's articulation (tongue, front constriction, lip) to avatar morph targets.
//
// A configuration is a list of "maps". Each map has an input (one articulation frame, captured from your voice) and the morph
// target values that should appear on the avatar for it. In test mode, the live articulation is compared with every map's input
// and the morph targets are a weighted blend of the nearest maps. With two maps and power 1 this is exactly linear interpolation
// between them; with more maps it generalises to inverse-distance weighting of the K nearest.

// the articulation values a map is matched on: [name, range used to normalise it, group the weight sliders control]
export const DIMENSIONS = [
  ["tongueIndex", 17, "tongue"],
  ["tongueDiameter", 1.45, "tongue"],
  ["constrictionIndex", 24, "front"], // the model's moving tongue-tip ("front") constriction
  ["constrictionDiameter", 5, "front"],
  ["lipDiameter", 5, "lip"],
];
// everything stored with a captured frame; the rest is kept so the sound can be played on Pink Trombone
export const INPUT_KEYS = [
  "frequency",
  "voiceness",
  "intensity",
  ...DIMENSIONS.map(([name]) => name),
];
export const DEFAULT_SETTINGS = {
  neighbours: 3,
  power: 1,
  tongue: 1,
  front: 1,
  lip: 1,
  smoothing: 0.4,
  gate: -42,
};
export const SETTING_RANGES = {
  neighbours: [1, 12],
  power: [0.25, 6],
  tongue: [0, 3],
  front: [0, 3],
  lip: [0, 3],
  smoothing: [0, 0.95],
  gate: [-70, -20],
};

const num = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let counter = 0;
export const newId = () =>
  `m${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function emptyConfig() {
  return {
    version: 1,
    name: "",
    targets: [],
    maps: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Anything parsed from a file or storage -> a clean configuration (never trusts the shape). Throws if it isn't one. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.maps))
    throw new Error("not a morph target configuration");
  const config = emptyConfig();
  config.name = typeof raw.name === "string" ? raw.name.slice(0, 80) : "";
  config.targets = Array.isArray(raw.targets)
    ? [
        ...new Set(
          raw.targets.filter((t) => typeof t === "string" && t.length < 80),
        ),
      ]
    : [];
  const ids = new Set();
  for (const m of raw.maps.slice(0, 500)) {
    if (!m || typeof m !== "object") continue;
    let id =
      typeof m.id === "string" && m.id && m.id.length < 40 && !ids.has(m.id)
        ? m.id
        : newId();
    ids.add(id);
    let input = null;
    if (
      m.input &&
      typeof m.input === "object" &&
      DIMENSIONS.every(([k]) => num(m.input[k]))
    ) {
      input = {};
      for (const k of INPUT_KEYS) if (num(m.input[k])) input[k] = m.input[k];
    }
    const targets = {};
    if (m.targets && typeof m.targets === "object") {
      for (const [k, v] of Object.entries(m.targets))
        if (k.length < 80 && num(v)) targets[k] = clamp(v, -1, 1);
    }
    config.maps.push({
      id,
      name: typeof m.name === "string" ? m.name.slice(0, 80) : "map",
      input,
      targets,
    });
  }
  if (raw.settings && typeof raw.settings === "object") {
    for (const [k, [lo, hi]] of Object.entries(SETTING_RANGES))
      if (num(raw.settings[k]))
        config.settings[k] = clamp(raw.settings[k], lo, hi);
  }
  return config;
}

/** Distance between two articulation frames, each dimension normalised by its range and weighted by its group's slider. */
export function distance(a, b, settings) {
  let sum = 0;
  for (const [name, range, group] of DIMENSIONS) {
    const d = (a[name] - b[name]) / range;
    sum += settings[group] * d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Blend the maps' morph target values for a live articulation frame.
 * @returns {{ weights: Map<string, number>, values: Record<string, number> }}  weights sum to 1 (empty if no map has an input)
 */
export function blend(frame, maps, settings) {
  const near = maps
    .filter((m) => m.input)
    .map((m) => ({ m, d: distance(frame, m.input, settings) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, Math.max(1, Math.round(settings.neighbours)));
  const weights = new Map(),
    values = {};
  if (!near.length) return { weights, values };
  let total = 0;
  if (near[0].d < 1e-9) {
    near.length = 1;
    near[0].w = 1;
    total = 1;
  } // exactly on a map
  else
    for (const n of near) {
      n.w = 1 / n.d ** settings.power;
      total += n.w;
    }
  for (const { m, w } of near) {
    weights.set(m.id, w / total);
    for (const [name, v] of Object.entries(m.targets))
      values[name] = (values[name] ?? 0) + (v * w) / total;
  }
  return { weights, values };
}
