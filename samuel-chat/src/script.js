// Voice messages: text / microphone / audio file -> Samuel -> per-channel simplified keys -> PeerJS -> the other
// person's Pink Trombone. Only articulation data (plus the text of typed messages) crosses the network, never audio.
import { CHANNELS, encodeFrames, keysToFrames } from "./stream.js";

// Samuel's files are shared with the /samuel page; change this if yours live somewhere else.
const SAMUEL_SRC = new URL("../../samuel/src/", import.meta.url);
let Samuel, loadOrt, AK;

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MAX_RECORD_S = 60;

let samuel = null, busy = false, rec = null;
const setStatus = (text, isError = false) => { $("status").textContent = text; $("status").className = isError ? "err" : ""; };
const connOpen = () => Boolean(conn?.open);
function refreshControls() {
  const idle = Boolean(samuel) && !busy && !rec;
  $("text").disabled = $("sendText").disabled = $("audioInput").disabled = !idle;
  $("micDevice").disabled = !idle;
  $("record").disabled = !samuel || busy || !navigator.mediaDevices?.getUserMedia; // stays enabled while recording, to stop
}

// ---------------------------------------------------------------- load Samuel (with text-to-speech, for typed messages)
(async () => {
  try {
    setStatus("loading Samuel…");
    ({ Samuel, loadOrt } = await import(new URL("samuel.js", SAMUEL_SRC).href));
    AK = await import(new URL("articulation-keyframes.js", SAMUEL_SRC).href);
    const ort = await loadOrt({ base: new URL("ort/", SAMUEL_SRC).href });
    samuel = await Samuel.load({
      ort, models: new URL("models/", SAMUEL_SRC).href,
      onProgress: (stage, got, total) => setStatus(`loading ${stage} model…${total ? " " + Math.round((got / total) * 100) + "%" : ""}`),
    });
    setStatus(window.Peer ? "ready" : "couldn't load PeerJS (is unpkg.com reachable?)", !window.Peer);
  } catch (error) {
    console.error(error);
    setStatus("couldn't load Samuel: " + error.message, true);
  }
  refreshControls();
})();

async function refreshMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const select = $("micDevice"), selected = select.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  select.replaceChildren(new Option("default microphone", ""));
  devices.forEach((d, i) => select.append(new Option(d.label || `microphone ${i + 1}`, d.deviceId)));
  select.value = devices.some((d) => d.deviceId === selected) ? selected : "";
}
navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
refreshMics();

// ---------------------------------------------------------------- Pink Trombone
const { send } = setupConnection("samuel-chat", () => {});
const toPinkTrombone = (message) => send({ to: ["pink-trombone"], type: "message", ...message });
const DEFAULT_TRACT = 44;
// Indices stay as Samuel produced them; every message carries the tract length and Pink Trombone rescales by length / 44.
const tractLength = () => clamp(Math.round(+$("tract").value) || DEFAULT_TRACT, 15, 88);
function setTract(length) {
  $("tract").value = $("tractSlider").value = clamp(Math.round(length) || DEFAULT_TRACT, 15, 88);
  toPinkTrombone({ tractLength: tractLength() });
}
$("tractSlider").addEventListener("input", () => setTract(+$("tractSlider").value));
$("tract").addEventListener("change", () => setTract(+$("tract").value));
$("tractReset").addEventListener("click", () => setTract(DEFAULT_TRACT));

function setQuality() {
  const q = +$("quality").value;
  $("qualityVal").textContent = q === 0 ? "off (every frame)" : `${q.toFixed(1)} ×${q === 1 ? " (normal)" : ""}`;
}
$("quality").addEventListener("input", setQuality);
try { const saved = localStorage.getItem("samuel-chat-autoplay"); if (saved !== null) $("autoPlay").checked = saved === "1"; } catch {}
$("autoPlay").addEventListener("change", () => { try { localStorage.setItem("samuel-chat-autoplay", $("autoPlay").checked ? "1" : "0"); } catch {} });

