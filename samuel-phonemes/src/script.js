// Find the phoneme closest to your voice. A map = a phoneme + one captured frame of Samuel's articulation (tongue, front
// constriction, lip and voiceness). Test mode names the closest phoneme live; a recording can be recognised too.
import {
  DIMENSIONS,
  INPUT_KEYS,
  SETTING_RANGES,
  UNKNOWN,
  emptyConfig,
  normalizeConfig,
  newId,
  distance,
  Recognizer,
} from "./mapping.js";

// Samuel's files are shared with the /samuel page; change this if yours live somewhere else.
const SAMUEL_SRC = new URL("../../samuel/src/", import.meta.url);
// an optional reference configuration, used when this browser has none of its own
const REFERENCE_CONFIG = new URL("../phonemes.json", import.meta.url).href;
const STORE = "samuel-phonemes-config";
const FRAME_RATE = 44100 / 512,
  FRAME_MS = 1000 / FRAME_RATE,
  OPEN_LIP = 3;

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const setStatus = (text, isError = false) => {
  $("status").textContent = text;
  $("status").className = isError ? "err" : "mute";
};
function armed(button, label, action) {
  // two clicks to confirm, instead of a confirm() dialog some browsers suppress
  let timer = 0;
  button.addEventListener("click", () => {
    if (!timer) {
      button.textContent = "Sure?";
      timer = setTimeout(() => {
        timer = 0;
        button.textContent = label;
      }, 2500);
      return;
    }
    clearTimeout(timer);
    timer = 0;
    button.textContent = label;
    action();
  });
}
function download(name, json) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------- Samuel (speech model only)
let samuel = null;
(async () => {
  try {
    setStatus("loading Samuel…");
    const { Samuel, loadOrt } = await import(
      new URL("samuel.js", SAMUEL_SRC).href
    );
    const ort = await loadOrt({ base: new URL("ort/", SAMUEL_SRC).href });
    samuel = await Samuel.load({
      ort,
      models: new URL("models/", SAMUEL_SRC).href,
      tts: false,
      onProgress: (stage, got, total) =>
        setStatus(
          `loading ${stage} model…${total ? " " + Math.round((got / total) * 100) + "%" : ""}`,
        ),
    });
    setStatus("ready");
  } catch (error) {
    console.error(error);
    setStatus("couldn't load Samuel: " + error.message, true);
  }
  refreshButtons();
})();

// ---------------------------------------------------------------- the phonemes to choose from
// Pink Trombone's own phoneme table (the global from ../src/utils.js, which is what the "phoneme" message plays); if the
// page can't see it, a standard English set is used instead.
const FALLBACK = {
  vowel: [
    "i",
    "ɪ",
    "ɛ",
    "æ",
    "ʌ",
    "ə",
    "ɒ",
    "ɔ",
    "ʊ",
    "u",
    "eɪ",
    "aɪ",
    "ɔɪ",
    "aʊ",
    "oʊ",
    "ɑ:",
    "ɜ:ʳ",
    "eəʳ",
    "ɪəʳ",
    "ʊəʳ",
  ],
  consonant: [
    "p",
    "b",
    "t",
    "d",
    "k",
    "g",
    "f",
    "v",
    "θ",
    "ð",
    "s",
    "z",
    "ʃ",
    "ʒ",
    "h",
    "tʃ",
    "dʒ",
    "m",
    "n",
    "ŋ",
    "l",
    "r",
    "w",
    "j",
  ],
};
function phonemeGroups() {
  const groups = {};
  try {
    if (typeof phonemes === "object" && phonemes) {
      for (const [symbol, p] of Object.entries(phonemes)) {
        if (!p || !p.constrictions || symbol === "." || symbol.length > 12)
          continue;
        (groups[p.type || "other"] ||= []).push(symbol);
      }
    }
  } catch {}
  return Object.keys(groups).length ? groups : FALLBACK;
}
const GROUPS = phonemeGroups();
function fillPhonemeSelect(select) {
  select.replaceChildren();
  for (const [type, symbols] of Object.entries(GROUPS)) {
    const group = document.createElement("optgroup");
    group.label = type;
    symbols.forEach((s) => group.append(new Option(s, s)));
    select.append(group);
  }
}
fillPhonemeSelect($("phonemePick"));
fillPhonemeSelect($("mapPhoneme"));
const knownSymbol = (s) =>
  Object.values(GROUPS).some((list) => list.includes(s));

