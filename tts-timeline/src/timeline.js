// Visual timeline for the TTS demo. It reads and writes the same per-phoneme inputs
// (offset, hold, intensity, ...) that script.js already listens to, so all TTS behavior is unchanged.
(() => {
  const $ = (id) => document.getElementById(id);
  const lane = $("lane"),
    pitchLane = $("pitchLane"),
    wordsRow = $("wordsRow"),
    ruler = $("ruler"),
    stage = $("stage"),
    head = $("playhead"),
    zoom = $("zoom"),
    insp = $("inspector");
  const BLK_H = 76,
    PH = 72,
    SC = (PH / 2 - 10) / 12; // pitch lane height, pixels per semitone
  const FIELDS = [
    ["offset", "transition (s)", 0, 2, 0.01],
    ["hold", "hold (s)", 0, 2, 0.01],
    ["intensity", "intensity", 0, 1, 0.05],
    ["tractLength", "tract (0 = unchanged)", 0, 88, 1],
    ["offsetBetweenSubPhonemes", "sub-phoneme gap (s)", 0, 1, 0.01],
  ];
  let blocks = [],
    selIdx = -1,
    sig = "",
    inspKey = "",
    raf = 0,
    playRaf = 0;
  const P = () => +zoom.value;
  const val = (el, c) => +el.querySelector("." + c).value;
  const setField = (el, c, v, lo, hi) => {
    const input = el.querySelector("." + c);
    input.value = +clamp(v, lo, hi).toFixed(3);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const off = (el) =>
    el.phonemeOffset ? el.phonemeOffset() : val(el, "offset"); // the transition actually in use
  const get = (el, c) => (c === "offset" ? off(el) : val(el, c));
  let targets = []; // absolute pitch (semitones) per block; null for blocks with no audible keyframes
  const changed = () => {
    schedule();
    document.dispatchEvent(new Event("input"));
  }; // the event also lets persist.js save
  const setManual = (i, v) => {
    const b = blocks[i];
    if (!b) return;
    if (v == null) delete b.el.pitchManual;
    else b.el.pitchManual = clamp(v, -48, 48);
    changed();
  };
  // Manual blocks keep their pitch; the rest hold the last manual pitch, or interpolate (by time) toward the next one.
  function computeTargets(out) {
    const idx = out.map((b, i) => (b.dur > 0 ? i : -1)).filter((i) => i >= 0);
    const man = idx.filter((i) => out[i].el.pitchManual != null);
    const interp = $("pitchMode").value === "interpolate",
      res = out.map(() => null);
    idx.forEach((i) => {
      const b = out[i],
        m = b.el.pitchManual;
      if (m != null) {
        res[i] = m;
        return;
      }
      const pi = man.filter((j) => j < i).pop(),
        ni = man.find((j) => j > i);
      const a =
        pi != null
          ? { t: out[pi].start, v: out[pi].el.pitchManual }
          : { t: 0, v: 0 }; // before the first manual pitch: the base pitch
      if (!interp || ni == null) {
        res[i] = a.v;
        return;
      }
      const n = out[ni];
      res[i] =
        a.v +
        (n.el.pitchManual - a.v) * ((b.start - a.t) / (n.start - a.t || 1));
    });
    return res;
  }
  function applyPitch() {
    // absolute targets -> the per-phoneme semitone steps script.js understands
    let prev = 0;
    blocks.forEach((b, i) => {
      if (targets[i] == null) return;
      const d = +(targets[i] - prev).toFixed(3);
      prev = targets[i];
      if (Math.abs(val(b.el, "semitones") - d) > 1e-6)
        setField(b.el, "semitones", d, -100, 100);
    });
  }
  const schedule = () => {
    raf ||= requestAnimationFrame(render);
  };

  // Lay phonemes out end to end using the durations script.js computes from their keyframes.
  function scan() {
    const out = [];
    let t = 0;
    let wi = -1;
    resultsContainer.querySelectorAll(".result").forEach((r) => {
      if (r.style.display === "none") return;
      wi++;
      r.querySelectorAll(".phoneme").forEach((el) => {
        const dur = el.phonemeDuration ? el.phonemeDuration() / speed : 0;
        out.push({ el, r, wi, ph: el.phoneme, start: t, dur });
        t += dur;
      });
    });
    return { out, total: t };
  }

  function buildInspector() {
    const b = blocks[selIdx];
    insp.textContent = "";
    insp.className = b ? "" : "empty";
    if (!b) {
      insp.textContent = "Select a phoneme to fine-tune it.";
      return;
    }
    const title = document.createElement("b");
    title.textContent = b.ph;
    insp.append(title);
    FIELDS.forEach(([c, label, lo, hi, step]) => {
      if (
        c === "offsetBetweenSubPhonemes" &&
        b.el.querySelector("." + c).parentElement.style.display === "none"
      )
        return;
      const l = document.createElement("label"),
        i = document.createElement("input");
      Object.assign(i, { type: "number", min: lo, max: hi, step });
      i.dataset.c = c;
      i.oninput = () => {
        const cur = blocks[selIdx];
        if (cur && i.value !== "") setField(cur.el, c, +i.value, lo, hi);
      };
      l.append(label + " ", i);
      insp.append(l);
    });
    const pl = document.createElement("label"),
      pi = document.createElement("input"),
      ml = document.createElement("label"),
      mi = document.createElement("input");
    Object.assign(pi, { type: "number", step: 0.5, id: "inspPitch" });
    pi.oninput = () => {
      if (pi.value !== "") setManual(selIdx, +pi.value);
    };
    Object.assign(mi, { type: "checkbox", id: "inspManual" });
    mi.onchange = () =>
      setManual(
        selIdx,
        mi.checked ? Math.round(targets[selIdx] * 2) / 2 : null,
      );
    pl.append("pitch (st) ", pi);
    ml.append(mi, " manual pitch");
    insp.append(pl, ml);
  }

  function render() {
    raf = 0;
    const { out, total } = scan();
    blocks = out;
    targets = computeTargets(out);
    applyPitch();
    const s = out.map((b) => b.ph).join("");
    if (s !== sig) {
      sig = s;
      selIdx = -1;
    }
    const p = P(),
      end = total + releaseTime / speed;
    stage.style.width = Math.max(end * p + 40, 300) + "px";
    lane.textContent =
      wordsRow.textContent =
      ruler.textContent =
      pitchLane.textContent =
        "";
    $("total").textContent = out.length ? `${end.toFixed(2)} s` : "";

    const groups = new Map();
    out.forEach((b, i) => {
      if (b.dur <= 0) return;
      const g = groups.get(b.wi) || { start: b.start, r: b.r };
      g.end = b.start + b.dur;
      groups.set(b.wi, g);
      const info = phonemes[b.ph],
        el = document.createElement("div");
      el.className =
        "blk " +
        (b.ph === "." ? "gap" : info?.type === "vowel" ? "vowel" : "cons") +
        (info?.voiced === false ? " unvoiced" : "") +
        (i === selIdx ? " sel" : "");
      el.dataset.i = i;
      el.style.left = b.start * p + "px";
      el.style.width = Math.max(b.dur * p - 2, 4) + "px";
      const ramp = Math.min(off(b.el) / speed, b.dur) * p;
      el.innerHTML = `<i class="fill" style="height:${val(b.el, "intensity") * 100}%"></i><i class="ramp" style="width:${ramp}px"></i><span></span><b data-h="off" style="left:${ramp - 5}px"></b><b data-h="hold"></b>`;
      el.children[2].textContent = b.ph;
      lane.append(el);
    });
    groups.forEach((g, gi) => {
      const w = document.createElement("div");
      w.dataset.w = gi;
      w.className = "wl";
      w.style.left = g.start * p + "px";
      w.style.width = Math.max((g.end - g.start) * p - 2, 4) + "px";
      w.textContent =
        g.r.querySelector(".word").innerText || g.r.alternative || "";
      wordsRow.append(w);
    });
    const mid = PH / 2,
      yAt = (v) => mid - clamp(v, -12, 12) * SC,
      W = parseFloat(stage.style.width);
    let path = "",
      dots = "";
    out.forEach((b, i) => {
      if (b.dur <= 0) return;
      const acc = targets[i],
        y = yAt(acc),
        x0 = b.start * p;
      path += `${path ? "L" : "M"}${x0} ${y}L${x0 + b.dur * p - 2} ${y}`;
      dots += `<circle data-i="${i}" cx="${x0 + 10}" cy="${y}" r="6" class="${i === selIdx ? "sel " : ""}${out[i].el.pitchManual == null ? "auto" : ""}"/><text x="${x0 + 20}" y="${y - 8}">${acc > 0 ? "+" : ""}${+acc.toFixed(1)}</text>`;
    });
    pitchLane.innerHTML = `<svg width="${W}" height="${PH}">${[12, 0, -12].map((v) => `<line class="pg" x1="0" x2="${W}" y1="${yAt(v)}" y2="${yAt(v)}"/><text x="3" y="${yAt(v) - 3}">${v > 0 ? "+" : ""}${v} st</text>`).join("")}<path d="${path}"/>${dots}</svg>`;
    const step = p >= 220 ? 0.25 : p >= 110 ? 0.5 : 1;
    for (let t = 0; t <= end; t += step) {
      const k = document.createElement("div");
      k.className = "tick";
      k.style.left = t * p + "px";
      k.textContent = t.toFixed(2).replace(/0$/, "") + "s";
      ruler.append(k);
    }
    const key = selIdx + "|" + sig;
    if (key !== inspKey) {
      inspKey = key;
      buildInspector();
    }
    const b = blocks[selIdx];
    if (b)
      insp.querySelectorAll("input[data-c]").forEach((i) => {
        if (document.activeElement !== i)
          i.value = +get(b.el, i.dataset.c).toFixed(3);
      });
    const pt = targets[selIdx],
      pin = $("inspPitch"),
      pman = $("inspManual");
    if (b && pt != null && pin) {
      if (document.activeElement !== pin) pin.value = +pt.toFixed(2);
      pman.checked = b.el.pitchManual != null;
    }
  }

  // Drag handles: diamond = transition time, right edge = hold, body (vertical) = intensity.
  lane.addEventListener("pointerdown", (e) => {
    const blk = e.target.closest(".blk");
    if (!blk) {
      selIdx = -1;
      schedule();
      return;
    }
    e.preventDefault();
    const i = +blk.dataset.i,
      b = blocks[i],
      kind = e.target.dataset.h || "body";
    const x0 = e.clientX,
      y0 = e.clientY,
      p = P(),
      sp = speed;
    const o0 = off(b.el),
      h0 = val(b.el, "hold"),
      i0 = val(b.el, "intensity");
    selIdx = i;
    schedule();
    lane.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dt = ((ev.clientX - x0) / p) * sp,
        r = (v) => Math.round(v * 100) / 100;
      if (kind === "off") {
        // trade transition against hold so the block keeps its length
        const tot = o0 + h0,
          o = r(clamp(o0 + dt, Math.max(0, tot - 2), Math.min(2, tot)));
        setField(b.el, "offset", o, 0, 2);
        setField(b.el, "hold", r(tot - o), 0, 2);
      } else if (kind === "hold") setField(b.el, "hold", r(h0 + dt), 0, 2);
      else if (Math.abs(ev.clientY - y0) > 3)
        setField(
          b.el,
          "intensity",
          Math.round((i0 - (ev.clientY - y0) / BLK_H) * 20) / 20,
          0,
          1,
        );
    };
    const up = () => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
    };
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
  });

  function startPlayhead(from, len) {
    const t0 = performance.now();
    cancelAnimationFrame(playRaf);
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      head.style.display = "block";
      head.style.transform = `translateX(${(from + t) * P()}px)`;
      if (t < len) playRaf = requestAnimationFrame(step);
      else head.style.display = "none";
    };
    step();
  }

  // Play one word (wi >= 0) or the whole phrase (wi = -1). Frequency and tract length are chained
  // through the earlier words so a word sounds the same alone as it does inside the phrase.
  function playWord(wi) {
    let time = 0,
      freq = initialFrequency,
      tract = initialTractLength,
      t0 = 0;
    const kfs = [];
    [...resultsContainer.querySelectorAll(".result")]
      .filter((r) => r.style.display !== "none")
      .forEach((r, i) => {
        const k = r.renderKeyframes(time, freq, tract);
        if (!k.length) return;
        if (wi < 0 || i === wi) {
          if (!kfs.length) t0 = time;
          kfs.push(...k);
        }
        const last = k[k.length - 1];
        time = last.time;
        freq = last.frequency;
        tract = last.tractLength;
      });
    if (!kfs.length) return;
    kfs.forEach((k) => (k.time -= t0));
    const last = kfs[kfs.length - 1];
    kfs.push({
      name: ".",
      time: last.time + releaseTime / speed,
      frequency: last.frequency,
      tractLength: last.tractLength,
      intensity: 0,
    });
    if (isWhispering)
      kfs.forEach((k) => Object.assign(k, deconstructVoiceness(0)));
    if (phonemeSubstitutionType == "misc.slurring")
      kfs.forEach((k) => Object.assign(k, deconstructVoiceness(0.8)));
    throttledSend({
      utterance: { name: wi < 0 ? "phrase" : "word", keyframes: kfs },
    });
    const sel = blocks.filter((b) => wi < 0 || b.wi === wi),
      from = sel.length ? sel[0].start : 0;
    startPlayhead(
      from,
      (sel.length ? sel[sel.length - 1].start + sel[sel.length - 1].dur : 0) -
        from +
        releaseTime / speed,
    );
  }

  // Pitch: dragging a dot pins that block to a manual pitch; double-clicking it returns it to automatic.
  // Hear a dot while dragging it: hold that phoneme's main keyframe at the dragged pitch, then silence on release.
  const PARAMS = [
    "tongue.index",
    "tongue.diameter",
    "frontConstriction.index",
    "frontConstriction.diameter",
    "backConstriction.index",
    "backConstriction.diameter",
  ];
  const sendLive = throttle(
    (m) => send({ to: recipients("pink-trombone"), type: "message", ...m }),
    30,
  );
  function hear(i, abs) {
    if (!$("hearPitch").checked || !blocks[i]?.el.mainKeyframe) return;
    const pose = {};
    let tract = initialTractLength;
    for (let j = 0; j <= i; j++) {
      // carry earlier phonemes' settings forward, like consecutive keyframes do
      const f = blocks[j].el.firstKeyframe?.(),
        k = blocks[j].el.mainKeyframe?.();
      if (f && "tractLength" in f) tract = f.tractLength;
      if (k)
        PARAMS.forEach((key) => {
          if (key in k) pose[key] = k[key];
        });
    }
    const k = blocks[i].el.mainKeyframe();
    if (!k) return;
    pose.intensity = k.intensity;
    pose.tractLength = tract;
    pose.frequency = initialFrequency * 2 ** (abs / 12);
    pose.voiceness = isWhispering
      ? 0
      : phonemeSubstitutionType == "misc.slurring"
        ? 0.8
        : Math.acos(1 - (k.tenseness ?? 0.6)) / (Math.PI / 2);
    sendLive(pose);
  }
  const silence = () =>
    send({ to: recipients("pink-trombone"), type: "message", intensity: 0 });
  let nudge,
    lastDot = { i: -1, t: 0 };
  pitchLane.addEventListener("pointerdown", (e) => {
    const c = e.target.closest("circle");
    if (!c) return;
    e.preventDefault();
    const i = +c.dataset.i,
      abs0 = targets[i],
      y0 = e.clientY,
      now = performance.now();
    selIdx = i;
    schedule();
    if (lastDot.i === i && now - lastDot.t < 350) {
      lastDot = { i: -1, t: 0 };
      setManual(i, null);
      return;
    }
    lastDot = { i, t: now };
    pitchLane.setPointerCapture(e.pointerId);
    hear(i, abs0);
    const move = (ev) => {
      if (Math.abs(ev.clientY - y0) <= 2) return;
      const v = clamp(Math.round(abs0 - (ev.clientY - y0) / SC), -12, 12);
      setManual(i, v);
      hear(i, v);
    };
    const up = () => {
      pitchLane.removeEventListener("pointermove", move);
      pitchLane.removeEventListener("pointerup", up);
      silence();
    };
    pitchLane.addEventListener("pointermove", move);
    pitchLane.addEventListener("pointerup", up);
  });
  $("pitchReset").onclick = () => {
    blocks.forEach((b) => delete b.el.pitchManual);
    changed();
  };
  wordsRow.addEventListener("click", (e) => {
    const w = e.target.closest(".wl");
    if (!w) return;
    selIdx = blocks.findIndex((b) => b.wi === +w.dataset.w && b.dur > 0);
    schedule();
    playWord(+w.dataset.w);
  });

  document.addEventListener("keydown", (e) => {
    if (
      e.target.matches("textarea,select,input[type=number],input[type=text]") ||
      e.metaKey ||
      e.ctrlKey
    )
      return;
    const b = blocks[selIdx];
    if (e.code === "Space") {
      e.preventDefault();
      playWord(e.shiftKey || !b ? -1 : b.wi);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      let j = selIdx;
      const d = e.key === "ArrowRight" ? 1 : -1;
      do j += d;
      while (j >= 0 && j < blocks.length && blocks[j].dur <= 0);
      if (j >= 0 && j < blocks.length) {
        selIdx = j;
        schedule();
      }
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && b) {
      e.preventDefault();
      const d = e.key === "ArrowUp" ? 1 : -1;
      if (e.shiftKey) {
        const v = Math.round(targets[selIdx]) + d;
        setManual(selIdx, v);
        hear(selIdx, v);
        clearTimeout(nudge);
        nudge = setTimeout(silence, 350);
      } else
        setField(
          b.el,
          "intensity",
          +(val(b.el, "intensity") + d * 0.05).toFixed(2),
          0,
          1,
        );
    }
  });
  document.addEventListener("click", (e) => {
    e.target.closest("button")?.blur();
    if (e.target.closest("#play")) {
      const { total } = scan();
      startPlayhead(0, total + releaseTime / speed);
    }
  });
  document.addEventListener(
    "click",
    (e) => {
      // each word's own play button plays just that word
      const btn = e.target.closest(".result .play");
      if (!btn) return;
      e.stopPropagation();
      playWord(
        [...resultsContainer.querySelectorAll(".result")]
          .filter((r) => r.style.display !== "none")
          .indexOf(btn.closest(".result")),
      );
    },
    true,
  );
  document.addEventListener("change", (e) => {
    if (
      e.target.matches(
        "input[type=checkbox],input[type=radio],input[type=range]",
      )
    )
      e.target.blur();
  });
  document.addEventListener("input", schedule, true); // any edit (text, speed, substitutions, handles) re-lays out the timeline
  schedule();
})();
