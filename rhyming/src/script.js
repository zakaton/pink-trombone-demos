/*
  TODO
    *
*/

const { send } = setupConnection("wordplay", (message) => {});

const wordsPhonemesAlternativesContainer = document.getElementById(
  "wordsPhonemesAlternatives"
);
const wordPhonemesAlternativeTemplate = document.getElementById(
  "wordPhonemesAlternativeTemplate"
);

const wordsPhonemesAlternativesSelections = [];
const setupWordsPhonemesAlternatives = (wordsPhonemesAlternatives) => {
  wordsPhonemesAlternativesContainer.innerHTML = "";
  wordsPhonemesAlternativesSelections.length = 0;

  wordsPhonemesAlternatives.forEach(
    (wordPhonemesAlternatives, wordPhonemesAlternativesIndex) => {
      const wordPhonemesAlternativesContainer = document.createElement("div");
      wordPhonemesAlternativesContainer.classList.add(
        "wordPhonemesAlternatives"
      );
      wordsPhonemesAlternativesSelections[wordPhonemesAlternativesIndex] =
        wordPhonemesAlternatives[0];

      wordPhonemesAlternatives.forEach(
        (wordPhonemesAlternative, wordPhonemesAlternativeIndex) => {
          const wordPhonemesAlternativeContainer =
            wordPhonemesAlternativeTemplate.content
              .cloneNode(true)
              .querySelector(".wordPhonemesAlternative");
          const span = wordPhonemesAlternativeContainer.querySelector("span");
          span.innerText = wordPhonemesAlternative;
          const input = wordPhonemesAlternativeContainer.querySelector("input");
          input.name = `wordPhonemesAlternativesIndex-${wordPhonemesAlternativesIndex}`;
          if (wordPhonemesAlternativeIndex == 0) {
            input.checked = true;
          }
          input.addEventListener("input", () => {
            wordsPhonemesAlternativesSelections[wordPhonemesAlternativesIndex] =
              wordPhonemesAlternatives[wordPhonemesAlternativeIndex];

            updatePhonemesInput();
            clearRhymeSelections();
          });

          wordPhonemesAlternativesContainer.appendChild(
            wordPhonemesAlternativeContainer
          );
        }
      );
      wordsPhonemesAlternativesContainer.appendChild(
        wordPhonemesAlternativesContainer
      );
    }
  );

  updatePhonemesInput();
};

const updatePhonemesInput = () => {
  phonemesInput.value = wordsPhonemesAlternativesSelections.join(" ");
  phonemesInput.dispatchEvent(new Event("input"));
};

const wordsInput = document.getElementById("words");
wordsInput.addEventListener("input", (event) => {
  const { wordsPhonemesAlternatives } = getPhonemesAlternativesFromWords(
    event.target.value,
    true
  );
  setupWordsPhonemesAlternatives(wordsPhonemesAlternatives);
  selectedRhymes.length = [];
});
const phonemesInput = document.getElementById("phonemes");
phonemesInput.addEventListener("input", () => {
  const phonemes = phonemesInput.value;
  syllables = splitPhonemesIntoSyllables(phonemes);
  resetGrids();
});
let rhymes = [];
let syllables = [];
const findRhymes = () => {
  clearRhymeSelections();

  rhymesGrid.innerHTML = "";
  rhymes.length = 0;
  //console.log("syllables", syllables);
  for (const word in TextToIPA._SyllableDict) {
    TextToIPA._SyllableDict[word].forEach((_syllables) => {
      if (_syllables.length >= syllables.length + 2) {
        return;
      }
      for (
        let offset = Math.max(-(_syllables.length - 1), 0);
        offset < syllables.length;
        offset++
      ) {
        if (offset >= 0) {
          const numberOfSyllablesUntilEnd = syllables.length - offset;
          const isTooFar = _syllables.length - numberOfSyllablesUntilEnd >= 2;
          if (isTooFar) {
            continue;
          }
        }

        const rhyme = { word, offset, syllables: _syllables };
        let shouldAddRhyme = null;
        syllables.every((syllable, index) => {
          const _index = index - offset;
          const _syllable = _syllables[_index];
          if (_syllable && syllablesToCheck[index]) {
            if (syllable.type != _syllable.type) {
              shouldAddRhyme = false;
            }
            if (
              syllable.isSemiVowel &&
              syllable.phonemes != _syllable.phonemes
            ) {
              shouldAddRhyme = false;
            }

            if (syllable.type == "vowel") {
              shouldAddRhyme =
                isNotFalse(shouldAddRhyme) &&
                syllable.phonemes == _syllable.phonemes;
            } else {
              const minConsonantsLength = Math.min(
                syllable.phonemes.length,
                _syllable.phonemes.length
              );
              let areAllConsonantsInSameGroup = true;
              const lastNPhonemes = [syllable.phonemes, _syllable.phonemes].map(
                (phonemes) => phonemes.substr(-minConsonantsLength)
              );
              for (
                let i = 0;
                areAllConsonantsInSameGroup && i < minConsonantsLength;
                i++
              ) {
                areAllConsonantsInSameGroup = areConsonantsInSameGroup(
                  lastNPhonemes[0][i],
                  lastNPhonemes[1][i]
                );
              }
              shouldAddRhyme =
                isNotFalse(shouldAddRhyme) && areAllConsonantsInSameGroup;
            }
          }
          return (
            isNotFalse(shouldAddRhyme) &&
            (_index < 0 || (_syllable && syllable.type == _syllable.type))
          );
        });

        if (shouldAddRhyme) {
          rhymes.push(rhyme);
        }
      }
    });
  }
  sortRhymes();
};

