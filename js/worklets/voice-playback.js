// Gapless playback of the tutor's 24 kHz PCM audio. Chunks are queued as
// Float32Arrays; "clear" drops everything queued (the student interrupted).
class VoicePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      if (e.data === 'clear') { this.queue = []; this.offset = 0; }
      else if (e.data === 'status') this.port.postMessage(this.playing ? 'playing' : 'idle');
      else this.queue.push(e.data);
    };
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const buf = this.queue[0];
      const take = Math.min(out.length - i, buf.length - this.offset);
      out.set(buf.subarray(this.offset, this.offset + take), i);
      i += take;
      this.offset += take;
      if (this.offset >= buf.length) { this.queue.shift(); this.offset = 0; }
    }
    out.fill(0, i);
    // Report only transitions, so the UI can show "tutor is speaking".
    const playing = i > 0;
    if (playing !== this.playing) { this.playing = playing; this.port.postMessage(playing ? 'playing' : 'idle'); }
    return true;
  }
}

registerProcessor('voice-playback', VoicePlaybackProcessor);
