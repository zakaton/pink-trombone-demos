// Play Samuel's articulations on a <pink-trombone> element: zakaton's
// (github.com/zakaton/Pink-Trombone) or the modified copy in vvolhejn/samuel.
// Self-contained: copy this one file next to your page.
//
//   import { Samuel } from "./lib/samuel.js";
//   import { attachSamuel } from "./lib/pink-trombone-adapter.js";
//   const el = document.querySelector("pink-trombone");
//   await el.setAudioContext(ctx); el.connect(ctx.destination); el.start();
//   const mouth = attachSamuel(el);
//   await mouth.play(await samuel.speak("Hello there."));     // scheduled curves
//   samuel.liveMimic({ onFrame: (f) => mouth.frame(f.params) }); // or live
//
// The mapping is the original webapp's (webapp/lib/usePinkTrombone.ts):
// tenseness = voiceness, loudness = voiceness ** 0.25, a tongue-tip
// constriction that moves, and a lip constriction fixed at index 43.

const OPEN = 3;
const LEAD_S = 0.12;
const FADE_S = 0.05;

// Without cancelAndHoldAtTime (Firefox) a running value curve can't
// be cut short or overlapped, so there utterances go out as per-frame ramps.
const CAN_HOLD =
  typeof AudioParam !== "undefined" &&
  "cancelAndHoldAtTime" in AudioParam.prototype;

function cancelAndHold(p, t) {
  if (CAN_HOLD) return p.cancelAndHoldAtTime(Math.max(0, t - 1e-5));
  const v = p.value;
  p.cancelScheduledValues(Math.max(0, t - 1e-5));
  try {
    p.setValueAtTime(v, t);
  } catch {}
}

function schedule(p, v, t0, dur) {
  p.setValueAtTime(v[0], Math.max(0, t0 - 0.01));
  if (CAN_HOLD) return p.setValueCurveAtTime(v, t0, dur);
  p.setValueAtTime(v[0], t0);
  const step = dur / (v.length - 1);
  for (let i = 1; i < v.length; i++)
    p.linearRampToValueAtTime(v[i], t0 + i * step);
}

function glide(p, v, t, tau) {
  try {
    p.setTargetAtTime(v, t, tau);
  } catch {
    cancelAndHold(p, t);
    try {
      p.setTargetAtTime(v, t, tau);
    } catch {}
  }
}

/** Per-frame values for each AudioParam role. */
export function articulationCurves(a) {
  const p = a.params;
  const v = Float32Array.from(p.voiceness);
  const out = {
    frequency: Float32Array.from(p.frequency),
    tenseness: v,
    loudness: v.map((x) => Math.pow(Math.max(x, 0), 0.25)),
    intensity: Float32Array.from(p.intensity),
    tongueIndex: Float32Array.from(p.tongueIndex),
    tongueDiameter: Float32Array.from(p.tongueDiameter),
    tipIndex: Float32Array.from(p.constrictionIndex),
    tipDiameter: Float32Array.from(p.constrictionDiameter),
    lipDiameter: p.lipDiameter
      ? Float32Array.from(p.lipDiameter)
      : new Float32Array(v.length).fill(OPEN),
  };
  if (v.length < 2)
    for (const k of Object.keys(out))
      out[k] = Float32Array.of(out[k][0] ?? 0, out[k][0] ?? 0);
  return out;
}

/**
 * Take over a started <pink-trombone> element's voice.
 * @param {HTMLElement} el  has setAudioContext() resolved and start() called
 */
export function attachSamuel(el) {
  const ctx = el.audioContext;
  el.vibrato.gain.value = 0;
  el.vibrato.wobble.value = 0;
  el.intensity.value = 0;
  el.setAttribute?.("interactive", "false");
  // zakaton's element marks a slot taken only after the worklet replies, so
  // two calls in a row would get the same slot. Claim each one at once.
  const claim = (index) => {
    const c = el.newConstriction(index, OPEN);
    if (c) c._isEnabled = true;
    return c;
  };
  const tip = claim(33);
  const lip = claim(43);
  if (!tip || !lip || tip === lip) {
    if (tip) el.removeConstriction(tip);
    if (lip && lip !== tip) el.removeConstriction(lip);
    throw new Error(
      "Samuel needs two free constriction slots on this <pink-trombone>",
    );
  }
  const params = {
    frequency: el.frequency,
    tenseness: el.tenseness,
    loudness: el.loudness,
    intensity: el.intensity,
    tongueIndex: el.tongue.index,
    tongueDiameter: el.tongue.diameter,
    tipIndex: tip.index,
    tipDiameter: tip.diameter,
    lipDiameter: lip.diameter,
  };
  let token = 0,
    scheduleEnd = 0,
    playing = false;

  return {
    params,
    /** Schedule a whole utterance; resolves when it has played. */
    async play(a, { speed = 1 } = {}) {
      await ctx.resume();
      const my = ++token;
      const c = articulationCurves(a);
      const n = c.frequency.length;
      const dur = n / a.frame_rate / speed;
      const now = ctx.currentTime;
      if (playing) scheduleEnd = now; // interrupting: the old curves are cut below
      const t0 = Math.max(now + LEAD_S, scheduleEnd + 0.02);
      for (const [role, values] of Object.entries(c)) {
        const p = params[role];
        cancelAndHold(p, now);
        schedule(p, values, t0, dur);
      }
      // fade the voice out after the last frame
      params.intensity.setValueAtTime(c.intensity[n - 1], t0 + dur);
      params.intensity.linearRampToValueAtTime(0, t0 + dur + FADE_S);
      scheduleEnd = t0 + dur + FADE_S;
      playing = true;
      while (
        ctx.currentTime < scheduleEnd &&
        token === my &&
        ctx.state !== "closed"
      )
        await new Promise((r) => setTimeout(r, 40));
      if (token === my) playing = false;
    },
    /** Glide to one frame (for Samuel.liveMimic). */
    frame(f, tau = 0.012) {
      const now = ctx.currentTime;
      const v = Math.max(f.voiceness, 0);
      const set = {
        frequency: f.frequency,
        tenseness: v,
        loudness: Math.pow(v, 0.25),
        intensity: f.intensity,
        tongueIndex: f.tongueIndex,
        tongueDiameter: f.tongueDiameter,
        tipIndex: f.constrictionIndex,
        tipDiameter: f.constrictionDiameter,
        lipDiameter: f.lipDiameter ?? OPEN,
      };
      if (playing) {
        this.stop();
      }
      for (const [role, value] of Object.entries(set))
        if (Number.isFinite(value)) glide(params[role], value, now, tau);
    },
    /** Cut the utterance short and fade out. */
    stop() {
      token++;
      const now = ctx.currentTime;
      for (const p of Object.values(params)) cancelAndHold(p, now);
      glide(params.intensity, 0, now, 0.02);
      scheduleEnd = now + FADE_S;
      playing = false;
    },
    /** Give the constriction slots back. */
    release() {
      this.stop();
      el.removeConstriction(tip);
      el.removeConstriction(lip);
      el.setAttribute?.("interactive", "true");
    },
  };
}