const isNotFalse = (value) => value == null || value;

const sortRhymes = () => {
  rhymes.sort((a, b) => {
    return a.offset - b.offset;
    let offsetDifference = Math.abs(a.offset) - Math.abs(b.offset);
    if (offsetDifference == 0) {
      return b.offset - a.offset;
    } else {
      return offsetDifference;
    }
  });
  //console.log("rhymes", rhymes);
  displayRhymes();
};

const selectedRhymes = [];

const displayRhymes = () => {
  rhymes.forEach((rhyme, rhymeIndex) => {
    rhyme.syllables.forEach((syllable, syllableIndex) => {
      const syllableCell = document.createElement("div");
      syllableCell.rhyme = rhyme;
      syllableCell.innerText = syllable.phonemes;
      syllableCell.classList.add(
        syllable.isSemiVowel ? "semi-vowel" : syllable.type
      );
      syllableCell.style.gridRowStart = rhymeIndex + 1;
      syllableCell.style.gridColumnStart = syllableIndex + 2 + rhyme.offset;
      syllableCell.addEventListener("click", () => {
        selectedRhymes.push(rhyme);
        selectedRhymes.sort((a, b) => a.offset - b.offset);
        updateRhymes();
        updateRhymeSelectionsGrid();
      });
      rhymesGrid.appendChild(syllableCell);
    });

    const wordCell = document.createElement("div");
    wordCell.rhyme = rhyme;
    wordCell.innerText = rhyme.word;
    wordCell.classList.add("word");
    wordCell.style.gridRowStart = rhymeIndex + 1;
    wordCell.style.gridColumnStart = syllables.length + 3;
    wordCell.style.textAlign = "left";
    rhymesGrid.appendChild(wordCell);
  });
};
const getRhymeRange = (rhyme) => {
  return [rhyme.offset, rhyme.offset + rhyme.syllables.length - 1];
};
const isOutsideRange = (a, b, overlap = 0) => {
  return a[1] < b[0] + overlap || a[0] > b[1] + overlap;
};
const isOverlappingBy1 = (a, b) => {
  return a[1] == b[0] || a[0] == b[1];
};
let rhymeSelectionsWords = "";
const updateRhymeSelectionsGrid = () => {
  rhymeSelectionsWords = selectedRhymes.map((rhyme) => rhyme.word).join(" ");
  //console.log("rhyme selections:", rhymeSelectionsWords);

  rhymeSelectionsWordsContainer.innerHTML = "";
  selectedRhymes.forEach((selectedRhyme) => {
    const selectedRhymeSpan = document.createElement("span");
    selectedRhymeSpan.innerText = selectedRhyme.word;
    selectedRhymeSpan.addEventListener("click", () => {
      removeSelectedRhyme(selectedRhyme);
    });
    rhymeSelectionsWordsContainer.appendChild(selectedRhymeSpan);
  });

  rhymeSelectionsGrid.innerHTML = "";
  selectedRhymes.forEach((selectedRhyme) => {
    selectedRhyme.syllables.forEach((syllable, syllableIndex) => {
      const selectedRhymeCell = document.createElement("div");
      selectedRhymeCell.selectedRhyme = selectedRhyme;
      selectedRhymeCell.innerText = syllable.phonemes;
      selectedRhymeCell.classList.add(
        syllable.isSemiVowel ? "semi-vowel" : syllable.type
      );
      selectedRhymeCell.style.gridColumnStart =
        syllableIndex + 2 + selectedRhyme.offset;
      selectedRhymeCell.addEventListener("click", () => {
        removeSelectedRhyme(selectedRhyme);
      });
      rhymeSelectionsGrid.appendChild(selectedRhymeCell);
    });
  });
};
const removeSelectedRhyme = (selectedRhyme) => {
  selectedRhymes.splice(selectedRhymes.indexOf(selectedRhyme), 1);
  selectedRhymes.sort((a, b) => a.offset - b.offset);
  updateRhymes();
  updateRhymeSelectionsGrid();
};
const updateRhymes = () => {
  rhymesGrid.childNodes.forEach((child) => {
    const { rhyme } = child;
    if (rhyme) {
      const range = getRhymeRange(rhyme);
      let shouldShow = true;
      selectedRhymes.every((selectedRhyme) => {
        const selectedRhymeRange = getRhymeRange(selectedRhyme);
        shouldShow = isOutsideRange(
          selectedRhymeRange,
          range,
          rhyme.syllables.length == 1 ? 0 : 1
        );
        if (
          isOverlappingBy1(selectedRhymeRange, range) &&
          rhyme.syllables.length > 1
        ) {
          if (range[0] == syllables.length - 1) {
            shouldShow = false;
          } else {
            let s1, s2;

            if (selectedRhymeRange[1] == range[0]) {
              s1 = selectedRhyme.syllables;
              s2 = rhyme.syllables;
            } else {
              s1 = rhyme.syllables;
              s2 = selectedRhyme.syllables;
            }

            shouldShow = s1[s1.length - 1].phonemes == s2[0].phonemes;
          }
        }
        return shouldShow;
      });

      if (shouldShow) {
        child.removeAttribute("hidden");
      } else {
        child.setAttribute("hidden", "");
      }
    }
  });
  rhymesGrid.scrollTop = 0;
};

