const { send } = setupConnection("midi", (message) => {
  // FILL
  console.log("message", message);
});

const _send = (message) => {
  send({
    to: ["pink-trombone", "machine-learning", "mfcc", "knn", "tts", "lip-sync"],
    type: "message",
    ...message,
  });
};

const throttledSend = throttle((message) => {
  _send(message);
}, 100);

_send({ "vibrato.wobble": 0.0, voiceness: 1 });

// TONE
/** @type {import("tone")} */
const Tone = window.Tone;

// KEYBOARD
const keyToNote = {
  a: "C4",
  s: "D4",
  d: "E4",
  f: "F4",
  g: "G4",
  h: "A4",
  j: "B4",
  k: "C5",
  l: "D5",
  ";": "E5",
  "'": "F5",

  w: "C#4",
  e: "D#4",

  t: "F#4",
  y: "G#4",
  u: "A#4",

  o: "C#5",
  p: "D#5",

  "]": "F#5",
};
/** @type {Record<string, boolean>} */
const isKeyDown = {};
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select")) {
    return;
  }
  const { key } = event;
  if (isKeyDown[key]) {
    return;
  }
  isKeyDown[key] = true;
  console.log(`keydown "${key}"`);

  const note = keyToNote[key];

  if (note) {
    onFrequency(
      Tone.Frequency(note).transpose(
        (WebMidi.octaveOffset - baseOctaveOffset) * 12
      )
    );
    event.preventDefault();
  }
});
document.addEventListener("keyup", (event) => {
  if (event.target.closest("input")) {
    return;
  }
  const { key } = event;
  if (!isKeyDown[key]) {
    return;
  }
  isKeyDown[key] = false;
  console.log(`keyup "${key}"`);

  const note = keyToNote[key];

  if (note) {
    offFrequency(
      Tone.Frequency(note).transpose(
        (WebMidi.octaveOffset - baseOctaveOffset) * 12
      )
    );
    event.preventDefault();
  }
});

// MODE
/** @typedef {"pitch" | "phoneme" | "utterance" | "tts" | "pts"} Mode */
/** @type {Mode[]} */
const modes = ["pitch", "phoneme", "utterance", "tts", "pts"];
/** @type {Mode} */
let mode = "pitch";
/** @param {Mode} newMode */
const setMode = (newMode) => {
  mode = newMode;
  console.log({ mode });
  modeSelect.value = mode;
};
/** @type {HTMLSelectElement} */
const modeSelect = document.getElementById("mode");
const modeOptgroup = modeSelect.querySelector("optgroup");
modes.forEach((mode) => {
  modeOptgroup.appendChild(new Option(mode));
});
modeSelect.addEventListener("input", () => setMode(modeSelect.value));

// FREQUENCY

const frequencySpan = document.getElementById("frequency");
const attackVelocitySpan = document.getElementById("attackVelocity");
const releaseVelocitySpan = document.getElementById("releaseVelocity");

const throttledOnFrequencySend = throttle((message) => {
  _send(message);
}, 100);
const throttledOffFrequencySend = throttle((message) => {
  _send(message);
}, 100);

