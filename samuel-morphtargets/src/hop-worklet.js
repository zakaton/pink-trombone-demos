// Turns the microphone into the 512-sample, 44.1 kHz hops Samuel.liveMimic expects.
// If the audio context isn't running at 44.1 kHz, the stream is resampled (linearly) on the way.
class HopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 44100; // input samples per output sample
    this.pos = 0; // next output position, in input samples, relative to the start of the current block
    this.last = 0; // last sample of the previous block (position -1)
    this.hop = new Float32Array(512);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    const n = input.length;
    let p = this.pos;
    while (p < n - 1) {
      const i = Math.floor(p),
        f = p - i;
      const a = i < 0 ? this.last : input[i],
        b = input[i + 1];
      this.hop[this.filled++] = a + (b - a) * f;
      if (this.filled === 512) {
        const hop = this.hop;
        this.hop = new Float32Array(512);
        this.filled = 0;
        this.port.postMessage(hop, [hop.buffer]);
      }
      p += this.step;
    }
    this.pos = p - n;
    this.last = input[n - 1];
    return true;
  }
}
registerProcessor("hop-processor", HopProcessor);
