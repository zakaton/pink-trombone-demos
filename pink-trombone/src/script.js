const audioContext = new AudioContext();
autoResumeAudioContext(audioContext);

const pinkTromboneElement = document.querySelector("pink-trombone");
let frontConstriction, backConstriction;

let frequencyNode;
pinkTromboneElement.addEventListener("load", (event) => {
  pinkTromboneElement.setAudioContext(audioContext).then((pinkTrombone) => {
    frequencyNode = pinkTromboneElement.frequency;
    frequencyNode.isFrequency = true;

    pinkTromboneElement.enableUI();
    pinkTromboneElement.startUI();
    const { audioContext } = pinkTromboneElement;
    if (location.href.includes("default")) {
      if (audioContext.destination.maxChannelCount >= 6) {
        audioContext.destination.channelCount = 6;
        audioContext.destination.maxChannelCount = 6;
        audioContext.destination.channelCount = 6;
        audioContext.destination.channelInterpretation = "discrete";
        audioContext.destination.channelCountMode = "explicit";
      } else {
        audioContext.destination.channelCount = 2;
      }

      pinkTromboneElement.pinkTrombone._pinkTromboneNode.connect(
        audioContext.destination
      );
    } else {
      pinkTromboneElement.connect(pinkTromboneElement.audioContext.destination);
    }
    pinkTromboneElement.start();
    frontConstriction = pinkTromboneElement.newConstriction(43, 1.8);
    pinkTromboneElement.frontConstriction = frontConstriction;
    frontConstriction._isEnabled = true;
    backConstriction = pinkTromboneElement.newConstriction(10.5, 1.8);
    pinkTromboneElement.backConstriction = backConstriction;
    if (typeof searchParams.get("dark") == "string") {
      toggleDarkMode();
    }
  });
});

pinkTromboneElement.addEventListener("setConstriction", (event) => {
  const constrictionIndex = Number(event.detail.constrictionIndex);

  if (constrictionIndex > 1) {
    const { index, diameter } = event.detail;

    const constriction = index > 28 ? frontConstriction : backConstriction;

    const indexValue = index || constriction.index.value;
    const diameterValue = diameter || constriction.diameter.value;

    switch (event.detail.type) {
      case "linear":
        constriction.index.linearRampToValueAtTime(
          indexValue,
          event.detail.endTime
        );
        constriction.diameter.linearRampToValueAtTime(
          diameterValue,
          event.detail.endTime
        );
        break;
      default:
        constriction.index.value = indexValue;
        constriction.diameter.value = diameterValue;
    }

    event.target.dispatchEvent(new CustomEvent("didSetConstriction"));
    shouldSendConstrictions = true;
  }
});

let shouldSendConstrictions = false;
pinkTromboneElement.addEventListener("setParameter", (event) => {
  const { newValue, parameterName } = event.detail;
  const [type, subtype] = parameterName.split(".");
  if (parameterName == "tenseness") {
    updateVoiceness(newValue);
  }
  shouldSendConstrictions = true;
});

let isMouseDown = false;
document.body.addEventListener("mousedown", (event) => {
  isMouseDown = true;
  if (shouldSendConstrictions) {
    updateConstriction();
    shouldSendConstrictions = false;
  }
});
document.body.addEventListener("mousemove", () => {
  if (isMouseDown && shouldSendConstrictions) {
    updateConstriction();
    shouldSendConstrictions = false;
  }
});
document.body.addEventListener("mouseup", (event) => {
  isMouseDown = false;
  if (shouldSendConstrictions) {
    updateConstriction();
    shouldSendConstrictions = false;
  }
});

function deconstructConstriction(constriction) {
  const index = constriction.index.value;
  const diameter = constriction.diameter.value;
  return { index, diameter };
}
function setConstriction(constriction, index, diameter) {
  constriction.index.value = index;
  constriction.diameter.value = diameter;
}