const inputSyllablesGrid = document.getElementById("inputSyllablesGrid");
const inputSyllableTemplate = document.getElementById("inputSyllableTemplate");
const rhymeSelectionsGrid = document.getElementById("rhymeSelectionsGrid");
const rhymesGrid = document.getElementById("rhymesGrid");

const syllablesToCheck = [];
const resetGrids = () => {
  const numberOfGridColumns = syllables.length + 2;
  [inputSyllablesGrid, rhymeSelectionsGrid, rhymesGrid].forEach((grid) => {
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `repeat(${numberOfGridColumns}, 1fr)`;
    grid.style.width = `${numberOfGridColumns * 50}px`;
  });
  rhymesGrid.style.width = "fit-content";

  syllablesToCheck.length = 0;

  syllables.forEach((syllable, index) => {
    syllablesToCheck[index] = true;
    const syllableContainer = inputSyllableTemplate.content
      .cloneNode(true)
      .querySelector(".inputSyllable");
    const span = syllableContainer.querySelector("span");
    span.innerText = syllable.phonemes;
    const input = syllableContainer.querySelector("input");
    input.checked = syllablesToCheck[index];
    input.addEventListener("input", (event) => {
      const { checked } = event.target;
      syllablesToCheck[index] = checked;
    });
    if (syllable.isSemiVowel) {
      syllableContainer.classList.add("semi-vowel");
    } else {
      syllableContainer.classList.add(syllable.type);
    }
    syllableContainer.style.gridColumnStart = index + 2;

    inputSyllablesGrid.appendChild(syllableContainer);
  });
};

const rhymeSelectionsWordsContainer = document.getElementById(
  "rhymeSelectionsWords"
);
const playRhymeSelections = () => {
  playSyllables(selectedRhymes, rhymeSelectionsWords);
};

const playSyllables = (words, name) => {
  let pronunciation = "";
  words.forEach((rhyme) => {
    rhyme.syllables.forEach((syllable) => {
      pronunciation += syllable.phonemes;
    });
  });
  if (pronunciation.length) {
    let keyframes = generateKeyframes(pronunciation);
    keyframes = RenderKeyframes(keyframes);
    const utterance = { name, keyframes };
    //(utterance);
    throttledSend({ utterance });
  }
};

const playOriginalWords = () => {
  playSyllables([{ syllables }], wordsInput.value);
};

const throttledSend = throttle((message) => {
  send({
    to: ["pink-trombone"],
    type: "message",
    ...message,
  });
}, 10);

const clearRhymeSelections = () => {
  //console.log("clear");
  selectedRhymes.length = 0;
  updateRhymes();
  updateRhymeSelectionsGrid();
};
