// Live chat: microphone -> Samuel.liveMimic -> simplified keys -> PeerJS -> partner's Pink Trombone.
// Only articulation data crosses the network. Your own voice never plays on your own Pink Trombone.
import { CHANNELS, Encoder, Playout, pack } from "./stream.js";

// Samuel's files are shared with the /samuel page; change this if yours live somewhere else.
const SAMUEL_SRC = new URL("../../samuel/src/", import.meta.url);
let Samuel, loadOrt;

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HOP_MS = (512 / 44100) * 1000,
  FRAME_RATE = 1000 / HOP_MS;

let samuel = null,
  session = null;

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = isError ? "err" : "";
}

// ---------------------------------------------------------------- load Samuel (speech model only)
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
    setStatus(
      window.Peer ? "ready" : "couldn't load PeerJS (is unpkg.com reachable?)",
      !window.Peer,
    );
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

// ---------------------------------------------------------------- Pink Trombone (receiving side)
const { send } = setupConnection("samuel-live-chat", () => {});
const toPinkTrombone = (message) =>
  send({ to: ["pink-trombone"], type: "message", ...message });
const DEFAULT_TRACT = 44;
// Indices are sent as Samuel produced them; Pink Trombone rescales each by tractLength / 44 itself.
const tractLength = () =>
  clamp(Math.round(+$("tract").value) || DEFAULT_TRACT, 15, 88);
function setTract(length) {
  $("tract").value = $("tractSlider").value = clamp(
    Math.round(length) || DEFAULT_TRACT,
    15,
    88,
  );
  toPinkTrombone({ tractLength: tractLength() });
}
$("tractSlider").addEventListener("input", () =>
  setTract(+$("tractSlider").value),
);
$("tract").addEventListener("change", () => setTract(+$("tract").value));
$("tractReset").addEventListener("click", () => setTract(DEFAULT_TRACT));
const delayMs = () => +$("delay").value || 150;
$("delay").addEventListener(
  "input",
  () => ($("delayVal").textContent = `${delayMs()} ms`),
);

function frameMessage(p) {
  const voice = Math.max(p.voiceness ?? 0, 0);
  return {
    frequency: p.frequency * 2 ** ((+$("transpose").value || 0) / 12),
    tenseness: voice,
    loudness: voice ** 0.25,
    intensity: p.intensity,
    "tongue.index": p.tongueIndex,
    "tongue.diameter": p.tongueDiameter,
    "frontConstriction.index": p.constrictionIndex,
    "frontConstriction.diameter": p.constrictionDiameter,
    "lipConstriction.index": 43,
    "lipConstriction.diameter": p.lipDiameter,
    tractLength: tractLength(),
  };
}

// ---------------------------------------------------------------- history graphs
const SECONDS = 8,
  N = Math.ceil(FRAME_RATE * SECONDS),
  LANE = 44;
