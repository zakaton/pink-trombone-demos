const { send } = setupConnection("pronunciation", (message) => {
  if (selectedPronunciation) {
    if (message.from == "knn") {
      const { results } = message;
      const { name, weight } = results[0];
      if (name == trimmedSelectedPronunciation[currentPhonemeIndex]) {
        if (currentPhonemeIndex + 1 == trimmedSelectedPronunciation.length) {
          //reset();
          setPhonemeIndex(currentPhonemeIndex + 1);
        } else {
          setPhonemeIndex(currentPhonemeIndex + 1);
        }
      }
    }
  }
});

const throttledSend = throttle((message) => {
  send({
    to: ["pink-trombone"],
    type: "message",
    ...message,
  });
}, 10);

const wordInput = document.getElementById("word");
let word, pronunciations;
let selectedPronunciation;
let trimmedSelectedPronunciation;
let currentPhonemeIndex = 0;
wordInput.addEventListener("input", (event) => {
  word = event.target.value;
  pronunciations = TextToIPA._IPADict[word] || [];
  updatePronunciations();
  setPronunciation(pronunciations[0]);
  buttonsContainer.style.display = pronunciations.length == 0 ? "none" : "";
});

const pronunciationsContainer = document.getElementById("pronunciations");
const pronunciationTemplate = pronunciationsContainer.querySelector("template");
const updatePronunciations = () => {
  pronunciationsContainer.innerHTML = "";
  pronunciations.forEach((pronunciation, index) => {
    const pronunciationContainer = pronunciationTemplate.content
      .cloneNode(true)
      .querySelector(".pronunciation");
    pronunciationContainer.querySelector("span").innerText = pronunciation;

    const input = pronunciationContainer.querySelector("input");
    input.value = pronunciation;
    if (index == 0) {
      input.checked = true;
    }
    input.addEventListener("input", (event) => {
      setPronunciation(event.target.value);
    });
    pronunciationsContainer.appendChild(pronunciationContainer);
  });
};

const setPhonemeIndex = (phonemeIndex) => {
  currentPhonemeIndex = phonemeIndex;
  phonemesContainer.querySelectorAll("span").forEach((span, index) => {
    if (index < phonemeIndex) {
      span.classList.add("spoken");
    } else {
      span.classList.remove("spoken");
    }

    if (index == phonemeIndex) {
      span.classList.add("current");
    } else {
      span.classList.remove("current");
    }
  });
};

let highlightedPhoneme;
let debouncedSilence = debounce(() => {
  if (!highlightedPhoneme) {
    throttledSend({ intensity: 0 });
  }
}, 50);

let playPhonemeOnHover = true;

const phonemesContainer = document.getElementById("phonemes");
const setPronunciation = (pronunciation) => {
  selectedPronunciation = pronunciation;

  console.log("selectedPronunciation", selectedPronunciation);

  phonemesContainer.innerHTML = "";
  if (pronunciation) {
    trimmedSelectedPronunciation = trimPronunciation(selectedPronunciation);
    Array.from(trimmedSelectedPronunciation).forEach((phoneme, index) => {
      const span = document.createElement("span");
      span.innerText = phoneme;
      span.addEventListener("mouseenter", () => {
        if (playPhonemeOnHover) {
          span.classList.add("highlighted");
          highlightedPhoneme = phoneme;
          throttledSend({ phoneme, intensity: 1 });
        }
      });
      span.addEventListener("mouseleave", () => {
        if (playPhonemeOnHover) {
          span.classList.remove("highlighted");
          highlightedPhoneme = undefined;
          debouncedSilence();
        }
      });

      span.addEventListener("mousedown", () => {
        if (!playPhonemeOnHover) {
          span.classList.add("highlighted");
          highlightedPhoneme = phoneme;
          throttledSend({ phoneme, intensity: 1 });
        }
      });
      span.addEventListener("mouseup", () => {
        if (!playPhonemeOnHover) {
          span.classList.remove("highlighted");
          highlightedPhoneme = undefined;
          throttledSend({ intensity: 0 });
        }
      });

      phonemesContainer.appendChild(span);
    });
    setPhonemeIndex(0);
  }
};

const buttonsContainer = document.getElementById("buttons");

const playButton = document.getElementById("play");
playButton.addEventListener("click", () =>
  playPronunciation(selectedPronunciation)
);
const playPronunciation = (pronunciation) => {
  let keyframes = generateKeyframes(pronunciation);
  keyframes = RenderKeyframes(keyframes);
  const utterance = { name: word, keyframes };
  throttledSend({ utterance });
};

const resetButton = document.getElementById("reset");
resetButton.addEventListener("click", () => {
  reset();
});

const reset = () => {
  setPhonemeIndex(0);
};