/** A decoded message as Pink Trombone keyframes, with this listener's transpose and tract length applied. */
function pinkTromboneKeyframes(m) {
  const ratio = 2 ** ((+$("transpose").value || 0) / 12), length = tractLength();
  return m.frames.map(({ t, values: p }) => {
    const voice = Math.max(p.voiceness, 0);
    return {
      time: Math.round(t) / 1000,
      frequency: p.frequency * ratio, tenseness: voice, loudness: voice ** 0.25, intensity: p.intensity,
      "tongue.index": p.tongueIndex, "tongue.diameter": p.tongueDiameter,
      "frontConstriction.index": p.constrictionIndex, "frontConstriction.diameter": p.constrictionDiameter,
      "backConstriction.index": 10.5, "backConstriction.diameter": 5, // unused by the model: held open
      "lipConstriction.index": 43, "lipConstriction.diameter": p.lipDiameter,
      tractLength: length,
    };
  });
}

// ---------------------------------------------------------------- the message log
const messages = [];
let playing = null, queue = [], playTimer = 0, raf = 0;
const fmtKB = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);

function addMessage({ id, text, k }, mine, bytes) {
  const frames = keysToFrames(k);
  if (!frames) return null;
  const m = { id, mine, text: text || "", keys: k, frames, bytes, dur: frames[frames.length - 1].t / 1000, status: "" };
  const el = document.createElement("div"), meta = document.createElement("div"), bubble = document.createElement("div");
  el.className = "msg " + (mine ? "me" : "them"); meta.className = "meta"; bubble.className = "bubble";
  const play = document.createElement("button"), canvas = document.createElement("canvas"), dur = document.createElement("span");
  play.textContent = "▶"; dur.className = "dur"; dur.textContent = m.dur.toFixed(1) + " s";
  bubble.append(play, canvas, dur);
  if (m.text) { const t = document.createElement("div"); t.className = "text"; t.textContent = m.text; el.append(t); }
  el.append(bubble, meta);
  Object.assign(m, { el, meta, play, canvas });
  play.addEventListener("click", () => (playing === m ? stopPlayback() : (queue = [], playMessage(m))));
  canvas.addEventListener("click", () => (playing === m ? stopPlayback() : (queue = [], playMessage(m))));
  $("empty")?.remove();
  messages.push(m);
  $("log").append(el);
  $("log").scrollTop = $("log").scrollHeight;
  updateMeta(m); drawMessage(m);
  return m;
}
function updateMeta(m) {
  m.meta.textContent = `${m.mine ? "you" : "partner"} · ${m.keys.length} keys · ${fmtKB(m.bytes)}${m.status ? " · " + m.status : ""}`;
}
// intensity as a filled area, frequency as a line, and the playhead while it plays
function drawMessage(m, progress = -1) {
  const c = m.canvas, W = c.clientWidth || 220, H = c.clientHeight || 34, dpr = window.devicePixelRatio || 1;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext("2d"), end = m.frames[m.frames.length - 1].t || 1, X = (t) => (t / end) * (W - 1);
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.beginPath(); g.moveTo(0, H);
  m.frames.forEach((f) => g.lineTo(X(f.t), H - 2 - f.values.intensity * (H - 6)));
  g.lineTo(W, H); g.fillStyle = "rgba(255,210,122,.35)"; g.fill();
  g.beginPath();
  m.frames.forEach((f, i) => { const y = H - 3 - (clamp(f.values.frequency, 70, 500) - 70) / 430 * (H - 6); i ? g.lineTo(X(f.t), y) : g.moveTo(X(f.t), y); });
  g.strokeStyle = "#c9a7ff"; g.lineWidth = 1.3; g.stroke();
  if (progress >= 0) { const x = progress * (W - 1); g.strokeStyle = "#ff6b9a"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
}

// ---------------------------------------------------------------- playback on Pink Trombone
function playMessage(m) {
  stopPlayback(false);
  playing = m;
  const keyframes = pinkTromboneKeyframes(m);
  toPinkTrombone({ utterance: { name: "samuel-chat", keyframes } });
  m.startedAt = performance.now(); m.play.textContent = "■";
  const total = keyframes[keyframes.length - 1].time;
  playTimer = setTimeout(() => finishPlayback(m), total * 1000 + 150);
  cancelAnimationFrame(raf);
  const frame = () => { if (playing !== m) return; drawMessage(m, clamp((performance.now() - m.startedAt) / 1000 / total, 0, 1)); raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
}
function resetBubble(m) { m.play.textContent = "▶"; drawMessage(m); }
function stopPlayback(clearQueue = true) {
  if (clearQueue) queue = [];
  if (!playing) return;
  const m = playing; playing = null;
  clearTimeout(playTimer); cancelAnimationFrame(raf);
  toPinkTrombone({ lastKeyframe: true, intensity: 0 });
  resetBubble(m);
}
function finishPlayback(m) {
  if (playing !== m) return;
  playing = null; cancelAnimationFrame(raf); resetBubble(m);
  const next = queue.shift();
  if (next) playMessage(next);
}
function playIncoming(m) {
  if (!$("autoPlay").checked) return;
  if (playing) queue.push(m); else playMessage(m);
}

// ---------------------------------------------------------------- making a message
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
/** Samuel's articulation data -> simplified keys -> a message in the log, and out to the partner. */
function publish(articulation, text) {
  const frames = AK.articulationKeyframes(articulation).map((k) => ({
    t: k.time * 1000,
    values: {
      frequency: k.frequency, voiceness: k.tenseness, intensity: k.intensity,
      tongueIndex: k["tongue.index"], tongueDiameter: k["tongue.diameter"],
      constrictionIndex: k["frontConstriction.index"], constrictionDiameter: k["frontConstriction.diameter"],
      lipDiameter: k["lipConstriction.diameter"],
    },
  }));
  const packet = { type: "msg", id: uid(), ...(text ? { text } : {}), k: encodeFrames(frames, { quality: +$("quality").value }) };
  const m = addMessage(packet, true, JSON.stringify(packet).length);
  m.packet = packet;
  deliver(m);
}
function deliver(m) {
  if (!connOpen()) { m.status = "not sent yet (it will go when you're connected)"; return updateMeta(m); }
  try { conn.send(m.packet); m.status = "sent"; m.packet = null; } catch (e) { console.warn(e); m.status = "couldn't send"; }
  updateMeta(m);
}

async function run(label, job) {
  busy = true; refreshControls(); setStatus(label + "…");
  const t0 = performance.now();
  try {
    await job();
    setStatus(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error), true);
  } finally {
    busy = false; refreshControls();
  }
}
function sendText() {
  const text = $("text").value.trim();
  if (!text || !samuel || busy || rec) return;
  $("text").value = "";
  run("making your message", async () => publish(await samuel.speak(text), text));
}
$("sendText").addEventListener("click", sendText);
$("text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); } });

async function decodeToMono(blob) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) { const ch = buffer.getChannelData(c); for (let i = 0; i < data.length; i++) data[i] += ch[i] / buffer.numberOfChannels; }
    return { data, sampleRate: buffer.sampleRate };
  } finally { context.close(); }
}
const sendAudio = (blob, label) => run(label, async () => { const { data, sampleRate } = await decodeToMono(blob); publish(await samuel.mimic(data, sampleRate)); });
$("audioInput").addEventListener("change", () => {
  const file = $("audioInput").files[0];
  if (file) sendAudio(file, "analysing audio");
  $("audioInput").value = "";
});