let _indexThreshold = 28;
const getTractLength = () => {
  return pinkTromboneElement.pinkTrombone._pinkTromboneNode.tractLength.value;
};
const getIndexThreshold = () => {
  return normalizeIndex(_indexThreshold);
};
const normalizeIndex = (index, tractLength) => {
  tractLength = tractLength || getTractLength();
  return index * (tractLength / 44);
};
const updateConstriction = throttle(() => {
  const message = {
    to: ["machine-learning", "debug", "mfcc", "knn"],
    type: "message",
    constrictions: {},
  };

  const constrictionIndex =
    pinkTromboneElement.UI._tractUI._touchConstrictionIndices[-1];
  const isTongue = constrictionIndex == -1;
  if (isTongue) {
    const { index, diameter } = deconstructConstriction(
      pinkTromboneElement.tongue
    );
    message.constrictions.tongue = {
      index,
      diameter,
    };
  } else {
    const { index, diameter } = deconstructConstriction(
      pinkTromboneElement.pinkTrombone._pinkTromboneNode._constrictions[2]
    );
    if (!(index == 0 && diameter == 0)) {
      const isBackConstriction = index < getIndexThreshold();
      const targetConstriction = isBackConstriction
        ? backConstriction
        : frontConstriction;
      setConstriction(targetConstriction, index, diameter);
      message.constrictions[
        isBackConstriction ? "backConstriction" : "frontConstriction"
      ] = {
        index,
        diameter,
      };
    }
  }
  message.voiceness = _voiceness;
  send(message);
}, 100);

let _voiceness = 0.8;
function setVoiceness(voiceness, offset) {
  _voiceness = voiceness;

  const tenseness = 1 - Math.cos(voiceness * Math.PI * 0.5);
  const loudness = Math.pow(tenseness, 0.25);

  const nodes = [
    {
      node: pinkTromboneElement.tenseness,
      value: tenseness,
    },
    {
      node: pinkTromboneElement.loudness,
      value: loudness,
    },
  ];
  nodes.forEach(({ node, value }) => {
    pendingNodes.add(node);
    exponentialRampToValueAtTime(node, value, offset);
  });
}
function updateVoiceness(tenseness) {
  _voiceness = Math.acos(1 - tenseness) / (Math.PI * 0.5);
}