// ---------------------------------------------------------------- configuration
let config = emptyConfig(),
  selectedId = null;
const selected = () => config.maps.find((m) => m.id === selectedId) ?? null;
const settings = () => config.settings;
let saveTimer = 0;
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(config));
    } catch {}
  }, 250);
  refreshButtons();
}
window.addEventListener("pagehide", () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(config));
  } catch {}
});
function setConfig(next, info) {
  stopTest();
  config = next;
  selectedId = config.maps[0]?.id ?? null;
  $("cfgName").value = config.name;
  $("cfgInfo").textContent = info ?? "";
  live.reset();
  renderAll();
  changed();
}
async function initConfig() {
  // started at the end of the file, once everything it touches exists
  let loaded = null,
    info = "";
  try {
    loaded = normalizeConfig(JSON.parse(localStorage.getItem(STORE)));
    info =
      "Restored from this browser. Edits are saved here automatically; use Export to keep a copy.";
  } catch {}
  if (!loaded) {
    try {
      const response = await fetch(REFERENCE_CONFIG);
      if (response.ok) {
        loaded = normalizeConfig(await response.json());
        info =
          "Loaded the reference configuration (phonemes.json). Your edits are saved in this browser, not in that file.";
      }
    } catch {}
  }
  if (!loaded) {
    loaded = emptyConfig();
    info =
      "No saved or reference configuration yet. Pick a phoneme and add a map, then capture its input by recording yourself saying it.";
  }
  setConfig(loaded, info);
}
$("cfgName").addEventListener("input", () => {
  config.name = $("cfgName").value;
  changed();
});
$("cfgExport").addEventListener("click", () =>
  download(
    (config.name || "phonemes").replace(/[^\w.-]+/g, "-") + ".json",
    config,
  ),
);
$("cfgLoad").addEventListener("click", () => $("cfgFile").click());
$("cfgFile").addEventListener("change", async () => {
  const file = $("cfgFile").files[0];
  $("cfgFile").value = "";
  if (!file) return;
  try {
    setConfig(
      normalizeConfig(JSON.parse(await file.text())),
      `Loaded ${file.name}.`,
    );
  } catch (error) {
    setStatus("couldn't load that file: " + error.message, true);
  }
});
armed($("cfgNew"), "New", () =>
  setConfig(emptyConfig(), "Started a new configuration."),
);

// ---------------------------------------------------------------- Pink Trombone
const { send } = setupConnection("samuel-phonemes", () => {});
const toPT = (message) =>
  send({ to: ["pink-trombone"], type: "message", ...message });
function frameMessage(p) {
  // the same mapping /samuel-live uses
  const voice = Math.max(p.voiceness ?? 0, 0);
  return {
    frequency: Number.isFinite(p.frequency) ? p.frequency : 120,
    tenseness: voice,
    loudness: voice ** 0.25,
    intensity: p.intensity ?? 0.7,
    "tongue.index": p.tongueIndex,
    "tongue.diameter": p.tongueDiameter,
    "frontConstriction.index": p.constrictionIndex,
    "frontConstriction.diameter": p.constrictionDiameter,
    "lipConstriction.index": 43,
    "lipConstriction.diameter": p.lipDiameter ?? OPEN_LIP,
    tractLength: 44,
  };
}
let soundTimer = 0;
function holdPose(p, ms) {
  clearTimeout(soundTimer);
  toPT(frameMessage(p));
  soundTimer = setTimeout(() => toPT({ intensity: 0 }), ms);
}
function playCaptured(map) {
  if (!map?.input) return;
  toPT({
    lastKeyframe: true,
    "backConstriction.index": 10.5,
    "backConstriction.diameter": 5,
  });
  holdPose(
    { ...map.input, intensity: Math.max(map.input.intensity ?? 0, 0.7) },
    800,
  );
}
const playCanonical = (map) => {
  if (map) {
    clearTimeout(soundTimer);
    toPT({ phoneme: map.phoneme });
  }
}; // Pink Trombone's own version