// Microphone: raw capture, with no echo cancellation, noise suppression, auto gain or voice isolation (they mute quiet sounds)
async function startRecording() {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false, channelCount: 1 };
  if ($("micDevice").value) audio.deviceId = { exact: $("micDevice").value };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio }); } catch (error) { return setStatus("couldn't use the microphone: " + error.message, true); }
  refreshMics();
  const chunks = [], recorder = new MediaRecorder(stream, { audioBitsPerSecond: 256000 }), started = performance.now();
  let timer = 0;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    clearInterval(timer); stream.getTracks().forEach((t) => t.stop());
    rec = null; $("record").textContent = "record"; $("record").classList.remove("on"); refreshControls();
    if (performance.now() - started > 300) sendAudio(new Blob(chunks, { type: recorder.mimeType }), "analysing your recording");
  };
  const label = () => {
    const s = Math.floor((performance.now() - started) / 1000);
    $("record").textContent = `stop & send (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`;
    if (s >= MAX_RECORD_S) recorder.stop();
  };
  recorder.start(); rec = recorder; $("record").classList.add("on"); label(); timer = setInterval(label, 250);
  refreshControls(); setStatus("recording…");
}
$("record").addEventListener("click", () => (rec ? rec.stop() : startRecording()));

// ---------------------------------------------------------------- peer connection
const CODE_PREFIX = "ptmsg-", CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const randomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const cleanCode = (s) => s.trim().toLowerCase().replace(/^.*join=/, "").replace(CODE_PREFIX, "").replace(/[^a-z0-9]/g, "");
let peer = null, conn = null, roomCode = "";

