const { PitchDetector } = Pitchy;
let pitch, clarity;
let detector, pitchInput, volumeInput, stream;
let volumeThreshold = 0.01; //% volume triggering change
let clarityThreshold = 0.97; // 0<1 clarity
function updatePitch() {
  analyserNode.getFloatTimeDomainData(pitchInput);
  [pitch, clarity] = detector.findPitch(pitchInput, audioContext.sampleRate);

  //pitchElement.textContent = `${Math.round(pitch * 10) / 10} Hz`;
  //clarityElement.textContent = `${Math.round(clarity * 100)} %`;
  console.log({ pitch, clarity });
  return { pitch, clarity };
}
let volume;
function updateVolume() {
  analyserNode.getByteTimeDomainData(volumeInput);

  // Calculate RMS (root mean square) for the "volume"
  let sum = 0;
  for (let i = 0; i < volumeInput.length; i++) {
    const value = volumeInput[i] / 128 - 1; // Normalize to [-1, 1]
    sum += value * value;
  }
  const rms = Math.sqrt(sum / volumeInput.length);
  const volume = rms * 1;

  console.log({ volume });

  return volume;
}

const constrictions = {
  getData() {
    if (this.hasAllConstrictions()) {
      const classifications = {};
      for (const type in this) {
        if (typeof this[type] == "object" && "index" in this[type]) {
          for (const subtype in this[type]) {
            classifications[`${type}.${subtype}`] = this[type][subtype];
          }
        }
      }
      return classifications;
    }
  },
  tongue: {
    index: 12.89,
    diameter: 2.43,
  },
  frontConstriction: {
    index: 43,
    diameter: 1.8,
  },
  backConstriction: {
    diameter: 1.8,
    index: 10.5,
  },
  hasAllConstrictions() {
    return Boolean(this.tongue && this.backConstriction && this.frontConstriction);
  },
};
let voiceness = 0.7;
const { send } = setupConnection(
  "edge-impulse",
  (message) => {
    if (message.from == "pink-trombone") {
      Object.assign(constrictions, message.constrictions);
      if ("voiceness" in message) {
        voiceness = message.voiceness;
      }
      //console.log(constrictions.getData(), voiceness);
      if (addDataButton.disabled) {
        addDataButton.disabled = false;
      }
    }
  },
  (send) => {
    send({
      to: ["pink-trombone"],
      type: "message",
      command: "getConstrictions",
    });
  }
);

// Sample Rate
const sampleRates = [8000, 16000, 44100, 48000];
let sampleRate = sampleRates[sampleRates.length - 1];
const sampleRateInput = document.getElementById("sampleRate");
const sampleRateOptgroup = sampleRateInput.querySelector("optgroup");
sampleRates.forEach((sampleRate) => {
  sampleRateOptgroup.appendChild(new Option(sampleRate));
});
sampleRateInput.value = sampleRate;
sampleRateInput.addEventListener("input", (event) => {
  const newSampleRate = Number(event.target.value);
  console.log({ newSampleRate });
  setSampleRate(newSampleRate);
});
/** @param {number} newSampleRate */
async function setSampleRate(newSampleRate) {
  sampleRate = newSampleRate;
  sampleRateInput.value = sampleRate;
  console.log({ sampleRate });
  window.dispatchEvent(new Event("sampleRate"));
  sampleRateInput.value = sampleRate;
  setSamplingInterval(1000 / sampleRate);
  setUrlParam("sampleRate", sampleRate);
  if (audioContext.sampleRate != sampleRate) {
    await setupAudioContext();
  }
}
window.addEventListener("loadConfig", () => {
  if (config.sampleRate) {
    sampleRateInput.value = config.sampleRate;
  }
});
window.addEventListener("load", () => {
  if (url.searchParams.has("sampleRate")) {
    setSampleRate(Number(url.searchParams.get("sampleRate")));
  }
});

// Sample Length

let sampleLength = 100;
const sampleLengthInput = document.getElementById("sampleLength");
sampleLengthInput.value = sampleLength;
sampleLengthInput.addEventListener("input", (event) => {
  const newSampleLength = Number(event.target.value);
  console.log({ newSampleLength });
  setSampleLength(newSampleLength);
});
/** @param {number} newSampleLength */
function setSampleLength(newSampleLength) {
  sampleLength = newSampleLength;
  console.log({ sampleLength });
  window.dispatchEvent(new Event("sampleLength"));
  sampleLengthInput.value = sampleLength;
  setUrlParam("sampleLength", sampleLength);
}
window.addEventListener("loadConfig", () => {
  if (config.sampleLength) {
    sampleLengthInput.value = config.sampleLength;
  }
});
window.addEventListener("load", () => {
  if (url.searchParams.has("sampleLength")) {
    setSampleLength(Number(url.searchParams.get("sampleLength")));
  }
});

