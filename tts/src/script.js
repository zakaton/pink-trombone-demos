const { send } = setupConnection("tts", (message) => {
  const { text, phonemes } = message;
  if (text) {
    textInput.value = text;
    textInput.dispatchEvent(new Event("input"));
    playButton.click();
  } else if (phonemes) {
    phonemesInput.value = phonemes;
    phonemesInput.dispatchEvent(new Event("input"));
    playButton.click();
  }
});

let speed = 1;
const speedInput = document.getElementById("speed");
speedInput.addEventListener("input", (event) => {
  speed = Number(event.target.value);
  //console.log("speed", speed);
});

let initialFrequency = 140;
const initialFrequencyInput = document.getElementById("initialFrequency");
initialFrequencyInput.addEventListener("input", (event) => {
  initialFrequency = Number(event.target.value);
  //console.log("initialFrequency", initialFrequency);
});

let initialTractLength = 44;
const initialTractLengthInput = document.getElementById("initialTractLength");
initialTractLengthInput.addEventListener("input", (event) => {
  initialTractLength = Number(event.target.value);
  //console.log("initialTractLength", initialTractLength);
});

const downloadButton = document.getElementById("download");
downloadButton.addEventListener("click", () => {
  const utterance = getUtterance();
  utterance.keyframes.forEach((keyframe) => {
    if (!("frequency" in keyframe)) {
      keyframe.frequency = initialFrequency;
    }
    if (!("tractLength" in keyframe)) {
      keyframe.tractLength = initialTractLength;
    }
  });
  downloadJSON([utterance]);
});

const downloadLink = document.getElementById("downloadLink");
function downloadJSON(json) {
  console.log("downloading", json);
  var dataString =
    "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(json));
  downloadLink.setAttribute("href", dataString);
  downloadLink.setAttribute(
    "download",
    `tts-${new Date().toLocaleString()}.json`
  );
  downloadLink.click();
}

const playButton = document.getElementById("play");
playButton.addEventListener("click", () => {
  const utterance = getUtterance(true);
  throttledSend({ utterance });
});

const getUtterance = () => {
  const utterance = { name: finalString, keyframes: renderKeyframes() };
  console.log("utterance", utterance);
  return utterance;
};

const renderKeyframes = (
  time = 0,
  frequency = initialFrequency,
  tractLength = initialTractLength
) => {
  const keyframes = [];
  resultsContainer.querySelectorAll(".result").forEach((resultContainer) => {
    const _keyframes = resultContainer.renderKeyframes(
      time,
      frequency,
      tractLength
    );
    const lastKeyframe = _keyframes[_keyframes.length - 1];
    time = lastKeyframe.time;
    frequency = lastKeyframe.frequency;
    tractLength = lastKeyframe.tractLength;
    keyframes.push(..._keyframes);
  });
  keyframes.push({
    name: ".",
    time: time + releaseTime / speed,
    frequency,
    tractLength,
    intensity: 0,
  });
  if (isWhispering) {
    keyframes.forEach((keyframe) => {
      Object.assign(keyframe, deconstructVoiceness(0));
    });
  }
  if (phonemeSubstitutionType == "misc.slurring") {
    keyframes.forEach((keyframe) => {
      Object.assign(keyframe, deconstructVoiceness(0.8));
    });
  }
  return keyframes;
};

const validTextSpan = document.getElementById("validText");
const validPhonemesSpan = document.getElementById("validPhonemes");
const textInput = document.getElementById("text");
const results = [];
let finalString = "";
const validTextStrings = [];
textInput.addEventListener("input", (event) => {
  const strings = event.target.value.split(" ");
  results.length = 0;

  validPhonemesSpan.innerHTML = "";

  validTextStrings.length = 0;
  strings.forEach((string) => {
    if (string.length > 0) {
      const ipas = TextToIPA._IPADict[string];
      if (ipas) {
        validTextStrings.push(string);
        results.push(ipas.slice());
        //console.log("ipas", index, ipas);
      }
    }
  });

  if (results.length > 0 && validTextStrings.length > 0) {
    finalString = validTextStrings.join(" ");
    validTextSpan.innerText = finalString;
  } else {
    validTextSpan.innerText = "";
  }

  onResultsUpdate();
});

