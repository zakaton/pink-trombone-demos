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
  if (event.target.closest("input")) {
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
      Tone.Frequency(note).transpose((WebMidi.octaveOffset - 1) * 12)
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
      Tone.Frequency(note).transpose((WebMidi.octaveOffset - 1) * 12)
    );
    event.preventDefault();
  }
});

// FREQUENCY

const throttledOnFrequencySend = throttle((message) => {
  _send(message);
}, 100);
const throttledOffFrequencySend = throttle((message) => {
  _send(message);
}, 100);

let ignoreMidi = false;
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

  const message = { frequency: frequency.toFrequency(), intensity: velocity };
  // FILL - set phoneme/utterance/etc based on mode
  _send(message);
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

  _send({ intensity: 0 });
};

// WEBMIDI

/** @typedef {import("webmidi").WebMidi} WebMidi */
/** @typedef {import("webmidi").InputEventMap} InputEventMap */

/** @type {WebMidi} */
const WebMidi = window.WebMidi;
WebMidi.octaveOffset = 1;

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
  const { note, message } = event;
  const { channel } = message;
  console.log(event.type, { note, channel });
  if (channel == 1) {
    const frequency = Tone.Midi(note.number);
    onFrequency(frequency, applyVelocityCurve(note.attack));
  } else {
    // FILL
  }
};
/** @type {InputEventMap["noteoff"]} */
const onWebMidiNoteOff = (event) => {
  const { note, message } = event;
  const { channel } = message;
  console.log(event.type, { note, channel });
  if (channel == 1) {
    const frequency = Tone.Midi(note.number);
    offFrequency(frequency, applyVelocityCurve(note.release));
  } else {
    // FILL
  }
};

/** @type {InputEventMap["channelaftertouch"]} */
const onWebMidiChannelAfterTouch = (event) => {
  const { value, message } = event;
  const { channel } = message;
  console.log(event.type, { value, channel });
};

/** @type {InputEventMap["controlchange"]} */
const onWebMidiControlChange = (event) => {
  const { value, message, controller } = event;
  const { channel } = message;
  console.log(event.type, { value, channel, controller: controller.number });
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
