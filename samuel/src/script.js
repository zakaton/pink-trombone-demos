import { Samuel, loadOrt } from "./samuel.js";
import * as AK from "./articulation-keyframes.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- state
/** @type {Samuel | null} */
let samuel = null;
/** @type {{ a: object, label: string } | null} */
let current = null; // the latest articulation data
let busy = false;
let rec = null; // active microphone recording

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = isError ? "err" : "";
}
function refreshControls() {
  const idle = Boolean(samuel) && !busy && !rec;
  $("textToArticulation").disabled = !idle;
  $("audioInput").disabled = !idle;
  $("micDevice").disabled = !idle;
  $("record").disabled =
    !samuel || busy || !navigator.mediaDevices?.getUserMedia; // stays enabled while recording, to stop
  for (const id of ["play", "stop", "sendToTimeline"])
    $(id).disabled = !current;
}

// ---------------------------------------------------------------- load the models
(async () => {
  try {
    setStatus("loading Samuel…");
    const ort = await loadOrt({
      base: new URL("./ort/", import.meta.url).href,
    });
    samuel = await Samuel.load({
      ort,
      models: new URL("./models/", import.meta.url).href,
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

if (!AK.cleanupKeyframes) {
  $("simplify").disabled = $("tolerance").disabled = true;
  $("simplify").parentElement.title =
    "needs the newer articulation-keyframes.js (with cleanupKeyframes)";
}

/** Run one generation job with the controls locked and the status updated. */
async function run(label, job) {
  busy = true;
  refreshControls();
  setStatus(label + "…");
  const t0 = performance.now();
  try {
    onArticulationData(await job());
    setStatus(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if ($("autoPlay").checked) playCurrent(); // text, audio files and recordings alike
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error), true);
  } finally {
    busy = false;
    refreshControls();
  }
}

function onArticulationData(articulationData) {
  console.log(articulationData);
  endScrub();
  if (playing) stopPlayback();
  playPos = 0;
  current = {
    a: articulationData,
    full: AK.articulationKeyframes(articulationData),
  }; // full: one keyframe per frame, for scrubbing
  console.log("keyframes", getKeyframes());
  buildViz();
  updateInfo();
  refreshControls();
}

// Samuel's indices are for the default vocal tract length of 44. The chosen length goes out with the keyframes (and
// scrub poses), and Pink Trombone rescales each index by length / 44, so the same articulation lands in the right place
// in a longer or shorter tract. The indices themselves are left as Samuel produced them.
const DEFAULT_TRACT = 44;
function tractLength() {
  return clamp(Math.round(+$("tract").value) || DEFAULT_TRACT, 15, 88);
}

/** Keyframes for the current articulation, simplified if that box is ticked. */
function getKeyframes() {
  let keyframes = AK.articulationKeyframes(current.a, {
    tractLength: tractLength(),
  });
  if ($("simplify").checked && AK.cleanupKeyframes) {
    const tolerance = Math.max(0, +$("tolerance").value || 0) / 100;
    keyframes = AK.cleanupKeyframes(keyframes, { tolerance });
  }
  return keyframes;
}
function updateInfo() {
  if (!current) return ($("info").textContent = "");
  const n = current.a.params.frequency.length;
  $("info").textContent =
    `${n} frames · ${(n / current.a.frame_rate).toFixed(2)} s · ${getKeyframes().length} keyframes`;
}
$("simplify").addEventListener("input", updateInfo);
$("tolerance").addEventListener("input", updateInfo);

// ---------------------------------------------------------------- text
$("text").value = "The smallest possible Samuel.";
function generateFromText() {
  if (!samuel || busy || rec) return;
  setSource(null);
  run("generating", () => samuel.speak($("text").value));
}
$("textToArticulation").addEventListener("click", generateFromText);
// Enter generates (Shift+Enter still adds a line break; Enter while an input method is composing text is left alone)
$("text").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  generateFromText();
});
// remember the play-when-ready choice
try {
  const saved = localStorage.getItem("samuel-autoplay");
  if (saved !== null) $("autoPlay").checked = saved === "1";
} catch (error) {}
$("autoPlay").addEventListener("change", () => {
  try {
    localStorage.setItem("samuel-autoplay", $("autoPlay").checked ? "1" : "0");
  } catch (error) {}
});

// ---------------------------------------------------------------- audio file and microphone
/** Show the audio the articulation was made from, so it can be compared with the result. */
let sourceUrl = null;
function setSource(blob) {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = blob ? URL.createObjectURL(blob) : null;
  $("source").pause();
  $("source").hidden = !blob;
  $("mixControls").hidden = !blob;
  if (blob) $("source").src = sourceUrl;
  else $("source").removeAttribute("src");
}
async function decodeToMono(blob) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++)
        data[i] += channel[i] / buffer.numberOfChannels;
    }
    return { data, sampleRate: buffer.sampleRate };
  } finally {
    context.close();
  }
}
function articulateAudio(blob, label) {
  setSource(blob);
  run(label, async () => {
    const { data, sampleRate } = await decodeToMono(blob);
    return samuel.mimic(data, sampleRate);
  });
}

