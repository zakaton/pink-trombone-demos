const { send } = setupConnection("debug", (message) => {
  if (message.from == "pink-trombone") {
    updateUI(message);
  }
});

const _send = (message) => {
  send({
    to: ["pink-trombone", "machine-learning", "mfcc", "knn", "tts", "lip-sync"],
    type: "message",
    ...message,
  });
};
const throttledSend = throttle((message) => {
  _send(message);
}, 100);

const tongueElements = {
  index: document.getElementById("tongueIndex"),
  diameter: document.getElementById("tongueDiameter"),
};
for (const type in tongueElements) {
  const element = tongueElements[type];
  element.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    throttledSend({ [`tongue.${type}`]: value });
  });
}
const frontConstrictionElements = {
  index: document.getElementById("frontConstriction.index"),
  diameter: document.getElementById("frontConstriction.diameter"),
};
for (const type in frontConstrictionElements) {
  const element = frontConstrictionElements[type];
  element.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    throttledSend({ [`frontConstriction.${type}`]: value });
  });
}
const backConstrictionElements = {
  index: document.getElementById("backConstriction.index"),
  diameter: document.getElementById("backConstriction.diameter"),
};
for (const type in backConstrictionElements) {
  const element = backConstrictionElements[type];
  element.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    throttledSend({ [`backConstriction.${type}`]: value });
  });
}
function updateElements(
  { index: indexElement, diameter: diameterElement },
  { index, diameter }
) {
  indexElement.value = index;
  diameterElement.value = diameter;
}
function updateUI(message) {
  const { constrictions } = message;
  if (constrictions) {
    const { tongue, frontConstriction, backConstriction } = constrictions;
    if (tongue) {
      updateElements(tongueElements, tongue);
    }
    if (frontConstriction) {
      updateElements(frontConstrictionElements, frontConstriction);
    }
    if (backConstriction) {
      updateElements(backConstrictionElements, backConstriction);
    }
  }
}

const trackElements = {
  frequency: Array.from(document.querySelectorAll(".frequency")),
  voiceness: document.getElementById("voiceness"),
  intensity: document.getElementById("intensity"),
};
for (const type in trackElements) {
  const element = trackElements[type];
  const elements = Array.isArray(element) ? element : [element];
  elements.forEach((element) => {
    element.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      elements.forEach((_element) => {
        if (_element != element) {
          _element.value = value;
        }
      });
      throttledSend({ [type]: value });
    });
  });
}

const phonemeSelect = document.getElementById("phoneme");
const consonantsOptgroup = document.getElementById("consonants");
const vowelsOptgroup = document.getElementById("vowels");
for (const phoneme in phonemes) {
  const { example, type } = phonemes[phoneme];
  const option = new Option(`${phoneme} (${example})`, phoneme);
  const optgroup = type == "consonant" ? consonantsOptgroup : vowelsOptgroup;
  optgroup.appendChild(option);
}
phonemeSelect.addEventListener("input", (event) => {
  const phoneme = event.target.value;
  if (phoneme.length > 0) {
    if (true) {
      throttledSend({ phoneme });
    } else {
      throttledSend({
        utterance: {
          name: phoneme,
          keyframes: RenderKeyframes(generateKeyframes(phoneme)),
        },
      });
    }

    event.target.value = "";
  }
});

const utteranceSelect = document.getElementById("utterance");
utterances.forEach(({ name }, index) => {
  const option = new Option(name, index);
  utteranceSelect.appendChild(option);
});
utteranceSelect.addEventListener("input", (event) => {
  const utterance = event.target.value;
  if (utterance.length > 0) {
    throttledSend({ utterance });
    event.target.value = "";
  }
});

const ttsInput = document.getElementById("ttsInput");
const ttsButton = document.getElementById("ttsButton");
ttsInput.addEventListener("input", (event) => {
  let string = event.target.value;
  ttsButton.disabled = string.length == 0;
  if (string.endsWith("\n")) {
    event.target.value = string.slice(0, -1);
    ttsButton.click();
  }
});
ttsButton.addEventListener("click", () => {
  const text = ttsInput.value;
  throttledSend({ text });
});

const ptsInput = document.getElementById("ptsInput");
const ptsButton = document.getElementById("ptsButton");
ptsInput.addEventListener("input", (event) => {
  let string = event.target.value;
  ptsButton.disabled = string.length == 0;
  if (string.endsWith("\n")) {
    event.target.value = string.slice(0, -1);
    ptsButton.click();
  }
});
ptsButton.addEventListener("click", () => {
  const phonemes = ptsInput.value;
  throttledSend({ phonemes });
});

const tractLengthInputs = document.querySelectorAll(".tractLength");
tractLengthInputs.forEach((tractLengthInput) => {
  tractLengthInput.addEventListener("input", (event) => {
    const tractLength = Number(event.target.value);
    tractLengthInputs.forEach((_tractLengthInput) => {
      if (_tractLengthInput != tractLengthInput) {
        _tractLengthInput.value = tractLength;
      }
    });
    _send({ tractLength });
  });
});
