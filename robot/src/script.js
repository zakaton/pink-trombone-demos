let scalar = 30;

const { send } = setupConnection("robot", (message) => {
  if (message.from == "knn") {
    const { results, loudness } = message;
    const { name, weight } = results[0];
    const loudnessScalar = clamp(inverseLerp(0.01, 0.1, loudness), 0, 2);

    let keyToTap;
    let mouseToggleDown;

    const xy = [0, 0];
    switch (name) {
      case "left":
        xy[0] = -scalar * loudnessScalar;
        keyToTap = "left";
        break;
      case "right":
        xy[0] = scalar * loudnessScalar;
        keyToTap = "right";
        break;
      case "up":
        xy[1] = scalar * loudnessScalar;
        keyToTap = "up";
        break;
      case "down":
        xy[1] = -scalar * loudnessScalar;
        keyToTap = "down";
        break;
      case "mousedown":
        mouseToggleDown = "down";
        break;
      case "mouseup":
        mouseToggleDown = "up";
        break;
      default:
        console.log("uncaught name", name);
        break;
    }

    if (weight == 1) {
      let command;
      switch (mode) {
        case "scroll":
          command = { method: "scrollMouse", args: xy };
          break;
        case "mouse":
          if (mouseToggleDown) {
            command = { method: "mouseToggle", args: [mouseToggleDown] };
          } else {
            mousePosition[0] += xy[0];
            mousePosition[0] = clamp(mousePosition[0], 0, width);
            mousePosition[1] -= xy[1];
            mousePosition[1] = clamp(mousePosition[1], 0, height);
            command = { method: "moveMouse", args: mousePosition };
          }
          break;
        case "arrowKeys":
          if (keyToTap) {
            command = ["up", "down", "left", "right"].map((arrowKey) => {
              return {
                method: "keyToggle",
                args: [arrowKey, arrowKey == keyToTap ? "down" : "up"],
              };
            });
          }
          break;
        default:
          break;
      }
      if (command) {
        throttledSend({ command });
        if (keyToTap) {
          resetArrowKeys();
        }
      }
    }
  }
});

const resetArrowKeys = debounce(() => {
  const command = ["up", "down", "left", "right"].map((arrowKey) => {
    return {
      method: "keyToggle",
      args: [arrowKey, "up"],
    };
  });
  send({
    type: "robot",
    command,
  });
}, 100);

const modes = ["scroll", "mouse", "arrowKeys"];
let mode = modes[0];
const modeSelect = document.getElementById("modes");
modes.forEach((mode) => {
  const modeOption = new Option(mode);
  modeSelect.appendChild(modeOption);
});
modeSelect.addEventListener("input", (event) => {
  mode = event.target.value;
  console.log("new mode", mode);
});

const { width, height } = screen;
const mousePosition = [width / 2, height / 2];

const throttledSend = throttle((message) => {
  send({
    type: "robot",
    ...message,
  });
}, 1);
