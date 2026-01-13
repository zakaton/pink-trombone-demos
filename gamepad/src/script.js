const { send } = setupConnection("gamepad", (message) => {
  // FILL
  console.log("message", message);
});

const _send = (message) => {
  send({
    to: ["pink-trombone", "lip-sync"],
    type: "message",
    ...message,
  });
};
const throttledSend = throttle((message) => {
  _send(message);
}, 100);

// FILL