// Audio Context

/** @type {AudioContext} */
let audioContext = null;
async function setupAudioContext() {
  console.trace("setting up audio context");
  await clearAudioConext();
  audioContext = new AudioContext({ sampleRate });
  if (gainNode) {
    gainNode.disconnect();
  }
  gainNode = audioContext.createGain();
  analyserNode = audioContext.createAnalyser();
  //analyserNode.fftSize = 256;
  analyserDataArray = new Uint8Array(analyserNode.frequencyBinCount);
  gainNode.connect(analyserNode);

  detector = PitchDetector.forFloat32Array(analyserNode.fftSize);
  pitchInput = new Float32Array(detector.inputLength);
  volumeInput = new Uint8Array(detector.inputLength);

  autoResumeAudioContext(audioContext);
  setupMicrophone();
  setupScriptProcessor();
}
async function clearAudioConext() {
  if (audioContext == null) {
    return;
  }
  await audioContext.close();
  audioContext = null;
}
setupAudioContext();

async function setupScriptProcessor() {
  if (mediaStreamScriptProcessor) {
    mediaStreamScriptProcessor.disconnect();
  }
  mediaStreamScriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
}

/** @type {MediaStream|undefined} */
var mediaStream;
/** @type {MediaStreamAudioSourceNode|undefined} */
var mediaStreamSourceNode;
/** @type {ScriptProcessorNode|undefined} */
var mediaStreamScriptProcessor;
/** @type {AnalyserNode|undefined} */
var analyserNode;
/** @type {Uint8Array} */
let analyserDataArray;

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
  setupMicrophone();
  updateToggleSamplingButton();
  updateClassifyButton();

  debugMicrophoneButton.removeAttribute("hidden");
  toggleMicrophoneButton.innerText = "disable microphone";
};

function setupMicrophone() {
  mediaStreamSourceNode?.disconnect();
  if (mediaStream) {
    if (mediaStreamSourceNode) {
      mediaStreamSourceNode.disconnect();
    }
    mediaStreamSourceNode = audioContext.createMediaStreamSource(mediaStream);
    mediaStreamSourceNode.connect(gainNode);
    onIsListeningToMicrophoneUpdate();
  }
}

const stopMicrophone = () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = undefined;
    mediaStreamSourceNode?.disconnect();
    mediaStreamSourceNode = undefined;
    isListeningToMicrophone = false;
    debugMicrophoneButton.setAttribute("hidden", "");
    toggleMicrophoneButton.innerText = "enable microphone";
    updateToggleSamplingButton();
    updateClassifyButton();
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
      microphoneOptGroup.appendChild(new Option(microphone.label, microphone.deviceId));
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
    onIsListeningToMicrophoneUpdate();
  }
});
function onIsListeningToMicrophoneUpdate() {
  if (!mediaStreamSourceNode) {
    return;
  }
  try {
    if (isListeningToMicrophone) {
      gainNode.connect(audioContext.destination);
      debugMicrophoneButton.innerText = "stop listening to microphone";
    } else {
      gainNode.disconnect(audioContext.destination);
      debugMicrophoneButton.innerText = "listen to microphone";
    }
  } catch (error) {
    console.log(error);
  }
}

// SEARCH PARAMS

const url = new URL(location);
console.log({ url });
function setUrlParam(key, value) {
  if (history.pushState) {
    let searchParams = new URLSearchParams(window.location.search);
    if (value) {
      searchParams.set(key, value);
    } else {
      searchParams.delete(key);
    }
    let newUrl =
      window.location.protocol + "//" + window.location.host + window.location.pathname + "?" + searchParams.toString();
    window.history.pushState({ path: newUrl }, "", newUrl);
  }
}

// PROJECT ID

/** @type {string?} */
let projectId;

/** @type {HTMLInputElement} */
const projectIdInput = document.getElementById("projectId");
projectIdInput.addEventListener("input", (event) => {
  setProjectId(event.target.value);
  setHmacKey();
});
/** @param {string} newProjectId */
function setProjectId(newProjectId) {
  projectId = newProjectId;
  console.log({ projectId });
  window.dispatchEvent(new Event("projectId"));
  projectIdInput.value = projectId;
  setUrlParam("projectId", projectId);
}
window.addEventListener("loadConfig", () => {
  if (config.projectId) {
    setProjectId(Number(config.projectId));
  }
});
window.addEventListener("load", () => {
  if (url.searchParams.has("projectId")) {
    setProjectId(url.searchParams.get("projectId"));
  }
});