function makeGraph(canvas, labelsEl, lanes) {
  // lanes: [label, color, low, high]; a lane with shade:true shades the frames where speech was detected
  const hist = lanes.map(() => new Float32Array(N)),
    marks = lanes.map(() => new Uint8Array(N)),
    shade = new Uint8Array(N),
    times = new Float64Array(N);
  let written = 0,
    extra = null;
  const ctx = canvas.getContext("2d");
  const valueEls = lanes.map(([label, color]) => {
    const el = document.createElement("div"),
      name = document.createElement("b"),
      value = document.createElement("span");
    el.className = "lbl";
    el.style.borderLeftColor = color;
    name.textContent = label;
    el.append(name, value);
    labelsEl.append(el);
    return value;
  });
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  return {
    record(values, shaded, t) {
      const i = written % N;
      values.forEach((v, k) => {
        hist[k][i] = v;
        marks[k][i] = 0;
      });
      shade[i] = shaded ? 1 : 0;
      times[i] = t;
      written++;
    },
    mark(lane, t) {
      // a key that was sent: dot it on the frame whose time is closest before t
      let k = written - 1;
      while (k > written - N && k >= 0 && times[k % N] > t) k--;
      if (k >= 0 && k > written - N) marks[lane][k % N] = 1;
    },
    setExtra(fn) {
      extra = fn;
    },
    draw() {
      const W = canvas.parentElement.clientWidth,
        H = lanes.length * LANE,
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
        xOf = (k) => W - ((count - 1 - k) / (N - 1)) * W,
        at = (k) => (written - count + k) % N;
      lanes.forEach(([, color, lo, hi, shaded], lane) => {
        const top = lane * LANE,
          pad = 6,
          values = hist[lane],
          y = (v) =>
            top +
            LANE -
            pad -
            ((clamp(v, lo, hi) - lo) / (hi - lo)) * (LANE - 2 * pad);
        ctx.fillStyle = lane % 2 ? "#1d1824" : "#211b29";
        ctx.fillRect(0, top, W, LANE);
        if (shaded) {
          ctx.fillStyle = "rgba(143,227,160,.12)";
          for (let k = 0; k < count; k++)
            if (shade[at(k)])
              ctx.fillRect(xOf(k), top, Math.max(1, W / N), LANE);
          const ty = extra?.();
          if (ty != null) {
            ctx.strokeStyle = "rgba(143,227,160,.8)";
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(0, top + LANE - pad - ty * (LANE - 2 * pad));
            ctx.lineTo(W, top + LANE - pad - ty * (LANE - 2 * pad));
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        if (count) {
          ctx.beginPath();
          for (let k = 0; k < count; k++)
            k
              ? ctx.lineTo(xOf(k), y(values[at(k)]))
              : ctx.moveTo(xOf(k), y(values[at(k)]));
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          for (let k = 0; k < count; k++)
            if (marks[lane][at(k)]) {
              ctx.beginPath();
              ctx.arc(xOf(k), y(values[at(k)]), 2.4, 0, 7);
              ctx.fill();
            }
          valueEls[lane].textContent = fmt(values[at(count - 1)]);
        }
        ctx.fillStyle = "#9b8fa8";
        ctx.font = "10px system-ui";
        ctx.fillText(fmt(hi), 4, top + 10);
        ctx.fillText(fmt(lo), 4, top + LANE - 3);
      });
    },
  };
}
const levelLane = (rms) => Math.min(1, Math.sqrt(rms) * 2.5);
const RANGES = {
  frequency: [70, 500],
  voiceness: [0, 1],
  intensity: [0, 1],
  tongueIndex: [12, 29],
  tongueDiameter: [2, 3.5],
  constrictionIndex: [20, 44],
  constrictionDiameter: [0, 5],
  lipDiameter: [0, 5],
};
const LABELS = {
  frequency: "frequency (Hz)",
  voiceness: "voiceness",
  intensity: "intensity",
  tongueIndex: "tongue index",
  tongueDiameter: "tongue diameter",
  constrictionIndex: "tip constriction index",
  constrictionDiameter: "tip constriction diameter",
  lipDiameter: "lip diameter",
};
const COLORS = [
  "#c9a7ff",
  "#ffd27a",
  "#ffd27a",
  "#f4a7c0",
  "#f4a7c0",
  "#7fd1c7",
  "#7fd1c7",
  "#ff9f6b",
];
const paramLanes = CHANNELS.map((c, i) => [
  LABELS[c.name],
  COLORS[i],
  ...RANGES[c.name],
]);
const txGraph = makeGraph($("txCanvas"), $("txLabels"), [
  ["input level", "#9b8fa8", 0, 1, true],
  ...paramLanes,
]);
const rxGraph = makeGraph($("rxCanvas"), $("rxLabels"), paramLanes);
txGraph.setExtra(() => ($("gateOn").checked ? levelLane(gateRms()) : null));

// ---------------------------------------------------------------- speech detection (same gate as /samuel-live)
const HANGOVER_FRAMES = Math.round(0.2 * FRAME_RATE);
let gateOpen = false,
  quietFrames = 0;
const gateRms = () => 10 ** ((+$("gate").value || -42) / 20);
function updateGate(level) {
  if (!$("gateOn").checked) return (gateOpen = true);
  const open = gateRms();
  if (level >= (gateOpen ? open * 0.7 : open)) {
    quietFrames = 0;
    gateOpen = true;
  } else if (gateOpen && ++quietFrames > HANGOVER_FRAMES) gateOpen = false;
  return gateOpen;
}
function showSpeechState(sending) {
  const el = $("speechState");
  el.textContent = !session
    ? ""
    : $("mute").checked
      ? "muted"
      : sending
        ? "speech"
        : "silence";
  el.style.color = sending ? "#8fe3a0" : "var(--mute)";
}
$("gate").addEventListener(
  "input",
  () => ($("gateVal").textContent = `${$("gate").value} dB`),
);

// ---------------------------------------------------------------- peer connection
const CODE_PREFIX = "ptchat-",
  CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const randomCode = () =>
  Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join("");
const cleanCode = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^.*join=/, "")
    .replace(CODE_PREFIX, "")
    .replace(/[^a-z0-9]/g, "");
let peer = null,
  conn = null,
  roomCode = "";
const connOpen = () => Boolean(conn?.open);

function setConn(text, isError = false) {
  $("conn").textContent = text;
  $("conn").className = isError ? "err" : "mute";
}
function showRoom(inRoom) {
  $("create").hidden = $("joinCode").hidden = $("join").hidden = inRoom;
  document.querySelector("#create + .mute").hidden = inRoom;
  $("leave").hidden = !inRoom;
  $("code").textContent = roomCode;
  $("copyLink").hidden = !roomCode || !inRoom;
}
function leave() {
  try {
    conn?.close();
  } catch {}
  try {
    peer?.destroy();
  } catch {}
  conn = peer = null;
  roomCode = "";
  endPlayback();
  showRoom(false);
  setConn("");
}
function newPeer(id) {
  if (!window.Peer) {
    setConn(
      "PeerJS didn't load, so there is no connection (is unpkg.com reachable?)",
      true,
    );
    return null;
  }
  return new Peer(id, { debug: 1 });
}
function createRoom(attempt = 0) {
  leave();
  roomCode = randomCode();
  peer = newPeer(CODE_PREFIX + roomCode);
  if (!peer) return;
  const mine = peer;
  setConn("creating room…");
  peer.on("open", () => {
    if (peer !== mine) return;
    showRoom(true);
    setConn("waiting for your partner… send them the code or invite link");
  });
  peer.on("connection", (c) => {
    if (connOpen()) {
      c.on("open", () => c.close());
      return;
    } // two people only
    attach(c);
  });
  peer.on("disconnected", () => {
    try {
      peer.reconnect();
    } catch {}
  }); // keeps the room code alive on the signalling server
  peer.on("error", (e) => {
    if (e.type === "unavailable-id" && attempt < 3)
      return createRoom(attempt + 1);
    setConn(`${e.type}: ${e.message}`, true);
  });
}
function joinRoom(code) {
  code = cleanCode(code);
  if (!code) return setConn("enter the room code first", true);
  leave();
  roomCode = code;
  peer = newPeer();
  if (!peer) return;
  const mine = peer;
  setConn("joining…");
  showRoom(true);
  peer.on("open", () => {
    if (peer === mine)
      attach(peer.connect(CODE_PREFIX + code, { reliable: true }));
  });
  peer.on("error", (e) => {
    if (e.type === "peer-unavailable") {
      leave();
      setConn(
        "no room with that code (has the other person created it yet?)",
        true,
      );
    } else setConn(`${e.type}: ${e.message}`, true);
  });
}
function attach(c) {
  conn = c;
  c.on("open", () => {
    if (conn !== c) return;
    setConn("connected");
    encoder.reset();
    pending.length = 0;
    startPlayback();
  });
  c.on("data", (data) => {
    if (conn === c) onPacket(data);
  });
  c.on("close", () => {
    if (conn !== c) return;
    conn = null;
    endPlayback();
    setConn("your partner left");
  });
  c.on("error", (e) =>
    setConn(`connection error: ${e.type ?? e.message}`, true),
  );
}
$("create").addEventListener("click", () => createRoom());
$("join").addEventListener("click", () => joinRoom($("joinCode").value));
$("joinCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom($("joinCode").value);
});
$("leave").addEventListener("click", leave);
$("copyLink").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?join=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    $("copyLink").textContent = "copied";
  } catch {
    prompt("Invite link", link);
  }
  setTimeout(() => ($("copyLink").textContent = "Copy invite link"), 1500);
});
window.addEventListener("pagehide", () => {
  try {
    peer?.destroy();
  } catch {}
});
{
  const j = new URLSearchParams(location.search).get("join");
  if (j) {
    $("joinCode").value = cleanCode(j);
    window.addEventListener("load", () => joinRoom(j));
  }
}

