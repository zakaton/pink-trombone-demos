// "send to timeline": builds the same utterance as "download all" and hands it to the /timeline page.
// If that page is open it receives it over a BroadcastChannel; otherwise it is opened and picks it up from localStorage.
(() => {
  const $ = (id) => document.getElementById(id),
    btn = $("sendToTimeline"),
    dl = $("download");
  const sync = () => (btn.disabled = dl.disabled); // enabled whenever there is something to download
  new MutationObserver(sync).observe(dl, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  sync();
  const bc = new BroadcastChannel("timeline-handoff");
  let acked = false;
  bc.onmessage = (e) => {
    if (e.data?.type === "loaded") acked = true;
  };
  btn.onclick = () => {
    const utterance = getUtterance();
    utterance.keyframes.forEach((k) => {
      if (!k.frequency) k.frequency = initialFrequency;
      if (!k.tractLength) k.tractLength = initialTractLength;
    });
    const payload = [utterance];
    try {
      localStorage.setItem("timeline-inbox", JSON.stringify(payload));
    } catch (err) {}
    acked = false;
    bc.postMessage({ type: "load", payload });
    setTimeout(() => {
      if (!acked) window.open("../timeline/", "pink-trombone-timeline"); // not open yet: it will read the inbox on load
      btn.textContent = "sent ✓";
      setTimeout(() => (btn.textContent = "send to timeline"), 1500);
    }, 400);
  };
})();