// EDGE IMPULSE KEYS

/** @type {string?} */
let apiKey;

const apiKeyInput = document.getElementById("apiKey");
apiKeyInput.addEventListener("input", (event) => {
  setApiKey(event.target.value);
  setHmacKey();
});
function setApiKey(newApiKey) {
  apiKey = newApiKey;
  apiKeyInput.value = apiKey;
  console.log({ apiKey });
  window.dispatchEvent(new Event("apiKey"));
  setUrlParam("apiKey", apiKey);
}
window.addEventListener("loadConfig", () => {
  if (config.apiKey) {
    setApiKey(config.apiKey);
  }
});
window.addEventListener("load", () => {
  if (url.searchParams.has("apiKey")) {
    setApiKey(url.searchParams.get("apiKey"));
  }
});

// HmacKey

/** @type {string?} */
let hmacKey;

function setHmacKey(newHmacKey) {
  hmacKey = newHmacKey;
  console.log({ hmacKey });
  window.dispatchEvent(new Event("hmacKey"));
  updateHmacKeyButton();
  setUrlParam("hmacKey", hmacKey);
}

/** @type {HTMLButtonElement} */
const getHmacKeyButton = document.getElementById("getHmacKey");
getHmacKeyButton.addEventListener("click", async () => {
  getHmacKeyButton.innerText = "getting hmacKey...";
  getHmacKeyButton.disabled = true;
  await getHmacKey();
  updateHmacKeyButton();
});

function updateHmacKeyButton() {
  getHmacKeyButton.disabled = Boolean(hmacKey);
  getHmacKeyButton.innerText = Boolean(hmacKey) ? "got hmacKey" : "get hmacKey";
}

["projectId", "apiKey", "hmacKey"].forEach((eventType) => {
  window.addEventListener(eventType, () => {
    updateHmacKeyButton();
  });
});

window.addEventListener("load", () => {
  if (url.searchParams.has("hmacKey")) {
    setHmacKey(url.searchParams.get("hmacKey"));
  }
});

// EDGE IMPULSE API

const ingestionApi = "https://ingestion.edgeimpulse.com";
const remoteManagementEndpoint = "wss://remote-mgmt.edgeimpulse.com";
const studioEndpoint = "https://studio.edgeimpulse.com";

async function getProjects() {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", `${studioEndpoint}/v1/api/projects`);
    x.onload = () => {
      if (x.status !== 200) {
        reject("No projects found: " + x.status + " - " + JSON.stringify(x.response));
      } else {
        if (!x.response.success) {
          reject(x.response.error);
        } else {
          const projects = x.response.projects;
          console.log("projects", projects);
          resolve(projects);
          window.dispatchEvent(new CustomEvent("edgeImpulseProjects", { detail: { projects } }));
        }
      }
    };
    x.onerror = (err) => reject(err);
    x.responseType = "json";
    x.setRequestHeader("x-api-key", apiKey);
    x.send();
  });
}

async function getProject() {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", `${studioEndpoint}/v1/api/${projectId}/public-info`);
    x.onload = () => {
      if (x.status !== 200) {
        reject("No projects found: " + x.status + " - " + JSON.stringify(x.response));
      } else {
        if (!x.response.success) {
          reject(x.response.error);
        } else {
          const project = x.response;
          console.log("project", project);
          resolve(project);
          window.dispatchEvent(new CustomEvent("edgeImpulseProject", { detail: { project } }));
        }
      }
    };
    if (apiKey) {
      x.setRequestHeader("x-api-key", apiKey);
    }
    x.onerror = (err) => reject(err);
    x.responseType = "json";
    x.send();
  });
}

async function getHmacKey() {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", `${studioEndpoint}/v1/api/${projectId}/devkeys`);
    x.onload = () => {
      if (x.status !== 200) {
        reject("No development keys found: " + x.status + " - " + JSON.stringify(x.response));
      } else {
        if (!x.response.success) {
          reject(x.response.error);
        } else {
          const { apiKey, hmacKey } = x.response;
          console.log({ apiKey, hmacKey });
          //setApiKey(apiKey);
          setHmacKey(hmacKey);
          resolve({
            apiKey,
            hmacKey,
          });
        }
      }
    };
    x.onerror = (err) => reject(err);
    x.responseType = "json";
    if (apiKey) {
      x.setRequestHeader("x-api-key", apiKey);
    }
    x.send();
  });
}

// SAMPLING

let isSampling = false;
/** @param {boolean} newIsSampling */
function setIsSampling(newIsSampling) {
  isSampling = newIsSampling;
  console.log({ isSampling });
  window.dispatchEvent(new Event("isSampling"));
}

