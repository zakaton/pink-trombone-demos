const { send } = setupConnection("gamepad", (message) => {
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

_send({
  "vibrato.wobble": 0.0,
  "vibrato.gain": 0.0,
  intensity: 0,
  voiceness: 0.9,
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

// TONE
/** @type {import("tone")} */
const Tone = window.Tone;

// GAMEPAD MESSAGE
/** @type {HTMLPreElement} */
const gamepadMessagePre = document.getElementById("gamepadMessage");
const setGamepadMessagePre = (message) => {
  gamepadMessagePre.textContent = JSON.stringify(
    message,
    (_, value) => {
      if (typeof value === "number") {
        return Number(value.toFixed(3));
      }
      return value;
    },
    2
  );
};

// GAMEPAD
/** @type {Record<number, Gamepad>} */
const gamepads = {};
window.gamepads = gamepads;

/**
 * @typedef GamepadThumbstick
 * @type {Object}
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} magnitude
 */

/** @type {Record<number, number>} */
const gamepadTimestamps = {};
/** @type {Record<number, number[]>} */
const gamepadAxes = {};
/** @type {Record<number, GamepadThumbstick[]>} */
const gamepadThumbsticks = {};
/** @type {Record<number, GamepadButton[]>} */
const gamepadButtons = {};

/**
 * @param {GamepadEvent} e
 * @param {boolean} connected
 */
const onGamepadConnection = (e, connected) => {
  const { gamepad } = e;
  console.log({ connected }, gamepad);
  if (connected) {
    gamepads[gamepad.index] = gamepad;
  } else {
    delete gamepads[gamepad.index];
  }

  if (Object.keys(gamepads).length > 0 && !isCheckingGamepads) {
    isCheckingGamepads = true;
    checkGamepads();
  }
};

window.axisDifferenceThreshold = 0.0001;
window.axisThreshold = 0.02;
window.thumbstickMagnitudeThreshold = 0.03;
window.thumbstickMagnitudeDifferenceThreshold = 0.001;
window.thumbstickAngleDifferenceThreshold = 0.001;
window.pressedButtonDifferenceThreshold = 0.001;
window.buttonValueDifferenceThreshold = 0.0;
window.buttonValueThreshold = 0.0;

/**
 * @typedef GamepadAxisChange
 * @type {Object}
 * @property {number} index
 * @property {number} value
 */
/**
 * @typedef GamepadButtonChange
 * @type {Object}
 * @property {number} index
 * @property {number?} value
 * @property {boolean?} pressed
 * @property {boolean?} touched
 */
/**
 * @typedef GamepadThumbstickChange
 * @type {Object}
 * @property {number} index
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} magnitude
 */
/**
 * @typedef GamepadChange
 * @type {Object}
 * @property {GamepadAxisChange[]} axes
 * @property {GamepadButtonChange[]} buttons
 * @property {GamepadThumbstickChange[]} thumbsticks
 */

let isCheckingGamepads = false;
const checkGamepads = () => {
  const gamepads = navigator.getGamepads();
  if (!gamepads.some(Boolean)) {
    return;
  }

  /** @type {Record<number, GamepadChange>} */
  const allChanges = {};
  /** @type {Record<number, GamepadChange>} */
  const allNonzeroValues = {};

  let didUpdate = false;

  navigator.getGamepads().forEach((gamepad, index) => {
    if (!gamepad) {
      return;
    }
    if (!gamepad.connected) {
      return;
    }
    if (gamepad.mapping != "standard") {
      return;
    }
    const { timestamp } = gamepad;
    if (gamepadTimestamps[index] == timestamp) {
      return;
    }
    gamepadTimestamps[index] = timestamp;
    didUpdate = true;

    const axes = gamepad.axes.map((value, index) => {
      if (Math.abs(value) < axisThreshold) {
        return 0;
      }
      const sign = index % 2 ? -1 : 1;
      return value * sign;
    });
    const _axes = gamepadAxes[index] ?? axes.slice().fill(0);

    /** @type {GamepadAxisChange[]} */
    const changedAxes = [];
    axes.forEach((value, index) => {
      const axisDifference = Math.abs(value - _axes[index]);
      //console.log({ axisDifference });
      if (axisDifference > axisDifferenceThreshold) {
        changedAxes.push({ index, value });
      }
    });
    if (false && changedAxes.length > 0) {
      console.log("changedAxes", ...changedAxes);
    }
    gamepadAxes[index] = axes;

    /** @type {GamepadAxisChange[]} */
    const nonzeroAxes = [];
    axes.forEach((value, index) => {
      if (value != 0) {
        nonzeroAxes.push({ index, value });
      }
    });
    if (false && nonzeroAxes.length > 0) {
      console.log("nonzeroAxes", ...nonzeroAxes);
    }

    /** @type {GamepadThumbstick[]} */
    const thumbsticks = [];
    gamepad.axes.forEach((axis, axisIndex, axes) => {
      if (axisIndex % 2) {
        return;
      }
      const x = axis;
      const y = -axes[axisIndex + 1];
      let magnitude = Math.sqrt(x ** 2 + y ** 2);
      if (magnitude < thumbstickMagnitudeThreshold) {
        magnitude = 0;
      }
      let angle = magnitude > 0 ? Math.atan2(y, x) : 0;
      if (angle < 0) angle += 2 * Math.PI;
      angle = (180 * angle) / Math.PI;
      thumbsticks.push({ x, y, angle, magnitude });
    });
    const _thumbsticks =
      gamepadThumbsticks[index] ??
      thumbsticks.map(() => ({ x: 0, y: 0, angle: 0, magnitude: 0 }));
    /** @type {GamepadThumbstickChange[]} */
    const changedThumbsticks = [];
    thumbsticks.forEach((thumbstick, index) => {
      const _thumbstick = _thumbsticks[index];

      const angleDifference = Math.abs(thumbstick.angle - _thumbstick.angle);
      const magnitudeDifference = Math.abs(
        thumbstick.magnitude - _thumbstick.magnitude
      );
      //console.log({ angleDifference, magnitudeDifference });
      if (
        angleDifference > thumbstickAngleDifferenceThreshold ||
        magnitudeDifference > thumbstickMagnitudeDifferenceThreshold
      ) {
        changedThumbsticks.push({ ..._thumbstick, index });
      }
    });
    if (false && changedThumbsticks.length > 0) {
      console.log("changedThumbsticks", ...changedThumbsticks);
    }
    gamepadThumbsticks[index] = thumbsticks;

    /** @type {GamepadThumbstickChange[]} */
    const nonzeroThumbsticks = [];
    thumbsticks.forEach((thumbstick, index) => {
      if (thumbstick.magnitude > 0) {
        nonzeroThumbsticks.push({ ...thumbstick, index });
      }
    });
    if (false && nonzeroThumbsticks.length > 0) {
      console.log("nonzeroThumbsticks", ...nonzeroThumbsticks);
    }

    const buttons = gamepad.buttons.map((button) => {
      let { pressed, touched, value } = button;
      value = Math.abs(value) < buttonValueThreshold ? 0 : value;
      return { pressed, touched, value };
    });
    const _buttons =
      gamepadButtons[index] ??
      buttons.map(() => ({ pressed: false, touched: false, value: 0 }));

    /** @type {GamepadButtonChange[]} */
    const changedButtons = [];
    buttons.forEach((button, index) => {
      const changedButton = { index };
      let didButtonChange = false;

      const _button = _buttons[index];

      if (button.pressed != _button.pressed) {
        didButtonChange = true;
        changedButton.pressed = button.pressed;
      }

      if (button.touched != _button.touched) {
        didButtonChange = true;
        changedButton.touched = button.touched;
      }

      const valueDifference = Math.abs(button.value - _button.value);
      //console.log({ valueDifference });
      if (valueDifference > buttonValueDifferenceThreshold) {
        didButtonChange = true;
        changedButton.value = button.value;
      }

      if (didButtonChange) {
        changedButtons.push(changedButton);
      }
    });
    if (false && changedButtons.length > 0) {
      console.log("changedButtons", ...changedButtons);
    }
    gamepadButtons[index] = buttons;

    /** @type {GamepadButtonChange[]} */
    const nonzeroButtons = [];
    buttons.forEach((button, index) => {
      const nonzeroButton = { index };
      let isButtonNonzero = false;

      if (button.touched) {
        isButtonNonzero = true;
        nonzeroButton.touched = button.touched;
      }

      if (button.value > 0) {
        isButtonNonzero = true;
        nonzeroButton.value = button.value;
      }

      if (button.pressed) {
        isButtonNonzero = true;
        nonzeroButton.pressed = button.pressed;
      }

      if (isButtonNonzero) {
        nonzeroButtons.push(nonzeroButton);
      }
    });
    if (false && nonzeroButtons.length > 0) {
      console.log("nonzeroButtons", ...nonzeroButtons);
    }

    if (changedAxes.length > 0 || changedButtons.length > 0) {
      allChanges[index] = {};
      if (changedAxes.length > 0) {
        allChanges[index].axes = changedAxes;
      }
      if (changedButtons.length > 0) {
        allChanges[index].buttons = changedButtons;
      }
      if (changedThumbsticks.length > 0) {
        allChanges[index].thumbsticks = changedThumbsticks;
      }
    }

    if (nonzeroAxes.length > 0 || nonzeroButtons.length > 0) {
      allNonzeroValues[index] = {};
      if (nonzeroAxes.length > 0) {
        allNonzeroValues[index].axes = nonzeroAxes;
      }
      if (nonzeroButtons.length > 0) {
        allNonzeroValues[index].buttons = nonzeroButtons;
      }
      if (nonzeroThumbsticks.length > 0) {
        allNonzeroValues[index].thumbsticks = nonzeroThumbsticks;
      }
    }
  });

  if (didUpdate) {
    if (true) {
      setGamepadMessagePre(allNonzeroValues);
    } else {
      if (Object.keys(allChanges).length > 0) {
        setGamepadMessagePre(allChanges);
      }
    }

    Object.entries(allChanges).forEach(
      ([gamepadIndex, { buttons, axes, thumbsticks }]) => {
        gamepadIndex = +gamepadIndex;
        axes?.forEach((change) => {
          gamepadMaps.forEach((map) => {
            map.onAxisChange(change);
          });
        });
        buttons?.forEach((change) => {
          gamepadMaps.forEach((map) => {
            map.onButtonChange(change);
          });
        });
        thumbsticks?.forEach((change) => {
          gamepadMaps.forEach((map) => {
            map.onThumbstickChange(change);
          });
        });
      }
    );
  }

  requestAnimationFrame(checkGamepads);
};

window.addEventListener("gamepadconnected", (e) => {
  onGamepadConnection(e, true);
});
window.addEventListener("gamepaddisconnected", (e) => {
  onGamepadConnection(e, false);
});

// GAMEPAD MAPPING
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
* "vibrato.wobble" |
* "phoneme" |
* "tts" |
* "tts2" |
* "pts"
* } GamepadMapType

/** @type {GamepadMapType[]} */
const gamepadMapTypes = [
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

  "phoneme",

  "tts",
  "tts2",

  "pts",
];

/** @param {GamepadMapType} type */
const isTypeTrigger = (type) => {
  switch (type) {
    case "phoneme":
    case "tts":
    case "tts2":
    case "pts":
      return true;
    default:
      return false;
  }
};

/** @param {GamepadMapType} type */
const isTypeText = (type) => {
  switch (type) {
    case "tts":
    case "pts":
      return true;
    default:
      return false;
  }
};

/** @type {Record<GamepadMapType, ValueRange>} */
const gamepadMapTypeRanges = {
  frequency: {
    min: Tone.Frequency(20).toMidi(),
    max: Tone.Frequency(990).toMidi(),
  },

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
  "vibrato.gain": { min: 0, max: 0.5 },
  "vibrato.wobble": { min: 0, max: 1 },

  tractLength: { min: 15, max: 88 },
};

/** @typedef {"button" | "axis" | "thumbstick.x" | "thumbstick.y" | "thumbstick.angle" | "thumbstick.magnitude"} GamepadInputType */
/** @type {GamepadInputType[]} */
const gamepadMapInputTypes = [
  "button",
  "axis",
  "thumbstick.x",
  "thumbstick.y",
  "thumbstick.angle",
  "thumbstick.magnitude",
];
/** @typedef {(buttonChange: GamepadButtonChange) => void} GamepadButtonChangeEvent */
/** @typedef {(axisChange: GamepadAxisChange) => void} GamepadAxisChangeEvent */
/** @typedef {(axisChange: GamepadThumbstickChange) => void} GamepadThumbstickChangeEvent */
/** @typedef {{min: number, max: number}} ValueRange */
/**
 * @typedef GamepadMap
 * @type {Object}
 * @property {GamepadInputType} inputType
 * @property {number} index
 * @property {GamepadMapType} type
 * @property {ValueRange} inputRange
 * @property {ValueRange} outputRange
 * @property {boolean} isRelative
 * @property {boolean} ignore
 * @property {GamepadButtonChangeEvent} onButtonChange
 * @property {GamepadAxisChangeEvent} onAxisChange
 * @property {GamepadThumbstickChangeEvent} onThumbstickChange
 * @property {(value: number, overrideIsTriggered?: boolean) => void} onValue
 * @property {function} delete
 * @property {string} text
 * @property {string} phoneme
 * @property {boolean} isTrigger
 */
/** @type {GamepadMap[]?} */
let gamepadMaps = [];
const stringifyGamepadMaps = () => {
  return JSON.stringify(gamepadMaps, null, 2);
};
window.stringifyMaps = stringifyGamepadMaps;

const mappingContainer = document.getElementById("mapping");
/** @type {HTMLTemplateElement} */
const mapTemplate = document.getElementById("mapTemplate");

/**
 * @param {ValueRange} range
 * @param {number} interpolation
 */
function lerp(range, interpolation) {
  return (1 - interpolation) * range.min + interpolation * range.max;
}
/**
 * @param {ValueRange} range
 * @param {number} value
 */
function inverseLerp(range, value) {
  if (range.min !== range.max) {
    return (value - range.min) / (range.max - range.min);
  } else {
    return 0;
  }
}

const deleteAllMapsButton = document.getElementById("deleteAllMaps");
deleteAllMapsButton.addEventListener("click", () => {
  while (gamepadMaps.length > 0) {
    gamepadMaps[0].delete();
  }
});
const updateDeleteAllMapsButton = () => {
  deleteAllMapsButton.disabled = gamepadMaps.length == 0;
};

/** @type {GamepadMap[]} */
const triggeredMaps = [];

let latestFrequency;

const addMapButton = document.getElementById("addMap");
/** @param {GamepadMap} map */
const addMap = (map) => {
  const isNew = !map;
  map = map ?? {
    inputType: "button",
    index: 0,

    type: "frequency",

    inputRange: { min: 0, max: 1 },
    outputRange: { min: 0, max: 1 },

    isRelative: false,
    ignore: false,

    text: "",
    phoneme: "ɛ",

    isTrigger: false,
  };
  gamepadMaps.push(map);
  updateSaveMappingButton();
  updateDeleteAllMapsButton();
  //console.log("gamepadMaps", gamepadMaps);

  /** @type {HTMLElement} */
  const mapContainer = mapTemplate.content
    .cloneNode(true)
    .querySelector(".map");

  const _delete = () => {
    mapContainer.remove();
    gamepadMaps.splice(gamepadMaps.indexOf(map), 1);
    //console.log("gamepadMaps", gamepadMaps);
    updateSaveMappingButton();
    updateDeleteAllMapsButton();
  };
  map.delete = _delete;

  mapContainer.querySelector(".delete").addEventListener("click", () => {
    _delete();
  });

  const indexInput = mapContainer.querySelector(".index");
  indexInput.value = map.index;
  indexInput.addEventListener("input", () => {
    map.index = +indexInput.value;
    console.log("index", map.index);
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
    const range = gamepadMapTypeRanges[map.type] ?? { min: 0, max: 1 };
    if (false) {
      outputRangeMinInput.min = range.min;
      outputRangeMaxInput.max = range.max;
    }
    map.outputRange.min = range.min;
    outputRangeMinInput.value = range.min;

    map.outputRange.max = range.max;
    outputRangeMaxInput.value = range.max;
  };
  if (isNew) {
    updateOutputRange();
  }

  const textContainer = mapContainer.querySelector(".text");
  const textInput = textContainer.querySelector("input");
  textInput.value = map.text;
  textInput.addEventListener("input", () => {
    map.text = textInput.value;
    console.log("text", map.text);
  });
  const updateTextInput = () => {
    if (isTypeText(map.type)) {
      textContainer.removeAttribute("hidden");
    } else {
      textContainer.setAttribute("hidden", "");
      textInput.value = "";
    }
  };
  updateTextInput();

  const phonemeContainer = mapContainer.querySelector(".phoneme");
  const phonemeSelect = phonemeContainer.querySelector("select");
  const consonantsOptgroup = phonemeSelect.querySelector(".consonants");
  const vowelsOptgroup = phonemeSelect.querySelector(".vowels");
  for (const phoneme in phonemes) {
    const { example, type } = phonemes[phoneme];
    const option = new Option(`${phoneme} (${example})`, phoneme);
    const optgroup = type == "consonant" ? consonantsOptgroup : vowelsOptgroup;
    optgroup.appendChild(option);
  }
  phonemeSelect.value = map.phoneme;
  phonemeSelect.addEventListener("input", () => {
    map.phoneme = phonemeSelect.value;
    console.log("phoneme", map.phoneme);
  });
  const updatePhonemeInput = () => {
    if (map.type == "phoneme") {
      phonemeContainer.removeAttribute("hidden");
    } else {
      phonemeContainer.setAttribute("hidden", "");
    }
  };
  updatePhonemeInput();

  /** @type {HTMLInputElement} */
  const triggerCheckbox = mapContainer.querySelector(".isTrigger");
  triggerCheckbox.checked = map.isTrigger;
  triggerCheckbox.addEventListener("input", () => {
    map.isTrigger = triggerCheckbox.checked;
    console.log("trigger", map.isTrigger);
  });
  const updateTriggerInput = () => {
    const isTrigger = isTypeTrigger(map.type);
    triggerCheckbox.disabled = isTrigger;

    if (isTrigger) {
      triggerCheckbox.checked = true;
      map.isTrigger = true;
    } else {
    }
  };
  updateTriggerInput();

  const typeSelect = mapContainer.querySelector(".type");
  typeSelect.addEventListener("input", () => {
    map.type = typeSelect.value;
    console.log("type", map.type);
    latestIsTriggered = false;
    latestValue = 0;
    updateOutputRange();
    updateTextInput();
    updatePhonemeInput();
    updateTriggerInput();
  });
  const typeOptgroup = typeSelect.querySelector("optgroup");
  gamepadMapTypes.forEach((type) => {
    typeOptgroup.appendChild(new Option(type));
  });
  typeSelect.value = map.type;

  const inputTypeSelect = mapContainer.querySelector(".inputType");
  inputTypeSelect.addEventListener("input", () => {
    map.inputType = inputTypeSelect.value;
    console.log("inputType", map.inputType);
    updateOutputRange();
  });
  const inputTypeOptgroup = inputTypeSelect.querySelector("optgroup");
  gamepadMapInputTypes.forEach((inputType) => {
    inputTypeOptgroup.appendChild(new Option(inputType));
  });
  inputTypeSelect.value = map.inputType;

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
  const interpolationInput = mapContainer.querySelector(".interpolation");

  /** @type {HTMLInputElement} */
  const isRelativeCheckbox = mapContainer.querySelector(".isRelative");
  isRelativeCheckbox.checked = map.isRelative;
  isRelativeCheckbox.addEventListener("input", () => {
    map.isRelative = isRelativeCheckbox.checked;
    console.log("isRelative", map.isRelative);
  });

  /**
   * @param {GamepadInputType} inputType
   * @param {number} index
   */
  const matches = (inputType, index) => {
    if (map.ignore) {
      return false;
    }
    if (autoMapCheckbox.checked && inputType == "button") {
      inputTypeSelect.value = inputType;
      indexInput.value = index;
      Object.assign(map, { inputType, index });
      autoMapCheckbox.checked = false;
    }
    return map.inputType == inputType && map.index == index;
  };

  let latestValue = 0;
  let latestIsTriggered = false;
  map.onValue = (value, overrideIsTriggered) => {
    if (value == undefined) {
      value = latestValue;
    } else {
      latestValue = value;
    }
    valueInput.value = value;

    let interpolation = inverseLerp(map.inputRange, value);
    interpolation = Math.max(0, Math.min(1, interpolation));
    interpolationInput.value = interpolation;
    const isTrigger = isTypeTrigger(map.type) || map.isTrigger;
    const isTriggered = isTrigger && interpolation == 1;
    if (isTrigger) {
      interpolation = Math.floor(interpolation);
    }

    let outputValue = lerp(map.outputRange, interpolation);
    // outputValue = Math.max(
    //   map.outputRange.min,
    //   Math.min(map.outputRange.max, outputValue)
    // );
    outputValueInput.value = outputValue;

    if (
      map.type == "frequency" &&
      !map.isRelative &&
      (!isTrigger || isTriggered)
    ) {
      outputValue = Tone.Midi(outputValue).toFrequency();
      latestFrequency = outputValue;
      // console.log({ latestFrequency });
    }

    // console.log({ value, interpolation, outputValue });

    const { isRelative } = map;
    const relativeValueKey = `${map.index}.${map.inputType}`;

    if (isTrigger) {
      const message = {};
      const didIsTriggeredChange = isTriggered != latestIsTriggered;
      if (didIsTriggeredChange || overrideIsTriggered) {
        latestIsTriggered = isTriggered;
        //console.log({ isTriggered }, gamepadMaps.indexOf(map));
        if (isTriggered) {
          Object.assign(message, {
            intensity: 0.5,
            holdLastKeyframe: true,
            frequency: latestFrequency,
          });
        } else {
          Object.assign(message, {
            lastKeyframe: true,
            frequency: latestFrequency,
          });
        }
        // console.log({ latestFrequency });
        let shouldSendMessage = true;

        switch (map.type) {
          case "phoneme":
            if (isTriggered) {
              // console.log({ latestFrequency });
              Object.assign(message, {
                utterance: {
                  name: map.phoneme,
                  keyframes: RenderKeyframes(
                    generateKeyframes(map.phoneme),
                    0,
                    latestFrequency,
                    speed
                  ),
                },
              });
            } else {
              const keyframes = RenderKeyframes(
                generateKeyframes(map.phoneme),
                0,
                latestFrequency,
                speed
              );
              if (keyframes.length == 1) {
                message.intensity = 0;
              } else {
                Object.assign(message, {
                  utterance: {
                    name: map.phoneme,
                    keyframes: keyframes.slice(-1),
                  },
                });
              }
            }
            break;
          case "tts":
            if (isTriggered) {
              const text = map.text;
              delete message.intensity;
              Object.assign(message, { text });
            } else {
              const text = map.text;
              Object.assign(message, { text });
            }
            break;
          case "tts2":
            if (isTriggered) {
              Object.assign(message, { playTts: true });
              delete message.intensity;
            } else {
              Object.assign(message, { playTts: true });
            }
            break;
          case "pts":
            if (isTriggered) {
              const phonemes = map.text;
              delete message.intensity;
              Object.assign(message, { phonemes });
            } else {
              const phonemes = map.text;
              Object.assign(message, { phonemes });
            }
            break;
          case "frequency":
            message.isRelative = isRelative;
            message.relativeValueKey = relativeValueKey;
            if (isTriggered) {
              delete message.intensity;
              message.frequency = outputValue;
            } else {
              shouldSendMessage = false;
            }
            break;
          case "intensity":
            if (isTriggered) {
              message.intensity = outputValue;
            } else {
              shouldSendMessage = false;
            }
            break;
          case "voiceness":
            if (isTriggered) {
              delete message.intensity;
              message.voiceness = outputValue;
            } else {
              shouldSendMessage = false;
            }
            break;
          default:
            console.error(`uncaught trigger type "${map.type}"`);
            shouldSendMessage = false;
            break;
        }
        if (shouldSendMessage) {
          //console.log("sending message", message);
          _send(message);
        }

        if (isTriggered) {
          if (!triggeredMaps.includes(map)) {
            triggeredMaps.push(map);
          }
        } else {
          if (triggeredMaps.includes(map)) {
            triggeredMaps.splice(triggeredMaps.indexOf(map), 1);
            const phonemeMap = triggeredMaps.find(
              (map) => map.type == "phoneme"
            );
            if (phonemeMap) {
              phonemeMap.onValue(undefined, true);
            }
          }
        }
      }
    } else {
      const message = { [map.type]: outputValue, isRelative, relativeValueKey };
      //console.log("sending message", message);
      _send(message);
    }
  };

  map.onAxisChange = (change) => {
    const { index, value } = change;
    if (!matches("axis", index)) {
      return;
    }
    map.onValue(value);
  };
  map.onButtonChange = (change) => {
    const { index, value, touched, pressed } = change;
    if (!matches("button", index)) {
      return;
    }
    map.onValue(value);
  };
  map.onThumbstickChange = (change) => {
    const { index } = change;
    if (!map.inputType.startsWith("thumbstick.")) {
      return;
    }
    const thumbstickProperty = map.inputType.split(".").at(-1);
    //console.log({ thumbstickProperty });
    if (!matches(map.inputType, index)) {
      return;
    }
    map.onValue(change[thumbstickProperty]);
  };

  mappingContainer.appendChild(mapContainer);
};
addMapButton.addEventListener("click", () => {
  addMap();
});
/** @type {HTMLInputElement} */
const loadMappingInput = document.getElementById("loadMapping");
loadMappingInput.addEventListener("input", async () => {
  const file = loadMappingInput.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const _gamepadMaps = JSON.parse(text);
    _gamepadMaps.forEach((map) => addMap(map));
  } catch (error) {
    console.error(error);
  }

  loadMappingInput.value = "";
});
const saveMappingButton = document.getElementById("saveMapping");
saveMappingButton.addEventListener("click", () => {
  const blob = new Blob([stringifyGamepadMaps(gamepadMaps)], {
    type: "application/json",
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pinktrombone-gamepad-maps.json";
  a.click();
});
const updateSaveMappingButton = () => {
  saveMappingButton.disabled = gamepadMaps.length == 0;
};

const localStorageKey = "pinktrombone.gamepad";
window.addEventListener("beforeunload", () => {
  localStorage.setItem(localStorageKey, stringifyGamepadMaps());
});
const loadLocalStorage = () => {
  const gamepadMapsString = localStorage.getItem(localStorageKey);
  if (gamepadMapsString) {
    /** @type {GamepadMap[]} */
    const _gamepadMaps = JSON.parse(gamepadMapsString);
    //console.log("loaded gamepadMaps", _gamepadMaps);
    _gamepadMaps.forEach((map) => addMap(map));
  }
};
loadLocalStorage();

document.addEventListener("paste", (event) => {
  const text = event.clipboardData.getData("text");
  if (text) {
    try {
      const _gamepadMaps = JSON.parse(text);
      //console.log("pasted gamepadMaps", _gamepadMaps);
      _gamepadMaps.forEach((map) => addMap(map));
      event.preventDefault();
    } catch {
      //console.log("Invalid JSON");
    }
  }
});

document.addEventListener("paste", async (event) => {
  const files = event.clipboardData.files;
  if (!files.length) return;

  const file = files[0];
  if (file.type !== "application/json") {
    return;
  }

  try {
    const _gamepadMaps = JSON.parse(await file.text());
    //console.log("pasted gamepadMaps", _gamepadMaps);
    _gamepadMaps.forEach((map) => addMap(map));
  } catch {
    console.error("Invalid JSON file");
  }
});

// demo
const gamepadMidiMapping = {
  x: 60,
  o: 65,
  "□": 70,
  "△": 75,
  pad: 80,
};
/** @param {number} midi */
const midiToGamepadControl = (midi) => {
  const closestMidiMap = Object.entries(gamepadMidiMapping).find(
    ([key, _midi]) => {
      return Math.abs(midi - _midi) <= 2;
    }
  );
  if (closestMidiMap) {
    let gamepadControl = closestMidiMap[0];
    const midiOffset = midi - closestMidiMap[1];
    switch (midiOffset) {
      case -2:
        gamepadControl += "↓";
        break;
      case -1:
        gamepadControl += "←";
        break;
      case 0:
        break;
      case 1:
        gamepadControl += "→";
        break;
      case 2:
        gamepadControl += "↑";
        break;
    }
    return gamepadControl;
  } else {
    console.warn("uncaight midi", midi);
    return "?";
  }
};
/** @param {string[]} notes */
const notesToControls = (notes) => {
  return notes.map((note) => {
    const frequency =
      typeof note == "string" ? Tone.Frequency(note) : Tone.Midi(note);
    const midi = frequency.toMidi();
    return midiToGamepadControl(midi);
  });
};
window.notesToControls = notesToControls;

const notes = [
  "F4",
  "A4",
  "B4",

  "F4",
  "A4",
  "B4",

  "F4",
  "A4",
  "B4",

  "E5",
  "D5",

  "B4",
  "C5",
  "B4",

  "G4",
  "E4",

  "D4",
  "E4",
  "G4",
  "E4",
];
console.log(notesToControls(notes));
