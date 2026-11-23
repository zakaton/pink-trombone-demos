const audioContext = new AudioContext();
autoResumeAudioContext(audioContext);

const pinkTromboneElement = document.querySelector("pink-trombone");
let frontConstriction, backConstriction, lipConstriction;

let frequencyNode;
pinkTromboneElement.addEventListener("load", (event) => {
  pinkTromboneElement.setAudioContext(audioContext).then((pinkTrombone) => {
    frequencyNode = pinkTromboneElement.frequency;
    frequencyNode.isFrequency = true;
    frequencyNode.relativeValues = frequencyNode.relativeValues ?? [];
    frequencyNode._value = frequencyNode._value ?? frequencyNode.value;

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
        audioContext.destination,
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
    backConstriction._isEnabled = true;

    // Wide open (diameter 5), so it has no effect until it is moved.
    lipConstriction = pinkTromboneElement.newConstriction(44, 5);
    pinkTromboneElement.lipConstriction = lipConstriction;

    pinkTromboneElement.querySelector("#wobble").click();
    pinkTromboneElement.querySelector("#voice").click();
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
          event.detail.endTime,
        );
        constriction.diameter.linearRampToValueAtTime(
          diameterValue,
          event.detail.endTime,
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
      pinkTromboneElement.tongue,
    );
    message.constrictions.tongue = {
      index,
      diameter,
    };
  } else {
    // the slot the mouse touch uses: the first one that isn't front, back or lip
    const touchConstriction =
      pinkTromboneElement.pinkTrombone._pinkTromboneNode._constrictions.find(
        (constriction) =>
          ![frontConstriction, backConstriction, lipConstriction].includes(
            constriction,
          ),
      );
    const { index, diameter } = deconstructConstriction(touchConstriction);
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

  //console.log("setVoiceness", { voiceness });

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
      case "lipConstriction.index":
        node = lipConstriction.index;
        break;
      case "lipConstriction.diameter":
        node = lipConstriction.diameter;
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
              0.1 * constrictions.length,
            );
            exponentialRampToValueAtTime(
              pinkTromboneElement.intensity,
              0,
              0.1 * constrictions.length + 1,
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
                frontConstriction.diameter.maxValue,
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
                backConstriction.diameter.maxValue,
              );
            }
            exponentialRampToValueAtTime(lipConstriction.diameter, 5); // phonemes don't use the lips: reopen them
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
            const relativeValues = frequencyNode.relativeValues ?? [];

            const { frequency } = message;
            if (!message.isRelative) {
              frequencyNode._value = frequency ?? frequencyNode._value;
            }

            let relativeValue = 0;
            if (true) {
              relativeValue = relativeValues.at(-1)?.value ?? 0;
            } else {
              relativeValues.forEach(({ value }) => {
                relativeValue += value;
              });
            }
            const _frequency = frequency * 2 ** (relativeValue / 12);

            const rootFrequency = keyframes[0].frequency;
            keyframes.forEach((keyframe) => {
              const frequencyRatio = keyframe.frequency / rootFrequency;
              keyframe.frequency = frequencyRatio * _frequency;
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
            ({ key }) => key == message.relativeValueKey,
          );
          if (relativeValueObject) {
            relativeValueObject.value = valueNumber;
            if (relativeValueObject.value == 0) {
              node.relativeValues.splice(
                node.relativeValues.indexOf(relativeValueObject),
                1,
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
      lipConstriction: deconstructConstriction(lipConstriction),
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
    pinkTromboneElement.audioContext.currentTime + offset,
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

  "lipConstriction.index",
  "lipConstriction.diameter",

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
        pinkTromboneElement.audioContext.currentTime + offset,
      );
    });
  });
}

let allNodes;
document.addEventListener("mouseup", () => {
  allNodes = allNodes ?? [pinkTromboneElement.frequency]; // FILL - add more when needed
  allNodes.forEach((node) => {
    node._value = undefined;
  });
});

// Record the output of Pink Trombone: the signal is tapped right after the vocal tract (before the speakers), so it holds
// exactly what is played, and nothing from the room. It is saved losslessly as a 16-bit WAV file when you stop.
const recordOutputButton = document.getElementById("recordOutput");
const recorderWorkletSource = `
class OutputRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) this.port.postMessage(input.map((channel) => channel.slice()));
    return true;
  }
}
registerProcessor("pink-trombone-output-recorder", OutputRecorder);`;
let outputRecorder; // { node, chunks, started, timer }
let recorderModuleLoaded = false;

const encodeWav = (channels, sampleRate) => {
  const numChannels = channels.length;
  const length = channels[0].length;
  const buffer = new ArrayBuffer(44 + length * numChannels * 2);
  const view = new DataView(buffer);
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++)
      view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * numChannels * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * numChannels * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
};

const formatRecordingTime = (milliseconds) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const startOutputRecording = async () => {
  if (outputRecorder || !frequencyNode) return; // frequencyNode is set once Pink Trombone has loaded
  if (audioContext.state != "running") await audioContext.resume();
  if (!recorderModuleLoaded) {
    const url = URL.createObjectURL(
      new Blob([recorderWorkletSource], { type: "text/javascript" }),
    );
    await audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    recorderModuleLoaded = true;
  }
  const node = new AudioWorkletNode(
    audioContext,
    "pink-trombone-output-recorder",
    {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    },
  );
  const chunks = [];
  node.port.onmessage = (event) => chunks.push(event.data);
  pinkTromboneElement.pinkTrombone._pinkTromboneNode.connect(node);
  const started = performance.now();
  const timer = setInterval(() => {
    recordOutputButton.innerText = `stop recording (${formatRecordingTime(performance.now() - started)})`;
  }, 250);
  outputRecorder = { node, chunks, started, timer };
  recordOutputButton.innerText = "stop recording (0:00)";
  recordOutputButton.style.background = "#ff8a8a";
};

const stopOutputRecording = () => {
  if (!outputRecorder) return;
  const { node, chunks, timer } = outputRecorder;
  outputRecorder = undefined;
  clearInterval(timer);
  pinkTromboneElement.pinkTrombone._pinkTromboneNode.disconnect(node);
  node.port.onmessage = null;
  node.disconnect();
  recordOutputButton.innerText = "record";
  recordOutputButton.style.background = "";
  if (!chunks.length) return;

  const numChannels = Math.min(2, chunks[0].length);
  const total = chunks.reduce((sum, chunk) => sum + chunk[0].length, 0);
  const channels = Array.from(
    { length: numChannels },
    () => new Float32Array(total),
  );
  let offset = 0;
  chunks.forEach((chunk) => {
    channels.forEach((channel, c) => channel.set(chunk[c] ?? chunk[0], offset));
    offset += chunk[0].length;
  });

  const url = URL.createObjectURL(encodeWav(channels, audioContext.sampleRate));
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `pink-trombone-${stamp}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

recordOutputButton.addEventListener("click", async () => {
  try {
    if (outputRecorder) stopOutputRecording();
    else await startOutputRecording();
  } catch (error) {
    console.error("couldn't record the output", error);
    recordOutputButton.innerText = "record";
  }
});