/** @type {HTMLButtonElement} */
const toggleSamplingButton = document.getElementById("toggleSampling");
toggleSamplingButton.addEventListener("click", () => {
  if (isSampling) {
    // TODO
  } else {
    sampleAndUpload();
  }
});

function updateToggleSamplingButton() {
  const enabled = isRemoteManagementConnected() && label.length > 0 && !isSampling && mediaStream;
  toggleSamplingButton.disabled = !enabled;
  toggleSamplingButton.innerText = isSampling ? "sampling..." : "start sampling";
}

window.addEventListener("load", () => {
  ["isSampling", "remoteManagementConnection", "label"].forEach((eventType) => {
    window.addEventListener(eventType, () => {
      updateToggleSamplingButton();
    });
  });
});

// https://github.com/edgeimpulse/mobile-client/blob/b773b3b00894ddfde2493aece7d5c794e7cc02f8/public/smartphone/recorder.js#L335
async function sampleAndUpload() {
  setIsSampling(true);

  const audioData = await collectSamples();
  const audioValues = convertFloat32ToPCM(combineFloat32Arrays(audioData));
  const values = Array.from(audioValues);
  console.log("values", values);

  sendRemoteManagementMessage?.({ sampleFinished: true });
  setIsSampling(false);

  sendRemoteManagementMessage?.({ sampleUploading: true });
  await uploadData(values);
}

/**
 * @param {number?} numberOfSamples
 * @returns {Promise<Float32Array[]>}
 */
async function collectSamples(numberOfSamples) {
  if (!mediaStream) {
    console.log("no mediaStream");
    return;
  }

  if (numberOfSamples == undefined) {
    numberOfSamples = (sampleLength / 1000) * sampleRate;
  }

  console.log({ numberOfSamples });

  const audioData = [];
  let sampleCount = 0;

  const promise = new Promise((resolve, reject) => {
    mediaStreamScriptProcessor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer.getChannelData(0);
      audioData.push(new Float32Array(inputBuffer));
      sampleCount += inputBuffer.length;
      console.log({ sampleCount });
      if (sampleCount >= numberOfSamples) {
        const overflow = sampleCount - numberOfSamples;
        audioData[audioData.length - 1] = inputBuffer.slice(0, inputBuffer.length - overflow);
        mediaStreamScriptProcessor.disconnect();
        gainNode.disconnect(mediaStreamScriptProcessor);
        //resolve(createWavBlob(audioData, audioContext.sampleRate));
        resolve(audioData);
      }
    };

    mediaStreamSourceNode.onerror = (error) => {
      mediaStreamScriptProcessor.disconnect();
      gainNode.disconnect(mediaStreamScriptProcessor);
      reject(error);
    };

    gainNode.connect(mediaStreamScriptProcessor);
    mediaStreamScriptProcessor.connect(audioContext.destination);
  });

  const blob = await promise;
  return blob;
}

/**
 * @param {number?} numberOfSamples
 * @returns {Promise<Blob>}
 */
async function getWav(numberOfSamples) {
  const audioData = await collectSamples(numberOfSamples);
  return createWavBlob(audioData, audioContext.sampleRate);
}

/**
 * Converts recorded audio data to a WAV Blob.
 * @param {Float32Array[]} audioData - The recorded audio data.
 * @param {number} sampleRate - The sample rate of the audio.
 * @returns {Blob} - A Blob containing the WAV file.
 */
function createWavBlob(audioData, sampleRate) {
  const totalSamples = audioData.reduce((sum, buffer) => sum + buffer.length, 0);
  const wavBuffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(wavBuffer);

  // Write WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF"); // ChunkID
  view.setUint32(4, 36 + totalSamples * 2, true); // ChunkSize
  writeString(8, "WAVE"); // Format
  writeString(12, "fmt "); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size (PCM)
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, 1, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, "data"); // Subchunk2ID
  view.setUint32(40, totalSamples * 2, true); // Subchunk2Size

  // Write audio data
  let offset = 44;
  audioData.forEach((buffer) => {
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, buffer[i])); // Clamp to [-1, 1]
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  });

  return new Blob([view], { type: "audio/wav" });
}