// ---------------------------------------------------------------- sending: frames -> simplified keys -> packets
const encoder = new Encoder({ quality: 1 });
let pending = [],
  lastFlush = 0,
  sending = false;
const tx = { frames: 0, keys: 0, bytes: 0, since: performance.now(), text: "" };
function setQuality() {
  // multiplies every channel's tolerance (e.g. frequency 2 Hz, tongue index 0.25 at 1.0)
  const q = +$("quality").value;
  encoder.quality = q;
  $("qualityVal").textContent =
    q === 0
      ? "off (every frame)"
      : `${q.toFixed(1)} ×${q === 1 ? " (normal)" : ""}`;
}
$("quality").addEventListener("input", setQuality);
const FLUSH_MS = 50;

let frameCount = 0,
  clock0 = 0;
function frameTime() {
  // frames come in bursts, so time them by their position in the stream, resyncing if we fall far behind
  const now = performance.now(),
    ideal = clock0 + frameCount++ * HOP_MS;
  if (Math.abs(now - ideal) > 150) {
    clock0 = now - (frameCount - 1) * HOP_MS;
    return now;
  }
  return ideal;
}
function flush() {
  if (!pending.length) return;
  if (connOpen()) {
    const packet = pack(pending, performance.now());
    try {
      conn.send(packet);
      tx.bytes += JSON.stringify(packet).length;
      tx.keys += packet.k.length;
    } catch (e) {
      console.warn(e);
    }
  }
  pending = [];
  lastFlush = performance.now();
}
function emit(keys) {
  keys.forEach(([i, t]) => txGraph.mark(i + 1, t));
  pending.push(...keys);
}

