// Saves the page to localStorage and restores it on load. Restoring replays the real input events
// (text, substitutions, alternatives, per-phoneme edits), so script.js rebuilds everything itself.
(() => {
  const KEY = "tts-timeline-state",
    $ = (id) => document.getElementById(id);
  const FIELDS = [
    "offset",
    "hold",
    "intensity",
    "semitones",
    "tractLength",
    "offsetBetweenSubPhonemes",
  ];
  const visible = () =>
    [...resultsContainer.querySelectorAll(".result")].filter(
      (r) => r.style.display !== "none",
    );
  const fire = (el) => el.dispatchEvent(new Event("input", { bubbles: true }));
  const read = (el, c) =>
    c === "offset" && el.phonemeOffset
      ? el.phonemeOffset()
      : +el.querySelector("." + c).value; // offset: the value actually in use
  let restoring = true,
    resetting = false,
    timer;

  const snapshot = () => ({
    source: isResultFromPhoneme ? "phonemes" : "text",
    text: $("text").value,
    phonemes: $("phonemes").value,
    speed: $("speed").value,
    freq: $("initialFrequency").value,
    tract: $("initialTractLength").value,
    random: $("numberOfRandomPhonemes").value,
    whisper: $("whisper").checked,
    pig: $("pigLatin").checked,
    subs: $("phonemeSubstitutions").value,
    zoom: $("zoom").value,
    pitchMode: $("pitchMode").value,
    pm: visible().map((r) =>
      [...r.querySelectorAll(".phoneme")].map((el) => el.pitchManual ?? null),
    ),
    alts: visible().map((r) =>
      [...r.querySelectorAll(".alternatives input[type=radio]")].findIndex(
        (x) => x.checked,
      ),
    ),
    phs: visible().map((r) =>
      [...r.querySelectorAll(".phoneme")].map((el) =>
        FIELDS.map((c) => read(el, c)),
      ),
    ),
  });
  const save = () => {
    if (restoring || resetting) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot()));
    } catch (err) {}
  };
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  };

  function restore(s) {
    const set = (id, v) => {
      const el = $(id);
      el.value = v;
      fire(el);
    };
    set("speed", s.speed);
    set("initialFrequency", s.freq);
    set("initialTractLength", s.tract);
    set("numberOfRandomPhonemes", s.random);
    $("whisper").checked = s.whisper;
    fire($("whisper"));
    if (s.subs && s.subs !== "none") set("phonemeSubstitutions", s.subs);
    $("pigLatin").checked = s.pig;
    fire($("pigLatin"));
    if (s.pitchMode) set("pitchMode", s.pitchMode);
    if (s.source === "phonemes") set("phonemes", s.phonemes);
    else set("text", s.text);
    visible().forEach((r, i) => {
      // chosen pronunciation for each word
      const idx = s.alts?.[i],
        radio = r.querySelectorAll(".alternatives input[type=radio]")[idx];
      if (idx > 0 && radio) {
        radio.checked = true;
        fire(radio);
      }
    });
    visible().forEach((r, i) => {
      // manually pinned pitches
      const els = r.querySelectorAll(".phoneme"),
        pm = s.pm?.[i];
      if (pm && els.length === pm.length)
        els.forEach((el, j) => {
          if (pm[j] != null) el.pitchManual = pm[j];
        });
    });
    visible().forEach((r, i) => {
      // timing, intensity and pitch edits
      const els = r.querySelectorAll(".phoneme"),
        list = s.phs?.[i];
      if (!list || els.length !== list.length) return;
      els.forEach((el, j) =>
        FIELDS.forEach((c, k) => {
          if (Math.abs(read(el, c) - list[j][k]) < 1e-6) return;
          const input = el.querySelector("." + c);
          input.value = list[j][k];
          fire(input);
        }),
      );
    });
    if (s.zoom) set("zoom", s.zoom);
  }

  // The pronunciation dictionary loads asynchronously, and text can't become phonemes until it has.
  const dictLoaded = () => {
    for (const k in TextToIPA._IPADict) return true;
    return false;
  };
  const start = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s) restore(s);
    } catch (err) {
      console.warn("Couldn't restore saved state", err);
    }
    restoring = false; // saving stays off until now so a half-loaded page can't overwrite the saved state
  };
  const waitForDict = (tries = 0) =>
    dictLoaded() || tries > 300
      ? start()
      : setTimeout(() => waitForDict(tries + 1), 50);
  waitForDict();
  document.addEventListener("input", persist, true);
  document.addEventListener("change", persist, true);
  window.addEventListener("beforeunload", save);

  const btn = document.createElement("button");
  btn.textContent = "reset";
  btn.style.marginLeft = "auto";
  document.querySelector("header").append(btn);
  let armed = 0;
  btn.onclick = () => {
    if (!armed) {
      btn.textContent = "click again to reset";
      armed = setTimeout(() => {
        armed = 0;
        btn.textContent = "reset";
      }, 3000);
      return;
    }
    clearTimeout(armed);
    clearTimeout(timer);
    resetting = true;
    try {
      localStorage.removeItem(KEY);
    } catch (err) {}
    location.reload();
  };
})();