$("audioInput").addEventListener("change", () => {
  const file = $("audioInput").files[0];
  if (file) articulateAudio(file, "analysing audio");
  $("audioInput").value = "";
});

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

async function startRecording() {
  try {
    // Raw microphone: browsers otherwise apply echo cancellation, noise suppression, auto gain and voice isolation,
    // which gate and reshape the signal and can mute quiet or unvoiced sounds Samuel needs to hear.
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
      // some browsers/devices ignore the request: try once more, then say so
      await track
        .applyConstraints(Object.fromEntries(stillOn.map((k) => [k, false])))
        .catch(() => {});
      const again = track.getSettings?.() ?? {},
        left = stillOn.filter((k) => again[k] === true);
      if (left.length) console.warn("couldn't turn off:", left.join(", "));
    }
    const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 256000 }),
      chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(rec.timer);
      rec = null;
      $("record").textContent = "record";
      $("record").classList.remove("recording");
      refreshControls();
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (blob.size < 1000) return setStatus("nothing was recorded", true);
      articulateAudio(blob, "analysing recording");
    };
    const t0 = performance.now();
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000);
      $("record").textContent =
        `stop (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`;
    };
    rec = { recorder, timer: setInterval(tick, 250) };
    tick();
    $("record").classList.add("recording");
    setStatus("recording…");
    refreshControls();
    recorder.start();
  } catch (error) {
    console.error(error);
    setStatus("couldn't use the microphone: " + error.message, true);
  }
}
$("record").addEventListener("click", () =>
  rec ? rec.recorder.stop() : startRecording(),
);

// ---------------------------------------------------------------- Pink Trombone and the timeline
const { send } = setupConnection("samuel", () => {});
const toPinkTrombone = (message) =>
  send({ to: ["pink-trombone"], type: "message", ...message });

// Playback can be the articulation on Pink Trombone (another tab), the original recording here, or both together.
// It resumes from playPos: where you paused, or where you last clicked on the graphs. Stop rewinds to the start.
// The sync offset lines the recording up with the articulation by ear.
let playing = false,
  playTimers = [],
  playPos = 0;
