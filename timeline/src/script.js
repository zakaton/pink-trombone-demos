(() => {
  const LANE = 56,
    PAD = 7;
  // id, min, max, default, color
  const defs = [
    ["frequency", 20, 600, 140, "#c9a7ff"],
    ["tongue.index", 12, 29, 12.9, "#f4a7c0"],
    ["tongue.diameter", 2.05, 3.5, 2.43, "#f4a7c0"],
    ["frontConstriction.index", 28, 44, 43, "#7fd1c7"],
    ["frontConstriction.diameter", -1, 5, 5, "#7fd1c7"],
    ["backConstriction.index", 10.5, 16, 10.5, "#8fb4ff"],
    ["backConstriction.diameter", -1, 5, 5, "#8fb4ff"],
    ["voiceness", 0, 1, 0.8, "#ffd27a"],
    ["intensity", 0, 1, 0, "#ffd27a"],
    ["tractLength", 15, 88, 44, "#a8e08a"],
  ];
  const tracks = defs.map(([id, min, max, def, color]) => ({
    id,
    min,
    max,
    def,
    color,
    on: true,
    keys: [],
    label: id
      .replace("Constriction", " constriction")
      .replace(".", " ")
      .replace("tractLength", "tract length"),
  }));
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const $ = (id) => document.getElementById(id);
  const lanes = $("lanes"),
    ruler = $("ruler"),
    wrap = $("wrap");
  const lx = lanes.getContext("2d"),
    rx = ruler.getContext("2d");
  let dur = 3,
    head = 0,
    v0 = 0,
    pps = 0,
    dpr = 1,
    drag = null,
    playing = false,
    t0 = 0,
    capturing = false;
  const sel = new Set(),
    undo = [];

  // ---------- evaluation ----------
  function ev(tr, t) {
    const k = tr.keys,
      n = k.length;
    if (!n) return tr.def;
    if (t <= k[0].t) return k[0].v;
    if (t >= k[n - 1].t) return k[n - 1].v;
    let i = 0;
    while (k[i + 1].t <= t) i++;
    const a = k[i],
      b = k[i + 1];
    if (a.i === "step") return a.v;
    let u = (t - a.t) / (b.t - a.t);
    if (a.i === "ease") u = u * u * (3 - 2 * u);
    return a.v + (b.v - a.v) * u;
  }
  const sortKeys = () =>
    tracks.forEach((t) => t.keys.sort((a, b) => a.t - b.t));
  const setKey = (tr, t, v) => {
    v = clamp(v, tr.min, tr.max);
    const k = tr.keys.find((k) => Math.abs(k.t - t) < 0.001);
    if (k) k.v = v;
    else {
      tr.keys.push({ t, v, i: "linear" });
      sortKeys();
    }
  };
  const tx = (t) => (t - v0) * pps,
    xt = (x) => x / pps + v0;
  const vy = (i, tr, v) =>
    i * LANE +
    LANE -
    PAD -
    ((v - tr.min) / (tr.max - tr.min)) * (LANE - 2 * PAD);
  const yv = (tr, dy) => (dy / (LANE - 2 * PAD)) * (tr.max - tr.min);
  const trackOf = (k) => tracks.find((t) => t.keys.includes(k));

  // ---------- undo / save ----------
  const serialize = () => ({
    dur,
    tracks: Object.fromEntries(
      tracks.map((t) => [
        t.id,
        { on: t.on, keys: t.keys.map((k) => ({ ...k })) },
      ]),
    ),
  });
  // ---------- persistence (survives refresh) ----------
  const STORE = "pink-trombone-timeline";
  let resetting = false;
  const saveNow = () => {
    if (resetting) return;
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          ...serialize(),
          head,
          v0,
          pps,
          opts: {
            loop: $("loop").checked,
            snapOn: $("snapOn").checked,
            scrubOn: $("scrubOn").checked,
            silenceOn: $("silenceOn").checked,
          },
        }),
      );
    } catch (err) {}
  };
  let saveTimer;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  };
  window.addEventListener("beforeunload", saveNow);
  const mark = () => {
    undo.push(JSON.stringify(serialize()));
    if (undo.length > 50) undo.shift();
  };
  function restore(o) {
    dur = o.dur;
    $("dur").value = dur;
    tracks.forEach((t) => {
      const s = o.tracks?.[t.id];
      if (s) {
        t.on = s.on;
        t.keys = s.keys.map((k) => ({ ...k }));
      }
    });
    sel.clear();
    head = clamp(head, 0, dur);
    syncHeads();
    draw();
  }
  function fromUtterance(kfs) {
    tracks.forEach((tr) => {
      tr.keys = [];
      kfs.forEach((kf) => {
        let v = kf[tr.id];
        if (tr.id === "voiceness" && kf.tenseness != null)
          v = Math.acos(1 - kf.tenseness) / (Math.PI / 2);
        if (v != null && isFinite(v))
          tr.keys.push({
            t: kf.time ?? 0,
            v: clamp(v, tr.min, tr.max),
            i: "linear",
          });
      });
      if (!tr.keys.length) tr.keys.push({ t: 0, v: tr.def, i: "linear" });
      tr.on = true;
    });
    dur = Math.max(0.5, ...kfs.map((k) => k.time ?? 0));
    $("dur").value = dur.toFixed(2);
    head = 0;
    sel.clear();
    syncHeads();
    draw();
  }
  function download(name, json) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(json)], { type: "application/json" }),
    );
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Pink Trombone ----------
  const { send } = setupConnection("timeline", () => {});
  const msg = (o) => ({ to: ["pink-trombone"], type: "message", ...o });
  // Pink Trombone replies to getConstrictions with a "to" list that excludes us, so listen to the raw channel.
  let lastV,
    lastLive = 0,
    lastSent = 0;
  const leftKey = (tr) => {
    let r;
    for (const k of tr.keys) if (k.t <= head + 0.001) r = k;
    return r;
  }; // keys are sorted
  // Live edit: Pink Trombone streams the parts you drag; write them into the nearest key at or left of the playhead.
  function liveUpdate(m) {
    const now = performance.now(),
      v = m.voiceness;
    const ignore =
      !$("liveOn").checked || playing || drag || now - lastSent < 250; // ignore echoes of our own scrubbing
    const edits = [];
    for (const part of ["tongue", "frontConstriction", "backConstriction"]) {
      const c = m.constrictions[part];
      if (c) {
        const tl = byId.tractLength.on ? ev(byId.tractLength, head) / 44 : 1;
        edits.push(
          [byId[part + ".index"], c.index / tl],
          [byId[part + ".diameter"], c.diameter],
        );
      }
    }
    // the host repeats voiceness in every message, so only apply it when it actually changed
    if (v != null) {
      if (lastV != null && Math.abs(v - lastV) > 0.001)
        edits.push([byId.voiceness, v]);
      lastV = v;
    }
    if (ignore) return;
    const todo = edits
      .map(([tr, val]) => [leftKey(tr), tr, val])
      .filter(([k]) => k);
    if (!todo.length) return;
    if (now - lastLive > 1000) mark();
    lastLive = now;
    todo.forEach(([k, tr, val]) => (k.v = clamp(val, tr.min, tr.max)));
    draw();
    updateHeads();
  }
  new BroadcastChannel("pink-trombone").onmessage = (e) => {
    const m = e.data;
    if (m.from !== "pink-trombone" || !m.constrictions) return;
    if (!capturing) return liveUpdate(m);
    capturing = false;
    mark();
    const tl = byId.tractLength.on ? ev(byId.tractLength, head) / 44 : 1; // host reports indices scaled by tract length
    for (const part of ["tongue", "frontConstriction", "backConstriction"]) {
      const c = m.constrictions[part];
      if (c) {
        setKey(byId[part + ".index"], head, c.index / tl);
        setKey(byId[part + ".diameter"], head, c.diameter);
      }
    }
    if (m.voiceness != null) setKey(byId.voiceness, head, m.voiceness);
    draw();
    updateHeads();
  };
  // Resolve every enabled track into full keyframes. Linear segments are exact; eased segments and
  // voiceness (non-linear tenseness/loudness mapping) are sampled every 20ms; steps get a 1ms pre-key.
  const build = (from = 0) => {
    const on = tracks.filter((t) => t.on),
      r = (t) => Math.round(t * 1000) / 1000,
      T = new Set([from, dur]);
    on.forEach((tr) =>
      tr.keys.forEach((k, j) => {
        const n = tr.keys[j + 1];
        T.add(r(k.t));
        if (!n) return;
        if (k.i === "step") T.add(r(n.t - 0.001));
        else if (k.i === "ease" || tr.id === "voiceness")
          for (let s = k.t + 0.02; s < n.t; s += 0.02) T.add(r(s));
      }),
    );
    return [...T]
      .filter((t) => t >= from && t <= dur)
      .sort((a, b) => a - b)
      .map((t) => {
        const kf = { time: r(t - from) };
        on.forEach((tr) => {
          const v = ev(tr, t);
          if (tr.id === "voiceness") Object.assign(kf, deconstructVoiceness(v));
          else kf[tr.id] = v;
        });
        return kf;
      });
  };
  function play() {
    if (head >= dur - 0.01) head = 0;
    send(msg({ utterance: { name: "timeline", keyframes: build(head) } }));
    playing = true;
    t0 = performance.now() - head * 1000;
    $("play").textContent = "Stop";
    requestAnimationFrame(tick);
  }
  function stop() {
    if (!playing) return;
    playing = false;
    $("play").textContent = "Play";
    send(msg({ lastKeyframe: true, intensity: 0 }));
  }
  function tick() {
    if (!playing) return;
    head = (performance.now() - t0) / 1000;
    if (head >= dur) {
      if ($("loop").checked) {
        head = 0;
        stop();
        play();
        return;
      }
      head = dur;
      stop();
    }
    updateHeads();
    draw();
    if (playing) requestAnimationFrame(tick);
  }
  const silence = () => {
    if ($("silenceOn").checked && !playing) send(msg({ intensity: 0 }));
  };
  const scrubSend = throttle(() => {
    const m = {};
    tracks.filter((t) => t.on).forEach((tr) => (m[tr.id] = ev(tr, head)));
    lastSent = performance.now();
    send(msg(m));
  }, 40);
  function setHead(t) {
    head = clamp(t, 0, dur);
    if ($("scrubOn").checked && !playing) scrubSend();
    updateHeads();
    draw();
  }

  // ---------- track headers ----------
  tracks.forEach((tr, i) => {
    const d = document.createElement("div");
    d.className = "head";
    d.style.borderLeftColor = tr.color;
    d.style.background = i % 2 ? "#1d1824" : "#211b29";
    d.innerHTML = `<input type="checkbox" checked title="send this track"><label></label><input type="number" step="any">`;
    const [cb, label, num] = d.children;
    label.textContent = tr.label;
    label.style.cursor = "pointer";
    label.title = "select all keys in this track (shift adds)";
    label.onclick = (e) => {
      if (!e.shiftKey) sel.clear();
      tr.keys.forEach((k) => sel.add(k));
      draw();
    };
    cb.onchange = () => {
      tr.on = cb.checked;
      draw();
    };
    num.onchange = () => {
      mark();
      setKey(tr, head, +num.value);
      draw();
      updateHeads();
    };
    tr.cb = cb;
    tr.num = num;
    $("heads").appendChild(d);
  });
  function updateHeads() {
    $("readout").textContent = `${head.toFixed(2)} / ${dur.toFixed(2)} s`;
    tracks.forEach((tr) => {
      if (document.activeElement !== tr.num)
        tr.num.value = +ev(tr, head).toFixed(2);
    });
  }
  function syncHeads() {
    tracks.forEach((tr) => (tr.cb.checked = tr.on));
    updateHeads();
  }

  // ---------- drawing ----------
  function draw() {
    const W = lanes.clientWidth,
      H = tracks.length * LANE;
    if (!W || !(pps > 0)) return; // pps is 0 until the first resize; drawing then would loop forever
    persist();
    const step =
      [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find(
        (s) => s * pps >= 80,
      ) || 10;
    lx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lx.clearRect(0, 0, W, H);
    rx.clearRect(0, 0, W, 28);
    tracks.forEach((_, i) => {
      lx.fillStyle = i % 2 ? "#1d1824" : "#211b29";
      lx.fillRect(0, i * LANE, W, LANE);
    });
    lx.strokeStyle = "#322a3d";
    lx.lineWidth = 1;
    rx.fillStyle = "#9b8fa8";
    rx.strokeStyle = "#43385a";
    rx.font = "11px system-ui";
    for (let t = Math.ceil(v0 / step) * step; tx(t) < W; t += step) {
      const x = Math.round(tx(t)) + 0.5;
      lx.beginPath();
      lx.moveTo(x, 0);
      lx.lineTo(x, H);
      lx.stroke();
      rx.beginPath();
      rx.moveTo(x, 20);
      rx.lineTo(x, 28);
      rx.stroke();
      rx.fillText(t.toFixed(step < 0.1 ? 2 : 1) + "s", x + 4, 15);
    }
    const ex = tx(dur);
    if (ex < W) {
      lx.fillStyle = "rgba(0,0,0,.35)";
      lx.fillRect(ex, 0, W - ex, H);
    }
    tracks.forEach((tr, i) => {
      lx.globalAlpha = tr.on ? 1 : 0.3;
      lx.strokeStyle = tr.color;
      lx.lineWidth = 1.5;
      lx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const y = vy(i, tr, ev(tr, xt(x)));
        x ? lx.lineTo(x, y) : lx.moveTo(x, y);
      }
      lx.stroke();
      tr.keys.forEach((k) => {
        lx.save();
        lx.translate(tx(k.t), vy(i, tr, k.v));
        lx.rotate(Math.PI / 4);
        lx.fillStyle = sel.has(k) ? "#fff" : tr.color;
        lx.strokeStyle = "#17131c";
        lx.fillRect(-4, -4, 8, 8);
        lx.strokeRect(-4, -4, 8, 8);
        lx.restore();
      });
      lx.globalAlpha = 1;
    });
    const hx = Math.round(tx(head)) + 0.5;
    lx.strokeStyle = "#ff6b9a";
    lx.lineWidth = 1;
    lx.beginPath();
    lx.moveTo(hx, 0);
    lx.lineTo(hx, H);
    lx.stroke();
    if (drag?.box && drag.moved) {
      lx.fillStyle = "rgba(255,107,154,.12)";
      lx.strokeStyle = "#ff6b9a";
      lx.fillRect(drag.x, drag.y, drag.x2 - drag.x, drag.y2 - drag.y);
      lx.strokeRect(drag.x, drag.y, drag.x2 - drag.x, drag.y2 - drag.y);
    }
    rx.fillStyle = "#ff6b9a";
    rx.beginPath();
    rx.moveTo(hx - 6, 14);
    rx.lineTo(hx + 6, 14);
    rx.lineTo(hx, 27);
    rx.fill();
  }
  function resize() {
    const W = wrap.clientWidth;
    dpr = devicePixelRatio || 1;
    [
      [lanes, tracks.length * LANE],
      [ruler, 28],
    ].forEach(([c, h]) => {
      c.width = W * dpr;
      c.height = h * dpr;
      c.style.height = h + "px";
    });
    ruler.style.width = W + "px";
    if (!pps) pps = (W - 40) / dur;
    draw();
  }
  new ResizeObserver(resize).observe(wrap);

  // ---------- mouse ----------
  const pos = (e) => {
    const r = lanes.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const st = (t) =>
    clamp($("snapOn").checked ? Math.round(t / 0.05) * 0.05 : t, 0, dur);
  const hitKey = (x, y) => {
    const i = Math.floor(y / LANE),
      tr = tracks[i];
    return {
      i,
      tr,
      hit: tr?.keys.find(
        (k) => Math.abs(tx(k.t) - x) < 8 && Math.abs(vy(i, tr, k.v) - y) < 8,
      ),
    };
  };
  lanes.onmousedown = (e) => {
    const { x, y } = pos(e),
      { tr, hit } = hitKey(x, y);
    if (!tr) return;
    if (hit) {
      if (e.shiftKey) sel.has(hit) ? sel.delete(hit) : sel.add(hit);
      else if (!sel.has(hit)) {
        sel.clear();
        sel.add(hit);
      }
      $("interp").value = hit.i;
      mark();
      drag = {
        x,
        y,
        orig: [...sel].map((k) => ({ k, t: k.t, v: k.v, tr: trackOf(k) })),
      };
    } else {
      const base = e.shiftKey ? new Set(sel) : new Set();
      sel.clear();
      base.forEach((k) => sel.add(k));
      drag = { box: true, x, y, x2: x, y2: y, base, moved: false };
    }
    draw();
  };
  ruler.onmousedown = (e) => {
    drag = { scrub: true };
    setHead(xt(pos(e).x));
  };
  window.onmousemove = (e) => {
    if (!drag) return;
    const { x, y } = pos(e);
    if (drag.scrub) return setHead(xt(x));
    if (drag.box) {
      drag.x2 = x;
      drag.y2 = y;
      if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 3) drag.moved = true;
      if (drag.moved) boxSelect();
      return draw();
    }
    const dt = (x - drag.x) / pps;
    drag.orig.forEach((o) => {
      o.k.t = st(o.t + dt);
      o.k.v = clamp(o.v - yv(o.tr, y - drag.y), o.tr.min, o.tr.max);
    });
    sortKeys();
    draw();
    updateHeads();
  };
  window.onmouseup = () => {
    const clicked = drag?.box && !drag.moved;
    if (clicked) setHead(xt(drag.x)); // plain click on empty space moves the playhead
    if (drag?.scrub || clicked) silence();
    drag = null;
    draw();
  };
  window.onkeyup = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") silence();
  };
  function boxSelect() {
    const x0 = Math.min(drag.x, drag.x2),
      x1 = Math.max(drag.x, drag.x2),
      y0 = Math.min(drag.y, drag.y2),
      y1 = Math.max(drag.y, drag.y2);
    sel.clear();
    drag.base.forEach((k) => sel.add(k));
    tracks.forEach((tr, i) =>
      tr.keys.forEach((k) => {
        const kx = tx(k.t),
          ky = vy(i, tr, k.v);
        if (kx >= x0 && kx <= x1 && ky >= y0 && ky <= y1) sel.add(k);
      }),
    );
  }
  const selectAll = (tr) => {
    sel.clear();
    (tr ? [tr] : tracks).forEach((t) => t.keys.forEach((k) => sel.add(k)));
    draw();
  };
  lanes.ondblclick = (e) => {
    const { x, y } = pos(e),
      { i, tr, hit } = hitKey(x, y);
    if (!tr || hit) return;
    mark();
    const k = {
      t: st(xt(x)),
      v: clamp(
        tr.min +
          ((vy(i, tr, tr.min) - y) / (LANE - 2 * PAD)) * (tr.max - tr.min),
        tr.min,
        tr.max,
      ),
      i: "linear",
    };
    tr.keys.push(k);
    sortKeys();
    sel.clear();
    sel.add(k);
    draw();
    updateHeads();
  };
  const onWheel = (e) => {
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))
      v0 = Math.max(0, v0 + (e.deltaX || e.deltaY) / pps);
    else {
      const x = pos(e).x,
        t = xt(x);
      pps = clamp(pps * Math.exp(-e.deltaY * 0.0015), 20, 5000);
      v0 = Math.max(0, t - x / pps);
    }
    draw();
  };
  lanes.addEventListener("wheel", onWheel, { passive: false });
  ruler.addEventListener("wheel", onWheel, { passive: false });

  // ---------- keyboard + toolbar ----------
  const keyAll = () => {
    mark();
    tracks.filter((t) => t.on).forEach((tr) => setKey(tr, head, ev(tr, head)));
    draw();
    updateHeads();
  };
  window.onkeydown = (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if (e.code === "Space") {
      e.preventDefault();
      playing ? stop() : play();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      mark();
      tracks.forEach((t) => (t.keys = t.keys.filter((k) => !sel.has(k))));
      sel.clear();
      draw();
      updateHeads();
    } else if (e.key === "i") keyAll();
    else if (e.code === "KeyA" && e.altKey) {
      sel.clear();
      draw();
    } else if (e.code === "KeyA") {
      e.preventDefault();
      selectAll();
    } else if (e.key === "Escape") {
      sel.clear();
      draw();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      if (undo.length) restore(JSON.parse(undo.pop()));
    } else if (e.key === "ArrowRight") setHead(head + 0.05);
    else if (e.key === "ArrowLeft") setHead(head - 0.05);
  };
  document
    .querySelectorAll("button")
    .forEach((b) => b.addEventListener("click", () => b.blur()));
  $("play").onclick = () => (playing ? stop() : play());
  $("keyAll").onclick = keyAll;
  $("selAll").onclick = () => selectAll();
  $("selNone").onclick = () => {
    sel.clear();
    draw();
  };
  $("capture").onclick = () => {
    capturing = true;
    send(msg({ command: "getConstrictions" }));
  };
  $("interp").onchange = (e) => {
    mark();
    sel.forEach((k) => (k.i = e.target.value));
    draw();
  };
  $("dur").onchange = (e) => {
    dur = Math.max(0.5, +e.target.value || 3);
    head = clamp(head, 0, dur);
    updateHeads();
    draw();
  };
  $("save").onclick = () => download("timeline-project.json", serialize());
  $("export").onclick = () =>
    download("timeline-utterance.json", [
      { name: "timeline", keyframes: build(0) },
    ]);
  $("load").onclick = () => $("file").click();
  $("file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      mark();
      Array.isArray(j) ? fromUtterance(j[0].keyframes) : restore(j);
    } catch (err) {
      alert("Couldn't read that file: " + err.message);
    }
    e.target.value = "";
  };
  ["loop", "snapOn", "scrubOn", "silenceOn"].forEach(
    (id) => ($(id).onchange = persist),
  );
  let armed = 0;
  $("reset").onclick = () => {
    const b = $("reset");
    if (!armed) {
      // two clicks instead of a confirm() dialog, which some browsers suppress
      b.textContent = "Click again to reset";
      armed = setTimeout(() => {
        armed = 0;
        b.textContent = "Reset";
      }, 3000);
      return;
    }
    clearTimeout(armed);
    clearTimeout(saveTimer);
    resetting = true; // stop any pending or on-unload save from rewriting what we clear
    try {
      localStorage.removeItem(STORE);
    } catch (err) {}
    location.reload();
  };
  try {
    const o = JSON.parse(localStorage.getItem(STORE));
    if (o?.tracks) {
      v0 = o.v0 > 0 ? o.v0 : 0;
      pps = o.pps > 0 ? o.pps : 0;
      restore(o);
      head = clamp(o.head ?? 0, 0, dur);
      for (const id of ["loop", "snapOn", "scrubOn", "silenceOn"])
        if (o.opts && id in o.opts) $(id).checked = o.opts[id];
    }
  } catch (err) {}
  // Hand-off from the TTS page: over a BroadcastChannel if this page is open, or from the localStorage inbox if it opened us.
  const loadUtterance = (payload) => {
    stop();
    mark();
    fromUtterance(payload[0].keyframes);
    v0 = 0;
    pps = Math.max(20, (wrap.clientWidth - 40) / dur);
    draw();
  };
  const handoff = new BroadcastChannel("timeline-handoff");
  handoff.onmessage = (e) => {
    if (e.data?.type !== "load") return;
    try {
      loadUtterance(e.data.payload);
      localStorage.removeItem("timeline-inbox");
      handoff.postMessage({ type: "loaded" });
    } catch (err) {
      console.warn("Couldn't load from TTS page", err);
    }
  };
  try {
    const inbox = JSON.parse(localStorage.getItem("timeline-inbox"));
    if (inbox) {
      loadUtterance(inbox);
      localStorage.removeItem("timeline-inbox");
    }
  } catch (err) {}
  updateHeads();
})();
