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
    return Boolean(
      this.tongue && this.backConstriction && this.frontConstriction
    );
  },
};
let voiceness = 0.7;
const { send } = setupConnection(
  "machine-learning",
  (message) => {
    if (message.from == "pink-trombone") {
      Object.assign(constrictions, message.constrictions);
      if ("voiceness" in message) {
        voiceness = message.voiceness;
      }
      //console.log(constrictions.getData(), voiceness);
      if (addDataButton.disabled) {
        addDataButton.disabled = false;
        trainButton.disabled = false;
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

/** @type {HTMLCanvasElement} */
const spectrumCanvas = document.getElementById("spectrum");
const spectrumContext = spectrumCanvas.getContext("2d");

spectrumContext.strokeStyle = "black";
/**
 * @param {number[]} spectrum
 */
function drawSpectrum(spectrum, canvas, context, otherSpectrum) {
  const { width: w, height: h } = canvas;
  context.clearRect(0, 0, w, h);
  if (otherSpectrum) {
    _drawSpectrum(otherSpectrum, "blue", canvas, context);
  }
  if (spectrum) {
    _drawSpectrum(spectrum, "black", canvas, context);
  }
}

const spectrumRange = { min: Infinity, max: -Infinity };
const updateSpectrum = (value) => {
  let didUpdateRange = false;
  if (value < spectrumRange.min) {
    spectrumRange.min = value;
    didUpdateRange = true;
  } else if (value > spectrumRange.max) {
    spectrumRange.max = value;
    didUpdateRange = true;
  }
  if (didUpdateRange) {
    spectrumRange.range = spectrumRange.max - spectrumRange.min;
  }
};
const normalizeValue = (value) => {
  return (value - spectrumRange.min) / spectrumRange.range;
};
function _drawSpectrum(spectrum, color = "black", canvas, context) {
  const { width: w, height: h } = canvas;
  const segmentLength = w / spectrum.length;
  context.strokeStyle = color;
  spectrum.forEach((value, index) => {
    const normalizedValue = normalizeValue(value);
    let height = 1 - normalizedValue;
    height *= h;
    context.beginPath();
    context.moveTo(index * segmentLength, height);
    context.lineTo((index + 1) * segmentLength, height);
    context.stroke();
  });
}

const audioContext = new AudioContext();
gainNode = audioContext.createGain();
autoResumeAudioContext(audioContext);

let numberOfSpectrumsToAverage = 5;
const lastNSpectrums = [];
let numberOfLoudnessesToAverage = 5;
const lastNLoudnesses = [];

let loudnessThreshold = 0.02;

let _spectrum, _loudness;

const onData = ({ spectrum, loudness }) => {
  lastNSpectrums.push(spectrum);
  while (lastNSpectrums.length > numberOfSpectrumsToAverage) {
    lastNSpectrums.shift();
  }
  spectrum = spectrum.map((_, index) => {
    let sum = 0;
    lastNSpectrums.forEach((_spectrum) => {
      sum += _spectrum[index];
    });
    return sum / lastNSpectrums.length;
  });
  spectrum.forEach((value) => updateSpectrum(value));

  if (!neuralNetwork) {
    neuralNetwork = ml5.neuralNetwork({
      inputs: spectrum.length,
      outputs,

      task: "regression",
      debug: "true",
      //learningRate: 0.1,
      //hiddenUnity: 16,
    });
  }

  lastNLoudnesses.push(loudness);
  while (lastNLoudnesses.length > numberOfLoudnessesToAverage) {
    lastNLoudnesses.shift();
  }
  let loudnessSum = 0;
  lastNLoudnesses.forEach((_loudness) => (loudnessSum += _loudness));
  loudness = loudnessSum / lastNLoudnesses.length;

  drawSpectrum(spectrum, spectrumCanvas, spectrumContext);

  if (loudness > loudnessThreshold) {
    if (isCollectingData) {
      addDataThrottled(spectrum);
    }
    if (finishedTraining) {
      predictThrottled(spectrum);
    }
    _spectrum = spectrum;
  } else {
    if (finishedTraining) {
      const message = {
        intensity: Math.min(getInterpolation(0, 0.15, loudness), 1),
      };
      throttledSend(message);
    }
  }
  _loudness = loudness;
};

const addDataThrottled = throttle((spectrum) => {
  addData(spectrum);
  numberOfSamplesCollected++;
  if (numberOfSamplesCollected >= numberOfSamplesToCollect) {
    toggleDataCollection();
  }
}, 10);

let includeBackConstriction = false;
let includeFrontConstriction = false;
let includeVoiceness = false;
const outputs = ["tongue.index", "tongue.diameter"];
if (includeFrontConstriction) {
  outputs.push("frontConstriction.diameter", "frontConstriction.index");
}
if (includeBackConstriction) {
  outputs.push("backConstriction.diameter", "backConstriction.index");
}
if (includeVoiceness) {
  outputs.push("voiceness");
}

let neuralNetwork;

const addDataButton = document.getElementById("addData");
addDataButton.addEventListener("click", (event) => {
  toggleDataCollection();
});

let isCollectingData = false;
let numberOfSamplesCollected = 0;
let numberOfSamplesToCollect = 30;
function toggleDataCollection() {
  numberOfSamplesCollected = 0;
  isCollectingData = !isCollectingData;
  addDataButton.innerText = isCollectingData ? "stop adding data" : "add data";
}

function _addData(mfcc) {
  const inputs = mfcc;
  const outputs = constrictions.getData();
  if (includeVoiceness) {
    Object.assign(outputs, { voiceness });
  }
  if (!includeBackConstriction) {
    delete outputs["backConstriction.index"];
    delete outputs["backConstriction.diameter"];
  }
  if (!includeFrontConstriction) {
    delete outputs["frontConstriction.index"];
    delete outputs["frontConstriction.diameter"];
  }
  neuralNetwork.addData(inputs, outputs);
  localStorage[localStorage.length] = JSON.stringify({ inputs, outputs });
  if (clearLocalStorageButton.disabled) {
    clearLocalStorageButton.disabled = false;
  }
}
const addData = throttle((mfcc) => _addData(mfcc), 50);
window.addEventListener("load", (event) => {
  if (localStorage.length > 0) {
    clearLocalStorageButton.disabled = false;
    loadDataFromLocalStorageButton.disabled = false;
  }
});

const trainButton = document.getElementById("train");
trainButton.addEventListener("click", (event) => {
  train();
});

function train() {
  addDataButton.disabled = true;
  trainButton.disabled = true;
  neuralNetwork.normalizeData();
  neuralNetwork.train(
    {
      epochs: 50,
      batchSize: 30,
    },
    whileTraining,
    onFinishedTraining
  );
}

function whileTraining(epoch, loss) {
  console.log(`Epoch: ${epoch}, Loss: ${loss.loss}`);
}

let finishedTraining = false;
function onFinishedTraining() {
  console.log("finished training");
  finishedTraining = true;
  downloadButton.disabled = false;
}

function predict(mfcc) {
  neuralNetwork.predict(mfcc, getPrediction);
}
const predictThrottled = throttle(predict, 100);

function getPrediction(error, results) {
  if (error) {
    console.error(error);
  } else {
    console.log(results);
    const message = {};
    results.forEach(({ label, value }) => {
      message[label] = value;
    });
    throttledSend(message);
  }
}

const throttledSend = throttle((message) => {
  send({ to: ["pink-trombone"], type: "message", ...message });
}, 100);

const downloadButton = document.getElementById("download");
downloadButton.addEventListener("click", (event) => {
  console.log("download");
  neuralNetwork.save("model", () => {
    console.log("saved");
    downloadButton.disabled = true;
  });
});

const uploadInput = document.getElementById("upload");
uploadInput.addEventListener("input", (event) => {
  neuralNetwork.load(event.target.files, () => {
    console.log("loaded");
    event.target.disabled = true;
    trainButton.disabled = true;
    addDataButton.disabled = true;
    finishedTraining = true;
  });
});

const clearLocalStorageButton = document.getElementById("clearLocalstorage");
clearLocalStorageButton.addEventListener("click", (event) => {
  localStorage.clear();
  clearLocalStorageButton.disabled = true;
  loadDataFromLocalStorageButton.disabled = true;
});

const loadDataFromLocalStorageButton = document.getElementById(
  "loadDataFromLocalstorage"
);
loadDataFromLocalStorageButton.addEventListener("click", (event) => {
  for (let index = 0; index < localStorage.length; index++) {
    const { inputs, outputs } = JSON.parse(localStorage[index]);
    if (!includeBackConstriction) {
      delete outputs["backConstriction.index"];
      delete outputs["backConstriction.diameter"];
    }
    if (!includeVoiceness) {
      delete outputs["voiceness"];
    }
    if (!includeFrontConstriction) {
      delete outputs["frontConstriction.index"];
      delete outputs["frontConstriction.diameter"];
    }
    neuralNetwork.addData(inputs, outputs);
  }
  loadDataFromLocalStorageButton.disabled = true;
  trainButton.disabled = false;
});