const hasSource = () => !$("source").hidden;
const mixMode = () => (hasSource() ? $("mix").value : "articulation"); // what the "listen to" menu says to play
/** The keyframes from time T on, starting with an interpolated keyframe at T so playback begins at the right pose. */
function keyframesFrom(keyframes, T) {
  if (T <= 0) return keyframes;
  const i = keyframes.findIndex((k) => k.time > T);
  if (i < 0) return [{ ...keyframes.at(-1), time: 0 }];
  const a = keyframes[Math.max(0, i - 1)],
    b = keyframes[i];
  const u = b.time > a.time ? clamp((T - a.time) / (b.time - a.time), 0, 1) : 0;
  const start = {};
  for (const key of Object.keys(b))
    start[key] =
      typeof b[key] === "number" && typeof a[key] === "number"
        ? a[key] + (b[key] - a[key]) * u
        : b[key];
  start.time = 0;
  return [
    start,
    ...keyframes.slice(i).map((k) => ({ ...k, time: k.time - T })),
  ];
}
function setTract(length) {
  $("tract").value = $("tractSlider").value = clamp(
    Math.round(length) || DEFAULT_TRACT,
    15,
    88,
  );
  toPinkTrombone({ tractLength: tractLength() }); // visible straight away; applies to the next playback or scrub
}
$("tractSlider").addEventListener("input", () =>
  setTract(+$("tractSlider").value),
);
$("tract").addEventListener("change", () => setTract(+$("tract").value));
$("tractReset").addEventListener("click", () => setTract(DEFAULT_TRACT));
function playCurrent() {
  if (!current) return;
  stopAudio();
  const T = playPos >= model.end - 0.02 ? 0 : playPos; // at the very end, start over
  const mode = mixMode();
  const offset = (+$("syncOffset").value || 0) / 1000; // > 0: recording later, < 0: articulation later
  // S is the graph time playback begins at. From the very start it begins early (negative) when the recording leads, so
  // none of the recording is skipped; articulation content at graph time g plays alongside recording content at g - offset.
  const S = T === 0 ? Math.min(0, offset) : T;
  const later = (seconds, fn) =>
    seconds > 0 ? playTimers.push(setTimeout(fn, seconds * 1000)) : fn();
  if (mode === "recording")
    toPinkTrombone({ lastKeyframe: true, intensity: 0 }); // silence anything still playing there
  else
    later(-S, () =>
      toPinkTrombone({
        utterance: {
          name: "samuel",
          keyframes: keyframesFrom(getKeyframes(), T),
        },
      }),
    );
  if (mode !== "articulation") {
    const source = $("source"),
      recPos = S - offset;
    source.volume = +$("mixVolume").value;
    source.currentTime = clamp(recPos, 0, source.duration || Infinity);
    later(-recPos, () =>
      source
        .play()
        .catch((error) => console.warn("couldn't play the recording", error)),
    );
  }
  startPlayhead(S);
}
function stopAudio() {
  playTimers.forEach(clearTimeout);
  playTimers = [];
  $("source").pause();
}
/** Pause: silence everything but remember where we were. */
function pausePlayback() {
  const t = clamp(playT ?? playPos, 0, model.end);
  stopAudio();
  toPinkTrombone({ lastKeyframe: true, intensity: 0 });
  playPos = t;
  stopPlayhead();
}
/** Stop: silence everything and rewind to the start. */
function stopPlayback() {
  stopAudio();
  toPinkTrombone({ lastKeyframe: true, intensity: 0 });
  playPos = 0;
  stopPlayhead();
}
$("play").addEventListener("click", () =>
  playing ? pausePlayback() : playCurrent(),
);
$("stop").addEventListener("click", stopPlayback);
$("mixVolume").addEventListener("input", () => {
  $("source").volume = +$("mixVolume").value;
  if (scrubGain) scrubGain.gain.value = +$("mixVolume").value;
});
// Space toggles playback unless you're typing in a field
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey)
    return;
  if (
    e.target.matches?.(
      "textarea, select, input[type=text], input[type=number], input[type=file]",
    )
  )
    return;
  e.preventDefault(); // also stops a focused button or checkbox from being triggered by the same key
  if (!current) return;
  if (playing) pausePlayback();
  else playCurrent();
});

// Same hand-off the TTS page uses: if /timeline is open it receives this over the channel, otherwise it is opened
// and picks the keyframes up from localStorage when it loads.
const handoff = new BroadcastChannel("timeline-handoff");
let timelineAcked = false;
handoff.onmessage = (e) => {
  if (e.data?.type === "loaded") timelineAcked = true;
};
$("sendToTimeline").addEventListener("click", () => {
  const payload = [{ name: "samuel", keyframes: getKeyframes() }];
  try {
    localStorage.setItem("timeline-inbox", JSON.stringify(payload));
  } catch (error) {
    console.warn(error);
  }
  timelineAcked = false;
  handoff.postMessage({ type: "load", payload });
  setTimeout(() => {
    if (!timelineAcked) window.open("../timeline/", "pink-trombone-timeline");
    $("sendToTimeline").textContent = "sent ✓";
    setTimeout(
      () => ($("sendToTimeline").textContent = "send to timeline"),
      1500,
    );
  }, 400);
});

// ---------------------------------------------------------------- visualization
const LANE = 64,
  RULER = 24;
