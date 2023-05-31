function setupPocketSphinx(onHyp) {
  // These will be initialized later
  var recognizer, recorder, callbackManager, audioContext, outputContainer;
  // Only when both recorder and recognizer do we have a ready application
  var isRecorderReady = (isRecognizerReady = false);

  // A convenience function to post a message to the recognizer and associate
  // a callback to its response
  function postRecognizerJob(message, callback) {
    var msg = message || {};
    if (callbackManager) msg.callbackId = callbackManager.add(callback);
    if (recognizer) recognizer.postMessage(msg);
  }

  // This function initializes an instance of the recorder
  // it posts a message right away and calls onReady when it
  // is ready so that onmessage can be properly set
  function spawnWorker(workerURL, onReady) {
    recognizer = new Worker(workerURL);
    console.log(recognizer);
    recognizer.onmessage = function (event) {
      onReady(recognizer);
    };
    // As arguments, you can pass non-default path to pocketsphinx.js and pocketsphinx.wasm:
    // recognizer.postMessage({'pocketsphinx.wasm': '/path/to/pocketsphinx.wasm', 'pocketsphinx.js': '/path/to/pocketsphinx.js'});
    recognizer.postMessage({
      "pocketsphinx.wasm": "./pocketsphinx.wasm",
      "pocketsphinx.js": "./pocketsphinx.js",
    });
  }

  // To display the hypothesis sent by the recognizer
  function updateHyp(hyp) {
    onHyp(hyp);
  }

  // This updates the UI when the app might get ready
  // Only when both recorder and recognizer are ready do we enable the buttons
  function updateUI() {
    if (isRecorderReady && isRecognizerReady)
      startBtn.disabled = stopBtn.disabled = false;
  }

  // This is just a logging window where we display the status
  function updateStatus(newStatus) {
    document.getElementById("current-status").innerHTML += "<br/>" + newStatus;
  }

  // A not-so-great recording indicator
  function displayRecording(display) {
    return;
    if (display)
      document.getElementById("recording-indicator").innerHTML =
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
    else document.getElementById("recording-indicator").innerHTML = "";
  }

  // Callback function once the user authorises access to the microphone
  // in it, we instanciate the recorder
  function startUserMedia(stream) {
    window.stream = stream;
    var input = audioContext.createMediaStreamSource(stream);
    // Firefox hack https://support.mozilla.org/en-US/questions/984179
    window.firefox_audio_hack = input;
    var audioRecorderConfig = {
      errorCallback: function (x) {
        updateStatus("Error from recorder: " + x);
      },
    };
    recorder = new AudioRecorder(input, audioRecorderConfig);
    // If a recognizer is ready, we pass it to the recorder
    if (recognizer) recorder.consumers = [recognizer];
    isRecorderReady = true;
    updateUI();
    updateStatus("Audio recorder ready");
  }

  // This starts recording. We first need to get the id of the grammar to use
  var startRecording = function () {
    //var id = document.getElementById("grammars").value;
    startBtn.disabled = true;
    stopBtn.disabled = false;

    var id = 0;
    if (recorder && recorder.start(id)) displayRecording(true);
  };

  // Stops recording
  var stopRecording = function () {
    recorder && recorder.stop();
    displayRecording(false);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  };

  // Called once the recognizer is ready
  // We then add the grammars to the input select tag and update the UI
  var recognizerReady = function () {
    updateGrammars();
    isRecognizerReady = true;
    updateUI();
    updateStatus("Recognizer ready");
  };

  // We get the grammars defined below and fill in the input select tag
  var updateGrammars = function () {
    return;
    var selectTag = document.getElementById("grammars");
    for (var i = 0; i < grammarIds.length; i++) {
      var newElt = document.createElement("option");
      newElt.value = grammarIds[i].id;
      newElt.innerHTML = grammarIds[i].title;
      selectTag.appendChild(newElt);
    }
  };

  // This adds a grammar from the grammars array
  // We add them one by one and call it again as
  // a callback.
  // Once we are done adding all grammars, we can call
  // recognizerReady()
  var feedGrammar = function (g, index, id) {
    if (id && grammarIds.length > 0) grammarIds[0].id = id.id;
    if (false && index < g.length) {
      grammarIds.unshift({ title: g[index].title });
      /*
      postRecognizerJob(
        { command: "addGrammar", data: g[index].g },
        function (id) {
          feedGrammar(grammars, index + 1, { id: id });
        }
      );
      */
    } else {
      // We are adding keyword spotting which has id 0
      //grammarIds.push({ id: 0, title: "Keyword spotting" });
      recognizerReady();
    }
  };

  var feedWords = function (words) {
    postRecognizerJob({ command: "addWords", data: words }, function () {
      feedGrammar(grammars, 0);
    });
  };

  // This initializes the recognizer. When it calls back, we add words
  var initRecognizer = function () {
    // You can pass parameters to the recognizer, such as : {command: 'initialize', data: [["-hmm", "my_model"], ["-fwdflat", "no"]]}
    postRecognizerJob(
      {
        command: "initialize",
        data: [
          //["-kws", "kws.txt"],
          //["-dict", "kws.dict"],
          //["-dict", "cmudict.dict"],
          //["-fwdflat", "no"],
          //["-backtrace", "yes"],
          //["-kws_threshold", "1e-40f"],
          //["-beam", "1e-20"],
          //["-pbeam", "1e-20"],
          //["-lw", "2.0"],
          ["-allphone", "en-us-phone.lm.bin"],
          ["-hmm", "cmusphinx-en-us-8khz-5.2"],
        ],
      },
      function () {
        if (recorder) recorder.consumers = [recognizer];
        feedWords([]);
      }
    );
  };

  // When the page is loaded, we spawn a new recognizer worker and call getUserMedia to
  // request access to the microphone
  window.onload = function () {
    outputContainer = document.getElementById("output");
    updateStatus(
      "Initializing web audio and speech recognizer, waiting for approval to access the microphone"
    );
    callbackManager = new CallbackManager();
    spawnWorker("./src/pocketsphinx/recognizer.js", function (worker) {
      // This is the onmessage function, once the worker is fully loaded
      worker.onmessage = function (e) {
        //console.log(e.data);
        // This is the case when we have a callback id to be called
        if (e.data.hasOwnProperty("id")) {
          var clb = callbackManager.get(e.data["id"]);
          var data = {};
          if (e.data.hasOwnProperty("data")) data = e.data.data;
          if (clb) clb(data);
        }
        // This is a case when the recognizer has a new hypothesis
        if (e.data.hasOwnProperty("hyp")) {
          var newHyp = e.data.hyp;
          if (e.data.hasOwnProperty("final") && e.data.final)
            newHyp = "Final: " + newHyp;
          updateHyp(e.data);
        }
        // This is the case when we have an error
        if (e.data.hasOwnProperty("status") && e.data.status == "error") {
          updateStatus(
            "Error in " + e.data.command + " with code " + e.data.code
          );
        }
      };
      // Once the worker is fully loaded, we can call the initialize function
      // but before that we lazy-load two files for keyword spoting (key phrase
      // file plus associated dictionary.
      postRecognizerJob(
        {
          command: "lazyLoad",
          data: {
            folders: [["/", "cmusphinx-en-us-8khz-5.2"]],
            files: [
              //["/", "kws.txt", "./kws.txt"],
              ["/", "kws.dict", "./kws.dict"],
              ["/", "cmudict.dict", "./cmudict.dict"],
              ["/", "en-us-phone.lm.bin", "./en-us-phone.lm.bin"],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "feat.params",
                "./cmusphinx-en-us-8khz-5.2/feat.params",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "mdef",
                "./cmusphinx-en-us-8khz-5.2/mdef",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "transition_matrices",
                "./cmusphinx-en-us-8khz-5.2/transition_matrices",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "means",
                "./cmusphinx-en-us-8khz-5.2/means",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "feature_transform",
                "./cmusphinx-en-us-8khz-5.2/feature_transform",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "mixture_weights",
                "./cmusphinx-en-us-8khz-5.2/mixture_weights",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "noisedict",
                "./cmusphinx-en-us-8khz-5.2/noisedict",
              ],
              [
                "/cmusphinx-en-us-8khz-5.2",
                "variances",
                "./cmusphinx-en-us-8khz-5.2/variances",
              ],
            ],
          },
        },
        initRecognizer
      );
    });

    // The following is to initialize Web Audio
    try {
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      window.URL = window.URL || window.webkitURL;
      audioContext = new AudioContext({ sampleRate: 8000 });
      autoResumeAudioContext(audioContext);
    } catch (e) {
      updateStatus("Error initializing Web Audio browser");
    }
    if (navigator.mediaDevices.getUserMedia)
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            //echoCancellation: false,
            //noiseSuppression: false,
            //autoGainControl: false,
          },
        })
        .then(startUserMedia)
        .catch(function (e) {
          updateStatus("No live audio input in this browser");
        });
    else updateStatus("No web audio support in this browser");

    // Wiring JavaScript to the UI
    var startBtn = document.getElementById("startBtn");
    var stopBtn = document.getElementById("stopBtn");
    startBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.onclick = startRecording;
    stopBtn.onclick = stopRecording;
  };

  // This is the list of words that need to be added to the recognizer
  // This follows the CMU dictionary format
  var wordList = [
    ["ONE", "W AH N"],
    ["TWO", "T UW"],
    ["THREE", "TH R IY"],
    ["FOUR", "F AO R"],
    ["FIVE", "F AY V"],
    ["SIX", "S IH K S"],
    ["SEVEN", "S EH V AH N"],
    ["EIGHT", "EY T"],
    ["NINE", "N AY N"],
    ["ZERO", "Z IH R OW"],
    ["NEW-YORK", "N UW Y AO R K"],
    ["NEW-YORK-CITY", "N UW Y AO R K S IH T IY"],
    ["PARIS", "P AE R IH S"],
    ["PARIS(2)", "P EH R IH S"],
    ["SHANGHAI", "SH AE NG HH AY"],
    ["SAN-FRANCISCO", "S AE N F R AE N S IH S K OW"],
    ["LONDON", "L AH N D AH N"],
    ["BERLIN", "B ER L IH N"],
    ["SUCKS", "S AH K S"],
    ["ROCKS", "R AA K S"],
    ["IS", "IH Z"],
    ["NOT", "N AA T"],
    ["GOOD", "G IH D"],
    ["GOOD(2)", "G UH D"],
    ["GREAT", "G R EY T"],
    ["WINDOWS", "W IH N D OW Z"],
    ["LINUX", "L IH N AH K S"],
    ["UNIX", "Y UW N IH K S"],
    ["MAC", "M AE K"],
    ["AND", "AE N D"],
    ["AND(2)", "AH N D"],
    ["O", "OW"],
    ["S", "EH S"],
    ["X", "EH K S"],
  ];
  // This grammar recognizes digits
  var grammarDigits = {
    numStates: 1,
    start: 0,
    end: 0,
    transitions: [
      { from: 0, to: 0, word: "ONE" },
      { from: 0, to: 0, word: "TWO" },
      { from: 0, to: 0, word: "THREE" },
      { from: 0, to: 0, word: "FOUR" },
      { from: 0, to: 0, word: "FIVE" },
      { from: 0, to: 0, word: "SIX" },
      { from: 0, to: 0, word: "SEVEN" },
      { from: 0, to: 0, word: "EIGHT" },
      { from: 0, to: 0, word: "NINE" },
      { from: 0, to: 0, word: "ZERO" },
    ],
  };
  // This grammar recognizes a few cities names
  var grammarCities = {
    numStates: 1,
    start: 0,
    end: 0,
    transitions: [
      { from: 0, to: 0, word: "NEW-YORK" },
      { from: 0, to: 0, word: "NEW-YORK-CITY" },
      { from: 0, to: 0, word: "PARIS" },
      { from: 0, to: 0, word: "SHANGHAI" },
      { from: 0, to: 0, word: "SAN-FRANCISCO" },
      { from: 0, to: 0, word: "LONDON" },
      { from: 0, to: 0, word: "BERLIN" },
    ],
  };
  // This is to play with beloved or belated OSes
  var grammarOses = {
    numStates: 7,
    start: 0,
    end: 6,
    transitions: [
      { from: 0, to: 1, word: "WINDOWS" },
      { from: 0, to: 1, word: "LINUX" },
      { from: 0, to: 1, word: "UNIX" },
      { from: 1, to: 2, word: "IS" },
      { from: 2, to: 2, word: "NOT" },
      { from: 2, to: 6, word: "GOOD" },
      { from: 2, to: 6, word: "GREAT" },
      { from: 1, to: 6, word: "ROCKS" },
      { from: 1, to: 6, word: "SUCKS" },
      { from: 0, to: 4, word: "MAC" },
      { from: 4, to: 5, word: "O" },
      { from: 5, to: 3, word: "S" },
      { from: 3, to: 1, word: "X" },
      { from: 6, to: 0, word: "AND" },
    ],
  };
  var grammars = [
    { title: "OSes", g: grammarOses },
    { title: "Digits", g: grammarDigits },
    { title: "Cities", g: grammarCities },
  ];
  var grammarIds = [];

  return { startRecording, stopRecording };
}