let isResultFromPhoneme = false;
const onResultsUpdate = (fromPhonemes = false) => {
  isResultFromPhoneme = fromPhonemes;
  if (fromPhonemes) {
    textInput.value = "";
  } else {
    phonemesInput.value = "";
  }

  if (isUsingPigLatin) {
    results.forEach((alternatives) => {
      alternatives.forEach((alternative, alternativeIndex) => {
        let vowelIndex = -1;
        alternative.split("").some((phoneme, index) => {
          if (index != 0 && phonemes[phoneme]?.type == "vowel") {
            vowelIndex = index;
            return true;
          }
        });
        if (vowelIndex > -1) {
          const alternativeParts = [
            alternative.substring(vowelIndex),
            alternative.substring(0, vowelIndex),
          ];
          console.log(alternativeParts);
          alternativeParts[1] = alternativeParts[1] + "ej";
          alternatives[alternativeIndex] = alternativeParts.join("ˈ");
        }
      });
    });
  }

  //console.log("results", results);

  resultsContainer.innerHTML = "";

  if (results.length > 0) {
    playButton.disabled = false;
    downloadButton.disabled = false;
  } else {
    playButton.disabled = true;
    downloadButton.disabled = true;
  }

  clearResultContainers();
  if (results.length > 0) {
    if (phonemeSubstitution) {
      results.forEach((result) => {
        result.forEach((alternative, index) => {
          const keys = Object.keys(phonemeSubstitution);
          const regex = new RegExp(keys.join("|"), "g");
          alternative = alternative.replaceAll(
            regex,
            (match) => phonemeSubstitution[match]
          );
          result[index] = alternative;
        });
      });
    }

    results.forEach((alternatives) => {
      if (alternatives.length > 0) {
        const resultContainer = getResultContainer(alternatives);
      }
    });
    if (!fromPhonemes) {
      updatePhonemesInput();
    }
  }
};

const phonemesInput = document.getElementById("phonemes");
const validResultsIndices = [];
phonemesInput.addEventListener("input", (event) => {
  validTextSpan.innerText = "";
  validTextStrings.length = 0;
  validResultsIndices.length = 0;
  const strings = event.target.value.split(" ").map((string, index) => {
    const word =
      TextToIPA._WordDict[
        string.replaceAll("ˈ", "").replaceAll("ˌ", "").replaceAll(".", "")
      ];
    validTextStrings.push(word || string);
    validResultsIndices[index] = Boolean(word);
    let characters = string.split("");
    characters = characters.filter((character) => {
      if (character == "ˈ" || character == "ˌ" || character == ".") {
        return true;
      } else {
        return character in phonemes;
      }
    });
    return characters.join("");
  });

  validPhonemesSpan.innerHTML = "";
  validResultsIndices.forEach((isValid, index) => {
    const span = document.createElement("span");
    span.innerText = validTextStrings[index];
    if (isValid) {
      span.classList.add("valid");
    } else {
      span.classList.add("invalid");
    }
    validPhonemesSpan.appendChild(span);
  });

  results.length = 0;
  strings.forEach((string) => {
    results.push([string]);
  });
  onResultsUpdate(true);
});

const updatePhonemesInput = () => {
  if (isResultFromPhoneme) {
    return;
  }
  const selectedResults = [];
  resultsContainer.querySelectorAll(".result").forEach((container) => {
    selectedResults.push(container.alternative);
  });
  phonemesInput.value = selectedResults.join(" ");
};

const resultsContainer = document.getElementById("results");
const resultTemplate = document.getElementById("resultTemplate");
const alternativeTemplate = document.getElementById("alternativeTemplate");
const phonemeTemplate = document.getElementById("phonemeTemplate");
const getResultContainer = (alternatives) => {
  let resultContainer = Array.from(
    resultsContainer.querySelectorAll(".result")
  ).find((resultContainer) => resultContainer.style.display == "none");
  if (!resultContainer) {
    resultContainer = createResultContainer();
  }
  resultContainer.setAlternatives(alternatives);
  resultContainer.style.display = "";

  const wordSpan = resultContainer.querySelector(".word");
  wordSpan.innerText =
    validTextStrings[resultContainer.resultContainerIndex] || "";

  return resultContainer;
};

