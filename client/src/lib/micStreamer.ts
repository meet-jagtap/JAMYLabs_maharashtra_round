/**
 * Captures the microphone and emits 100 ms chunks of 16 kHz PCM16 mono audio
 * (produced by the `pcm-capture` AudioWorklet in /public).
 */
export class MicStreamer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  /** Requests mic permission. Throws a user-readable Error on failure. */
  async start(onChunk: (pcm: ArrayBuffer) => void, onLevel?: (level: number) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access requires a secure context (https or localhost).');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError') throw new Error('Microphone permission was denied.');
      if (name === 'NotFoundError') throw new Error('No microphone was found.');
      throw new Error(`Could not access microphone: ${(err as Error).message}`);
    }

    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (onLevel) onLevel(rms(new Int16Array(e.data)));
      onChunk(e.data);
    };
    this.source.connect(this.node);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  stop(): void {
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}

/** Normalised 0..1 loudness, lightly companded so speech is visible. */
function rms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
}