// ---------------------------------------------------------------- maps
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "–");
const distEls = new Map(); // map id -> its distance readout (test mode)
function variantLabel(map) {
  const same = config.maps.filter((m) => m.phoneme === map.phoneme);
  return same.length > 1 ? `variant ${same.indexOf(map) + 1}` : "";
}
function renderMaps() {
  const box = $("maps");
  box.replaceChildren();
  distEls.clear();
  for (const map of config.maps) {
    const row = document.createElement("div"),
      dot = document.createElement("span"),
      sym = document.createElement("span"),
      name = document.createElement("span"),
      dist = document.createElement("span");
    row.className = "map" + (map.id === selectedId ? " sel" : "");
    dot.className = "dot" + (map.input ? " ok" : "");
    dot.title = map.input ? "has an input" : "no input captured yet";
    sym.className = "sym ipa";
    sym.textContent = map.phoneme;
    name.className = "name";
    name.textContent = variantLabel(map);
    dist.className = "best";
    distEls.set(map.id, dist);
    const a = document.createElement("button"),
      b = document.createElement("button"),
      del = document.createElement("button");
    a.textContent = "▶";
    a.title = "play the captured frame";
    b.textContent = "▷";
    b.title = "play Pink Trombone's own version of this phoneme";
    del.textContent = "✕";
    del.title = "delete";
    a.addEventListener("click", (e) => {
      e.stopPropagation();
      playCaptured(map);
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      playCanonical(map);
    });
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteMap(map);
    });
    row.append(dot, sym, name, dist, a, b, del);
    row.addEventListener("click", () =>
      map.id === selectedId ? deselectMap() : selectMap(map.id, true),
    ); // clicking the selected map unselects it
    box.append(row);
  }
  if (!config.maps.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No maps yet.";
    box.append(p);
  }
}
function selectMap(id, hear) {
  selectedId = id;
  renderMaps();
  renderEditor();
  if (hear) playCaptured(selected());
  refreshButtons();
}
function deselectMap() {
  selectedId = null;
  renderMaps();
  renderEditor();
  refreshButtons();
}
function addMap() {
  const symbol = $("phonemePick").value;
  if (!symbol) return;
  const map = { id: newId(), phoneme: symbol, input: null };
  config.maps.push(map);
  selectMap(map.id, false);
  changed();
}
function deleteMap(map) {
  config.maps = config.maps.filter((m) => m !== map);
  if (selectedId === map.id) selectedId = config.maps[0]?.id ?? null;
  renderMaps();
  renderEditor();
  changed();
}
$("mapAdd").addEventListener("click", addMap);
$("mapUnselect").addEventListener("click", deselectMap);
window.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    selectedId &&
    !e.target.matches?.("select,textarea")
  ) {
    e.target.blur?.();
    deselectMap();
  }
});
armed($("mapDel"), "Delete", () => {
  const m = selected();
  if (m) deleteMap(m);
});
$("mapDup").addEventListener("click", () => {
  const m = selected();
  if (!m) return;
  const copy = {
    id: newId(),
    phoneme: m.phoneme,
    input: m.input ? { ...m.input } : null,
  };
  config.maps.splice(config.maps.indexOf(m) + 1, 0, copy);
  selectMap(copy.id, false);
  changed();
});
$("mapPhoneme").addEventListener("change", () => {
  const m = selected();
  if (!m) return;
  m.phoneme = $("mapPhoneme").value;
  renderMaps();
  changed();
});
$("mapPlay").addEventListener("click", () => playCaptured(selected()));
$("mapPlayPhoneme").addEventListener("click", () => playCanonical(selected()));
function renderEditor() {
  const map = selected();
  $("editor").hidden = !map;
  if (!map) return;
  if (!knownSymbol(map.phoneme)) {
    const known = [...$("mapPhoneme").options].some(
      (o) => o.value === map.phoneme,
    );
    if (!known) $("mapPhoneme").append(new Option(map.phoneme, map.phoneme));
  }
  $("mapPhoneme").value = map.phoneme;
  const i = map.input;
  $("inputInfo").textContent = i
    ? `input: tongue ${f2(i.tongueIndex)} / ${f2(i.tongueDiameter)} · tip ${f2(i.constrictionIndex)} / ${f2(i.constrictionDiameter)} · lip ${f2(i.lipDiameter)} · voiceness ${f2(i.voiceness)}`
    : "no input yet: record yourself saying this sound below and pick a frame";
}
function renderAll() {
  renderMaps();
  renderEditor();
  renderSettings();
  renderOutput(null);
  renderTranscript([], "");
}

