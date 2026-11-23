// Map Samuel's articulation (tongue, front constriction, lip) onto a Ready Player Me avatar's morph targets.
// A map = one captured articulation frame + the morph target values to show for it. Test mode blends the nearest maps live.
import {
  DIMENSIONS,
  INPUT_KEYS,
  DEFAULT_SETTINGS,
  SETTING_RANGES,
  emptyConfig,
  normalizeConfig,
  newId,
  blend,
} from "./mapping.js";

// Samuel's files are shared with the /samuel page; change this if yours live somewhere else.
const SAMUEL_SRC = new URL("../../samuel/src/", import.meta.url);
// the avatar the old lip-sync page used; override with ?avatar=URL or the "Load avatar" button
const DEFAULT_AVATAR = new URL("../../lip-sync/avatar.glb", import.meta.url)
  .href;
// an optional reference configuration, used when this browser has none of its own
const REFERENCE_CONFIG = new URL("../morphtargets.json", import.meta.url).href;
const STORE = "samuel-morphtargets-config";
const FRAME_RATE = 44100 / 512,
  OPEN_LIP = 3;

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const setStatus = (text, isError = false) => {
  $("status").textContent = text;
  $("status").className = isError ? "err" : "mute";
};
/** Two clicks to confirm, instead of a confirm() dialog that some browsers suppress. */
function armed(button, label, action) {
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

// ---------------------------------------------------------------- Samuel (speech model only: no text-to-speech needed)
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

// ---------------------------------------------------------------- configuration
let config = emptyConfig();
let selectedId = null;
const selected = () => config.maps.find((m) => m.id === selectedId) ?? null;
const settings = () => config.settings;
let saveTimer = 0;
function changed() {
  // every edit lands here: remember it in this browser
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
  if (!config.targets.length && targetNames.length)
    config.targets = presetTargets(/mouth|jaw|viseme|tongue/i);
  $("cfgName").value = config.name;
  $("cfgInfo").textContent = info ?? "";
  renderAll();
  applyPose(selected()?.targets ?? {});
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
          "Loaded the reference configuration (morphtargets.json). Your edits are saved in this browser, not in that file.";
      }
    } catch {}
  }
  if (!loaded) {
    loaded = emptyConfig();
    info =
      "No saved or reference configuration yet. Choose the morph targets to use, add a map for each mouth shape, set its sliders, then capture its input from your voice.";
  }
  setConfig(loaded, info);
}

