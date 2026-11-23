// Live control: microphone -> Samuel.liveMimic -> Pink Trombone, one articulation frame per 512-sample hop.
// Samuel's files are shared with the /samuel page; change this if yours live somewhere else.
const SAMUEL_SRC = new URL("../../samuel/src/", import.meta.url);

let Samuel, loadOrt;

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let samuel = null;
let session = null; // the running microphone session
let sentFrames = 0;

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = isError ? "err" : "";
}

// ---------------------------------------------------------------- load (speech model only: live doesn't need text-to-speech)
(async () => {
  try {
    setStatus("loading Samuel…");
    ({ Samuel, loadOrt } = await import(new URL("samuel.js", SAMUEL_SRC).href));
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
  refreshControls();
})();

function refreshControls() {
  $("start").disabled =
    !samuel ||
    !navigator.mediaDevices?.getUserMedia ||
    !window.AudioWorkletNode;
  $("micDevice").disabled = Boolean(session);
}

// ---------------------------------------------------------------- microphone list
async function refreshMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const select = $("micDevice"),
    selected = select.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput",
  );
  select.replaceChildren(new Option("default microphone", ""));
  devices.forEach((d, i) =>
    select.append(new Option(d.label || `microphone ${i + 1}`, d.deviceId)),
  );
  select.value = devices.some((d) => d.deviceId === selected) ? selected : "";
}
navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
refreshMics();

// ---------------------------------------------------------------- Pink Trombone
const { send } = setupConnection("samuel-live", () => {});
const toPinkTrombone = (message) =>
  send({ to: ["pink-trombone"], type: "message", ...message });
const OPEN_LIP = 3; // what the adapter uses when a frame has no lip diameter
const finite = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(
      ([, v]) => typeof v !== "string" && Number.isFinite(v),
    ),
  );

// Samuel's indices are for the default vocal tract length of 44. Every message carries the chosen length, and Pink Trombone
// rescales each index it receives by length / 44, so the same articulation lands in the right place in a longer or shorter
// tract. The indices are therefore sent as Samuel produced them (scaling them here as well would do it twice).
const DEFAULT_TRACT = 44;
const tractLength = () =>
  clamp(Math.round(+$("tract").value) || DEFAULT_TRACT, 15, 88);
function setTract(length) {
  $("tract").value = $("tractSlider").value = clamp(
    Math.round(length) || DEFAULT_TRACT,
    15,
    88,
  );
  toPinkTrombone({ tractLength: tractLength() }); // visible straight away, and while stopped
}
$("tractSlider").addEventListener("input", () =>
  setTract(+$("tractSlider").value),
);
$("tract").addEventListener("change", () => setTract(+$("tract").value));
$("tractReset").addEventListener("click", () => setTract(DEFAULT_TRACT));

/** One articulation frame as Pink Trombone parameters (the same mapping articulation-keyframes.js uses). */
function frameMessage(p) {
  const voice = Math.max(p.voiceness ?? 0, 0);
  return finite({
    frequency: p.frequency * 2 ** ((+$("transpose").value || 0) / 12),
    tenseness: voice,
    loudness: voice ** 0.25,
    intensity: p.intensity,
    "tongue.index": p.tongueIndex,
    "tongue.diameter": p.tongueDiameter,
    "frontConstriction.index": p.constrictionIndex, // the model's moving tongue-tip constriction
    "frontConstriction.diameter": p.constrictionDiameter,
    "lipConstriction.index": 43,
    "lipConstriction.diameter": p.lipDiameter ?? OPEN_LIP,
    tractLength: tractLength(), // makes Pink Trombone scale the indices above to this length
  });
}

// ---------------------------------------------------------------- speech detection
// Frames are only sent while there is speech: the microphone level (RMS of the hop) must reach the threshold to open the
// gate, and fall below 70% of it for a short while to close it, so quiet moments inside a word don't chop it up.
// Frames carry no "speech" flag of their own, and a pitch-based test would miss unvoiced sounds such as "s" and "f".
const HANGOVER_FRAMES = Math.round(0.2 * (44100 / 512)); // keep sending for 200 ms after the level drops
let gateOpen = false,
  quietFrames = 0;