const FADE = 0.05; // the voice fades out this long after the last frame (as in articulation-keyframes.js)
// [key, label, color, minimum visible span, forced range]
const LANES = [
  ["frequency", "frequency (Hz)", "#c9a7ff", 20],
  ["voiceness", "voiceness", "#ffd27a", 0.1, [0, 1]],
  ["intensity", "intensity", "#ffd27a", 0.1, [0, 1]],
  ["tongueIndex", "tongue index", "#f4a7c0", 2],
  ["tongueDiameter", "tongue diameter", "#f4a7c0", 0.3],
  ["constrictionIndex", "tip constriction index", "#7fd1c7", 2],
  ["constrictionDiameter", "tip constriction diameter", "#7fd1c7", 0.5],
  ["lipDiameter", "lip diameter", "#ff9f6b", 0.5],
];
const canvas = $("vizCanvas"),
  ctx = canvas.getContext("2d");
let lanes = []; // what is drawn for the current articulation
let model = { n: 0, dur: 0, end: 0 };
let hoverT = null,
  playT = null,
  playRaf = 0,
  playStart = 0;

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
const frameTime = (i) => (model.n > 1 ? (i * model.dur) / (model.n - 1) : 0); // same spacing play() uses

function buildViz() {
  const a = current.a,
    n = a.params.frequency.length,
    dur = n / a.frame_rate;
  model = { n, dur, end: dur + FADE };
  lanes = [];
  if (a.input?.length)
    lanes.push({ label: "input audio", color: "#9b8fa8", wave: true });
  for (const [key, label, color, minSpan, forced] of LANES) {
    const values = a.params[key];
    if (!values) continue;
    let lo = Infinity,
      hi = -Infinity;
    for (const v of values) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (forced) {
      lo = Math.min(lo, forced[0]);
      hi = Math.max(hi, forced[1]);
    }
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    lanes.push({ key, label, color, values, lo, hi });
  }
  $("vizLabels").replaceChildren(
    ...lanes.map((lane) => {
      const el = document.createElement("div"),
        name = document.createElement("b"),
        value = document.createElement("span");
      el.className = "lbl";
      el.style.borderLeftColor = lane.color;
      name.textContent = lane.label;
      el.append(name, value);
      lane.valueEl = value;
      return el;
    }),
    Object.assign(document.createElement("div"), {
      style: `height:${RULER}px`,
    }),
  );
  $("viz").classList.add("on");
  drawViz();
  setPlayPos(0);
}

function drawViz() {
  if (!current) return;
  const W = $("vizWrap").clientWidth,
    H = lanes.length * LANE + RULER,
    dpr = window.devicePixelRatio || 1;
  if (!W) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const x = (t) => (t / model.end) * W;
  lanes.forEach((_, i) => {
    ctx.fillStyle = i % 2 ? "#1d1824" : "#211b29";
    ctx.fillRect(0, i * LANE, W, LANE);
  });
  // time grid and ruler
  const step =
    [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((s) => (s / model.end) * W >= 70) ??
    60;
  ctx.font = "11px system-ui";
  ctx.lineWidth = 1;
  for (let t = 0; t <= model.end; t += step) {
    const px = Math.round(x(t)) + 0.5;
    ctx.strokeStyle = "#322a3d";
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, lanes.length * LANE);
    ctx.stroke();
    ctx.fillStyle = "#9b8fa8";
    ctx.fillText(t.toFixed(step < 1 ? 2 : 0) + "s", px + 3, H - 8);
  }
  lanes.forEach((lane, i) => {
    const top = i * LANE,
      pad = 9;
    if (lane.wave) return drawWave(lane, top, W);
    const y = (v) =>
      top +
      LANE -
      pad -
      ((v - lane.lo) / (lane.hi - lane.lo)) * (LANE - 2 * pad);
    ctx.beginPath();
    lane.values.forEach((v, k) =>
      k ? ctx.lineTo(x(frameTime(k)), y(v)) : ctx.moveTo(x(frameTime(k)), y(v)),
    );
    ctx.strokeStyle = lane.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(x(frameTime(model.n - 1)), top + LANE);
    ctx.lineTo(x(0), top + LANE);
    ctx.closePath();
    ctx.fillStyle = lane.color + "26";
    ctx.fill();
    ctx.fillStyle = "#9b8fa8";
    ctx.fillText(fmt(lane.hi), 4, top + 12);
    ctx.fillText(fmt(lane.lo), 4, top + LANE - 4);
  });
  placePlayhead(playT ?? playPos); // the line is positioned in pixels, so follow a resize
}