function onFrame(frame) {
  const t = frameTime(),
    speech = updateGate(frame.level),
    p = frame.params;
  const talking = speech && !$("mute").checked && connOpen();
  txGraph.record(
    [
      levelLane(frame.level),
      ...CHANNELS.map((c) => p[c.name] ?? (c.name === "lipDiameter" ? 3 : 0)),
    ],
    speech && !$("mute").checked,
    t,
  );
  if (talking) {
    emit(encoder.push(t, { ...p, lipDiameter: p.lipDiameter ?? 3 }));
    tx.frames++;
  } else if (encoder.active) emit(encoder.end(t));
  if (pending.length && (!talking || performance.now() - lastFlush >= FLUSH_MS))
    flush();
  showSpeechState(talking);
  const now = performance.now();
  if (now - tx.since >= 1000) {
    const s = (now - tx.since) / 1000;
    $("txStats").textContent = connOpen()
      ? `${(tx.frames / s).toFixed(0)} frames/s → ${(tx.keys / s).toFixed(0)} keys/s · ${(tx.bytes / s / 1024).toFixed(2)} kB/s sent`
      : "not connected: nothing is sent";
    Object.assign(tx, { frames: 0, keys: 0, bytes: 0, since: now });
  }
}

// ---------------------------------------------------------------- receiving: keys -> playout -> Pink Trombone
const playout = new Playout();
let tickWorker = null,
  lastJson = "",
  rx = { keys: 0, bytes: 0, since: performance.now() },
  lastLoud = 0;