const createResultContainer = () => {
  const resultContainer = resultTemplate.content
    .cloneNode(true)
    .querySelector(".result");

  let alternatives;
  let alternative;

  const resultContainerIndex = resultsContainer.childElementCount;
  resultContainer.resultContainerIndex = resultContainerIndex;

  const alternativesContainer = resultContainer.querySelector(".alternatives");

  const playButton = resultContainer.querySelector(".play");
  playButton.addEventListener("click", () => {
    const utterance = { name: alternative, keyframes: renderKeyframes() };
    const { time, frequency } =
      utterance.keyframes[utterance.keyframes.length - 1];
    utterance.keyframes.push({
      name: ".",
      time: time + releaseTime / speed,
      frequency,
      intensity: 0,
    });
    console.log("utterance", utterance);
    throttledSend({ utterance });
  });

  resultContainer.setAlternatives = (_alternatives) => {
    alternatives = _alternatives;
    alternativesContainer.innerHTML = "";
    alternatives.forEach((alternative, index) => {
      const alternativeContainer = alternativeTemplate.content
        .cloneNode(true)
        .querySelector(".alternative");
      const alternativeSpan = alternativeContainer.querySelector("span");
      alternativeSpan.innerText = alternative;
      const alternativeRadio = alternativeContainer.querySelector(
        "input[type='radio']"
      );
      alternativeRadio.checked = index == 0;
      alternativeRadio.name = resultContainerIndex;
      alternativeRadio.addEventListener("input", (event) => {
        setAlternative(alternative);
      });
      setAlternative(alternatives[0]);
      alternativesContainer.appendChild(alternativeContainer);
    });
  };

  const phonemesContainer = resultContainer.querySelector(".phonemes");
  const keyframes = [];
  const setAlternative = (_alternative) => {
    alternative = _alternative;
    resultContainer.alternative = alternative;
    //console.log("setting alternative", alternative);
    phonemesContainer.innerHTML = "";

    keyframes.length = 0;

    [...alternative].forEach((phoneme, index) => {
      if (phoneme == "ˈ" || phoneme == "ˌ") {
        return;
      }
      let nextPhoneme = alternative[index + 1];

      const _keyframes = [];

      let offsetTime = 0.1;
      let holdTime = 0;
      let intensity = 1;
      let offsetBetweenSubPhonemes = timeBetweenSubPhonemes;

      const setIntensity = (_intensity) => {
        intensity = _intensity;
        _keyframes.forEach((keyframe) => {
          if (!keyframe.isSilent) {
            const intensityMultiplier = keyframe.intensityMultiplier || 1;
            keyframe.intensity = intensity * intensityMultiplier;
          }
        });
      };
      const setOffsetTime = (_offsetTime) => {
        offsetTime = _offsetTime;
        const keyframe = _keyframes[0];
        if (keyframe) {
          keyframe.timeDelta = offsetTime;
        }
      };
      const setHoldTime = (_holdTime) => {
        holdTime = _holdTime;
        const holdKeyframe = _keyframes.findLast((keyframe) => keyframe.isHold);
        if (holdKeyframe) {
          holdKeyframe.timeDelta = holdTime;
        }
      };

      const setOffsetBetweenSubPhonemes = (_offsetBetweenSubPhonemes) => {
        offsetBetweenSubPhonemes = _offsetBetweenSubPhonemes;
        const subPhonemeKeyframes = _keyframes.filter(
          (keyframe) => keyframe.isSubPhoneme
        );
        subPhonemeKeyframes.forEach((subPhonemeKeyframe) => {
          subPhonemeKeyframe.timeDelta = offsetBetweenSubPhonemes;
        });
      };

      let hasSubPhonemes = false;

      if (phoneme in phonemes) {
        const phonemeInfo = phonemes[phoneme];
        const { type, voiced, constrictions } = phonemeInfo;

        if (type == "consonant") {
          holdTime = consonantHoldTime;
        }
        if (constrictions.length > 1) {
          hasSubPhonemes = true;
        }

        if ("offsetTime" in phonemeInfo) {
          offsetTime = phonemeInfo.offsetTime;
        }
        if ("holdTime" in phonemeInfo) {
          holdTime = phonemeInfo.holdTime;
        }
        if ("offsetBetweenSubPhonemes" in phonemeInfo) {
          offsetBetweenSubPhonemes = phonemeInfo.offsetBetweenSubPhonemes;
        }

        constrictions.forEach((constriction, index) => {
          let name = phoneme;
          if (constrictions.length > 1) {
            name += `(${index})`;
          }

          const isSubPhoneme = index > 0;
          const keyframe = {
            isSubPhoneme,
            intensity: 1,
            name,
            timeDelta: !isSubPhoneme
              ? timeBetweenPhonemes
              : timeBetweenSubPhonemes,
            "frontConstriction.diameter": 5,
            "backConstriction.diameter": 5,
          };

          let voiceness = defaultVoiceness;
          if (type == "consonant") {
            voiceness = voiced ? defaultVoiceness : defaultVoiceless;
          }
          Object.assign(keyframe, deconstructVoiceness(voiceness));

          for (const key in constriction) {
            for (const subKey in constriction[key]) {
              let string = key;
              if (key != "tongue") {
                string += "Constriction";
              }
              string += `.${subKey}`;
              keyframe[string] = constriction[key][subKey];
            }
          }
          _keyframes.push(keyframe);

          const holdKeyframe = Object.assign({}, keyframe);
          holdKeyframe.isHold = true;
          holdKeyframe.timeDelta = holdTime;
          holdKeyframe.name = `${holdKeyframe.name}]`;
          _keyframes.push(holdKeyframe);

          if (index == 0 && type == "consonant" && !voiced) {
            // add keyframe after first to change to voiced
            Object.assign(
              _keyframes[0],
              deconstructVoiceness(defaultVoiceness)
            );
            _keyframes[0].intensity = 0;
            _keyframes[0].isSilent = true;
            const voicedToVoicelessKeyframe = Object.assign({}, _keyframes[0]);
            voicedToVoicelessKeyframe.name = `{${voicedToVoicelessKeyframe.name}`;
            //voicedToVoicelessKeyframe.isHold = false;
            voicedToVoicelessKeyframe.timeDelta = 0.001;
            voicedToVoicelessKeyframe.isSilent = false;
            voicedToVoicelessKeyframe.intensity = 0.8;
            voicedToVoicelessKeyframe.intensityMultiplier = 0.8;
            Object.assign(
              voicedToVoicelessKeyframe,
              deconstructVoiceness(defaultVoiceless)
            );
            _keyframes.splice(1, 0, voicedToVoicelessKeyframe);

            // add keyframe after last to change back to voiced
            const voicelessToVoicedKeyframe = Object.assign(
              {},
              _keyframes[_keyframes.length - 1]
            );
            voicelessToVoicedKeyframe.timeDelta = 0.001;
            voicelessToVoicedKeyframe.name = `${voicelessToVoicedKeyframe.name}}`;
            //voicelessToVoicedKeyframe.isHold = false;

            //voicelessToVoicedKeyframe.intensity = 0;
            Object.assign(
              voicelessToVoicedKeyframe,
              deconstructVoiceness(defaultVoiceness)
            );
            _keyframes.push(voicelessToVoicedKeyframe);
          }
        });
      }
      if (nextPhoneme == "ˈ" || nextPhoneme == "ˌ") {
        holdTime = holdTimes[nextPhoneme];
      }
      if (phoneme == ".") {
        const startSilence = Object.assign({}, keyframes[keyframes.length - 1]);
        startSilence.intensity = 0;
        startSilence.timeDelta = timeBetweenPhonemes;
        startSilence.name = "[.";
        _keyframes.push(startSilence);
        const holdSilence = Object.assign({}, startSilence);
        holdSilence.intensity = 0;
        holdSilence.isHold = true;
        startSilence.name = "].";
        _keyframes.push(holdSilence);
        holdTime = holdTimes["."];
      }

      keyframes.push(..._keyframes);

      const phonemeContainer = phonemeTemplate.content
        .cloneNode(true)
        .querySelector(".phoneme");

      const semitonesInput = phonemeContainer.querySelector(".semitones");
      semitonesInput.addEventListener("input", (event) => {
        const semitones = Number(event.target.value);
        const pitchedKeyframe = _keyframes[0];
        if (pitchedKeyframe) {
          pitchedKeyframe.semitones = semitones;
        }
      });

      const tractLengthInput = phonemeContainer.querySelector(".tractLength");
      tractLengthInput.addEventListener("input", (event) => {
        const tractLength = Number(event.target.value);
        const keyframe = _keyframes[0];
        if (keyframe) {
          keyframe.tractLength = tractLength;
        }
      });

      const intensityInput = phonemeContainer.querySelector(".intensity");
      intensityInput.addEventListener("input", (event) => {
        setIntensity(Number(event.target.value));
      });

      const offsetInput = phonemeContainer.querySelector(".offset");
      offsetInput.value = offsetTime;
      offsetInput.addEventListener("input", (event) => {
        setOffsetTime(Number(event.target.value));
      });
      if (offsetTime > 0) {
        offsetInput.value = offsetTime;
      }
      const holdInput = phonemeContainer.querySelector(".hold");
      holdInput.value = holdTime;
      holdInput.addEventListener("input", (event) => {
        setHoldTime(Number(event.target.value));
      });
      if (holdTime > 0) {
        holdInput.value = holdTime;
      }

      const offsetBetweenSubPhonemesInput = phonemeContainer.querySelector(
        ".offsetBetweenSubPhonemes"
      );
      offsetBetweenSubPhonemesInput.value = offsetBetweenSubPhonemes;
      offsetBetweenSubPhonemesInput.addEventListener("input", (event) => {
        setOffsetBetweenSubPhonemes(Number(event.target.value));
      });
      setOffsetBetweenSubPhonemes(offsetBetweenSubPhonemes);

      if (!hasSubPhonemes) {
        offsetBetweenSubPhonemesInput.parentElement.style.display = "none";
      }

      phonemeContainer.querySelector(".text").innerText = phoneme;
      phonemesContainer.appendChild(phonemeContainer);
    });
    //console.log("keyframes", keyframes);
    updatePhonemesInput();
  };
  const renderKeyframes = (
    time = 0,
    frequency = initialFrequency,
    tractLength = initialTractLength
  ) => {
    const _keyframes = [];
    keyframes.forEach((keyframe) => {
      const _keyframe = Object.assign({}, keyframe);
      if (_keyframe.timeDelta > 0) {
        time += _keyframe.timeDelta / speed;
        _keyframe.time = time;
        if ("semitones" in keyframe) {
          const { semitones } = keyframe;
          frequency *= 2 ** (semitones / 12);
        }
        _keyframe.frequency = frequency;
        if ("tractLength" in keyframe) {
          const { tractLength: _tractLength } = keyframe;
          if (tractLength != 0) {
            tractLength = _tractLength;
          }
        }
        _keyframe.tractLength = tractLength;
        delete _keyframe.timeDelta;
        _keyframes.push(_keyframe);
      }
    });
    return _keyframes;
  };
  resultContainer.renderKeyframes = renderKeyframes;

  resultsContainer.appendChild(resultContainer);
  return resultContainer;
};
const removeResultContainer = (resultContainer) => {
  resultContainer.style.display = "none";
};
const clearResultContainers = () => {
  resultsContainer
    .querySelectorAll(".result")
    .forEach((resultContainer) => removeResultContainer(resultContainer));
};