let latestPhonemeTimestamp = 0;
let latestPlayKeyframesTimestamp = 0;
const { send } = setupConnection("pink-trombone", (message) => {
  let didSetVoiceness = false;
  let canSetVoiceness = true;
  //console.log("message", message);
  if (message.lastKeyframe) {
    clearPendingNodes();
  }
  for (const key in message) {
    const value = message[key];
    let valueNumber = Number(value);
    if (key.endsWith("index")) {
      valueNumber = normalizeIndex(valueNumber, message.tractLength);
    }

    let node;
    let nodes = [];
    switch (key) {
      case "tongue.index":
        node = pinkTromboneElement.tongue.index;
        break;
      case "tongue.diameter":
        node = pinkTromboneElement.tongue.diameter;
        break;
      case "frontConstriction.index":
        node = frontConstriction.index;
        break;
      case "frontConstriction.diameter":
        node = frontConstriction.diameter;
        break;
      case "backConstriction.index":
        node = backConstriction.index;
        break;
      case "backConstriction.diameter":
        node = backConstriction.diameter;
        break;
      case "tenseness":
        if (didSetVoiceness) {
          return;
        }
        node = pinkTromboneElement.tenseness;
        canSetVoiceness = false;
        break;
      case "loudness":
        if (didSetVoiceness) {
          return;
        }
        node = pinkTromboneElement.loudness;
        canSetVoiceness = false;
        break;
      case "intensity":
        node = pinkTromboneElement.intensity;
        break;
      case "frequency":
        if (!message.utterance) {
          node = pinkTromboneElement.frequency;
        }
        break;
      case "tractLength":
        node = pinkTromboneElement.tractLength;
        break;
      case "vibrato.frequency":
        node = pinkTromboneElement.vibrato.frequency;
        break;
      case "vibrato.gain":
        node = pinkTromboneElement.vibrato.gain;
        break;
      case "vibrato.wobble":
        node = pinkTromboneElement.vibrato.wobble;
        break;
      case "voiceness":
        if (!canSetVoiceness) {
          return;
        }
        setVoiceness(valueNumber);
        didSetVoiceness = true;
        break;
      case "phoneme":
        const { constrictions, voiced, type } = phonemes[message.phoneme];
        if (constrictions) {
          let voiceness = 0.8;
          if (type == "consonant") {
            voiceness = voiced ? 0.9 : 0.0;
          }
          setVoiceness(voiceness);
          if (!("intensity" in message)) {
            exponentialRampToValueAtTime(pinkTromboneElement.intensity, 1);
            exponentialRampToValueAtTime(
              pinkTromboneElement.intensity,
              1,
              0.1 * constrictions.length
            );
            exponentialRampToValueAtTime(
              pinkTromboneElement.intensity,
              0,
              0.1 * constrictions.length + 1
            );
          }
          const phonemeTimestamp = Date.now();
          latestPhonemeTimestamp = phonemeTimestamp;
          constrictions.forEach((constriction, index) => {
            if (phonemeTimestamp != latestPhonemeTimestamp) {
              return;
            }
            const { tongue, front, back } = constriction;
            const nodes = [];
            const features = ["index", "diameter"];
            if (tongue) {
              features.forEach((feature) => {
                const node = {
                  node: pinkTromboneElement.tongue[feature],
                  value: tongue[feature],
                };
                if (feature == "index") {
                  node.value = normalizeIndex(node.value, message.tractLength);
                }
                nodes.push(node);
              });
            }
            if (front) {
              features.forEach((feature) => {
                const node = {
                  node: frontConstriction[feature],
                  value: front[feature],
                };
                if (feature == "index") {
                  node.value = normalizeIndex(node.value, message.tractLength);
                }
                nodes.push(node);
              });
            } else {
              exponentialRampToValueAtTime(
                frontConstriction.diameter,
                frontConstriction.diameter.maxValue
              );
            }
            if (back) {
              features.forEach((feature) => {
                const node = {
                  node: backConstriction[feature],
                  value: back[feature],
                };
                if (feature == "index") {
                  node.value = normalizeIndex(node.value, message.tractLength);
                }
                nodes.push(node);
              });
            } else {
              exponentialRampToValueAtTime(
                backConstriction.diameter,
                backConstriction.diameter.maxValue
              );
            }
            //console.log("notes", nodes);
            nodes.forEach(({ node, value }) => {
              // FIX timing
              exponentialRampToValueAtTime(node, value, 0.04 + index * 0.1);
            });
          });
          setTimeout(() => {
            sendConstrictions();
          }, 10);
        }
        break;
      case "utterance":
        let keyframes;
        if (typeof value == "object") {
          keyframes = value.keyframes;
        } else if (value in utterances) {
          keyframes = utterances[value].keyframes;
        }
        keyframes = structuredClone(keyframes);
        if (keyframes && keyframes.length > 0) {
          if (
            message.holdLastKeyframe &&
            keyframes.length > 1 &&
            keyframes.at(-1).name == "."
          ) {
            keyframes.pop();
          }
          if (message.frequency) {
            const baseFrequency = keyframes[0].frequency;
            keyframes.forEach((keyframe) => {
              const frequencyRatio = keyframe.frequency / baseFrequency;
              keyframe.frequency = frequencyRatio * message.frequency;
            });
          }
          playKeyframes(keyframes, message.lastKeyframe ? -1 : 0);
        }
        break;
      default:
        //console.log("uncaught key", key);
        break;
    }

    if (node) {
      nodes.push(node);
    }
    if (nodes.length > 0) {
      nodes.forEach((node) => {
        node.relativeValues = node.relativeValues ?? [];
        if (message.isRelative) {
          const relativeValueObject = node.relativeValues.find(
            ({ key }) => key == message.relativeValueKey
          );
          if (relativeValueObject) {
            relativeValueObject.value = valueNumber;
            if (relativeValueObject.value == 0) {
              node.relativeValues.splice(
                node.relativeValues.indexOf(relativeValueObject),
                1
              );
            }
          } else if (valueNumber != 0) {
            node.relativeValues.push({
              value: valueNumber,
              key: message.relativeValueKey,
            });
          }
        }
        node._value = node._value ?? node.value;

        if (!message.isRelative) {
          node._value = valueNumber ?? node._value;
        }

        let relativeValue = 0;
        if (true) {
          relativeValue = node.relativeValues.at(-1)?.value ?? 0;
        } else {
          node.relativeValues.forEach(({ value }) => {
            relativeValue += value;
          });
        }

        if (node.isFrequency) {
          valueNumber = node._value * 2 ** (relativeValue / 12);
          //console.log("frequency", valueNumber);
        } else {
          valueNumber = node._value + relativeValue;
        }

        valueNumber = clamp(valueNumber, node.minValue, node.maxValue);
        exponentialRampToValueAtTime(node, valueNumber, 0.01);
      });
    }

    if (message.command == "getConstrictions") {
      sendConstrictions();
    }
  }
});