$("cfgName").addEventListener("input", () => {
  config.name = $("cfgName").value;
  changed();
});
$("cfgExport").addEventListener("click", () =>
  download(
    (config.name || "morphtargets").replace(/[^\w.-]+/g, "-") + ".json",
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

// ---------------------------------------------------------------- avatar
const avatarEl = $("avatar");
let morphMeshes = []; // every mesh that has morph targets (head, teeth, ...): the same name is set on all of them
let targetNames = []; // union of their morph target names, in the avatar's own order
avatarEl.addEventListener("model-loaded", () => {
  morphMeshes = [];
  avatarEl.object3D.traverse((o) => {
    if (o.morphTargetDictionary && o.morphTargetInfluences) morphMeshes.push(o);
  });
  const names = [];
  morphMeshes.forEach((m) =>
    Object.keys(m.morphTargetDictionary).forEach(
      (n) => names.includes(n) || names.push(n),
    ),
  );
  targetNames = names;
  $("avatarInfo").textContent =
    `${names.length} morph targets on ${morphMeshes.length} mesh${morphMeshes.length === 1 ? "" : "es"}`;
  if (!config.targets.length && names.length)
    config.targets = presetTargets(/mouth|jaw|viseme|tongue/i);
  renderTargets();
  renderEditor();
  applyPose(selected()?.targets ?? {});
});
avatarEl.addEventListener("model-error", () => {
  $("avatarInfo").textContent = 'couldn\'t load the avatar (use "Load avatar")';
  $("avatarInfo").className = "err";
});
function loadAvatar(url) {
  $("avatarInfo").className = "mute";
  $("avatarInfo").textContent = "loading avatar…";
  avatarEl.setAttribute("gltf-model", url);
}
loadAvatar(
  new URLSearchParams(location.search).get("avatar") || DEFAULT_AVATAR,
);
$("avatarLoad").addEventListener("click", () => $("avatarFile").click());
$("avatarFile").addEventListener("change", () => {
  const f = $("avatarFile").files[0];
  $("avatarFile").value = "";
  if (f) loadAvatar(URL.createObjectURL(f));
});

function setInfluence(name, value) {
  for (const mesh of morphMeshes) {
    const i = mesh.morphTargetDictionary[name];
    if (i !== undefined) mesh.morphTargetInfluences[i] = value;
  }
}
/** Show these morph target values; every target in use that isn't mentioned goes to 0. */
function applyPose(values) {
  for (const name of config.targets) setInfluence(name, values[name] ?? 0);
}
const presetTargets = (pattern) => targetNames.filter((n) => pattern.test(n));

// ---------------------------------------------------------------- which morph targets to use
function renderTargets() {
  const list = $("tlist");
  list.replaceChildren();
  for (const name of targetNames) {
    const label = document.createElement("label"),
      box = document.createElement("input");
    box.type = "checkbox";
    box.checked = config.targets.includes(name);
    label.title = name;
    box.addEventListener("change", () => {
      if (box.checked)
        config.targets = targetNames.filter(
          (n) => n === name || config.targets.includes(n),
        );
      else {
        config.targets = config.targets.filter((n) => n !== name);
        setInfluence(name, 0);
      }
      renderEditor();
      changed();
      countTargets();
    });
    label.append(box, " " + name);
    label.dataset.name = name.toLowerCase();
    list.append(label);
  }
  filterTargets();
  countTargets();
}
function filterTargets() {
  const q = $("tFilter").value.trim().toLowerCase();
  for (const l of $("tlist").children)
    l.hidden = q && !l.dataset.name.includes(q);
}
const countTargets = () =>
  ($("tCount").textContent = targetNames.length
    ? `${config.targets.filter((n) => targetNames.includes(n)).length} of ${targetNames.length} in use`
    : "waiting for the avatar");
function useTargets(names) {
  for (const n of config.targets) if (!names.includes(n)) setInfluence(n, 0);
  config.targets = names;
  renderTargets();
  renderEditor();
  applyPose(selected()?.targets ?? {});
  changed();
}
$("tFilter").addEventListener("input", filterTargets);
$("tMouth").addEventListener("click", () =>
  useTargets(presetTargets(/mouth|jaw|viseme|tongue/i)),
);
$("tAll").addEventListener("click", () => useTargets([...targetNames]));
$("tNone").addEventListener("click", () => useTargets([]));

// ---------------------------------------------------------------- maps
const bars = new Map(); // map id -> its weight bar in the list (test mode)
function renderMaps() {
  const box = $("maps");
  box.replaceChildren();
  bars.clear();
  for (const map of config.maps) {
    const row = document.createElement("div"),
      dot = document.createElement("span"),
      name = document.createElement("span"),
      bar = document.createElement("div");
    row.className = "map" + (map.id === selectedId ? " sel" : "");
    dot.className = "dot" + (map.input ? " ok" : "");
    name.className = "name";
    name.textContent = map.name;
    dot.title = map.input ? "has an input" : "no input captured yet";
    bar.className = "bar";
    bars.set(map.id, bar);
    const play = document.createElement("button"),
      del = document.createElement("button");
    play.textContent = "▶";
    play.title = "play its sound";
    del.textContent = "✕";
    del.title = "delete";
    play.addEventListener("click", (e) => {
      e.stopPropagation();
      playMapSound(map);
    });
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteMap(map);
    });
    row.append(dot, name, play, del, bar);
    row.addEventListener("click", () => selectMap(map.id, true));
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
  const map = selected();
  if (map && !testing) applyPose(map.targets);
  if (map && hear) playMapSound(map);
  refreshButtons();
}
function addMap() {
  const map = {
    id: newId(),
    name: `map ${config.maps.length + 1}`,
    input: null,
    targets: {},
  };
  config.maps.push(map);
  selectMap(map.id, false);
  changed();
  $("mapName").focus();
  $("mapName").select();
}
function deleteMap(map) {
  config.maps = config.maps.filter((m) => m !== map);
  if (selectedId === map.id) selectedId = config.maps[0]?.id ?? null;
  renderMaps();
  renderEditor();
  applyPose(selected()?.targets ?? {});
  changed();
}
$("mapAdd").addEventListener("click", addMap);
armed($("mapDel"), "Delete", () => {
  const m = selected();
  if (m) deleteMap(m);
});
$("mapDup").addEventListener("click", () => {
  const m = selected();
  if (!m) return;
  const copy = {
    id: newId(),
    name: m.name + " copy",
    input: m.input ? { ...m.input } : null,
    targets: { ...m.targets },
  };
  config.maps.splice(config.maps.indexOf(m) + 1, 0, copy);
  selectMap(copy.id, false);
  changed();
});
$("mapName").addEventListener("input", () => {
  const m = selected();
  if (!m) return;
  m.name = $("mapName").value;
  renderMaps();
  changed();
});
$("mapPlay").addEventListener("click", () => {
  const m = selected();
  if (m) playMapSound(m);
});
$("slidersReset").addEventListener("click", () => {
  const m = selected();
  if (!m) return;
  m.targets = {};
  applyPose({});
  renderEditor();
  changed();
});

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "–");
function renderEditor() {
  const map = selected();
  $("editor").hidden = !map;
  if (!map) return;
  if (document.activeElement !== $("mapName")) $("mapName").value = map.name;
  const i = map.input;
  $("inputInfo").textContent = i
    ? `input: tongue ${f2(i.tongueIndex)} / ${f2(i.tongueDiameter)} · tip ${f2(i.constrictionIndex)} / ${f2(i.constrictionDiameter)} · lip ${f2(i.lipDiameter)}`
    : "no input yet: record your voice below and pick a frame";
  const box = $("sliders");
  box.replaceChildren();
  for (const name of config.targets) {
    if (!targetNames.includes(name)) continue;
    const row = document.createElement("label"),
      text = document.createElement("span"),
      range = document.createElement("input"),
      number = document.createElement("input");
    row.className = "slider";
    text.textContent = name;
    text.title = name;
    range.type = "range";
    number.type = "number";
    for (const input of [range, number]) {
      input.min = -1;
      input.max = 1;
      input.step = 0.01;
      input.value = map.targets[name] ?? 0;
    }
    const set = (e) => {
      const v = clamp(Number(e.target.value) || 0, -1, 1);
      range.value = number.value = v;
      if (Math.abs(v) < 0.0005) delete map.targets[name];
      else map.targets[name] = v;
      setInfluence(name, v);
      changed();
    };
    range.addEventListener("input", set);
    number.addEventListener("input", set);
    row.append(text, range, number);
    box.append(row);
  }
  if (!config.targets.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Choose morph targets to use above.";
    box.append(p);
  }
}
function renderAll() {
  renderTargets();
  renderMaps();
  renderEditor();
  renderSettings();
}