const gateRms = () => 10 ** ((+$("gate").value || -42) / 20); // the slider is in dB relative to full scale
function updateGate(level) {
  if (!$("gateOn").checked) return (gateOpen = true);
  const open = gateRms();
  if (level >= (gateOpen ? open * 0.7 : open)) {
    quietFrames = 0;
    gateOpen = true;
  } else if (gateOpen && ++quietFrames > HANGOVER_FRAMES) gateOpen = false;
  return gateOpen;
}
function showSpeechState() {
  const el = $("speechState");
  el.textContent = !session
    ? ""
    : !$("gateOn").checked
      ? ""
      : gateOpen
        ? "speech"
        : "silence";
  el.style.color = gateOpen ? "#8fe3a0" : "var(--mute)";
}
$("gate").addEventListener(
  "input",
  () => ($("gateVal").textContent = `${$("gate").value} dB`),
);
$("gateOn").addEventListener("change", showSpeechState);

// ---------------------------------------------------------------- history graphs
const FRAME_RATE = 44100 / 512,
  SECONDS = 8,
  N = Math.ceil(FRAME_RATE * SECONDS),
  LANE = 56;
// [label, color, low, high, value from a frame]
const LANES = [
  ["input level", "#9b8fa8", 0, 1, (f) => levelLane(f.level)],
  ["frequency (Hz)", "#c9a7ff", 70, 500, (f) => f.params.frequency],
  ["voiceness", "#ffd27a", 0, 1, (f) => f.params.voiceness],
  ["intensity", "#ffd27a", 0, 1, (f) => f.params.intensity],
  ["tongue index", "#f4a7c0", 12, 29, (f) => f.params.tongueIndex],
  ["tongue diameter", "#f4a7c0", 2, 3.5, (f) => f.params.tongueDiameter],
  [
    "tip constriction index",
    "#7fd1c7",
    20,
    44,
    (f) => f.params.constrictionIndex,
  ],
  [
    "tip constriction diameter",
    "#7fd1c7",
    0,
    5,
    (f) => f.params.constrictionDiameter,
  ],
  ["lip diameter", "#ff9f6b", 0, 5, (f) => f.params.lipDiameter ?? OPEN_LIP],
];
const history = LANES.map(() => new Float32Array(N));
const voicedHistory = new Uint8Array(N),
  gateHistory = new Uint8Array(N);
const levelLane = (rms) => Math.min(1, Math.sqrt(rms) * 2.5); // how the input level lane scales a level
let written = 0; // frames written so far (the ring buffer position is written % N)
const canvas = $("vizCanvas"),
  ctx = canvas.getContext("2d");
const valueEls = LANES.map(([label, color]) => {
  const el = document.createElement("div"),
    name = document.createElement("b"),
    value = document.createElement("span");
  el.className = "lbl";
  el.style.borderLeftColor = color;
  name.textContent = label;
  el.append(name, value);
  $("vizLabels").append(el);
  return value;
});
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

