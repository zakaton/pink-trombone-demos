import { Samuel, loadOrt } from "./samuel.js";
import { articulationKeyframes } from "./articulation-keyframes.js";

const samuel = await Samuel.load({
  ort: await loadOrt({ base: new URL("./ort/", import.meta.url).href }),
  models: new URL("./models/", import.meta.url).href,
});

// TTS
/** @type {HTMLTextAreaElement} */
const textarea = document.getElementById("text");
textarea.value = "The smallest possible Samuel.";
const speakButton = document.getElementById("speak");
speakButton.addEventListener("click", async () => {
  speakButton.disabled = true;
  const articulationData = await samuel.speak(textarea.value);
  console.log(articulationData);
  speakButton.disabled = false;
  articulationKeyframes(articulationData);
});

// WAVEFORM
// FILL

// MIC
// FILL