function setConn(text, isError = false) { $("conn").textContent = text; $("conn").className = isError ? "err" : "mute"; }
function showRoom(inRoom) {
  $("create").hidden = $("or").hidden = $("joinCode").hidden = $("join").hidden = inRoom;
  $("leave").hidden = !inRoom;
  $("code").textContent = roomCode; $("copyLink").hidden = !roomCode || !inRoom;
}
function leave() {
  try { conn?.close(); } catch {}
  try { peer?.destroy(); } catch {}
  conn = peer = null; roomCode = "";
  showRoom(false); setConn("");
}
function newPeer(id) {
  if (!window.Peer) { setConn("PeerJS didn't load, so there is no connection (is unpkg.com reachable?)", true); return null; }
  return new Peer(id, { debug: 1 });
}
function createRoom(attempt = 0) {
  leave();
  roomCode = randomCode();
  peer = newPeer(CODE_PREFIX + roomCode);
  if (!peer) return;
  const mine = peer;
  setConn("creating room…");
  peer.on("open", () => { if (peer !== mine) return; showRoom(true); setConn("waiting for your partner… send them the code or invite link"); });
  peer.on("connection", (c) => { if (connOpen()) { c.on("open", () => c.close()); return; } attach(c); }); // two people only
  peer.on("disconnected", () => { try { peer.reconnect(); } catch {} }); // keeps the room code alive on the signalling server
  peer.on("error", (e) => { if (e.type === "unavailable-id" && attempt < 3) return createRoom(attempt + 1); setConn(`${e.type}: ${e.message}`, true); });
}
function joinRoom(code) {
  code = cleanCode(code);
  if (!code) return setConn("enter the room code first", true);
  leave();
  roomCode = code;
  peer = newPeer();
  if (!peer) return;
  const mine = peer;
  setConn("joining…"); showRoom(true);
  peer.on("open", () => { if (peer === mine) attach(peer.connect(CODE_PREFIX + code, { reliable: true })); });
  peer.on("error", (e) => {
    if (e.type === "peer-unavailable") { leave(); setConn("no room with that code (has the other person created it yet?)", true); }
    else setConn(`${e.type}: ${e.message}`, true);
  });
}
function attach(c) {
  conn = c;
  c.on("open", () => {
    if (conn !== c) return;
    setConn("connected");
    messages.filter((m) => m.mine && m.packet).forEach(deliver); // anything made while offline goes now
  });
  c.on("data", (data) => { if (conn === c) onData(data); });
  c.on("close", () => { if (conn !== c) return; conn = null; setConn("your partner left"); });
  c.on("error", (e) => setConn(`connection error: ${e.type ?? e.message}`, true));
}
function onData(d) { // untrusted: addMessage checks and clamps the keys
  if (!d || d.type !== "msg" || typeof d.id !== "string" || d.id.length > 40) return;
  if (messages.some((m) => m.id === d.id)) return;
  const text = typeof d.text === "string" ? d.text.slice(0, 2000) : "";
  const m = addMessage({ id: d.id, text, k: d.k }, false, JSON.stringify(d).length);
  if (m) playIncoming(m);
}
$("create").addEventListener("click", () => createRoom());
$("join").addEventListener("click", () => joinRoom($("joinCode").value));
$("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom($("joinCode").value); });
$("leave").addEventListener("click", leave);
$("copyLink").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?join=${roomCode}`;
  try { await navigator.clipboard.writeText(link); $("copyLink").textContent = "copied"; } catch { prompt("Invite link", link); }
  setTimeout(() => ($("copyLink").textContent = "Copy invite link"), 1500);
});
window.addEventListener("pagehide", () => { stopPlayback(); try { peer?.destroy(); } catch {} });
{ const j = new URLSearchParams(location.search).get("join"); if (j) { $("joinCode").value = cleanCode(j); window.addEventListener("load", () => joinRoom(j)); } }
new ResizeObserver(() => messages.forEach((m) => drawMessage(m))).observe($("log"));
setQuality();
