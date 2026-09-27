class NornsStereoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000;
    this.samples = new Float32Array(this.capacity * 2);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.queued = 0;
    this.primed = false;
    this.port.onmessage = event => {
      const incoming = new Float32Array(event.data);
      for (let index = 0; index + 1 < incoming.length; index += 2) {
        if (this.queued === this.capacity) {
          this.readIndex = (this.readIndex + 1) % this.capacity;
          this.queued--;
        }
        this.samples[this.writeIndex * 2] = incoming[index];
        this.samples[this.writeIndex * 2 + 1] = incoming[index + 1];
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        this.queued++;
      }
      // Keep interactive audio near the current norns state if a tab stalls.
      if (this.queued > 24000) {
        this.readIndex = (this.writeIndex - 9600 + this.capacity) % this.capacity;
        this.queued = 9600;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.primed) {
      if (this.queued < 4800) return true;
      this.primed = true;
    }
    for (let index = 0; index < left.length; index++) {
      if (this.queued === 0) {
        this.primed = false;
        break;
      }
      left[index] = this.samples[this.readIndex * 2];
      right[index] = this.samples[this.readIndex * 2 + 1];
      this.readIndex = (this.readIndex + 1) % this.capacity;
      this.queued--;
    }
    return true;
  }
}

registerProcessor('norns-stereo', NornsStereoProcessor);