function drawWave(lane, top, W) {
  const samples = current.a.input,
    rate = 44100,
    mid = top + LANE / 2,
    half = LANE / 2 - 6;
  let peak = 1e-9;
  for (let i = 0; i < samples.length; i++)
    peak = Math.max(peak, Math.abs(samples[i]));
  ctx.fillStyle = lane.color;
  for (let px = 0; px < W; px++) {
    const s0 = Math.floor((px / W) * model.end * rate),
      s1 = Math.min(
        samples.length,
        Math.floor(((px + 1) / W) * model.end * rate),
      );
    if (s0 >= samples.length) break;
    let lo = 0,
      hi = 0;
    for (let s = s0; s < Math.max(s1, s0 + 1); s++) {
      lo = Math.min(lo, samples[s]);
      hi = Math.max(hi, samples[s]);
    }
    ctx.fillRect(
      px,
      mid - (hi / peak) * half,
      1,
      Math.max(1, ((hi - lo) / peak) * half),
    );
  }
}

/** Show each parameter's value at time t in the labels (null clears them). */
function showAt(t) {
  const i =
    t == null
      ? -1
      : clamp(Math.round((t / model.dur) * (model.n - 1)), 0, model.n - 1);
  for (const lane of lanes)
    if (lane.valueEl)
      lane.valueEl.textContent = i < 0 || lane.wave ? "" : fmt(lane.values[i]);
}

const wrap = $("vizWrap");
// Click and drag across the graphs to hear that moment: the frame under the pointer is sent to Pink Trombone as a
// held pose (voice and all), and the voice is silenced on release. Sends are throttled but the latest pose always goes out.
let scrubbing = false,
  scrubMode = "articulation",
  lastScrubSend = 0,
  scrubTimer = 0;

// Hearing the recording while scrubbing: short overlapping grains of the original audio around the pointer, repeated
// while you hold still (like freezing the tape at that spot). Follows the "listen to" menu and the sync offset.
const GRAIN = 0.12,
  GRAIN_EVERY = 0.06,
  GRAIN_FADE = 0.03; // seconds
let scrubCtx = null,
  scrubGain = null,
  scrubLoop = 0,
  scrubPos = 0;
function recordingBuffer() {
  if (!current.buffer) {
    const input = current.a.input; // the 44.1 kHz audio Samuel analysed
    if (!input?.length) return null;
    current.buffer = scrubCtx.createBuffer(1, input.length, 44100);
    current.buffer.copyToChannel(input, 0);
  }
  return current.buffer;
}
function playGrain() {
  const buffer = recordingBuffer();
  if (!buffer) return;
  const offset = (+$("syncOffset").value || 0) / 1000,
    at = scrubPos - offset; // same alignment as playback
  if (at < -0.02 || at > buffer.duration + 0.02) return; // nothing recorded at that point
  const start = clamp(at - GRAIN / 2, 0, Math.max(0, buffer.duration - GRAIN)),
    len = Math.min(GRAIN, buffer.duration - start);
  if (len < GRAIN_FADE * 2) return;
  const now = scrubCtx.currentTime,
    source = scrubCtx.createBufferSource(),
    env = scrubCtx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(1, now + GRAIN_FADE);
  env.gain.setValueAtTime(1, now + len - GRAIN_FADE);
  env.gain.linearRampToValueAtTime(0, now + len);
  source.buffer = buffer;
  source.connect(env);
  env.connect(scrubGain);
  source.start(now, start, len);
}
function startGrains() {
  scrubCtx ??= new AudioContext();
  scrubCtx.resume();
  if (!scrubGain) {
    scrubGain = scrubCtx.createGain();
    scrubGain.connect(scrubCtx.destination);
  }
  scrubGain.gain.value = +$("mixVolume").value;
  playGrain();
  scrubLoop = setInterval(playGrain, GRAIN_EVERY * 1000);
}
function scrubTo(t, first = false) {
  if (!current) return;
  const i = clamp(Math.round((t / model.dur) * (model.n - 1)), 0, model.n - 1);
  const { time, ...pose } = current.full[i]; // the full-rate keyframe for this frame: every parameter, as played
  pose.tractLength = tractLength();
  const message = first ? { ...pose, lastKeyframe: true } : pose; // lastKeyframe also cancels anything still playing
  clearTimeout(scrubTimer);
  const wait = 30 - (performance.now() - lastScrubSend);
  const go = () => {
    lastScrubSend = performance.now();
    toPinkTrombone(message);
  };
  if (first || wait <= 0) go();
  else scrubTimer = setTimeout(go, wait);
}
function endScrub() {
  if (!scrubbing) return;
  scrubbing = false;
  clearTimeout(scrubTimer);
  clearInterval(scrubLoop);
  toPinkTrombone({ intensity: 0 });
}
const timeAt = (e) =>
  clamp(
    ((e.clientX - wrap.getBoundingClientRect().left) / wrap.clientWidth) *
      model.end,
    0,
    model.end,
  );
