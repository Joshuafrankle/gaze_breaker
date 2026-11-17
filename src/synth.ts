// Tiny Web Audio kit: plucked notes placed in 3D with HRTF panning, plus a driving looping beat.
// Everything in the backing track stays inside the notes the bricks play (C major pentatonic).
const ROOTS = [130.81, 110, 98, 110]; // bass per bar: C A G A
// Calm mode: slow warm chords on the same C A G A roots as the beat, with sparse music-box notes (C pentatonic) in a big reverb.
const PAD = [[130.81, 196, 293.66, 329.63], [110, 164.81, 261.63, 329.63], [98, 146.83, 246.94, 293.66], [110, 164.81, 261.63, 329.63]];
const CHIMES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
const PAD_BAR = 8; // seconds per chord
const ARP = [0, 7, 12, 7, 4, 9, 12, 9, 0, 7, 12, 16, 14, 12, 9, 7]; // semitones above C5, one per 16th

export class Synth {
  private ctx?: AudioContext;
  private out?: DynamicsCompressorNode; // everything goes through this so stacked sounds don't clip
  private noise?: AudioBuffer;
  private nextT = 0; // when the next 16th-note tick is due
  private step16 = 0;
  private gridT = 0; // time of the latest scheduled tick, and the tick length: notes snap to this grid
  private gridLen = 0;
  private quantize = false;
  private bus?: GainNode; // the beat goes through this, so it can fade in and out instead of cutting
  private busOn = false;
  private stopAt = 0; // keep scheduling the beat until its fade-out has finished
  private amb?: GainNode; // the calm ambience: chords and chimes, with a reverb
  private ambOn = false;
  private chordAt = 0;
  private chord = 0;
  private chimeAt = 0;
  private kickT = 0;
  private barT = 0; // time of the latest downbeat // time of a recent kick: the background pulses on it

  // Browsers only allow audio after a user gesture, so call this from one.
  start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createDynamicsCompressor();
      this.out.connect(this.ctx.destination);
      this.bus = this.ctx.createGain();
      this.bus.gain.value = 0;
      this.bus.connect(this.out);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setListener(
    px: number, py: number, pz: number,
    fx: number, fy: number, fz: number,
    ux: number, uy: number, uz: number,
  ): void {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz;
    l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
    l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
  }