function onPacket(data) {
  const n = playout.receive(data, performance.now());
  rx.keys += n;
  rx.bytes += JSON.stringify(data).length;
}
function startPlayback() {
  endPlayback();
  toPinkTrombone({
    lastKeyframe: true,
    "backConstriction.index": 10.5,
    "backConstriction.diameter": 5,
  });
  // a worker timer isn't slowed down when this tab is in the background, which it usually will be, next to Pink Trombone
  tickWorker = new Worker(
    URL.createObjectURL(
      new Blob(["setInterval(() => postMessage(0), 12)"], {
        type: "text/javascript",
      }),
    ),
  );
  tickWorker.onmessage = tick;
}
function endPlayback() {
  if (tickWorker) {
    tickWorker.terminate();
    tickWorker = null;
    toPinkTrombone({ intensity: 0 });
  }
  playout.reset();
  lastJson = "";
  $("partnerState").textContent = "";
}
function tick() {
  const now = performance.now(),
    p = playout.sample(now, delayMs());
  if (p) {
    const m = frameMessage(p),
      json = JSON.stringify(m);
    if (json !== lastJson) {
      lastJson = json;
      toPinkTrombone(m);
    } // unchanged parameters (such as silence) cost nothing
    rxGraph.record(
      CHANNELS.map((c) => p[c.name]),
      false,
      now,
    );
    if (p.intensity > 0.05) lastLoud = now;
    const talking = now - lastLoud < 300;
    $("partnerState").textContent = talking ? "speaking" : "silent";
    $("partnerState").style.color = talking ? "#8fe3a0" : "var(--mute)";
  }
  if (now - rx.since >= 1000) {
    const s = (now - rx.since) / 1000;
    $("rxStats").textContent =
      `${(rx.keys / s).toFixed(0)} keys/s · ${(rx.bytes / s / 1024).toFixed(2)} kB/s received`;
    Object.assign(rx, { keys: 0, bytes: 0, since: now });
  }
}

// ---------------------------------------------------------------- microphone start / stop
async function start() {
  $("start").disabled = true;
  try {
    // Raw microphone: no echo cancellation, noise suppression, auto gain or voice isolation (they'd mute quiet sounds)
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: 1,
    };
    if ($("micDevice").value) audio.deviceId = { exact: $("micDevice").value };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    refreshMics();
    const [track] = stream.getAudioTracks(),
      settings = track.getSettings?.() ?? {};
    const stillOn = [
      "echoCancellation",
      "noiseSuppression",
      "autoGainControl",
      "voiceIsolation",
    ].filter((k) => settings[k] === true);
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

    gateOpen = false;
    quietFrames = 0;
    frameCount = 0;
    clock0 = performance.now();
    encoder.reset();
    pending = [];
    const live = samuel.liveMimic({ onFrame });
    node.port.onmessage = (e) => live.push(e.data);
    session = { stream, context, source, node, live };
    $("start").textContent = "stop";
    $("start").classList.add("on");
    setStatus(`listening (${Math.round(context.sampleRate)} Hz)`);
  } catch (error) {
    console.error(error);
    setStatus("couldn't use the microphone: " + error.message, true);
  }
  refreshControls();
  $("start").disabled = !samuel;
}
function stop() {
  if (!session) return;
  const { stream, context, source, node, live } = session;
  session = null;
  live.close();
  node.port.onmessage = null;
  source.disconnect();
  node.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  context.close();
  if (encoder.active) emit(encoder.end(performance.now()));
  flush();
  $("start").textContent = "start";
  $("start").classList.remove("on");
  setStatus("microphone stopped");
  gateOpen = false;
  showSpeechState(false);
  refreshControls();
}
$("start").addEventListener("click", () => (session ? stop() : start()));
$("mute").addEventListener("change", () => showSpeechState(false));
window.addEventListener("pagehide", stop);

// the graphs repaint continuously (started last, once everything they read has been defined)
(function drawLoop() {
  txGraph.draw();
  rxGraph.draw();
  requestAnimationFrame(drawLoop);
})();