function record(frame, sending) {
  const i = written % N;
  LANES.forEach(([, , , , get], k) => (history[k][i] = get(frame)));
  voicedHistory[i] = frame.voiced ? 1 : 0;
  gateHistory[i] = sending ? 1 : 0;
  written++;
}
function drawHistory() {
  const W = $("vizWrap").clientWidth,
    H = LANES.length * LANE,
    dpr = window.devicePixelRatio || 1;
  if (!W) return;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const count = Math.min(written, N),
    xOf = (k) => W - ((count - 1 - k) / (N - 1)) * W; // newest at the right edge
  const at = (k) => (written - count + k) % N;
  LANES.forEach(([, color, lo, hi], lane) => {
    const top = lane * LANE,
      pad = 8,
      values = history[lane];
    ctx.fillStyle = lane % 2 ? "#1d1824" : "#211b29";
    ctx.fillRect(0, top, W, LANE);
    if (lane === 0) {
      // input level: shade where speech is detected, and mark the threshold
      ctx.fillStyle = "rgba(143,227,160,.12)";
      for (let k = 0; k < count; k++)
        if (gateHistory[at(k)])
          ctx.fillRect(xOf(k), top, Math.max(1, W / N), LANE);
      if ($("gateOn").checked) {
        const ty = top + LANE - pad - levelLane(gateRms()) * (LANE - 2 * pad);
        ctx.strokeStyle = "rgba(143,227,160,.8)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, ty);
        ctx.lineTo(W, ty);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (lane === 1) {
      // frequency: shade the frames the pitch tracker considers voiced
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let k = 0; k < count; k++)
        if (voicedHistory[at(k)])
          ctx.fillRect(xOf(k), top, Math.max(1, W / N), LANE);
    }
    if (count) {
      const y = (v) =>
        top +
        LANE -
        pad -
        ((clamp(v, lo, hi) - lo) / (hi - lo)) * (LANE - 2 * pad);
      ctx.beginPath();
      for (let k = 0; k < count; k++)
        k
          ? ctx.lineTo(xOf(k), y(values[at(k)]))
          : ctx.moveTo(xOf(k), y(values[at(k)]));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      valueEls[lane].textContent = fmt(values[at(count - 1)]);
    }
    ctx.fillStyle = "#9b8fa8";
    ctx.font = "10px system-ui";
    ctx.fillText(fmt(hi), 4, top + 11);
    ctx.fillText(fmt(lo), 4, top + LANE - 3);
  });
}
let drawRaf = 0;
const drawLoop = () => {
  drawHistory();
  drawRaf = requestAnimationFrame(drawLoop);
};
new ResizeObserver(drawHistory).observe($("vizWrap"));
drawHistory();

// ---------------------------------------------------------------- start and stop
async function start() {
  $("start").disabled = true;
  try {
    // Raw microphone: echo cancellation, noise suppression, auto gain and voice isolation would gate and reshape the
    // signal, muting quiet and unvoiced sounds that Samuel needs to hear.
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: 1,
    };
    if ($("micDevice").value) audio.deviceId = { exact: $("micDevice").value };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    refreshMics(); // device names are only available once permission has been given
    const [track] = stream.getAudioTracks(),
      settings = track.getSettings?.() ?? {};
    console.log("microphone settings", settings);
    const stillOn = [
      "echoCancellation",
      "noiseSuppression",
      "autoGainControl",
      "voiceIsolation",
    ].filter((k) => settings[k] === true);
    if (stillOn.length) {
      await track
        .applyConstraints(Object.fromEntries(stillOn.map((k) => [k, false])))
        .catch(() => {});
      const left = stillOn.filter((k) => track.getSettings?.()[k] === true);
      if (left.length) console.warn("couldn't turn off:", left.join(", "));
    }

    // 44.1 kHz where the browser allows it; otherwise the worklet resamples from the device rate
    let context, source;
    try {
      context = new AudioContext({
        sampleRate: 44100,
        latencyHint: "interactive",
      });
      source = context.createMediaStreamSource(stream);
    } catch (error) {
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

    sentFrames = 0;
    written = 0;
    gateOpen = false;
    quietFrames = 0;
    const live = samuel.liveMimic({ onFrame });
    node.port.onmessage = (e) => live.push(e.data);
    session = { stream, context, source, node, live };
    // start from a known state: the back constriction isn't used by Samuel, and anything still playing is cancelled
    toPinkTrombone({
      lastKeyframe: true,
      "backConstriction.index": 10.5,
      "backConstriction.diameter": 5,
    });
    $("start").textContent = "stop";
    $("start").classList.add("on");
    showSpeechState();
    setStatus(`listening (${Math.round(context.sampleRate)} Hz)`);
    drawRaf = requestAnimationFrame(drawLoop);
  } catch (error) {
    console.error(error);
    setStatus("couldn't use the microphone: " + error.message, true);
  }
  refreshControls();
  $("start").disabled = !samuel;
}

function onFrame(frame) {
  const wasOpen = gateOpen,
    speech = updateGate(frame.level);
  record(frame, speech);
  if ($("send").checked) {
    if (speech) {
      toPinkTrombone(frameMessage(frame.params));
      sentFrames++;
    } else if (wasOpen) toPinkTrombone({ intensity: 0 }); // speech just ended: silence the voice once, then send nothing
  }
  if (wasOpen !== speech) showSpeechState();
  $("stats").textContent =
    `${sentFrames} frames sent · ${session?.live.dropped ?? 0} dropped`;
}

function stop() {
  if (!session) return;
  const { stream, context, source, node, live } = session;
  session = null;
  live.close();
  node.port.onmessage = null;
  source.disconnect();
  node.disconnect();
  stream.getTracks().forEach((track) => track.stop());
  context.close();
  cancelAnimationFrame(drawRaf);
  drawHistory();
  toPinkTrombone({ intensity: 0 });
  $("start").textContent = "start";
  $("start").classList.remove("on");
  setStatus("stopped");
  gateOpen = false;
  showSpeechState();
  refreshControls();
}
$("start").addEventListener("click", () => (session ? stop() : start()));
$("send").addEventListener("change", () => {
  if (!$("send").checked) toPinkTrombone({ intensity: 0 });
});
window.addEventListener("pagehide", stop);
