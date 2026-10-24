// Microphone capture for the voice tutor: downsamples whatever rate the
// audio context runs at to 16 kHz mono and posts ~32 ms Int16 PCM chunks
// (Gemini Live expects 16-bit little-endian PCM at 16 kHz).
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; // fractional read position carried across render quanta
    this.out = new Int16Array(512);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Average the input samples that fall into each 16 kHz output sample.
    while (this.pos < ch.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(ch.length, Math.max(start + 1, Math.floor(this.pos + this.ratio)));
      let sum = 0;
      for (let i = start; i < end; i++) sum += ch[i];
      const s = Math.max(-1, Math.min(1, sum / (end - start)));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage(this.out.buffer.slice(0));
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}

registerProcessor('voice-capture', VoiceCaptureProcessor);