function sendConstrictions() {
  const message = {
    to: ["machine-learning", "debug", "mfcc", "knn"],
    type: "message",
    constrictions: {
      tongue: deconstructConstriction(pinkTromboneElement.tongue),
      frontConstriction: deconstructConstriction(frontConstriction),
      backConstriction: deconstructConstriction(backConstriction),
    },
    voiceness: _voiceness,
  };

  send(message);
}

function exponentialRampToValueAtTime(node, value, offset = 0.01) {
  if (value == 0) {
    value = 0.0001;
  }
  node.cancelAndHoldAtTime(pinkTromboneElement.audioContext.currentTime);
  node.exponentialRampToValueAtTime(
    value,
    pinkTromboneElement.audioContext.currentTime + offset
  );
  pendingNodes.add(node);
}

const keyframeStrings = [
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
];

/** @type {Set<AudioParam>} */
const pendingNodes = new Set();
const clearPendingNodes = () => {
  //console.log("clearPendingNodes");
  pendingNodes.forEach((node) => {
    node.cancelScheduledValues(pinkTromboneElement.audioContext.currentTime);
  });
  pendingNodes.clear();
};
function playKeyframes(keyframes, offset = 0) {
  clearPendingNodes();

  const playKeyframesTimestamp = Date.now();
  latestPlayKeyframesTimestamp = playKeyframesTimestamp;
  offset = offset < 0 ? keyframes.length + offset : offset;
  if (offset != 0) {
    keyframes = structuredClone(keyframes);
    const timeOffset = keyframes[offset].time - keyframes[offset - 1].time;
    keyframes = keyframes.slice(offset);
    keyframes.forEach((keyframe) => {
      keyframe.time -= timeOffset;
    });
  }
  //console.log("playKeyframes", keyframes);
  keyframes.forEach((keyframe) => {
    keyframeStrings.forEach((keyframeString) => {
      let value = keyframe[keyframeString];
      if (value == undefined) {
        return;
      }
      const isIndex = keyframeString.endsWith("index");
      if (isIndex) {
        value = normalizeIndex(value, keyframe.tractLength);
      }
      const path = keyframeString.split(".");
      let node = pinkTromboneElement;
      while (path.length) {
        node = node[path.shift()];
      }
      pendingNodes.add(node);
      const offset = keyframe.time;
      node.linearRampToValueAtTime(
        value,
        pinkTromboneElement.audioContext.currentTime + offset
      );
    });
  });
}

const darkModeButton = document.getElementById("darkMode");
let isDarkMode = false;
const toggleDarkMode = () => {
  isDarkMode = !isDarkMode;
  if (isDarkMode) {
    pinkTromboneElement.UI._container.style.gridTemplateRows = "auto 200px";
    pinkTromboneElement.UI._container.style.gridTemplateColumns = "auto";
    pinkTromboneElement.UI._buttonsUI._container.style.display = "none";
    pinkTromboneElement.UI._glottisUI._container.style.display = "none";
    document.body.style.margin = "0px";
    document.body.style.filter = "grayscale(1)";
  } else {
    pinkTromboneElement.UI._container.style.gridTemplateRows =
      "auto 200px 100px";
    pinkTromboneElement.UI._container.style.gridTemplateColumns = "auto 100px";
    pinkTromboneElement.UI._buttonsUI._container.style.display = "flex";
    pinkTromboneElement.UI._glottisUI._container.style.display = "";
    document.body.style.margin = "";
    document.body.style.filter = "";
  }
};
const debouncedToggleDarkMode = debounce(() => toggleDarkMode(), 10);
darkModeButton.addEventListener("click", () => {
  debouncedToggleDarkMode();
});

