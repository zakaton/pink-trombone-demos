/*
  TODO
    interpolate voice
*/

const { send } = setupConnection("lip-sync", (message) => {
  const { phoneme, utterance, results } = message;
  if (phoneme) {
    const keyframes = RenderKeyframes(generateKeyframes(phoneme));
    keyframes.pop(); // remove ".", closing the mouth
    playKeyframes(keyframes);
    debouncedResetMouth();
  } else if (utterance) {
    playKeyframes(utterance.keyframes);
  } else if (results) {
    const { name: phoneme } = results[0];
    console.log("phoneme", phoneme);
    const morphTargets = phonemeToMorphTargets[phoneme];
    if (morphTargets) {
      interpolateTowardsMorphTargets(morphTargets);
      debouncedResetMouth();
    }
  }
});

const interpolateTowardsMorphTargets = (morphTargets, interpolation = 0.9) => {
  for (const name in morphTargetDictionary) {
    const key = morphTargetDictionary[name];
    morphTargetInfluences[key] = lerp(morphTargetInfluences[key] || 0, morphTargets[name] || 0, interpolation);
  }
};

const debouncedResetMouth = debounce(() => {
  playKeyframes(RenderKeyframes(generateKeyframes(".")));
}, 400);

const isDebug = searchParams.get("debug") != undefined;

const overlay = document.getElementById("overlay");
if (!isDebug) {
  overlay.setAttribute("hidden", "");
}

let morphTargetInfluences, morphTargetDictionary;
const avatar = document.getElementById("avatar");
avatar.addEventListener("model-loaded", () => {
  ({ morphTargetInfluences, morphTargetDictionary } = avatar.components["gltf-model"].model.children[0].children[1]);
  console.log("morphTargetDictionary", morphTargetDictionary);
  if (isDebug) {
    setupMorphTargetUI();
  }
});

const keyframes = [];
let isAnimationRunning = false;
let startTime;
const playKeyframes = (_keyframes) => {
  if (keyframes.length > 0) {
    const offsetTime = keyframes[keyframes.length - 1].time;
    _keyframes.forEach((keyframe) => {
      const _keyframe = Object.assign({}, keyframe);
      _keyframe.time += offsetTime;
      keyframes.push(_keyframe);
    });
  } else {
    keyframes.push(..._keyframes);
  }
  //console.log("keyframes", keyframes.slice());

  if (!isAnimationRunning) {
    isAnimationRunning = true;
    startTime = undefined;
    requestAnimationFrame(mouthAnimationFrame);
  }
};
const mouthAnimationFrame = (timestamp) => {
  if (!startTime) {
    startTime = timestamp;
  }
  const timeOffset = (timestamp - startTime) / 1000;
  const nextKeyframeIndex = keyframes.findIndex((keyframe) => keyframe.time > timeOffset);
  const isFirstKeyframe = nextKeyframeIndex == 0;
  const nextKeyframe = keyframes[nextKeyframeIndex];
  const previousKeyframe = isFirstKeyframe ? { time: 0 } : keyframes[nextKeyframeIndex - 1];
  if (nextKeyframe) {
    const interpolation = getInterpolation(previousKeyframe.time, nextKeyframe.time, timeOffset);
    setMouthFromPhonemes(previousKeyframe.name, nextKeyframe.name, interpolation);
    requestAnimationFrame(mouthAnimationFrame);
  } else {
    isAnimationRunning = false;
    keyframes.length = 0;
    //console.log("done");
    resetMouth();
  }
};

