(() => {
  let LANE = 96; // lane height in px, adjustable
  const PAD = 7;
  // id, min, max, default, color
  const defs = [
    ["frequency", 20, 600, 140, "#c9a7ff"],
    ["tongue.index", 12, 29, 12.9, "#f4a7c0"],
    ["tongue.diameter", 2.05, 3.5, 2.43, "#f4a7c0"],
    ["frontConstriction.index", 28, 44, 43, "#7fd1c7"],
    ["frontConstriction.diameter", -1, 5, 5, "#7fd1c7"],
    ["backConstriction.index", 10.5, 16, 10.5, "#8fb4ff"],
    ["backConstriction.diameter", -1, 5, 5, "#8fb4ff"],
    ["lipConstriction.index", 38, 44, 44, "#ff9f6b"], // near the tip of the tract (lips start around 39)
    ["lipConstriction.diameter", -1, 5, 5, "#ff9f6b"],
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
  let modal = null,
    mouse = { x: 0, y: 0 },
    dur = 3,
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
  const HC = {
    auto: "#ffb3c7",
    vector: "#8fe3a0",
    aligned: "#c9a7ff",
    free: "#2b2335",
  }; // handle colors, as in Blender

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
    if (a.i === "bezier" && a.hr && b.hl)
      return clamp(bez(a, b, t), tr.min, tr.max);
    return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
  }
  // Cubic bezier segment a -> b, like a Blender F-curve: each key has a left and right handle stored as (time, value)
  // offsets. Handles that would overlap are scaled down together so time stays monotonic.
  function bez(a, b, t) {
    const gap = b.t - a.t,
      l1 = Math.max(0, a.hr[0]),
      l2 = Math.max(0, -b.hl[0]),
      s = l1 + l2 > gap ? gap / (l1 + l2) : 1;
    const x1 = a.t + l1 * s,
      y1 = a.v + a.hr[1] * s,
      x2 = b.t - l2 * s,
      y2 = b.v + b.hl[1] * s;
    const P = (u, p0, p1, p2, p3) => {
      const w = 1 - u;
      return (
        w * w * w * p0 +
        3 * w * w * u * p1 +
        3 * w * u * u * p2 +
        u * u * u * p3
      );
    };
    let lo = 0,
      hi = 1,
      u = 0.5;
    for (let n = 0; n < 24; n++) {
      u = (lo + hi) / 2;
      P(u, a.t, x1, x2, b.t) < t ? (lo = u) : (hi = u);
    }
    return P(u, a.v, y1, y2, b.v);
  }
  // Handle types: auto (auto clamped), vector, aligned, free. Auto and vector are recomputed whenever keys change.
  function fixHandles(tr) {
    const ks = tr.keys;
    ks.forEach((k, j) => {
      if (k.i === "ease") k.i = "bezier"; // older projects
      k.ht ||= "auto";
      k.hl ||= [0, 0];
      k.hr ||= [0, 0];
      if (k.ht !== "auto" && k.ht !== "vector") return;
      const p = ks[j - 1],
        n = ks[j + 1],
        dl = p ? (k.t - p.t) / 3 : n ? (n.t - k.t) / 3 : 0,
        dr = n ? (n.t - k.t) / 3 : dl;
      if (k.ht === "vector") {
        k.hl = [-dl, p ? (p.v - k.v) / 3 : 0];
        k.hr = [dr, n ? (n.v - k.v) / 3 : 0];
        return;
      }
      const slope =
        p && n && (k.v - p.v) * (k.v - n.v) < 0 ? (n.v - p.v) / (n.t - p.t) : 0; // extremes stay flat
      k.hl = [-dl, -slope * dl];
      k.hr = [dr, slope * dr];
    });
  }
  const sortKeys = () =>
    tracks.forEach((t) => {
      t.keys.sort((a, b) => a.t - b.t);
      fixHandles(t);
    });
  const setKey = (tr, t, v) => {
    v = clamp(v, tr.min, tr.max);
    const k = tr.keys.find((k) => Math.abs(k.t - t) < 0.001);
    if (k) k.v = v;
    else {
      tr.keys.push({ t, v, i: "bezier" });
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
          lane: LANE,
          opts: {
            loop: $("loop").checked,
            snapOn: $("snapOn").checked,
            scrubOn: $("scrubOn").checked,
            silenceOn: $("silenceOn").checked,
            freeOn: $("freeOn").checked,
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
    sortKeys();
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
    sortKeys();
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
    for (const part of [
      "tongue",
      "frontConstriction",
      "backConstriction",
      "lipConstriction",
    ]) {
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
    for (const part of [
      "tongue",
      "frontConstriction",
      "backConstriction",
      "lipConstriction",
    ]) {
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
        else if (k.i === "bezier" || tr.id === "voiceness")
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
    tracks.forEach(fixHandles);
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
      lx.save();
      lx.beginPath();
      lx.rect(0, i * LANE, W, LANE);
      lx.clip();
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
      tr.keys.forEach((k) => {
        // handles of selected bezier keys, colored by handle type
        if (!sel.has(k) || k.i !== "bezier") return;
        const kx = tx(k.t),
          ky = vy(i, tr, k.v);
        ["hl", "hr"].forEach((side) => {
          const hx = tx(k.t + k[side][0]),
            hy = vy(i, tr, k.v + k[side][1]);
          lx.strokeStyle = "rgba(255,255,255,.5)";
          lx.beginPath();
          lx.moveTo(kx, ky);
          lx.lineTo(hx, hy);
          lx.stroke();
          lx.fillStyle = HC[k.ht];
          lx.strokeStyle = "#17131c";
          lx.beginPath();
          lx.arc(hx, hy, 4.5, 0, 7);
          lx.fill();
          lx.stroke();
        });
      });
      lx.restore();
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
    if (modal) {
      lx.fillStyle = "#fff";
      lx.font = "12px system-ui";
      lx.fillText(
        `${modal.type === "g" ? "grab" : "scale"}${modal.axis ? " " + modal.axis.toUpperCase() : ""} - X/Y constrain, click or Enter confirms, Esc cancels`,
        8,
        14,
      );
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
  function setLane(h) {
    // headers follow through the --lane CSS variable
    LANE = Math.round(clamp(h, 48, 360));
    document.documentElement.style.setProperty("--lane", LANE + "px");
    $("laneH").value = LANE;
    resize();
  }
  $("laneH").oninput = (e) => setLane(+e.target.value);

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
  const vAt = (i, tr, y) =>
    tr.min + ((vy(i, tr, tr.min) - y) / (LANE - 2 * PAD)) * (tr.max - tr.min);
  const handleAt = (x, y, li) => {
    for (const k of sel) {
      const tr = trackOf(k),
        ti = tracks.indexOf(tr);
      if (k.i !== "bezier" || ti !== li) continue;
      for (const side of ["hl", "hr"])
        if (
          Math.hypot(
            tx(k.t + k[side][0]) - x,
            vy(ti, tr, k.v + k[side][1]) - y,
          ) < 7
        )
          return { k, side, tr, ti };
    }
  };
  // keep the opposite handle collinear with this one (in screen space), preserving its own length
  function align(k, side, tr) {
    const o = side === "hr" ? "hl" : "hr",
      sc = (LANE - 2 * PAD) / (tr.max - tr.min);
    const mx = k[side][0] * pps,
      my = k[side][1] * sc,
      ml = Math.hypot(mx, my) || 1,
      ol = Math.hypot(k[o][0] * pps, k[o][1] * sc);
    k[o] = [((-mx / ml) * ol) / pps, ((-my / ml) * ol) / sc];
  }
  lanes.onmousedown = (e) => {
    if (e.button !== 0) return;
    if (modal) {
      modal = null;
      draw();
      return;
    } // click confirms grab/scale
    const { x, y } = pos(e),
      { i: li, tr, hit } = hitKey(x, y);
    if (!tr) return;
    const hh = handleAt(x, y, li);
    if (hh) {
      mark();
      drag = { handle: hh };
      return;
    }
    if (hit) {
      if (e.shiftKey) sel.has(hit) ? sel.delete(hit) : sel.add(hit);
      else if (!sel.has(hit)) {
        sel.clear();
        sel.add(hit);
      }
      $("interp").value = hit.i;
      $("handleType").value = hit.ht || "auto";
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
    if (drag.handle) {
      // dragging a handle turns auto into aligned and vector into free, like Blender
      const { k, side, tr, ti } = drag.handle,
        dt = xt(x) - k.t;
      k[side] = [
        side === "hr" ? Math.max(0, dt) : Math.min(0, dt),
        vAt(ti, tr, y) - k.v,
      ];
      if ($("freeOn").checked)
        k.ht = "free"; // free handles: never drag the other handle along
      else if (k.ht === "auto") k.ht = "aligned";
      else if (k.ht === "vector") k.ht = "free";
      if (k.ht === "aligned") align(k, side, tr);
      $("handleType").value = k.ht;
      return draw();
    }
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
  // G grabs and S scales the selected keys (with their handles). X / Y constrain to one axis, like Blender.
  window.addEventListener("mousemove", (e) => {
    mouse = pos(e);
    if (modal) modalApply();
  });
  function startModal(type) {
    if (!sel.size || playing) return;
    mark();
    const items = [...sel].map((k) => ({
        k,
        tr: trackOf(k),
        t: k.t,
        v: k.v,
        hl: [...k.hl],
        hr: [...k.hr],
      })),
      ts = items.map((o) => o.t),
      pv = new Map();
    tracks.forEach((tr) => {
      const vs = items.filter((o) => o.tr === tr).map((o) => o.v);
      if (vs.length) pv.set(tr, (Math.min(...vs) + Math.max(...vs)) / 2);
    });
    const pt = (Math.min(...ts) + Math.max(...ts)) / 2,
      first = items[0],
      ti = tracks.indexOf(first.tr);
    modal = {
      type,
      x0: mouse.x,
      y0: mouse.y,
      axis: null,
      items,
      pt,
      pv,
      px: tx(pt),
      py: vy(ti, first.tr, pv.get(first.tr)),
    };
  }
  function modalApply() {
    const m = modal,
      dx = (mouse.x - m.x0) / pps,
      dy = mouse.y - m.y0;
    const f = clamp(
      Math.hypot(mouse.x - m.px, mouse.y - m.py) /
        Math.max(4, Math.hypot(m.x0 - m.px, m.y0 - m.py)),
      0,
      20,
    );
    m.items.forEach((o) => {
      let t = o.t,
        v = o.v,
        hl = o.hl,
        hr = o.hr;
      if (m.type === "g") {
        if (m.axis !== "y") t = st(o.t + dx);
        if (m.axis !== "x") v = o.v - yv(o.tr, dy);
      } else {
        if (m.axis !== "y") {
          t = clamp(m.pt + (o.t - m.pt) * f, 0, dur);
          hl = [hl[0] * f, hl[1]];
          hr = [hr[0] * f, hr[1]];
        }
        if (m.axis !== "x") {
          const p = m.pv.get(o.tr);
          v = p + (o.v - p) * f;
          hl = [hl[0], hl[1] * f];
          hr = [hr[0], hr[1] * f];
        }
      }
      o.k.t = t;
      o.k.v = clamp(v, o.tr.min, o.tr.max);
      o.k.hl = hl;
      o.k.hr = hr;
    });
    sortKeys();
    draw();
    updateHeads();
  }
  function cancelModal() {
    modal.items.forEach((o) =>
      Object.assign(o.k, { t: o.t, v: o.v, hl: o.hl, hr: o.hr }),
    );
    modal = null;
    sortKeys();
    draw();
    updateHeads();
  }
  lanes.oncontextmenu = (e) => {
    if (modal) {
      e.preventDefault();
      cancelModal();
    }
  };
  const pick = (id) => {
    const s = $(id);
    s.focus();
    try {
      s.showPicker();
    } catch (err) {}
  }; // T and V open the menus
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
      i: "bezier",
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
    if (e.ctrlKey || e.metaKey) return setLane(LANE - e.deltaY * 0.3); // ctrl/⌘ + wheel (or pinch) resizes the lanes
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

  // ---------- clean up selected keys, per track ----------
  // Each track is handled on its own: a selected key is removed when the track's curve, redrawn without it (handles
  // recomputed), stays within `tol` of the original curve. The least noticeable key goes first, always measured
  // against the original curve so small errors can't add up. Unselected keys and each track's first and last key stay.
  // --- cleanupTrack begin
  function cleanupTrack(tr, tol) {
    const ks = tr.keys;
    if (ks.length < 3) return 0;
    const first = ks[0],
      last = ks[ks.length - 1],
      t0 = first.t,
      t1 = last.t;
    const cand = new Set(
      ks.filter((k) => sel.has(k) && k !== first && k !== last),
    );
    if (!cand.size || t1 <= t0) return 0;
    const DT = Math.max(0.005, (t1 - t0) / 4000),
      n = Math.ceil((t1 - t0) / DT),
      tAt = (s) => Math.min(t1, t0 + s * DT);
    const ref = Array.from({ length: n + 1 }, (_, s) => ev(tr, tAt(s)));
    const cost = (k) => {
      // worst deviation if k were removed, checked around the gap (neighbouring handles move too)
      const i = ks.indexOf(k),
        lo = ks[Math.max(0, i - 2)].t,
        hi = ks[Math.min(ks.length - 1, i + 2)].t;
      ks.splice(i, 1);
      fixHandles(tr);
      let err = 0;
      for (
        let s = Math.max(0, Math.floor((lo - t0) / DT));
        s <= Math.min(n, Math.ceil((hi - t0) / DT));
        s++
      )
        err = Math.max(err, Math.abs(ev(tr, tAt(s)) - ref[s]));
      ks.splice(i, 0, k);
      fixHandles(tr);
      return err;
    };
    const err = new Map([...cand].map((k) => [k, cost(k)]));
    let removed = 0;
    for (;;) {
      let best = null,
        bestErr = tol;
      for (const [k, e] of err)
        if (e <= bestErr) {
          bestErr = e;
          best = k;
        }
      if (!best) break;
      const i = ks.indexOf(best);
      ks.splice(i, 1);
      fixHandles(tr);
      err.delete(best);
      removed++;
      for (const j of [i - 2, i - 1, i, i + 1]) {
        const k = ks[j];
        if (k && err.has(k)) err.set(k, cost(k));
      } // only these windows changed
    }
    return removed;
  }
  // --- cleanupTrack end
  let cleanMsg = 0;
  function cleanupSelected() {
    const b = $("clean"),
      say = (text) => {
        b.textContent = text;
        clearTimeout(cleanMsg);
        cleanMsg = setTimeout(
          () => (b.textContent = "Clean up selected (C)"),
          1800,
        );
      };
    if (!sel.size || playing) return say("Select keys first");
    mark();
    const pct = Math.max(0, +$("cleanTol").value || 0) / 100;
    let removed = 0;
    tracks.forEach(
      (tr) => (removed += cleanupTrack(tr, pct * (tr.max - tr.min))),
    );
    if (!removed) {
      undo.pop();
      return say("Nothing to remove");
    }
    [...sel].forEach((k) => {
      if (!trackOf(k)) sel.delete(k);
    });
    draw();
    updateHeads();
    say(`Removed ${removed} key${removed == 1 ? "" : "s"}`);
  }

  // ---------- keyboard + toolbar ----------
  const keyAll = () => {
    mark();
    tracks.filter((t) => t.on).forEach((tr) => setKey(tr, head, ev(tr, head)));
    draw();
    updateHeads();
  };
  window.onkeydown = (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if (modal) {
      e.preventDefault();
      if (e.key === "x" || e.key === "y") {
        modal.axis = modal.axis === e.key ? null : e.key;
        modalApply();
      } else if (e.key === "Enter") {
        modal = null;
        draw();
      } else if (e.key === "Escape") cancelModal();
      return;
    }
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
    else if ((e.key === "g" || e.key === "s") && !e.metaKey && !e.ctrlKey)
      startModal(e.key);
    else if (e.key === "v") pick("handleType");
    else if (e.key === "c" && !e.metaKey && !e.ctrlKey) cleanupSelected();
    else if (e.key === "t") pick("interp");
    else if (e.key === "Home") {
      v0 = 0;
      pps = (wrap.clientWidth - 40) / dur;
      draw();
    } else if (e.code === "KeyA" && e.altKey) {
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
  $("clean").onclick = cleanupSelected;
  $("capture").onclick = () => {
    capturing = true;
    send(msg({ command: "getConstrictions" }));
  };
  $("interp").onchange = (e) => {
    mark();
    sel.forEach((k) => (k.i = e.target.value));
    draw();
    e.target.blur();
  };
  $("handleType").onchange = (e) => {
    mark();
    sel.forEach((k) => {
      k.ht = e.target.value;
      if (k.ht === "aligned") align(k, "hr", trackOf(k));
    });
    draw();
    e.target.blur();
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
  ["loop", "snapOn", "scrubOn", "silenceOn", "freeOn"].forEach(
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
      if (o.lane) setLane(o.lane);
      restore(o);
      head = clamp(o.head ?? 0, 0, dur);
      for (const id of ["loop", "snapOn", "scrubOn", "silenceOn", "freeOn"])
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