/** @type {MediaRecorder} */
let mediaRecorder;
/** @returns {Promise<Blob>} */
async function collectDataWithMediaRecorder() {
  if (!mediaStream) {
    console.log("no mediaStream");
    return;
  }

  const promise = new Promise((resolve) => {
    mediaRecorder = new MediaRecorder(mediaStream);
    let audioChunks = [];

    mediaRecorder.onstart = (event) => {
      console.log(event);
    };
    mediaRecorder.onerror = (event) => {
      console.log(event);
    };
    mediaRecorder.onpause = (event) => {
      console.log(event);
    };

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      console.log("stopped recording");
      const blob = new Blob(audioChunks, { type: "audio/wav" });
      console.log("blob", blob);
      resolve(blob);
      mediaRecorder = null;
    };

    mediaRecorder.start();
    window.setTimeout(() => {
      if (mediaRecorder?.state == "recording") {
        mediaRecorder.stop();
      }
    }, sampleLength);
  });

  const blob = await promise;
  return blob;
}

// LABEL

/** @type {string} */
let label;
/** @type {HTMLSelectElement} */
const labelInput = document.getElementById("label");
const vowelLabelsOptgroup = document.getElementById("vowelLabels");
const voicedConsonantLabelsOptgroup = document.getElementById("voicedConsonantLabels");
const voicelessConsonantLabelsOptgroup = document.getElementById("voicelessConsonantLabels");
Object.entries(phonemes).forEach(([phoneme, value]) => {
  const option = new Option(`${phoneme} (${value.example})`, phoneme);
  if (value.type == "vowel") {
    vowelLabelsOptgroup.appendChild(option);
  } else {
    if (value.voiced) {
      voicedConsonantLabelsOptgroup.appendChild(option);
    } else {
      voicelessConsonantLabelsOptgroup.appendChild(option);
    }
  }
});
labelInput.addEventListener("input", (event) => {
  setLabel(event.target.value);
  throttledSendToPinkTrombone({ phoneme: event.target.value });
});
/** @param {string} newLabel */
function setLabel(newLabel) {
  label = newLabel;
  console.log({ label });
  labelInput.value = label;
  window.dispatchEvent(new Event("label"));
}
setLabel("silence");

// PATH
/** @type {string} */
let path;
/** @type {HTMLInputElement} */
const pathInput = document.getElementById("path");
pathInput.addEventListener("input", (event) => {
  setPath(event.target.value);
});
/** @param {string} newPath */
function setPath(newPath) {
  path = newPath;
  console.log({ path });
  pathInput.value = path;
  window.dispatchEvent(new Event("path"));
}
setPath("/api/training/data");

// REMOTE MANAGEMENT

/**
 * @typedef SamplingDetails
 * @type {Object}
 * @property {string} path
 * @property {string} label
 * @property {number} length ms
 * @property {number} interval ms
 * @property {string} hmacKey
 * @property {string} sensor
 */

/** @type {WebSocket?} */
let remoteManagementWebSocket;
/** @type {(message: object)=>{}?} */
let sendRemoteManagementMessage;
async function connectToRemoteManagement() {
  remoteManagementWebSocket?.close();

  /** @type {number?} */
  let intervalId;

  const ws = new WebSocket(remoteManagementEndpoint);
  remoteManagementWebSocket = ws;

  sendRemoteManagementMessage = (message) => {
    console.log("sending message", message);
    ws.send(JSON.stringify(message));
  };
  ws.addEventListener("open", () => {
    console.log("remoteManagementWebSocket.open");
    window.dispatchEvent(new Event("remoteManagementConnection"));
    sendRemoteManagementMessage(remoteManagementHelloMessage());
    intervalId = setInterval(() => {
      console.log("ping");
      ws.send("ping");
    }, 3000);
  });
  ws.addEventListener("close", () => {
    console.log("remoteManagementWebSocket.close");
    window.dispatchEvent(new Event("remoteManagementConnection"));
    clearInterval(intervalId);
    if (reconnectRemoteManagementOnDisconnection && !ws.dontReconnect) {
      window.setTimeout(() => {
        if (!reconnectRemoteManagementOnDisconnection) {
          return;
        }
        connectToRemoteManagement();
      }, 2000);
    }
  });
  ws.addEventListener("error", (event) => {
    console.log("remoteManagementWebSocket.error", event);
    window.dispatchEvent(new Event("remoteManagementConnection"));
  });
  ws.addEventListener("message", async (event) => {
    console.log("remoteManagementWebSocket.message", event.data);

    const data = await parseRemoteManagementMessage(event);
    if (!data) {
      return;
    }

    console.log({ data });

    if ("hello" in data) {
      const isConnected = data.hello;
      console.log({ isConnected });
      if (isConnected) {
        ws._isConnected = true;
        window.dispatchEvent(new Event("remoteManagementConnection"));
      }
    }

    if ("sample" in data) {
      /** @type {SamplingDetails} */
      const samplingDetails = data.sample;
      console.log("samplingDetails", samplingDetails);

      const newSampleRate = 1000 / samplingDetails.interval;
      await setSampleRate(newSampleRate);
      setSampleLength(samplingDetails.length);
      setLabel(samplingDetails.label);
      setHmacKey(samplingDetails.hmacKey);
      setPath(samplingDetails.path);

      sampleAndUpload();
    }
  });
}

