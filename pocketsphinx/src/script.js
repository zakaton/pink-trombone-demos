const { send } = setupConnection("pocketsphinx", (message) => {
  // FILL
});

const { startRecording, stopRecording } = setupPocketSphinx(
  ({ hyp, hypseg }) => {
    //console.log(hyp, hypseg);
    let silenceLength = 0;
    hypseg.toReversed().every(
      (silenceLength,
      ({ word, start, end }) => {
        if (word == "SIL") {
          silenceLength += end - start;
          return true;
        }
      }),
      0
    );

    if (silenceLength > 300) {
      stopRecording();
    }
  }
);
