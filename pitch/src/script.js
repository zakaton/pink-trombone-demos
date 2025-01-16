const { send } = setupConnection("pitch", (message) => {
  // FILL
});

const { PitchDetector } = Pitchy;

let pitch, clarity;
const pitchElement = document.getElementById("pitch");
const clarityElement = document.getElementById("clarity");
function updatePitch() {
  analyserNode.getFloatTimeDomainData(pitchInput);
  [pitch, clarity] = detector.findPitch(pitchInput, audioContext.sampleRate);

  pitchElement.textContent = `${Math.round(pitch * 10) / 10} Hz`;
  clarityElement.textContent = `${Math.round(clarity * 100)} %`;
}

let volume;
const volumeElement = document.getElementById("volume");
function updateVolume() {
  analyserNode.getByteFrequencyData(volumeInput);

  let sum = 0;
  for (const amplitude of volumeInput) {
    sum += amplitude * amplitude;
  }

  volume = Math.sqrt(sum / volumeInput.length);
  volume = getInterpolation(20, 100, volume);
  volume = clamp(volume, 0, 1);

  volumeElement.textContent = `${Math.round(volume * 100)}%`;
}

let updateInterval = 50; //x ms update intervall
let volumeThreshold = 0.1; //% volume triggering change
let clarityThreshold = 0.97; // 0<1 clarity
const throttledSend = throttle(() => {
  const message = {
    type: "message",
    from: "pitch",
    to: ["pink-trombone"],
    //intensity: Math.min(getInterpolation(0, 0.3, volume), 1),
  };
  if (volume > volumeThreshold && clarity > clarityThreshold && pitch > 100) {
    message.frequency = pitch;
  }
  send(message);
}, updateInterval);
function update() {
  updateVolume();
  updatePitch();
  throttledSend();
  window.setTimeout(() => update(), updateInterval);
}

const audioContext = new window.AudioContext();
const analyserNode = audioContext.createAnalyser();
gainNode = audioContext.createGain();
gainNode.connect(analyserNode);

let detector, pitchInput, volumeInput, stream;
audioContext.addEventListener("statechange", (event) => {
  if (audioContext.state == "running" && !stream) {
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      .then((_stream) => {
        stream = _stream;
        audioContext.createMediaStreamSource(stream).connect(gainNode);
        detector = PitchDetector.forFloat32Array(analyserNode.fftSize);
        pitchInput = new Float32Array(detector.inputLength);
        volumeInput = new Uint8Array(detector.inputLength);
        update();
      });
  }
});
autoResumeAudioContext(audioContext);