// ---------------------------------------------------------------- Pink Trombone
const { send } = setupConnection("samuel-morphtargets", () => {});
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
  // sustain one articulation pose for a moment, then silence
  clearTimeout(soundTimer);
  toPT(frameMessage(p));
  soundTimer = setTimeout(() => toPT({ intensity: 0 }), ms);
}
function playMapSound(map) {
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

// ---------------------------------------------------------------- microphone -> Samuel.liveMimic (as in /samuel-live)
let mic = null,
  micBusy = false;
async function refreshMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const select = $("mic"),
    selectedDevice = select.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput",
  );
  select.replaceChildren(new Option("default microphone", ""));
  devices.forEach((d, i) =>
    select.append(new Option(d.label || `microphone ${i + 1}`, d.deviceId)),
  );
  select.value = devices.some((d) => d.deviceId === selectedDevice)
    ? selectedDevice
    : "";
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
    const live = samuel.liveMimic({ onFrame: (frame) => handler(frame) });
    node.port.onmessage = (e) => live.push(e.data);
    mic = { stream, context, source, node, live };
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
  const { stream, context, source, node, live } = mic;
  mic = null;
  live.close();
  node.port.onmessage = null;
  source.disconnect();
  node.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  context.close();
}
window.addEventListener("pagehide", stopMic);

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
  ["tongueIndex", "#f4a7c0"],
  ["tongueDiameter", "#e08aa8"],
  ["constrictionIndex", "#7fd1c7"],
  ["constrictionDiameter", "#5fb1a7"],
  ["lipDiameter", "#ff9f6b"],
];
const RANGE = {
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
    `frame ${cursor + 1}/${frames.length} · ${(cursor / FRAME_RATE).toFixed(2)} s · tongue ${f2(f.tongueIndex)} / ${f2(f.tongueDiameter)} · tip ${f2(f.constrictionIndex)} / ${f2(f.constrictionDiameter)} · lip ${f2(f.lipDiameter)} · ${f.frequency.toFixed(0)} Hz`;
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
  $("frameInfo").textContent = "recording… make the sound, then stop";
  const ok = await startMic((frame) => {
    const p = frame.params;
    frames.push({
      ...Object.fromEntries(INPUT_KEYS.map((k) => [k, p[k]])),
      lipDiameter: p.lipDiameter ?? OPEN_LIP,
      level: frame.level,
    });
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
  setStatus(`captured frame ${cursor + 1} as the input of "${map.name}"`);
});

// ---------------------------------------------------------------- test mode: live voice -> blended morph targets
let testing = false,
  gateOpen = false,
  quietFrames = 0,
  lastBarUpdate = 0;
const smoothed = {}; // current value of every target in use
const HANGOVER_FRAMES = Math.round(0.2 * FRAME_RATE);
function updateGate(level) {
  // the same level gate as /samuel-live: opens at the threshold, closes 200 ms after it drops below 70% of it
  const open = 10 ** (settings().gate / 20);
  if (level >= (gateOpen ? open * 0.7 : open)) {
    quietFrames = 0;
    gateOpen = true;
  } else if (gateOpen && ++quietFrames > HANGOVER_FRAMES) gateOpen = false;
  return gateOpen;
}
function onTestFrame(frame) {
  const wasOpen = gateOpen,
    speech = updateGate(frame.level),
    p = { ...frame.params, lipDiameter: frame.params.lipDiameter ?? OPEN_LIP };
  const result = speech ? blend(p, config.maps, settings()) : null,
    target = result?.values ?? {},
    k = 1 - settings().smoothing;
  for (const name of config.targets) {
    smoothed[name] =
      (smoothed[name] ?? 0) + ((target[name] ?? 0) - (smoothed[name] ?? 0)) * k;
    setInfluence(name, smoothed[name]);
  }
  if ($("testSound").checked) {
    if (speech) toPT(frameMessage(p));
    else if (wasOpen) toPT({ intensity: 0 });
  }
  const now = performance.now();
  if (now - lastBarUpdate > 80) {
    lastBarUpdate = now;
    for (const [id, bar] of bars)
      bar.style.width = `${Math.round((result?.weights.get(id) ?? 0) * 100)}%`;
    $("testState").textContent = speech ? "speech" : "quiet";
  }
}
async function toggleTest() {
  if (testing) return stopTest();
  if (recording || !samuel) return;
  if (!config.maps.some((m) => m.input))
    return setStatus("capture an input for at least one map first", true);
  config.targets.forEach((n) => (smoothed[n] = 0));
  gateOpen = false;
  quietFrames = 0;
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
  for (const bar of bars.values()) bar.style.width = "0";
  applyPose(selected()?.targets ?? {});
  setStatus("ready");
  refreshButtons();
}
$("test").addEventListener("click", toggleTest);

// settings sliders (stored in the configuration, so they export with it)
const SETTING_UI = {
  neighbours: ["sNeighbours", "vNeighbours", (v) => String(v)],
  power: ["sPower", "vPower", (v) => v.toFixed(2)],
  tongue: ["sTongue", "vTongue", (v) => v.toFixed(1)],
  front: ["sFront", "vFront", (v) => v.toFixed(1)],
  lip: ["sLip", "vLip", (v) => v.toFixed(1)],
  smoothing: ["sSmoothing", "vSmoothing", (v) => v.toFixed(2)],
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

function refreshButtons() {
  const ready =
    Boolean(samuel) &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(window.AudioWorkletNode);
  $("rec").disabled = !ready || testing;
  $("test").disabled = !ready || recording;
  $("mic").disabled = Boolean(mic);
  $("useFrame").disabled = !selected() || cursor < 0 || recording;
}
refreshButtons();

initConfig();