/** @type {number} */
let samplingInterval = 1000 / sampleRate;
/** @param {number} newSamplingInterval */
function setSamplingInterval(newSamplingInterval) {
  console.log({ newSamplingInterval });
  samplingInterval = newSamplingInterval;
}

async function parseRemoteManagementMessage(event) {
  if (event.data instanceof Blob) {
    return await readFile(event.data);
  } else if (typeof event.data === "string") {
    if (event.data === "pong") return null;
    return JSON.parse(event.data);
  }
  return null;
}

let deviceId = "My Headphones";
/** @type {HTMLInputElement} */
const deviceIdInput = document.getElementById("deviceId");
deviceIdInput.addEventListener("input", (event) => {
  setDeviceId(event.target.value);
});
deviceIdInput.value = deviceId;
/** @param {string} newDeviceId */
function setDeviceId(newDeviceId) {
  deviceId = newDeviceId;
  console.log({ deviceId });
  window.dispatchEvent(new Event("deviceId"));
  deviceIdInput.value = deviceId;
  setUrlParam("deviceId", deviceId);
}
window.addEventListener("loadConfig", () => {
  if (config.deviceId) {
    deviceIdInput.value = config.deviceId;
  }
});
window.addEventListener("load", () => {
  if (url.searchParams.has("deviceId")) {
    setDeviceId(url.searchParams.get("deviceId"));
  }
});

let deviceType = navigator.userAgent;

const getSensors = () => [
  {
    name: "Microphone",
    frequencies: sampleRates,
    maxSampleLengthS: sampleLength,
    units: "wav",
  },
];

function remoteManagementHelloMessage() {
  const message = {
    hello: {
      version: 3,
      apiKey,
      deviceId,
      deviceType,
      connection: "ip",
      sensors: getSensors(),
      supportsSnapshotStreaming: false,
    },
  };
  console.log("remoteManagementHelloMessage", message);
  return message;
}

function isRemoteManagementConnected() {
  return remoteManagementWebSocket?.readyState == WebSocket.OPEN && remoteManagementWebSocket?._isConnected;
}

/** @type {HTMLButtonElement} */
const toggleRemoteManagementConnectionButton = document.getElementById("toggleRemoteManagementConnection");
toggleRemoteManagementConnectionButton.addEventListener("click", () => {
  if (isRemoteManagementConnected()) {
    remoteManagementWebSocket.dontReconnect = true;
    remoteManagementWebSocket.close();
    toggleRemoteManagementConnectionButton.innerText = "disconnecting...";
    toggleRemoteManagementConnectionButton.disabled = true;
    deviceIdInput.disabled = true;
    sampleRateInput.disabled = true;
    sampleLengthInput.disabled = true;
    toggleSamplingButton.disabled = false;
  } else {
    connectToRemoteManagement();
    toggleRemoteManagementConnectionButton.innerText = "connecting...";
    deviceIdInput.disabled = false;
    sampleRateInput.disabled = false;
    sampleLengthInput.disabled = false;
    toggleSamplingButton.disabled = true;
  }
});

window.addEventListener("remoteManagementConnection", () => {
  if (isRemoteManagementConnected()) {
    toggleRemoteManagementConnectionButton.innerText = "disconnect";
    toggleRemoteManagementConnectionButton.disabled = false;
  } else {
    toggleRemoteManagementConnectionButton.innerText = "connect";
    toggleRemoteManagementConnectionButton.disabled = false;
  }
});

let reconnectRemoteManagementOnDisconnection = false;
/** @type {HTMLInputElement} */
const reconnectRemoteManagementOnDisconnectionInput = document.getElementById(
  "reconnectRemoteManagementOnDisconnection"
);
reconnectRemoteManagementOnDisconnectionInput.addEventListener("input", (event) => {
  setReconnectRemoteManagementOnDisconnection(event.target.checked);
});
reconnectRemoteManagementOnDisconnectionInput.checked = reconnectRemoteManagementOnDisconnection;
/** @param {boolean} newReconnectRemoteManagementOnDisconnection */
function setReconnectRemoteManagementOnDisconnection(newReconnectRemoteManagementOnDisconnection) {
  reconnectRemoteManagementOnDisconnection = newReconnectRemoteManagementOnDisconnection;
  console.log({ reconnectRemoteManagementOnDisconnection });
  dispatchEvent(new Event("reconnectRemoteManagementOnDisconnection"));
}