// ---------------------------------------------------------------- microphone -> Samuel.liveMimic (as in /samuel-live)
let mic = null,
  micBusy = false;
async function refreshMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const select = $("mic"),
    current = select.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput",
  );
  select.replaceChildren(new Option("default microphone", ""));
  devices.forEach((d, i) =>
    select.append(new Option(d.label || `microphone ${i + 1}`, d.deviceId)),
  );
  select.value = devices.some((d) => d.deviceId === current) ? current : "";
}
navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
refreshMics();
async function startMic(handler) {
  if (mic || micBusy) return false;
  micBusy = true;
  try {
    // raw microphone: echo cancellation, noise suppression, auto gain and voice isolation would mute quiet sounds
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: 1,
    };
    if ($("mic").value) audio.deviceId = { exact: $("mic").value };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    refreshMics();
    const [track] = stream.getAudioTracks(),
      now = track.getSettings?.() ?? {};
    const stillOn = [
      "echoCancellation",
      "noiseSuppression",
      "autoGainControl",
      "voiceIsolation",
    ].filter((k) => now[k] === true);
    if (stillOn.length)
      await track
        .applyConstraints(Object.fromEntries(stillOn.map((k) => [k, false])))
        .catch(() => {});
    let context, source;
    try {
      context = new AudioContext({
        sampleRate: 44100,
        latencyHint: "interactive",
      });
      source = context.createMediaStreamSource(stream);
    } catch {
      context?.close();
      context = new AudioContext({ latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
    }
    await context.audioWorklet.addModule(
      new URL("./hop-worklet.js", import.meta.url),
    );
    const node = new AudioWorkletNode(context, "hop-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    source.connect(node);
    await context.resume();
    const liveMimic = samuel.liveMimic({ onFrame: (frame) => handler(frame) });
    node.port.onmessage = (e) => liveMimic.push(e.data);
    mic = { stream, context, source, node, live: liveMimic };
    return true;
  } catch (error) {
    console.error(error);
    setStatus("couldn't use the microphone: " + error.message, true);
    return false;
  } finally {
    micBusy = false;
  }
}
function stopMic() {
  if (!mic) return;
  const { stream, context, source, node, live: liveMimic } = mic;
  mic = null;
  liveMimic.close();
  node.port.onmessage = null;
  source.disconnect();
  node.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  context.close();
}
window.addEventListener("pagehide", stopMic);

/** The level gate /samuel-live uses: opens at the threshold, closes 200 ms after the level drops below 70% of it. */
function makeGate() {
  let open = false,
    quiet = 0;
  const hangover = Math.round(0.2 * FRAME_RATE);
  return (level) => {
    if (!gateEnabled()) return (open = true);
    const threshold = gateRms();
    if (level >= (open ? threshold * 0.7 : threshold)) {
      quiet = 0;
      open = true;
    } else if (open && ++quiet > hangover) open = false;
    return open;
  };
}
const toInput = (p) => ({
  ...Object.fromEntries(INPUT_KEYS.map((k) => [k, p[k]])),
  lipDiameter: p.lipDiameter ?? OPEN_LIP,
  voiceness: clamp(p.voiceness ?? 0, 0, 1),
});

// ---------------------------------------------------------------- capture an input frame from a recording
const MAX_RECORD_FRAMES = Math.round(40 * FRAME_RATE);
let recording = false,
  frames = [],
  cursor = -1,
  recStarted = 0;
const cap = $("cap"),
  capCtx = cap.getContext("2d");
const LINES = [
  ["level", "#9b8fa8"],
  ["voiceness", "#ffd27a"],
  ["tongueIndex", "#f4a7c0"],
  ["tongueDiameter", "#e08aa8"],
  ["constrictionIndex", "#7fd1c7"],
  ["constrictionDiameter", "#5fb1a7"],
  ["lipDiameter", "#ff9f6b"],
];
const RANGE = {
  voiceness: [0, 1],
  tongueIndex: [12, 29],
  tongueDiameter: [2.05, 3.5],
  constrictionIndex: [20, 44],
  constrictionDiameter: [0, 5],
  lipDiameter: [0, 5],
};
const levelLine = (rms) => Math.min(1, Math.sqrt(rms) * 2.5);
function drawCapture() {
  const W = cap.clientWidth,
    H = cap.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (!W) return;
  if (cap.width !== W * dpr) {
    cap.width = W * dpr;
    cap.height = H * dpr;
  }
  capCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  capCtx.clearRect(0, 0, W, H);
  if (!frames.length) return;
  const n = frames.length,
    x = (i) => (n > 1 ? (i / (n - 1)) * (W - 1) : 0);
  for (const [key, color] of LINES) {
    capCtx.beginPath();
    frames.forEach((f, i) => {
      const v =
        key === "level"
          ? levelLine(f.level)
          : (f[key] - RANGE[key][0]) / (RANGE[key][1] - RANGE[key][0]);
      const y = H - 4 - clamp(v, 0, 1) * (H - 8);
      i ? capCtx.lineTo(x(i), y) : capCtx.moveTo(x(i), y);
    });
    capCtx.strokeStyle = color;
    capCtx.lineWidth = key === "level" ? 1 : 1.4;
    capCtx.globalAlpha = key === "level" ? 0.6 : 1;
    capCtx.stroke();
  }
  capCtx.globalAlpha = 1;
  if (gateEnabled()) {
    const ty = H - 4 - levelLine(gateRms()) * (H - 8);
    capCtx.setLineDash([4, 4]);
    capCtx.strokeStyle = "#ffd27a";
    capCtx.lineWidth = 1;
    capCtx.beginPath();
    capCtx.moveTo(0, ty + 0.5);
    capCtx.lineTo(W, ty + 0.5);
    capCtx.stroke();
    capCtx.setLineDash([]);
  }
  if (cursor >= 0) {
    capCtx.strokeStyle = "#fff";
    capCtx.lineWidth = 1.5;
    capCtx.beginPath();
    capCtx.moveTo(x(cursor) + 0.5, 0);
    capCtx.lineTo(x(cursor) + 0.5, H);
    capCtx.stroke();
  }
}
new ResizeObserver(drawCapture).observe(cap);
function showFrame(i, sound) {
  if (!frames.length) return;
  cursor = clamp(i, 0, frames.length - 1);
  const f = frames[cursor];
  $("frameInfo").textContent =
    `frame ${cursor + 1}/${frames.length} · ${(cursor / FRAME_RATE).toFixed(2)} s · tongue ${f2(f.tongueIndex)} / ${f2(f.tongueDiameter)} · tip ${f2(f.constrictionIndex)} / ${f2(f.constrictionDiameter)} · lip ${f2(f.lipDiameter)} · voiceness ${f2(f.voiceness)}`;
  drawCapture();
  refreshButtons();
  if (sound && $("hear").checked) holdPose(f, 450);
}
const frameAt = (e) => {
  const r = cap.getBoundingClientRect();
  return Math.round(
    clamp((e.clientX - r.left) / r.width, 0, 1) * (frames.length - 1),
  );
};
let scrubbing = false;
cap.addEventListener("mousedown", (e) => {
  if (recording || !frames.length) return;
  scrubbing = true;
  showFrame(frameAt(e), true);
});
window.addEventListener("mousemove", (e) => {
  if (scrubbing) showFrame(frameAt(e), true);
});
window.addEventListener("mouseup", () => {
  if (!scrubbing) return;
  scrubbing = false;
  clearTimeout(soundTimer);
  toPT({ intensity: 0 });
});
window.addEventListener("keydown", (e) => {
  if (
    e.target.matches?.("input,select,textarea") ||
    recording ||
    !frames.length
  )
    return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    showFrame(cursor - (e.shiftKey ? 5 : 1), true);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    showFrame(cursor + (e.shiftKey ? 5 : 1), true);
  }
});
async function toggleRecord() {
  if (recording) return finishRecording();
  if (testing || !samuel) return;
  frames = [];
  cursor = -1;
  $("frameInfo").textContent = "recording… say the sound, then stop";
  const ok = await startMic((frame) => {
    pushMeter(frame.level, frame.level >= gateRms());
    frames.push({ ...toInput(frame.params), level: frame.level });
    if (frames.length >= MAX_RECORD_FRAMES) finishRecording();
    else if (frames.length % 4 === 0) drawCapture();
  });
  if (!ok) return;
  recording = true;
  recStarted = performance.now();
  $("rec").classList.add("on");
  const tick = setInterval(() => {
    if (!recording) return clearInterval(tick);
    $("rec").textContent =
      `stop (${((performance.now() - recStarted) / 1000).toFixed(0)} s)`;
  }, 250);
  refreshButtons();
}
function finishRecording() {
  if (!recording) return;
  recording = false;
  stopMic();
  $("rec").classList.remove("on");
  $("rec").textContent = "record";
  if (frames.length) {
    // start on the loudest frame, which is usually in the middle of the sound
    let best = 0;
    frames.forEach((f, i) => {
      if (f.level > frames[best].level) best = i;
    });
    showFrame(best, false);
    $("frameInfo").textContent +=
      " · click or drag the graph, or use ← →, to pick another frame";
  }
  drawCapture();
  refreshButtons();
}
$("rec").addEventListener("click", toggleRecord);
$("useFrame").addEventListener("click", () => {
  const map = selected(),
    f = frames[cursor];
  if (!map || !f) return;
  map.input = Object.fromEntries(
    INPUT_KEYS.map((k) => [k, Math.round(f[k] * 1000) / 1000]),
  );
  renderMaps();
  renderEditor();
  changed();
  setStatus(`captured frame ${cursor + 1} as the input of "${map.phoneme}"`);
});
$("classifyRec").addEventListener("click", () => {
  // the whole recording through the same recogniser test mode uses
  const recognizer = new Recognizer(() => config.maps, settings),
    gate = makeGate();
  for (const f of frames) recognizer.push(f, gate(f.level));
  recognizer.push(frames[0], false); // ends the last phoneme
  renderTranscript(recognizer.transcript, "(from the recording)");
});

// ---------------------------------------------------------------- output: the closest phoneme
const live = new Recognizer(() => config.maps, settings);
function renderOutput(result) {
  const big = $("big"),
    shown = result?.phoneme;
  big.textContent = shown ?? "–";
  big.classList.toggle("dim", !shown || shown === UNKNOWN);
  const top = result?.ranking?.[0];
  $("bigInfo").textContent =
    result && top
      ? result.raw === UNKNOWN
        ? `nothing close enough (nearest ${top.phoneme}, distance ${top.distance.toFixed(2)})`
        : `nearest ${top.phoneme} · distance ${top.distance.toFixed(2)}${result.raw !== shown ? ` · ${result.raw} pending` : ""}`
      : "";
  const box = $("cands");
  box.replaceChildren();
  (result?.ranking ?? []).slice(0, 6).forEach((r, i) => {
    const row = document.createElement("div"),
      sym = document.createElement("span"),
      track = document.createElement("div"),
      fill = document.createElement("div"),
      pct = document.createElement("span");
    row.className = "cand" + (i === 0 ? " top" : "");
    sym.className = "sym ipa";
    sym.textContent = r.phoneme;
    track.className = "track";
    fill.className = "fill";
    fill.style.width = `${Math.round(r.p * 100)}%`;
    pct.textContent = `${Math.round(r.p * 100)}%`;
    track.append(fill);
    row.append(sym, track, pct);
    box.append(row);
  });
}
function renderTranscript(list, source) {
  $("transcriptSource").textContent = source;
  $("transcriptText").textContent = list.map((t) => t.phoneme).join(" ");
  const box = $("transcript");
  box.replaceChildren();
  for (const t of list.slice(-300)) {
    const chip = document.createElement("span"),
      ms = document.createElement("small");
    chip.className = "chip ipa" + (t.phoneme === UNKNOWN ? " q" : "");
    chip.textContent = t.phoneme;
    ms.textContent = `${Math.round(t.frames * FRAME_MS)}`;
    chip.title = `${Math.round(t.frames * FRAME_MS)} ms`;
    chip.append(ms);
    box.append(chip);
  }
  box.scrollTop = box.scrollHeight;
}
$("tClear").addEventListener("click", () => {
  live.transcript.length = 0;
  live.open = false;
  renderTranscript([], "");
});
$("tCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("transcriptText").textContent);
    $("tCopy").textContent = "copied";
  } catch {
    /* no clipboard access */
  }
  setTimeout(() => ($("tCopy").textContent = "Copy IPA"), 1200);
});