let ignoreMidi = false;
let latestFrequency = Tone.Frequency("C4");
/** @param {Frequency} frequency */
const onFrequency = (frequency, velocity = 0.5) => {
  if (ignoreMidi) {
    return;
  }
  clearDownFrequencies();
  const index = getDownFrequencyIndex(frequency);
  if (index != -1) {
    return;
  }
  if (downFrequencies.length >= maxDownFrequencyLength) {
    return;
  }

  downFrequencies.push(frequency);
  console.log({ note: frequency.toNote(), downFrequencies });

  frequencySpan.innerText = `${frequency.toNote()} (${Math.round(
    frequency.toFrequency()
  )}Hz)`;
  attackVelocitySpan.innerText = velocity.toFixed(2);

  latestFrequency = Tone.Frequency(frequency);

  const message = {
    frequency: frequency.toFrequency(),
    intensity: velocity,
    holdLastKeyframe: true,
  };
  switch (mode) {
    case "pitch":
      break;
    case "phoneme":
      {
        const phoneme = phonemeSelect.value;
        if (phoneme.length > 0) {
          if (true) {
            Object.assign(message, { phoneme });
          } else {
            Object.assign(message, {
              utterance: {
                name: phoneme,
                keyframes: RenderKeyframes(generateKeyframes(phoneme)),
              },
            });
          }
        } else {
          console.error("no phoneme selected");
        }
      }
      break;
    case "utterance":
      {
        const utterance = utteranceSelect.value;
        if (utterance.length > 0) {
          Object.assign(message, { utterance });
        } else {
          console.error("no utterance selected");
        }
      }
      break;
    case "tts":
      {
        const text = ttsInput.value;
        Object.assign(message, { text });
      }
      break;
    case "pts":
      {
        const phonemes = ptsInput.value;
        Object.assign(message, { phonemes });
      }
      break;
    default:
      console.error(`uncaught mode "${mode}"`);
      break;
  }
  console.log("message", message);
  _send(message);

  playButton.innerText = "stop";
};
/** @param {Frequency} frequency */
const offFrequency = (frequency, velocity = 0.5) => {
  const downFrequencyIndex = getDownFrequencyIndex(frequency);
  const downFrequency = downFrequencies[downFrequencyIndex];

  if (downFrequency) {
    downFrequencies.splice(downFrequencyIndex, 1);
  } else {
    //console.error("downFrequency not found", frequency);
    return;
  }

  console.log({ note: frequency.toNote(), downFrequencies });

  releaseVelocitySpan.innerText = velocity.toFixed(2);

  _send({ intensity: 0 });

  playButton.innerText = "play";
};

const playButton = document.getElementById("play");
playButton.addEventListener("mousedown", () => {
  if (!latestFrequency) {
    return;
  }
  onFrequency(latestFrequency);
});
playButton.addEventListener("mouseup", () => {
  if (!latestFrequency) {
    return;
  }
  offFrequency(latestFrequency);
});

// WEBMIDI

/** @typedef {import("webmidi").WebMidi} WebMidi */
/** @typedef {import("webmidi").InputEventMap} InputEventMap */

const baseOctaveOffset = 0;

/** @type {WebMidi} */
const WebMidi = window.WebMidi;
WebMidi.octaveOffset = baseOctaveOffset;

const octaveOffsetInput = document.getElementById("octaveOffset");
octaveOffsetInput.addEventListener("input", () => {
  setOctaveOffset(+octaveOffsetInput.value);
});
const setOctaveOffset = (octaveOffset) => {
  WebMidi.octaveOffset = octaveOffset;
  console.log({ octaveOffset });
  octaveOffsetInput.value = WebMidi.octaveOffset;
  clearDownFrequencies();
};

/** @typedef {import("tone").FrequencyClass} Frequency */
/** @type {Frequency[]} */
const downFrequencies = [];
const maxDownFrequencyLength = 1;
const clearDownFrequencies = () => {
  downFrequencies.forEach((downFrequency) => {
    offFrequency(downFrequency);
  });
};
/** @param {Frequency} frequency */
const getDownFrequencyIndex = (frequency) => {
  const index = downFrequencies.findIndex(
    (_frequency) => _frequency.toMidi() == frequency.toMidi()
  );
  return index;
};
/** @param {Frequency} frequency */
const getDownFrequency = (frequency) => {
  return downFrequencies.find(
    (_frequency) => _frequency.toMidi() == frequency.toMidi()
  );
};