// DATA UPLOAD

async function blobToAudioBuffer(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

function extractPCMValues(audioBuffer) {
  const pcmData = [];
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < channelData.length; i++) {
    pcmData.push(channelData[i]);
  }
  return pcmData;
}

/** @param {number[]} values */
async function uploadData(values) {
  console.log("Uploading values", values);

  const data = {
    protected: {
      ver: "v1",
      alg: "HS256",
      iat: Math.floor(Date.now() / 1000),
    },
    signature: emptySignature,
    payload: {
      device_name: deviceId,
      device_type: deviceType,
      interval_ms: samplingInterval,
      sensors: getSensors(),
      values,
    },
  };

  console.log("Message before signing", data);

  data.signature = await createSignature(hmacKey, data);
  console.log("Signature generated", data.signature);

  const formData = new FormData();
  formData.append("message", new Blob([JSON.stringify(data)], { type: "application/json" }), "message.json");

  console.log("Form data prepared", formData);

  return new Promise((resolve, reject) => {
    const xml = new XMLHttpRequest();
    xml.onload = () => {
      if (xml.status === 200) {
        console.log("Upload successful", xml.responseText);
        resolve(xml.responseText);
      } else {
        console.error("Upload failed", xml.status, xml.responseText);
        reject(`Failed to upload (status code ${xml.status}): ${xml.responseText}`);
      }
    };
    xml.onerror = () => {
      console.error("Network error during upload");
      reject("Network error");
    };
    xml.open("POST", `${ingestionApi}${path}`);
    xml.setRequestHeader("x-api-key", apiKey);
    xml.setRequestHeader("x-file-name", encodeLabel(label));
    xml.send(formData);
  });
}

function encodeLabel(header) {
  let encodedHeader;
  try {
    encodedHeader = encodeURIComponent(header);
  } catch (ex) {
    encodedHeader = header;
  }

  return encodedHeader;
}

const textEncoder = new TextEncoder();

/**
 * @param {string} hmacKey
 * @param {object} data
 */
async function createSignature(hmacKey, data) {
  // encoder to convert string to Uint8Array
  const key = await crypto.subtle.importKey(
    "raw", // raw format of the key - should be Uint8Array
    textEncoder.encode(hmacKey),
    {
      // algorithm details
      name: "HMAC",
      hash: {
        name: "SHA-256",
      },
    },
    false, // export = false
    ["sign", "verify"] // what this key can do
  );
  // Create signature for encoded input data
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(JSON.stringify(data)));
  // Convert back to Hex
  const b = new Uint8Array(signature);
  return Array.prototype.map.call(b, (x) => ("00" + x.toString(16)).slice(-2)).join("");
}

const emptySignature = Array(64).fill("0").join("");

// EDGE IMPULSE CONFIG

const configLocalStorageKey = "PinkTrombone.EdgeImpulse";

let config = {
  projectId,
  apiKey,
  hmacKey,
  deviceId,
  sampleRate,
  sampleLength,
};
/** @type {object?} */
let loadedConfig;
console.log("config", config);
function loadConfigFromLocalStorage() {
  const configString = localStorage.getItem(configLocalStorageKey);
  if (!configString) {
    return;
  }
  loadedConfig = JSON.parse(configString);
  console.log("loaded config", loadedConfig);
  Object.assign(config, loadedConfig);
  console.log("updated config", config);
  window.dispatchEvent(new Event("loadConfig"));
}
loadConfigFromLocalStorage();

function saveConfigToLocalStorage() {
  const isConfigDifferent =
    !loadedConfig ||
    Object.keys(loadedConfig).length != Object.keys(config).length ||
    Object.entries(loadedConfig).some(([key, value]) => config[key] != value);
  if (!isConfigDifferent) {
    return;
  }
  console.log("saving config", config);
  localStorage.setItem(configLocalStorageKey, JSON.stringify(config));
  loadedConfig = config;
}

Object.keys(config).forEach((type) => {
  window.addEventListener(type, () => {
    config = {
      projectId,
      apiKey,
      hmacKey,
      deviceId,
      sampleRate,
      sampleLength,
    };
    saveConfigToLocalStorage();
  });
});

// CLASSIFICATION
/** @type {EdgeImpulseClassifier} */
let classifier;
let classifierProject;
let classifierProperties;
let isClassifierLoaded = false;
let classifierThreshold = 0.3;
/**
 * @typedef {object} EdgeImpulseClassifierResults
 * @property {number} anomaly
 * @property {{label: string, value: number}[]} results
 */