const throttledSend = throttle((message) => {
  send({
    to: ["pink-trombone", "lip-sync"],
    type: "message",
    ...message,
  });
}, 100);

const phonemeSubstitutionsSelect = document.getElementById(
  "phonemeSubstitutions"
);

for (const substitutionType in phonemeSubstitutions) {
  const optGroup = document.createElement("optgroup");
  optGroup.label = substitutionType;
  const substitutionSubTypes = phonemeSubstitutions[substitutionType];
  for (const substitutionSubType in substitutionSubTypes) {
    const option = new Option(
      substitutionSubType,
      `${substitutionType}.${substitutionSubType}`
    );
    optGroup.appendChild(option);
  }
  phonemeSubstitutionsSelect.appendChild(optGroup);
}

let phonemeSubstitutionType = "none";
let phonemeSubstitution;
phonemeSubstitutionsSelect.addEventListener("input", (event) => {
  phonemeSubstitutionType = event.target.value;
  if (phonemeSubstitutionType == "none") {
    phonemeSubstitution = null;
  } else {
    const [type, subType] = phonemeSubstitutionType.split(".");
    phonemeSubstitution = phonemeSubstitutions[type][subType];
  }
  //console.log("phonemeSubstitution", phonemeSubstitution);
  textInput.dispatchEvent(new Event("input"));
});

