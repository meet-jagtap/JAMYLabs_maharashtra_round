/**
 * AudioWorklet: converts the microphone stream (whatever rate the browser's
 * AudioContext runs at, typically 44.1/48 kHz, Float32) into
 * 16 kHz, 16-bit signed little-endian, mono PCM — the format Gemini Live expects.
 *
 * Emits ArrayBuffers of 1600 samples (100 ms) to the main thread.
 *
 * Downsampling uses box-filter averaging over each output sample's input
 * window, which acts as a cheap low-pass and avoids most aliasing.
 */
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms @ 16 kHz

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this.acc = 0;
    this.accCount = 0;
    this.pos = 0; // input samples consumed within current output window
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIdx = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // mono (first channel)
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.acc += channel[i];
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.acc / this.accCount));
        this.out[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc = 0;
        this.accCount = 0;
        if (this.outIdx === CHUNK_SAMPLES) {
          const buf = this.out.buffer;
          this.port.postMessage(buf, [buf]);
          this.out = new Int16Array(CHUNK_SAMPLES);
          this.outIdx = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
