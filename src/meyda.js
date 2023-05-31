if (!useEssentia) {
  audio = new Audio();
  const audioContext = new AudioContext();
  gainNode = audioContext.createGain();
  autoResumeAudioContext(audioContext);
  let startedMicrophone = false;

  const numberOfMFCCCoefficients = 30;

  const startMicrophone = () =>
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          noiseSuppression: false,
          autoGainControl: false,
          echoCancellation: false,
        },
      })
      .then((stream) => {
        window.stream = stream;
        const sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(gainNode);
        audio.srcObject = stream;

        // Create a Meyda analyzer node to calculate MFCCs
        analyzer = Meyda.createMeydaAnalyzer({
          audioContext: audioContext,
          source: gainNode,
          featureExtractors: ["mfcc", "rms"],
          numberOfMFCCCoefficients,
          callback: ({ mfcc, rms }) => {
            onData({ spectrum: mfcc, loudness: rms });
          },
        });

        // Start the analyzer to begin processing audio classifications
        analyzer.start();
      });

  audioContext.addEventListener("statechange", () => {
    if (!startedMicrophone && audioContext.state == "running") {
      startMicrophone();
      startedMicrophone = true;
    }
  });
}
