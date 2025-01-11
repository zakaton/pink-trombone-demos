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

const audioContext = new AudioContext();
gainNode = audioContext.createGain();
autoResumeAudioContext(audioContext);

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
    if (isListeningToMicrophone) {
      mediaStreamSourceNode.connect(audioContext.destination);
      debugMicrophoneButton.innerText = "stop listening to microphone";
    } else {
      mediaStreamSourceNode.disconnect(audioContext.destination);
      debugMicrophoneButton.innerText = "listen to microphone";
    }
  }
});

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
    projectIdInput.value = config.projectId;
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

      return;
      const numberOfSamples = samplingDetails.length / samplingDetails.interval;
      setNumberOfSamples(numberOfSamples);
      setSensorTypes(sensorTypes);
      setSamplingInterval(samplingDetails.interval);
      setSamplingLength(samplingDetails.length);
      setLabel(samplingDetails.label);
      setHmacKey(samplingDetails.hmacKey);
      setPath(samplingDetails.path);

      sampleAndUpload();

      // /** @type {SensorConfiguration} */
      // const sensorConfiguration = {};
      // sensorTypes.forEach((sensorType) => {
      //     sensorConfiguration[sensorType] = samplingDetails.interval;
      // });
      // console.log("sensorConfiguration", sensorConfiguration);
      // device.setSensorConfiguration(sensorConfiguration);

      // setIsSampling(true);

      // const deviceData = await collectData(sensorTypes, numberOfSamples);
      // await device.clearSensorConfiguration();
      // console.log("deviceData", deviceData);

      // sendRemoteManagementMessage?.({ sampleFinished: true });
      // setIsSampling(false);

      // sendRemoteManagementMessage?.({ sampleUploading: true });
      // await uploadData(samplingDetails, sensorTypes, deviceData);
    }
  });
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

let deviceId = "";
/** @type {HTMLInputElement} */
const deviceIdInput = document.getElementById("deviceId");
deviceIdInput.addEventListener("input", (event) => {
  setDeviceId(event.target.value);
});
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

const sensors = [
  {
    name: "Microphone",
    frequencies: [48000],
    maxSampleLengthS: 100,
  },
];

let deviceType = navigator.userAgent;

function remoteManagementHelloMessage() {
  const message = {
    hello: {
      version: 3,
      apiKey: apiKey,
      deviceId,
      deviceType,
      connection: "ip",
      sensors,
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
  } else {
    connectToRemoteManagement();
    toggleRemoteManagementConnectionButton.innerText = "connecting...";
    deviceIdInput.disabled = false;
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

const emptySignature = Array(64).fill("0").join("");

// FIX
/**
 * @param {BS.ContinuousSensorType[]} sensorTypes
 * @param {DeviceData} deviceData
 */
async function uploadData(sensorTypes, deviceData) {
  const sensors = sensorTypes.flatMap((sensorType) => {
    let names = [];
    let units;
    switch (sensorType) {
      // FILL
      case "linearAcceleration":
      case "gyroscope":
      case "magnetometer":
        names = ["x", "y", "z"].map((component) => `${sensorType}.${component}`);
        switch (sensorType) {
          case "linearAcceleration":
            units = "g/s";
            break;
          case "gyroscope":
            units = "deg/s";
            break;
          case "magnetometer":
            units = "uT";
            break;
        }
        break;
      default:
        throw `uncaught sensorType ${sensorType}`;
    }

    return names.map((name) => ({
      name,
      units,
    }));
  });

  console.log("sensors", sensors);

  const values = [];
  for (let sampleIndex = 0; sampleIndex < numberOfSamples; sampleIndex++) {
    const value = [];

    sensorTypes.forEach((sensorType) => {
      const scalar = scalars[sensorType];
      const sensorSamples = deviceData[sensorType];

      switch (sensorType) {
        case "linearAcceleration":
        case "gyroscope":
        case "magnetometer":
          ["x", "y", "z"].forEach((component) => {
            value.push(sensorSamples[sampleIndex][component] * scalar);
          });
          break;
        default:
          throw `uncaught sensorType ${sensorType}`;
      }
    });

    values.push(value);
  }

  console.log("values", values);

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
      sensors,
      values,
    },
  };

  console.log("data", data);

  data.signature = await createSignature(hmacKey, data);

  console.log("signature", data.signature);

  const formData = new FormData();
  formData.append("message", new Blob([JSON.stringify(data)], { type: "application/json" }), "message.json");

  return new Promise((resolve, reject) => {
    let xml = new XMLHttpRequest();
    xml.onload = () => {
      if (xml.status === 200) {
        resolve(xml.responseText);
      } else {
        reject("Failed to upload (status code " + xml.status + "): " + xml.responseText);
      }
    };
    xml.onerror = () => reject(undefined);
    xml.open("post", ingestionApi + path);
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

// EDGE IMPULSE CONFIG

const configLocalStorageKey = "PinkTrombone.EdgeImpulse";

let config = {
  projectId,
  apiKey,
  hmacKey,
  deviceId,
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
  const isConfigDifferent = !loadedConfig || Object.entries(loadedConfig).some(([key, value]) => config[key] != value);
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
    };
    saveConfigToLocalStorage();
  });
});