// ---------------------------------------------------------------- test mode: live voice -> closest phoneme
let testing = false,
  lastRender = 0,
  testGate = makeGate();
function onTestFrame(frame) {
  const speech = testGate(frame.level);
  pushMeter(frame.level, speech);
  const result = live.push(toInput(frame.params), speech);
  if (
    result.changed &&
    $("testSound").checked &&
    result.phoneme &&
    result.phoneme !== UNKNOWN
  )
    toPT({ phoneme: result.phoneme });
  const now = performance.now();
  if (result.changed || now - lastRender > 80) {
    // the readouts needn't repaint at the frame rate
    lastRender = now;
    renderOutput(speech ? result : null);
    if (result.changed || !speech) renderTranscript(live.transcript, "(live)");
    $("testState").textContent = speech ? "speech" : "quiet";
    let bestId = result.ranking[0]?.mapId;
    for (const map of config.maps) {
      // how far each map is from the smoothed live frame, with the closest one marked
      const el = distEls.get(map.id);
      if (!el) continue;
      el.textContent =
        speech && live.vec && map.input
          ? distance(live.vec, map.input, settings()).toFixed(2)
          : "";
      el.style.fontWeight = map.id === bestId ? "700" : "400";
      el.style.opacity = map.id === bestId ? "1" : "0.6";
    }
  }
}
async function toggleTest() {
  if (testing) return stopTest();
  if (recording || !samuel) return;
  if (!config.maps.some((m) => m.input))
    return setStatus("capture an input for at least one map first", true);
  live.reset();
  testGate = makeGate();
  renderTranscript([], "(live)");
  if (!(await startMic(onTestFrame))) return;
  testing = true;
  $("test").textContent = "stop test mode";
  $("test").classList.add("on");
  setStatus("test mode: speak");
  refreshButtons();
}
function stopTest() {
  if (!testing) return;
  testing = false;
  stopMic();
  if ($("testSound").checked) toPT({ intensity: 0 });
  $("test").textContent = "start test mode";
  $("test").classList.remove("on");
  $("testState").textContent = "";
  renderOutput(null);
  for (const el of distEls.values()) el.textContent = "";
  renderTranscript(live.transcript, "(live)");
  setStatus("ready");
  refreshButtons();
}
$("test").addEventListener("click", toggleTest);