const unpackPhoneme = (phoneme) => {
  let isHold, startVoiceless, endVoiceless, index;
  if (phoneme) {
    isHold = phoneme.includes("]");
    startVoiceless = phoneme.includes("{");
    endVoiceless = phoneme.includes("}");
    index = 0;
    if (phoneme.includes("(")) {
      let split = phoneme.split("(");
      phoneme = split[0];
      split = split[1].split(")");
      index = split[0];
    }
    phoneme = phoneme.replace("]", "");
    phoneme = phoneme.replace("{", "");
    phoneme = phoneme.replace("}", "");
  }
  return { phoneme, isHold, startVoiceless, endVoiceless, index };
};
const getMorphTargetsFromPhoneme = ({ phoneme, index }) => {
  let morphTargets = {};
  if (!phoneme) {
    morphTargets = getCurrentMorphTargets();
  } else {
    if (index > 0) {
      const _phoneme = phoneme + index;
      if (_phoneme in phonemeToMorphTargets) {
        Object.assign(morphTargets, phonemeToMorphTargets[_phoneme]);
      } else {
        Object.assign(morphTargets, phonemeToMorphTargets[phoneme]);
        morphTargets.mouthOpen = 0.5;
      }
    } else {
      morphTargets = Object.assign(morphTargets, phonemeToMorphTargets[phoneme]);
    }
  }
  if (!morphTargets) {
    //console.warn("no morphTargets for ", phoneme, index);
  }
  return morphTargets;
};
const getCurrentMorphTargets = () => {
  const currentMorphTargets = {};
  for (const name in morphTargetDictionary) {
    const key = morphTargetDictionary[name];
    currentMorphTargets[name] = morphTargetInfluences[key];
  }
  return currentMorphTargets;
};
const setMouthFromPhonemes = (fromPhoneme, toPhoneme, interpolation = 0) => {
  let morphTargets = {};

  //console.log(`from "${fromPhoneme}" to "${toPhoneme}"`);

  const unpackedFromPhoneme = unpackPhoneme(fromPhoneme);
  fromPhoneme = unpackedFromPhoneme.phoneme;
  const unpackedToPhoneme = unpackPhoneme(toPhoneme);
  toPhoneme = unpackedToPhoneme.phoneme;

  const fromMorphTargets = getMorphTargetsFromPhoneme(unpackedFromPhoneme);

  if (unpackedFromPhoneme.index > 0 && unpackedFromPhoneme.phoneme in phonemeToMorphTargets) {
    fromPhoneme += unpackedFromPhoneme.index;
  }

  if (toPhoneme) {
    const toMorphTargets = getMorphTargetsFromPhoneme(unpackedToPhoneme);
    const sharedKeys = Object.keys(fromMorphTargets).concat(Object.keys(toMorphTargets));
    sharedKeys.forEach((key) => {
      if (!(key in morphTargets)) {
        morphTargets[key] = lerp(fromMorphTargets[key] || 0, toMorphTargets[key] || 0, interpolation);
      }
    });
  } else {
    morphTargets = fromMorphTargets;
  }

  setMouthFromMorphTargets(morphTargets);
};

const setMouthFromPhoneme = (phoneme) => {
  const morphTargets = phonemeToMorphTargets[phoneme];
  if (morphTargets) {
    setMouthFromMorphTargets(morphTargets);
  } else {
    console.warn("no morph targets for phoneme", phoneme);
  }
};

const setMouthFromMorphTargets = (morphTargets = {}) => {
  for (const name in morphTargetDictionary) {
    const key = morphTargetDictionary[name];
    if (name in morphTargets) {
      morphTargetInfluences[key] = morphTargets[name];
    } else {
      if (morphTargetInfluences[key] != 0) {
        morphTargetInfluences[key] = 0;
      }
    }
    if (isDebug) {
      morphTargetContainerInputs[name]?.forEach((input) => (input.value = morphTargetInfluences[key] || 0));
    }
  }
};

const resetMouth = () => {
  setMouthFromMorphTargets({});
};

const logMorphTargets = () => {
  if (isDebug) {
    const morphTargets = {};
    for (const name in morphTargetContainerInputs) {
      const key = morphTargetDictionary[name];
      if (morphTargetInfluences[key] != 0) {
        morphTargets[name] = morphTargetInfluences[key];
      }
    }
    console.log(morphTargets);
  }
};