/** @type {EdgeImpulseClassifierResults|undefined} */
let classifierResults;
(async () => {
  try {
    classifier = new EdgeImpulseClassifier();
    await classifier.init();

    classifierProject = classifier.getProjectInfo();
    console.log("classifierProject", classifierProject);
    classifierProperties = classifier.getProperties();
    console.log("classifierProperties", classifierProperties);
    isClassifierLoaded = true;
    //setSampleRate(classifierProperties.frequency);
    updateClassifyButton();
    //setSampleLength((1000 * classifierProperties.frame_sample_count) / classifierProperties.frequency);
  } catch (error) {
    console.log("error loading classifier");
  }
})();

const classifyButton = document.getElementById("classify");
classifyButton.addEventListener("click", () => {
  classify();
});
let isClassifying = false;
function setIsClassifying(newIsClassifying) {
  isClassifying = newIsClassifying;
  updateClassifyButton();
}
/**
 * @param {Float32Array[]} float32Arrays
 * @returns {Float32Array}
 */
function combineFloat32Arrays(float32Arrays) {
  const totalLength = float32Arrays.reduce((sum, arr) => sum + arr.length, 0);
  const combinedArray = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of float32Arrays) {
    combinedArray.set(arr, offset);
    offset += arr.length;
  }

  return combinedArray;
}
/**
 * @param {Float32Array} float32Array
 * @returns {Int16Array}
 */
function convertFloat32ToPCM(float32Array) {
  const pcmArray = new Int16Array(float32Array.length);

  for (let i = 0; i < float32Array.length; i++) {
    const clampedValue = Math.max(-1, Math.min(1, float32Array[i]));

    pcmArray[i] = clampedValue < 0 ? clampedValue * 0x8000 : clampedValue * 0x7fff;
  }

  return pcmArray;
}
async function classify() {
  await setSampleRate(classifierProperties.frequency);
  setIsClassifying(true);
  const audioData = await collectSamples(classifierProperties.frame_sample_count);
  const audioValues = convertFloat32ToPCM(combineFloat32Arrays(audioData));
  console.log(audioValues);
  classifierResults = classifier.classify(audioValues, false);
  console.log("classifierResults", classifierResults);
  classifierResults.results.sort((a, b) => b.value - a.value);
  const volume = updateVolume();
  const { pitch, clarity } = updatePitch();
  const phoneme = classifierResults.results[0].label;
  const value = classifierResults.results[0].value;
  console.log({ phoneme, value });
  if (volume > volumeThreshold && value > classifierThreshold) {
    topClassification.innerText = phoneme;
    classifierResultsPre.textContent = JSON.stringify(classifierResults, null, 2);
    throttledSendToGame();
    if (phoneme == "silence") {
      throttledSendToPinkTrombone({ intensity: 0 });
    } else {
      const message = { phoneme, intensity: 1 };
      if (clarity > clarityThreshold && pitch > 50) {
        message.frequency = pitch;
      }
      throttledSendToPinkTrombone(message);
    }
  } else {
    throttledSendToPinkTrombone({ intensity: 0 });
  }

  setIsClassifying(false);
  if (autoClassify) {
    classify();
  }
}

function updateClassifyButton() {
  const enabled = isClassifierLoaded && mediaStream && !isClassifying;
  classifyButton.disabled = !enabled;
  classifyButton.innerText = isClassifying ? "classifying" : "classify";
}

/** @type {HTMLPreElement} */
const classifierResultsPre = document.getElementById("classifierResultsPre");
const topClassification = document.getElementById("topClassification");

let autoClassify = false;
const autoClassifyCheckbox = document.getElementById("autoClassify");
autoClassifyCheckbox.addEventListener("input", (event) => {
  autoClassify = event.target.checked;
});

let shouldSendToPinkTrombone = true;
let shouldSendToLipSync = true;
let shouldSendToPronunciation = true;
let shouldSendToGame = true;
const throttledSendToPinkTrombone = throttle((message) => {
  if (shouldSendToPinkTrombone) {
    send({ to: ["pink-trombone"], type: "message", ...message });
  }
}, 10);
const throttledSendToGame = throttle(() => {
  const to = [];
  if (shouldSendToLipSync) {
    to.push("lip-sync");
  }
  if (shouldSendToPronunciation) {
    to.push("pronunciation");
  }
  if (shouldSendToGame) {
    to.push("game");
  }
  if (to.length > 0) {
    const _results = [];
    classifierResults.results.forEach(({ value, label }, index) => {
      _results.push({ name: label, weight: value });
    });
    send({ to, type: "message", results: _results });
  }
}, 2);
