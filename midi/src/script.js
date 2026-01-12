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
  // console.log(`keydown "${key}"`);

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
  // console.log(`keyup "${key}"`);

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
/** @typedef {"pitch" | "phoneme" | "utterance" | "tts" | "pts" | "tts2"} Mode */
/** @type {Mode[]} */
const modes = ["pitch", "phoneme", "utterance", "tts", "pts", "tts2"];
/** @type {Mode} */
let mode = "pitch";
/** @param {Mode} newMode */
const setMode = (newMode) => {
  if (mode == newMode) {
    return;
  }
  mode = newMode;
  console.log({ mode });
  modeSelect.value = mode;
};
/** @type {HTMLSelectElement} */
const modeSelect = document.getElementById("mode");
const modeOptgroup = modeSelect.querySelector("optgroup");
modes.forEach((mode) => {
  switch (mode) {
    case "utterance":
      return;
  }
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
  // console.log({ note: frequency.toNote(), downFrequencies });

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
      delete message.intensity;
      {
        const phoneme = phonemeSelect.value;
        if (phoneme.length > 0) {
          Object.assign(message, {
            utterance: {
              name: phoneme,
              keyframes: RenderKeyframes(generateKeyframes(phoneme)),
            },
          });
        } else {
          console.error("no phoneme selected");
        }
      }
      break;
    case "utterance":
      {
        delete message.intensity;

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
        delete message.intensity;
        Object.assign(message, { text });
      }
      break;
    case "pts":
      {
        const phonemes = ptsInput.value;
        delete message.intensity;

        Object.assign(message, { phonemes });
      }
      break;
    case "tts2":
      Object.assign(message, { playTts: true });
      delete message.intensity;
      break;
    default:
      console.error(`uncaught mode "${mode}"`);
      delete message.intensity;
      break;
  }
  //console.log("sending message", message);
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

  //console.log({ note: frequency.toNote(), downFrequencies });

  releaseVelocitySpan.innerText = velocity.toFixed(2);

  let message = {
    frequency: frequency.toFrequency(),
    //intensity: velocity,
    lastKeyframe: true,
  };
  switch (mode) {
    case "pitch":
      message.intensity = 0;
      break;
    case "phoneme":
      if (false) {
        message.intensity = 0;
      } else {
        const phoneme = phonemeSelect.value;
        if (phoneme.length > 0) {
          const keyframes = RenderKeyframes(generateKeyframes(phoneme));
          if (keyframes.length == 1) {
            message.intensity = 0;
          } else {
            Object.assign(message, {
              utterance: {
                name: phoneme,
                keyframes: RenderKeyframes(generateKeyframes(phoneme)).slice(
                  -1
                ),
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
    case "tts2":
      Object.assign(message, { playTts: true });
      break;
    default:
      console.error(`uncaught mode "${mode}"`);
      break;
  }
  // console.log("sending message", message);
  _send(message);

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

/** @type {{channel: number, number: number}?} */
let latestNonKeyNote;
const applyVelocityCurve = (velocity) => 0.8 ?? Math.max(0.5, velocity);
/** @type {InputEventMap["noteon"]} */
const onWebMidiNoteOn = (event) => {
  const { note, message, type } = event;
  const { channel } = message;
  const { number, attack } = note;
  // console.log({ type, note, channel });
  if (channel == 1) {
    const frequency = Tone.Midi(number);
    onFrequency(frequency, applyVelocityCurve(attack));
  } else {
    latestNonKeyNote = { number, channel };
  }
  setMidiMessagePre({ type, channel, number, attack });
  midiMaps.forEach((map) => {
    map.onWebMidiNoteOn(event);
  });
};
/** @type {InputEventMap["noteoff"]} */
const onWebMidiNoteOff = (event) => {
  const { note, message, type } = event;
  const { channel } = message;
  const { release, number } = note;
  if (channel == 1) {
    const frequency = Tone.Midi(number);
    offFrequency(frequency, applyVelocityCurve(release));
  }

  setMidiMessagePre({ type, channel, number, release });

  midiMaps.forEach((map) => {
    map.onWebMidiNoteOff(event);
  });
};

/** @type {InputEventMap["channelaftertouch"]} */
const onWebMidiChannelAfterTouch = (event) => {
  const { value, message, type } = event;
  const { channel } = message;
  setMidiMessagePre({
    type,
    channel,
    number: latestNonKeyNote.number,
    value,
  });
  midiMaps.forEach((map) => {
    map.onWebMidiChannelAfterTouch(event);
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
    number,
    value,
  });
  midiMaps.forEach((map) => {
    map.onWebMidiControlChange(event);
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

// WHISPER
let isWhispering = false;
const whisperCheckbox = document.getElementById("whisper");
whisperCheckbox.addEventListener("input", () => {
  setIsWhispering(whisperCheckbox.checked);
});
const setIsWhispering = (newIsWhispering) => {
  isWhispering = newIsWhispering;
  console.log({ isWhispering });
  _send({ isWhispering });
  whisperCheckbox.checked = isWhispering;
};

// SPEED
let speed = 1.0;
const speedInput = document.getElementById("speed");
speedInput.addEventListener("input", () => {
  setSpeed(+speedInput.value);
});
const setSpeed = (newSpeed) => {
  speed = newSpeed;
  console.log({ speed });
  _send({ speed });
  speedInput.value = speed;
};

// MIDI MESSAGE
/** @type {HTMLPreElement} */
const midiMessagePre = document.getElementById("midiMessage");
const setMidiMessagePre = (message) => {
  midiMessagePre.textContent = JSON.stringify(message, null, 2);
};

// MIDI MAPPING
/**
 * @typedef {"frequency" |
 * "tongue.index" |
 * "tongue.diameter" |
 * "frontConstriction.index" |
 * "frontConstriction.diameter" |
 * "backConstriction.index" |
 * "backConstriction.diameter" |
 * "tenseness" |
 * "loudness" |
 * "intensity" |
 * "tractLength" |
* "voiceness" |
* "vibrato.frequency" |
* "vibrato.gain" |
* "vibrato.wobble"
* } MidiMapType

/** @type {MidiMapType[]} */
const midiMapTypes = [
  "frequency",

  "tongue.index",
  "tongue.diameter",

  "frontConstriction.index",
  "frontConstriction.diameter",

  "backConstriction.index",
  "backConstriction.diameter",

  "tenseness",
  "loudness",

  "intensity",

  "tractLength",

  "voiceness",

  "vibrato.frequency",
  "vibrato.gain",
  "vibrato.wobble",
];

/** @type {Record<MidiMapType, MidiRange>} */
const midiMapTypeRanges = {
  frequency: { min: 20, max: 990 },

  "tongue.index": { min: 12, max: 29 },
  "tongue.diameter": { min: 1.7, max: 4.5 },

  "frontConstriction.index": { min: 28, max: 44 },
  "frontConstriction.diameter": { min: -1.6, max: 3 },

  "backConstriction.index": { min: 2, max: 16 },
  "backConstriction.diameter": { min: -1.6, max: 3 },

  tenseness: { min: 0, max: 1 },
  loudness: { min: 0, max: 1 },
  intensity: { min: 0, max: 1 },
  voiceness: { min: 0, max: 1 },

  "vibrato.frequency": { min: 0, max: 10 },
  "vibrato.gain": { min: 0, max: 1 },
  "vibrato.wobble": { min: 0, max: 1 },

  tractLength: { min: 15, max: 88 },
};

/** @typedef {{min: number, max: number}} MidiRange */
/**
 * @typedef MidiMap
 * @type {Object}
 * @property {string} name
 * @property {number} channel
 * @property {number} number
 * @property {MidiMapType} type
 * @property {MidiRange} inputRange
 * @property {MidiRange} outputRange
 * @property {boolean} isRelative
 * @property {boolean} ignore
 * @property {InputEventMap["noteon"]} onWebMidiNoteOn
 * @property {InputEventMap["noteoff"]} onWebMidiNoteOff
 * @property  {InputEventMap["channelaftertouch"]} onWebMidiChannelAfterTouch
 * @property {InputEventMap["controlchange"]} onWebMidiControlChange
 */
/** @type {MidiMap[]?} */
let midiMaps = [];

const mappingContainer = document.getElementById("mapping");
/** @type {HTMLTemplateElement} */
const mapTemplate = document.getElementById("mapTemplate");

function lerp(from, to, interpolation) {
  return (1 - interpolation) * from + interpolation * to;
}
function inverseLerp(from, to, value) {
  if (from !== to) {
    return (value - from) / (to - from);
  } else {
    return 0;
  }
}

const addMapButton = document.getElementById("addMap");
/** @param {MidiMap} map */
const addMap = (map) => {
  map = map ?? {
    name: `map${midiMaps.length}`,
    channel: 1,
    number: 0,

    type: "frequency",

    inputRange: { min: 0, max: 1 },
    outputRange: { min: 0, max: 1 },

    isRelative: false,
    ignore: false,
  };
  midiMaps.push(map);
  console.log("midiMaps", midiMaps);

  /** @type {HTMLElement} */
  const mapContainer = mapTemplate.content
    .cloneNode(true)
    .querySelector(".map");

  mapContainer.querySelector(".delete").addEventListener("click", () => {
    mapContainer.remove();
    midiMaps.splice(midiMaps.indexOf(map), 1);
    console.log("midiMaps", midiMaps);
  });

  const nameInput = mapContainer.querySelector(".name");
  nameInput.value = map.name;
  nameInput.addEventListener("input", () => {
    map.name = nameInput.value;
    console.log("name", map.name);
  });

  const numberInput = mapContainer.querySelector(".number");
  numberInput.value = map.number;
  numberInput.addEventListener("input", () => {
    map.number = +numberInput.value;
    console.log("number", map.number);
  });

  const channelInput = mapContainer.querySelector(".channel");
  channelInput.value = map.channel;
  channelInput.addEventListener("input", () => {
    map.channel = +channelInput.value;
    console.log("channel", map.channel);
  });

  const inputRangeMinInput = mapContainer.querySelector(".inputRangeMin");
  inputRangeMinInput.value = map.inputRange.min;
  inputRangeMinInput.addEventListener("input", () => {
    map.inputRange.min = +inputRangeMinInput.value;
    console.log("inputRangeMin", map.inputRange.min);
  });
  const inputRangeMaxInput = mapContainer.querySelector(".inputRangeMax");
  inputRangeMaxInput.value = map.inputRange.max;
  inputRangeMaxInput.addEventListener("input", () => {
    map.inputRange.max = +inputRangeMaxInput.value;
    console.log("inputRangeMax", map.inputRange.max);
  });

  /** @type {HTMLInputElement} */
  const outputRangeMinInput = mapContainer.querySelector(".outputRangeMin");
  outputRangeMinInput.value = map.outputRange.min;
  outputRangeMinInput.addEventListener("input", () => {
    map.outputRange.min = +outputRangeMinInput.value;
    console.log("outputRangeMin", map.outputRange.min);
  });
  /** @type {HTMLInputElement} */
  const outputRangeMaxInput = mapContainer.querySelector(".outputRangeMax");
  outputRangeMaxInput.value = map.outputRange.max;
  outputRangeMaxInput.addEventListener("input", () => {
    map.outputRange.max = +outputRangeMaxInput.value;
    console.log("outputRangeMax", map.outputRange.max);
  });

  const updateOutputRange = () => {
    const range = midiMapTypeRanges[map.type] ?? { min: 0, max: 1 };
    if (false) {
      outputRangeMinInput.min = range.min;
      outputRangeMaxInput.max = range.max;
    }
    map.outputRange.min = range.min;
    outputRangeMinInput.value = range.min;

    map.outputRange.max = range.max;
    outputRangeMaxInput.value = range.max;
  };

  const typeSelect = mapContainer.querySelector(".type");
  typeSelect.value = map.type;
  updateOutputRange();
  typeSelect.addEventListener("input", () => {
    map.type = typeSelect.value;
    console.log("type", map.type);
    updateOutputRange();
  });
  const typeOptgroup = typeSelect.querySelector("optgroup");
  midiMapTypes.forEach((type) => {
    typeOptgroup.appendChild(new Option(type));
  });

  /** @type {HTMLInputElement} */
  const autoMapCheckbox = mapContainer.querySelector(".autoMap");
  /** @type {HTMLInputElement} */
  const ignoreCheckbox = mapContainer.querySelector(".ignore");
  ignoreCheckbox.checked = map.ignore;
  ignoreCheckbox.addEventListener("input", () => {
    map.ignore = ignoreCheckbox.checked;
    console.log("ignore", map.ignore);
  });
  /** @type {HTMLInputElement} */
  const valueInput = mapContainer.querySelector(".value");
  /** @type {HTMLInputElement} */
  const outputValueInput = mapContainer.querySelector(".outputValue");

  /** @type {HTMLInputElement} */
  const isRelativeCheckbox = mapContainer.querySelector(".isRelative");
  isRelativeCheckbox.checked = map.isRelative;
  isRelativeCheckbox.addEventListener("input", () => {
    map.isRelative = isRelativeCheckbox.checked;
    console.log("isRelative", map.isRelative);
  });

  /**
   * @param {number} channel
   * @param {number} number
   */
  const matches = (channel, number) => {
    if (map.ignore) {
      return false;
    }
    if (autoMapCheckbox.checked) {
      channelInput.value = channel;
      numberInput.value = number;
      Object.assign(map, { channel, number });
    }
    return map.channel == channel && map.number == number;
  };

  /** @param {number} value */
  const onValue = (value) => {
    valueInput.value = value;

    let interpolation = inverseLerp(
      map.inputRange.min,
      map.inputRange.max,
      value
    );
    interpolation = Math.max(0, Math.min(1, interpolation));

    let outputValue = lerp(
      map.outputRange.min,
      map.outputRange.max,
      interpolation
    );
    outputValue = Math.max(
      map.outputRange.min,
      Math.min(map.outputRange.max, outputValue)
    );

    outputValueInput.value = outputValue;

    // console.log({ value, interpolation, outputValue });

    const { isRelative } = map;
    _send({ [map.type]: outputValue, isRelative });
  };

  map.onWebMidiNoteOn = (event) => {
    const { note, message, type } = event;
    const { channel } = message;
    const { number, attack } = note;
    if (!matches(channel, number)) {
      return;
    }
    onValue(attack);
  };
  map.onWebMidiNoteOff = (event) => {
    const { note, message, type } = event;
    const { channel } = message;
    const { release, number } = note;
    if (!matches(channel, number)) {
      return;
    }
    onValue(release);
  };
  map.onWebMidiChannelAfterTouch = (event) => {
    const { value, message, type } = event;
    const { channel } = message;
    const number = latestNonKeyNote.number;
    if (!matches(channel, number)) {
      return;
    }
    onValue(value);
  };
  map.onWebMidiControlChange = (event) => {
    const { value, message, controller, type } = event;
    const { channel } = message;
    const { number } = controller;
    if (!matches(channel, number)) {
      return;
    }
    onValue(value);
  };

  mappingContainer.appendChild(mapContainer);
};
addMapButton.addEventListener("click", () => {
  addMap();
});
/** @type {HTMLInputElement} */
const loadMappingInput = document.getElementById("loadMapping");
loadMappingInput.addEventListener("input", () => {
  // FILL
  loadMappingInput.value = "";
});
const saveMappingButton = document.getElementById("saveMapping");
saveMappingButton.addEventListener("click", () => {
  // FILL
});

// FILL - save/load to/from localStorage
// FILL - load from paste (file or text)