  play(freq: number, x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    let t = ctx.currentTime;
    if (this.quantize && this.gridLen) {
      // While the beat runs, snap a note to the next 16th if it is under 60 ms away: tight, not laggy.
      const d = this.gridLen - ((((t - this.gridT) % this.gridLen) + this.gridLen) % this.gridLen);
      if (d < 0.06) t += d;
    }
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z;
    osc.connect(gain).connect(pan).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.75);
  }

  // A rising noise sweep: the "here we go" at the start of every round.
  riser(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    n.connect(bp).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + 0.6);
  }

  // A short blast: a noise pop with a quick pitch drop under it.
  boom(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.hit(t, 'bandpass', 900, 0.2, 0.28, this.out);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.22);
  }

  // 1 right on a kick, easing to 0 before the next one.
  beatPulse(): number {
    if (!this.ctx || !this.quantize || !this.gridLen) return 0;
    const beat = this.gridLen * 4;
    const ph = ((((this.ctx.currentTime - this.kickT) % beat) + beat) % beat) / beat;
    return (1 - ph) ** 2;
  }

  // Call every frame. Schedules the groove a little ahead on the audio clock (not the frame clock) so it
  // stays steady. `energy` 0..1 (how well the player is doing) fades in the lead line and extra hats.
  beat(bpm: number, on: boolean, energy: number): void {
    const ctx = this.ctx;
    this.quantize = on;
    if (!ctx || !this.out || !this.bus || ctx.state !== 'running') {
      this.nextT = 0;
      return;
    }
    const now = ctx.currentTime;
    if (on !== this.busOn) {
      this.busOn = on;
      this.bus.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.7 : 0.25); // fade in over ~2 s, out over ~0.7 s
      if (!on) this.stopAt = now + 1.2;
    }
    if (!on && now > this.stopAt) {
      this.nextT = 0;
      return;
    }
    const len = 60 / bpm / 4;
    if (this.nextT < ctx.currentTime) {
      this.nextT = ctx.currentTime + 0.05; // (re)start cleanly, on the bar
      this.step16 = 0;
    }
    while (this.nextT < ctx.currentTime + 0.12) {
      this.gridT = this.nextT;
      this.gridLen = len;
      this.tick(this.step16, this.nextT, energy);
      this.nextT += len;
      this.step16 = (this.step16 + 1) % 64;
    }
  }

  // Call every frame. Calm mode's ambience: warm chords that swell in and out, and the odd soft chime.
  // It fades in and out gently when switched.
  pad(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (!this.amb) {
      if (!on) return;
      this.amb = ctx.createGain();
      this.amb.gain.value = 0;
      const verb = ctx.createConvolver(); // a 3 s wash of decaying noise = a big soft room
      const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 3), ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
      }
      verb.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      this.amb.connect(this.out);
      this.amb.connect(verb).connect(wet).connect(this.out);
    }
    if (on !== this.ambOn) {
      this.ambOn = on;
      this.amb.gain.setTargetAtTime(on ? 1 : 0, t, on ? 1.2 : 0.8);
      this.chordAt = this.chimeAt = 0;
    }
    if (!on) return;
    if (t > this.chordAt) {
      this.chordAt = t + PAD_BAR;
      for (const f of PAD[this.chord++ % PAD.length]) {
        for (const [type, mult, detune] of [['sine', 1, 0], ['triangle', 1, 6]] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f * mult;
          o.detune.value = detune;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 700;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(type === 'sine' ? 0.025 : 0.009, t + 3); // slow swell, then dissolve into the next chord
          g.gain.linearRampToValueAtTime(0, t + PAD_BAR + 3);
          o.connect(lp).connect(g).connect(this.amb);
          o.start(t);
          o.stop(t + PAD_BAR + 3.1);
        }
      }
    }
    if (t > this.chimeAt) {
      this.chimeAt = t + 2 + Math.random() * 2.5;
      const o = ctx.createOscillator();
      o.frequency.value = CHIMES[Math.floor(Math.random() * CHIMES.length)];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.4 - 0.7;
      o.connect(g).connect(pan).connect(this.amb);
      o.start(t);
      o.stop(t + 3.1);
    }
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const ctx = this.ctx!;
      this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  // A short burst of filtered noise: hats and claps.
  private hit(t: number, type: BiquadFilterType, freq: number, gain: number, dur: number, dest: AudioNode = this.bus!): void {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t);
    n.stop(t + dur + 0.01);
  }

  private tick(s: number, t: number, energy: number): void {
    const ctx = this.ctx!;
    const out = this.bus!;
    const st = s % 16;
    const bar = Math.floor(s / 16) % 4;

    if (st % 4 === 0) {
      // four on the floor: short and clicky, not boomy
      this.kickT = t;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(62, t + 0.08);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.15);
    }
    if (st === 4 || st === 12) this.hit(t, 'bandpass', 1600, 0.1, 0.11); // clap on 2 and 4
    if (st % 4 === 2) this.hit(t, 'highpass', 7000, 0.04, 0.05); // off-beat hat
    else if (st % 2 === 1 && energy > 0.35) this.hit(t, 'highpass', 8000, 0.016, 0.03); // ghost 16ths when you are on a roll
    if (st === 14) this.hit(t, 'highpass', 6000, 0.045, 0.16); // open hat leading into the next bar

    if (st % 2 === 0) {
      // driving eighth-note bass, bouncing up an octave on the off-beats
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = ROOTS[bar] * (st % 4 === 2 ? 2 : 1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(st % 4 === 0 ? 0.075 : 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.18);
    }

    // bright 16th-note arpeggio: always there, louder as energy rises, an octave higher in the last bar
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 523.25 * 2 ** (ARP[st] / 12) * (bar === 3 ? 2 : 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.016 + 0.03 * energy, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }
}