// Clicking (or dragging) on the graphs moves the playback position to where you let go; if it was playing it carries on
// from there, otherwise press play or Space to start from that spot. With "drag graphs to hear" on you also hear the
// moment under the pointer while you hold it.
let pressed = false,
  resumeAfter = false;
wrap.addEventListener("pointerdown", (e) => {
  if (!current || e.button !== 0) return;
  pressed = true;
  resumeAfter = playing;
  if (playing) pausePlayback();
  scrubPos = timeAt(e);
  setPlayPos(scrubPos);
  wrap.setPointerCapture(e.pointerId);
  if (!$("scrub").checked) return;
  scrubbing = true;
  scrubMode = mixMode();
  if (scrubMode !== "recording") scrubTo(scrubPos, true);
  else toPinkTrombone({ lastKeyframe: true, intensity: 0 }); // recording only: keep Pink Trombone quiet
  if (scrubMode !== "articulation") startGrains();
});
function endPress(resume) {
  if (!pressed) return;
  pressed = false;
  endScrub();
  setPlayPos(scrubPos);
  if (resume && resumeAfter) playCurrent();
}
wrap.addEventListener("pointerup", () => endPress(true));
wrap.addEventListener("pointercancel", () => endPress(false));
wrap.addEventListener("pointermove", (e) => {
  const px = clamp(
    e.clientX - wrap.getBoundingClientRect().left,
    0,
    wrap.clientWidth,
  );
  hoverT = timeAt(e);
  $("hover").style.display = "block";
  $("hover").style.transform = `translateX(${px}px)`;
  showAt(hoverT);
  if (pressed) {
    scrubPos = hoverT;
    setPlayPos(hoverT);
    if (scrubbing && scrubMode !== "recording") scrubTo(hoverT);
  }
});
wrap.addEventListener("mouseleave", () => {
  hoverT = null;
  $("hover").style.display = "none";
  showAt(playT ?? playPos);
});
new ResizeObserver(drawViz).observe(wrap);

// The pink line is always visible: it sits at the playback position, and moves while playing.
function placePlayhead(t) {
  if (!current || !(model.end > 0)) return;
  $("playhead").style.display = "block";
  $("playhead").style.transform =
    `translateX(${(clamp(t, 0, model.end) / model.end) * wrap.clientWidth}px)`;
}
function setPlayPos(t) {
  playPos = t;
  placePlayhead(t);
  if (hoverT == null) showAt(t);
}
function startPlayhead(from) {
  playing = true;
  $("play").textContent = "pause";
  cancelAnimationFrame(playRaf);
  playStart = performance.now();
  const tick = () => {
    const t = from + (performance.now() - playStart) / 1000;
    if (t >= model.end) {
      // finished: rewind
      playPos = 0;
      return stopPlayhead();
    }
    playT = t;
    placePlayhead(t);
    if (hoverT == null) showAt(Math.max(0, t));
    playRaf = requestAnimationFrame(tick);
  };
  tick();
}
function stopPlayhead() {
  playing = false;
  $("play").textContent = "play";
  cancelAnimationFrame(playRaf);
  playT = null;
  if (lanes.length) setPlayPos(playPos);
}

refreshControls();