const applyVelocityCurve = (velocity) => Math.max(0.5, velocity);
/** @type {InputEventMap["noteon"]} */
const onWebMidiNoteOn = (event) => {
  const { note, message, type, value } = event;
  const { channel } = message;
  const { number, attack } = note;
  console.log({ type, note, channel });
  if (channel == 1) {
    const frequency = Tone.Midi(number);
    onFrequency(frequency, applyVelocityCurve(attack));
  } else {
    // FILL - pads
  }

  setMidiMessagePre({ type, channel, number, attack });
};
/** @type {InputEventMap["noteoff"]} */
const onWebMidiNoteOff = (event) => {
  const { note, message, type } = event;
  const { channel } = message;
  const { release, number } = note;
  if (channel == 1) {
    const frequency = Tone.Midi(number);
    offFrequency(frequency, applyVelocityCurve(release));
  } else {
    // FILL - pads
  }

  setMidiMessagePre({ type, channel, number, release });
};

/** @type {InputEventMap["channelaftertouch"]} */
const onWebMidiChannelAfterTouch = (event) => {
  const { value, message, type } = event;
  const { channel } = message;
  setMidiMessagePre({
    type,
    channel,
    value,
  });
};

/** @type {InputEventMap["controlchange"]} */
const onWebMidiControlChange = (event) => {
  const { value, message, controller, type } = event;
  const { channel } = message;
  const { number } = controller;
  setMidiMessagePre({
    type,
    channel,
    value,
    number,
  });
};

try {
  await WebMidi.enable();
  WebMidi.inputs.forEach((webMidiInput) => {
    if (ignoreMidi) {
      return;
    }
    webMidiInput.addListener("noteon", onWebMidiNoteOn);
    webMidiInput.addListener("noteoff", onWebMidiNoteOff);

    webMidiInput.addListener("channelaftertouch", onWebMidiChannelAfterTouch);
    webMidiInput.addListener("controlchange", onWebMidiControlChange);
  });
} catch (error) {
  console.error(error);
}

// PHONEMES

const phonemeSelect = document.getElementById("phoneme");
const consonantsOptgroup = document.getElementById("consonants");
const vowelsOptgroup = document.getElementById("vowels");
for (const phoneme in phonemes) {
  const { example, type } = phonemes[phoneme];
  const option = new Option(`${phoneme} (${example})`, phoneme);
  const optgroup = type == "consonant" ? consonantsOptgroup : vowelsOptgroup;
  optgroup.appendChild(option);
}
phonemeSelect.addEventListener("input", () => {
  if (phonemeSelect.value.length) {
    setMode("phoneme");
    playButton.click();
  } else {
    setMode("pitch");
  }
  phonemeSelect.blur();
});

// UTTERANCES
const utteranceSelect = document.getElementById("utterance");
utterances.forEach(({ name }, index) => {
  const option = new Option(name, index);
  utteranceSelect.appendChild(option);
});
utteranceSelect.addEventListener("input", () => {
  if (utteranceSelect.value.length) {
    setMode("utterance");
    playButton.click();
  } else {
    setMode("pitch");
  }
  utteranceSelect.blur();
});

// TTS
const ttsInput = document.getElementById("ttsInput");
ttsInput.addEventListener("input", (event) => {
  const string = event.target.value;
  if (string.length > 0) {
    setMode("tts");
    if (string.endsWith("\n")) {
      event.target.value = string.slice(0, -1);
      playButton.click();
    }
  } else {
    setMode("pitch");
  }
});

// PTS
const ptsInput = document.getElementById("ptsInput");
ptsInput.addEventListener("input", (event) => {
  const string = event.target.value;
  if (string.length > 0) {
    setMode("pts");
    if (string.endsWith("\n")) {
      event.target.value = string.slice(0, -1);
      playButton.click();
    }
  } else {
    setMode("pitch");
  }
});

// MIDI MESSAGE
/** @type {HTMLPreElement} */
const midiMessagePre = document.getElementById("midiMessage");
const setMidiMessagePre = (message) => {
  midiMessagePre.textContent = JSON.stringify(message, null, 2);
};