const phonemeToMorphTargets = {
  // phoneme: {...morphTarget: value}
  b: {
    viseme_PP: 1,
  },
  d: {
    viseme_DD: 0.55,
  },
  f: {
    viseme_FF: 0.55,
  },
  g: {
    viseme_CH: 0.5,
    mouthShrugLower: -0.03,
    mouthShrugUpper: -0.08,
  },
  g1: {
    mouthOpen: 0.5,
    viseme_CH: 0.5,
    mouthShrugLower: 0.32,
    mouthShrugUpper: -0.33,
  },
  h: {
    viseme_aa: 0.31,
  },
  dʒ: {
    viseme_CH: 0.43,
  },
  k: "g",
  l: {
    mouthOpen: -0.34,
    viseme_aa: 0.12,
    viseme_E: 0.35,
    viseme_O: 0.15,
    mouthShrugLower: -0.24,
  },
  m: {
    viseme_PP: 0.8,
  },
  n: {
    viseme_nn: 0.28,
  },
  p: "b",
  r: {
    mouthOpen: 0.42,
    viseme_RR: 0.35,
    mouthPucker: 0.62,
    mouthShrugLower: 0.05,
    mouthShrugUpper: 0.3,
  },
  s: {
    viseme_SS: 1,
    mouthShrugLower: -0.1,
  },
  t: {
    viseme_SS: 1,
  },
  t1: {
    mouthOpen: 0.11,
    viseme_SS: 0.08,
    viseme_E: 0.53,
  },
  v: "f",
  w: {
    mouthOpen: -0.03,
    viseme_O: 0.38,
    viseme_U: 0.77,
    mouthShrugLower: 1,
    mouthShrugUpper: -0.55,
  },
  z: "s",
  ʒ: {
    viseme_CH: 0.3,
    viseme_U: 0.5,
  },
  tʃ: "dʒ",
  ʃ: "ʒ",
  θ: {
    viseme_TH: 0.5,
  },
  ð: "θ",
  ŋ: "g",
  j: "i",
  æ: {
    viseme_aa: 0.5,
  },
  eɪ: "i",
  ɛ: {
    viseme_aa: 0.22,
    viseme_E: 0.7,
  },
  i: {
    mouthOpen: 0.21,
    viseme_I: 0.92,
    mouthStretchLeft: 0.3,
    mouthStretchRight: 0.19,
  },
  ɪ: {
    viseme_aa: 0.32,
    viseme_I: 0.64,
  },
  aɪ: {},
  ɒ: {
    viseme_aa: 0.7,
  },
  oʊ: {},
  ʊ: {
    mouthOpen: 0.29,
    viseme_O: 0.43,
    viseme_U: 0.84,
    mouthShrugLower: 1,
    mouthShrugUpper: -0.55,
  },
  ʌ: {
    mouthOpen: 0.19,
    viseme_O: 0.3,
  },
  u: {
    mouthOpen: 0.79,
    viseme_U: 1,
    mouthPucker: 0.29,
    mouthShrugLower: 0.49,
    mouthShrugUpper: -0.4,
  },
  ɔɪ: {},
  aʊ: {},
  ə: "ʌ",
  "👄": {
    viseme_aa: 0.57,
  },
  "👅": {
    viseme_aa: 0.42,
  },
  eəʳ: {},
  "ɑ:": {},
  "ɜ:ʳ": {},
  ɔ: {
    viseme_aa: 0.62,
  },
  ɪəʳ: {},
  ʊəʳ: {},
  ".": {},
};

for (const phoneme in phonemeToMorphTargets) {
  if (typeof phonemeToMorphTargets[phoneme] == "string") {
    const aliasedPhoneme = phonemeToMorphTargets[phoneme];
    phonemeToMorphTargets[phoneme] = phonemeToMorphTargets[aliasedPhoneme];

    for (let i = 0; i < 3; i++) {
      if (typeof phonemeToMorphTargets[aliasedPhoneme + i]) {
        phonemeToMorphTargets[phoneme + i] = phonemeToMorphTargets[aliasedPhoneme + i];
      }
    }
  }
}
for (const alternatePhoneme in alternateIPAs) {
  const phoneme = alternateIPAs[alternatePhoneme];
  phonemeToMorphTargets[alternatePhoneme] = phonemeToMorphTargets[phoneme];
}