// ---------------------------------------------------------------- settings (stored in the configuration, so they export with it)
const SETTING_UI = {
  tongue: ["sTongue", "vTongue", (v) => v.toFixed(1)],
  front: ["sFront", "vFront", (v) => v.toFixed(1)],
  lip: ["sLip", "vLip", (v) => v.toFixed(1)],
  voice: ["sVoice", "vVoice", (v) => v.toFixed(1)],
  smoothing: ["sSmoothing", "vSmoothing", (v) => v.toFixed(2)],
  stability: ["sStability", "vStability", (v) => String(v)],
  maxDistance: ["sMaxDistance", "vMaxDistance", (v) => v.toFixed(2)],
  sharpness: ["sSharpness", "vSharpness", (v) => v.toFixed(1)],
  gate: ["sGate", "vGate", (v) => `${v} dB`],
};
function renderSettings() {
  for (const [key, [input, label, fmt]] of Object.entries(SETTING_UI)) {
    $(input).value = settings()[key];
    $(label).textContent = fmt(+settings()[key]);
  }
}
for (const [key, [input, label, fmt]] of Object.entries(SETTING_UI)) {
  $(input).addEventListener("input", () => {
    const [lo, hi] = SETTING_RANGES[key];
    settings()[key] = clamp(Number($(input).value), lo, hi);
    $(label).textContent = fmt(settings()[key]);
    changed();
  });
}