let isWhispering = false;
const onWhisperInput = (event) => {
  isWhispering = event.target.checked;
  //console.log("isWhispering", isWhispering);
};

let numberOfRandomPhonemes = 10;
const numberOfRandomPhonemesInput = document.getElementById(
  "numberOfRandomPhonemes"
);
numberOfRandomPhonemesInput.addEventListener("input", (event) => {
  numberOfRandomPhonemes = Number(event.target.value);
  //console.log("numberOfRandomPhonemes", numberOfRandomPhonemes);
});
const generateRandomPhonemesButton = document.getElementById(
  "generateRandomPhonemes"
);
generateRandomPhonemesButton.addEventListener("click", () => {
  let netLength = 0;
  const randomResults = [];
  while (netLength < numberOfRandomPhonemes) {
    const randomPhonemes = markov.generateRandom(getRandomInt(3, 6));
    randomResults.push(randomPhonemes);
    netLength += randomPhonemes.length;
  }
  phonemesInput.value = randomResults.join(" ");
  phonemesInput.dispatchEvent(new Event("input"));
});

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

let isUsingPigLatin = false;
const pigLatinCheckbox = document.getElementById("pigLatin");
pigLatinCheckbox.addEventListener("input", (event) => {
  isUsingPigLatin = event.target.checked;
  //console.log("isUsingPigLatin", isUsingPigLatin);
  onResultsUpdate();
});