const morphTargetsContainer = document.getElementById("morphTargets");
const morphTargetContainerInputs = {};
const morphTargetTemplate = morphTargetsContainer.querySelector("template");
const morphTargetKeysToIgnore = ["brow", "eye", "nose", "cheek"];
const setupMorphTargetUI = () => {
  for (const name in morphTargetDictionary) {
    if (morphTargetKeysToIgnore.some((key) => name.toLowerCase().includes(key))) {
      //console.log("ignoring", name);
      continue;
    }
    const morphTargetContainer = morphTargetTemplate.content.cloneNode(true).querySelector(".morphTarget");
    morphTargetContainer.querySelector("span").innerText = name;
    const inputs = Array.from(morphTargetContainer.querySelectorAll("input"));
    morphTargetContainerInputs[name] = inputs;
    inputs.forEach((input) =>
      input.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        const key = morphTargetDictionary[name];
        morphTargetInfluences[key] = value;

        inputs.forEach((_input) => {
          if (_input != input) {
            _input.value = value;
          }
        });
      })
    );
    morphTargetsContainer.appendChild(morphTargetContainer);
  }
};

// for reference
/*
const morphTargetDictionary = {
  mouthOpen: 0,
  viseme_sil: 1,
  viseme_PP: 2,
  viseme_FF: 3,
  viseme_TH: 4,
  viseme_DD: 5,
  viseme_kk: 6,
  viseme_CH: 7,
  viseme_SS: 8,
  viseme_nn: 9,
  viseme_RR: 10,
  viseme_aa: 11,
  viseme_E: 12,
  viseme_I: 13,
  viseme_O: 14,
  viseme_U: 15,
  mouthSmile: 16,
  browDownLeft: 17,
  browDownRight: 18,
  browInnerUp: 19,
  browOuterUpLeft: 20,
  browOuterUpRight: 21,
  eyeSquintLeft: 22,
  eyeSquintRight: 23,
  eyeWideLeft: 24,
  eyeWideRight: 25,
  jawForward: 26,
  jawLeft: 27,
  jawRight: 28,
  mouthFrownLeft: 29,
  mouthFrownRight: 30,
  mouthPucker: 31,
  mouthShrugLower: 32,
  mouthShrugUpper: 33,
  noseSneerLeft: 34,
  noseSneerRight: 35,
  mouthLowerDownLeft: 36,
  mouthLowerDownRight: 37,
  mouthLeft: 38,
  mouthRight: 39,
  eyeLookDownLeft: 40,
  eyeLookDownRight: 41,
  eyeLookUpLeft: 42,
  eyeLookUpRight: 43,
  eyeLookInLeft: 44,
  eyeLookInRight: 45,
  eyeLookOutLeft: 46,
  eyeLookOutRight: 47,
  cheekPuff: 48,
  cheekSquintLeft: 49,
  cheekSquintRight: 50,
  jawOpen: 51,
  mouthClose: 52,
  mouthFunnel: 53,
  mouthDimpleLeft: 54,
  mouthDimpleRight: 55,
  mouthStretchLeft: 56,
  mouthStretchRight: 57,
  mouthRollLower: 58,
  mouthRollUpper: 59,
  mouthPressLeft: 60,
  mouthPressRight: 61,
  mouthUpperUpLeft: 62,
  mouthUpperUpRight: 63,
  mouthSmileLeft: 64,
  mouthSmileRight: 65,
  tongueOut: 66,
  eyeBlinkLeft: 67,
  eyeBlinkRight: 68,
  eyesClosed: 69,
  eyesLookUp: 70,
  eyesLookDown: 71,
};
*/