// ---------------------------------------------------------------- loudness threshold + level meter (as in /samuel-live)
const meter = $("meter"),
  meterCtx = meter.getContext("2d"),
  MN = 300,
  mLevel = new Float32Array(MN),
  mOpen = new Uint8Array(MN);
let mHead = 0,
  mCount = 0,
  mDirty = true;
const gateRms = () => 10 ** (settings().gate / 20); // the slider is in dB relative to full scale
const gateEnabled = () => $("gateOn").checked;
try {
  $("gateOn").checked = localStorage.getItem("samuel-gate-on") !== "0";
} catch {}
$("gateOn").addEventListener("change", () => {
  try {
    localStorage.setItem("samuel-gate-on", $("gateOn").checked ? "1" : "0");
  } catch {}
  mDirty = true;
  drawCapture();
});
function pushMeter(level, open) {
  mLevel[mHead] = level;
  mOpen[mHead] = open ? 1 : 0;
  mHead = (mHead + 1) % MN;
  mCount = Math.min(MN, mCount + 1);
  mDirty = true;
}
function drawMeter() {
  requestAnimationFrame(drawMeter);
  if (!mDirty) return;
  mDirty = false;
  const W = meter.clientWidth,
    H = meter.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (!W) return;
  if (meter.width !== W * dpr) {
    meter.width = W * dpr;
    meter.height = H * dpr;
  }
  meterCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  meterCtx.clearRect(0, 0, W, H);
  const at = (k) => (mHead - mCount + k + MN) % MN,
    x = (k) => ((MN - mCount + k) / (MN - 1)) * (W - 1),
    y = (rms) => H - 3 - Math.min(1, Math.sqrt(rms) * 2.5) * (H - 6);
  meterCtx.fillStyle = "rgba(143,227,160,.18)";
  for (let k = 0; k < mCount; k++)
    if (mOpen[at(k)]) meterCtx.fillRect(x(k), 0, Math.max(1, W / MN), H); // shaded where speech is detected
  meterCtx.beginPath();
  for (let k = 0; k < mCount; k++)
    k
      ? meterCtx.lineTo(x(k), y(mLevel[at(k)]))
      : meterCtx.moveTo(x(k), y(mLevel[at(k)]));
  meterCtx.strokeStyle = "#9b8fa8";
  meterCtx.lineWidth = 1.4;
  meterCtx.stroke();
  if (gateEnabled()) {
    // the dashed line is the threshold
    meterCtx.setLineDash([5, 4]);
    meterCtx.strokeStyle = "#ffd27a";
    meterCtx.lineWidth = 1;
    meterCtx.beginPath();
    meterCtx.moveTo(0, y(gateRms()) + 0.5);
    meterCtx.lineTo(W, y(gateRms()) + 0.5);
    meterCtx.stroke();
    meterCtx.setLineDash([]);
  }
}
new ResizeObserver(() => {
  mDirty = true;
}).observe(meter);
$("sGate").addEventListener("input", () => {
  mDirty = true;
  drawCapture();
});
drawMeter();

function refreshButtons() {
  const ready =
    Boolean(samuel) &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(window.AudioWorkletNode);
  $("rec").disabled = !ready || testing;
  $("test").disabled = !ready || recording;
  $("mic").disabled = Boolean(mic);
  $("useFrame").disabled = !selected() || cursor < 0 || recording;
  $("classifyRec").disabled =
    !frames.length || recording || !config.maps.some((m) => m.input);
}
refreshButtons();
initConfig();