/** @type {MediaStream|undefined} */
var mediaStream;
/** @type {MediaStreamAudioSourceNode|undefined} */
var mediaStreamSourceNode;
const toggleMicrophoneButton = document.getElementById("toggleMicrophone");
toggleMicrophoneButton.addEventListener("click", async () => {
  if (isMicrophoneOn()) {
    stopMicrophone();
  } else {
    await getMicrophone();
  }
});

const isMicrophoneOn = () => {
  return Boolean(mediaStream);
};

const getMicrophone = async () => {
  stopMicrophone();

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: microphoneSelect.value ? microphoneSelect.value : true,
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: false,
    },
  });
  if (!didCheckMicrophonesOnce) {
    updateMicrophoneSelect();
  }
  mediaStreamSourceNode = audioContext.createMediaStreamSource(mediaStream);
  mediaStreamSourceNode.connect(
    pinkTromboneElement.pinkTrombone._pinkTromboneNode
  );
  pinkTromboneElement.pinkTrombone._fricativeFilter.disconnect();
  pinkTromboneElement.pinkTrombone._aspirateFilter.disconnect();

  debugMicrophoneButton.removeAttribute("hidden");
  toggleMicrophoneButton.innerText = "disable microphone";
};
const stopMicrophone = () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = undefined;
    mediaStreamSourceNode?.disconnect();
    mediaStreamSourceNode = undefined;
    isListeningToMicrophone = false;
    debugMicrophoneButton.setAttribute("hidden", "");
    toggleMicrophoneButton.innerText = "enable microphone";

    pinkTromboneElement.pinkTrombone._fricativeFilter.connect(
      pinkTromboneElement.pinkTrombone._pinkTromboneNode.noise
    );
    pinkTromboneElement.pinkTrombone._aspirateFilter.connect(
      pinkTromboneElement.pinkTrombone._pinkTromboneNode.noise
    );
  }
};

/** @type {HTMLSelectElement} */
const microphoneSelect = document.getElementById("microphoneSelect");
/** @type {HTMLOptGroupElement} */
const microphoneOptGroup = document.getElementById("microphoneOptGroup");
const updateMicrophoneSelect = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind == "audioinput");
  if (microphones.length > 0) {
    microphoneSelect.removeAttribute("hidden");
    microphoneOptGroup.innerHTML = "";
    microphones.forEach((microphone) => {
      microphoneOptGroup.appendChild(
        new Option(microphone.label, microphone.deviceId)
      );
    });
    didCheckMicrophonesOnce = true;
  } else {
    microphoneSelect.setAttribute("hidden", "");
  }
};
navigator.mediaDevices.addEventListener("devicechange", () => {
  updateMicrophoneSelect();
});
updateMicrophoneSelect();

microphoneSelect.addEventListener("input", async () => {
  if (isMicrophoneOn()) {
    await getMicrophone();
  }
});

var isListeningToMicrophone = false;
const debugMicrophoneButton = document.getElementById("debugMicrophone");
debugMicrophoneButton.addEventListener("click", () => {
  if (mediaStreamSourceNode) {
    isListeningToMicrophone = !isListeningToMicrophone;
    if (isListeningToMicrophone) {
      mediaStreamSourceNode.connect(audioContext.destination);
      debugMicrophoneButton.innerText = "stop listening to microphone";
    } else {
      mediaStreamSourceNode.disconnect(audioContext.destination);
      debugMicrophoneButton.innerText = "listen to microphone";
    }
  }
});

let allNodes;
document.addEventListener("mouseup", () => {
  allNodes = allNodes ?? [pinkTromboneElement.frequency]; // FILL - add more when needed
  allNodes.forEach((node) => {
    node._value = undefined;
  });
});
