import { frequency, clamp } from './music.mjs';

export class InstrumentAudio {
  constructor() {
    this.context = null;
    this.voices = [];
    this.settings = { volume: 65, echo: 25, hall: 35, decay: 55, bpm: 92, muted: false };
    this.onInterrupted = () => {};
  }
  unlock() {
    try {
      if (!this.context || this.context.state === 'closed') this.build();
      return this.context.resume();
    } catch (error) { return Promise.reject(error); }
  }
  build() {
    const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Constructor) throw new Error('このブラウザは音声合成に対応していません。');
    const ac = this.context = new Constructor({ latencyHint: 'interactive' });
    this.input = ac.createGain();
    const highpass = ac.createBiquadFilter();
    highpass.type = 'highpass'; highpass.frequency.value = 35;
    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.knee.value = 20;
    compressor.ratio.value = 5; compressor.attack.value = .003; compressor.release.value = .18;
    this.master = ac.createGain();
    this.input.connect(highpass); highpass.connect(compressor);
    compressor.connect(this.master); this.master.connect(ac.destination);
    this.delay = ac.createDelay(2);
    this.feedback = ac.createGain(); this.feedback.gain.value = .3;
    const damp = ac.createBiquadFilter(); damp.frequency.value = 2600;
    this.echo = ac.createGain();
    this.input.connect(this.delay); this.delay.connect(damp); damp.connect(this.feedback);
    this.feedback.connect(this.delay); this.delay.connect(this.echo); this.echo.connect(compressor);
    const reverb = ac.createConvolver();
    const length = Math.floor(ac.sampleRate * 2.6), impulse = ac.createBuffer(2, length, ac.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / ac.sampleRate * 3.2) * .6;
    }
    reverb.buffer = impulse; this.hall = ac.createGain();
    this.input.connect(reverb); reverb.connect(this.hall); this.hall.connect(compressor);
    this.noise = ac.createBuffer(1, Math.floor(ac.sampleRate * .025), ac.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 8);
    ac.onstatechange = () => {
      if (this.context === ac && ac.state === 'interrupted') this.onInterrupted();
    };
    this.configure(this.settings);
  }
  configure(values) {
    Object.assign(this.settings, values);
    if (!this.context) return;
    const t = this.context.currentTime, s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.volume / 100 * .8, t, .025);
    this.echo.gain.setTargetAtTime(s.echo / 100 * .6, t, .04);
    this.hall.gain.setTargetAtTime(s.hall / 100 * .8, t, .04);
    this.delay.delayTime.setTargetAtTime(60 / s.bpm * .75, t, .1);
  }
  get time() { return this.context?.currentTime ?? 0; }
  play(midi, { voice = 'kalimba', velocity = .65, brightness = .6, pan = 0, when = this.time } = {}) {
    const ac = this.context;
    if (!ac || ac.state === 'closed') return;
    const t = Math.max(when, ac.currentTime), f = frequency(midi);
    const duration = .45 + this.settings.decay / 100 * 2.8;
    const env = ac.createGain(), filter = ac.createBiquadFilter(), stereo = ac.createStereoPanner();
    filter.type = 'lowpass'; filter.frequency.value = 950 + brightness * 10000;
    stereo.pan.value = clamp(pan, -.8, .8);
    env.connect(filter); filter.connect(stereo); stereo.connect(this.input);
    const amp = .18 * clamp(velocity, .15, 1);
    env.gain.setValueAtTime(.0001, t);
    env.gain.exponentialRampToValueAtTime(amp, t + .004);
    env.gain.exponentialRampToValueAtTime(.0001, t + duration);
    const nodes = [env, filter, stereo], sources = [];
    const addPartial = (ratio, level, decay = 1, type = 'sine') => {
      const oscillator = ac.createOscillator(), gain = ac.createGain();
      oscillator.type = type; oscillator.frequency.value = f * ratio;
      gain.gain.setValueAtTime(level, t);
      gain.gain.exponentialRampToValueAtTime(.0001, t + duration * decay);
      oscillator.connect(gain); gain.connect(env);
      oscillator.start(t); oscillator.stop(t + duration + .04);
      sources.push(oscillator); nodes.push(oscillator, gain);
      return oscillator;
    };
    if (voice === 'neon') {
      const carrier = addPartial(1, .65);
      const mod = ac.createOscillator(), index = ac.createGain();
      mod.frequency.value = f * 2;
      index.gain.setValueAtTime(f * (.35 + brightness * 2), t);
      index.gain.exponentialRampToValueAtTime(.01, t + duration * .6);
      mod.connect(index); index.connect(carrier.frequency);
      mod.start(t); mod.stop(t + duration + .04);
      sources.push(mod); nodes.push(mod, index);
      addPartial(2, .12, .35);
    } else if (voice === 'glass') {
      addPartial(1, .65); addPartial(2, .22, .65); addPartial(3, .11, .35); addPartial(6, .05, .18);
    } else if (voice === 'velvet') {
      addPartial(1, .62); addPartial(2, .14, .35); addPartial(3, .08, .25);
      filter.frequency.value = 700 + brightness * 2700;
    } else {
      addPartial(1, .68); addPartial(2, .18, .38); addPartial(3, .09, .18); addPartial(5.04, .035, .09);
      const noise = ac.createBufferSource(), level = ac.createGain();
      noise.buffer = this.noise; level.gain.value = .13 * brightness;
      noise.connect(level); level.connect(env); noise.start(t); noise.stop(t + .03);
      nodes.push(noise, level); sources.push(noise);
    }
    let cleaned = false;
    const record = { sources, env, t, clean: () => {
      if (cleaned) return;
      cleaned = true; for (const node of nodes) node.disconnect();
      this.voices = this.voices.filter(v => v !== record);
    } };
    sources[0].onended = record.clean;
    this.voices.push(record);
    // Voice stealing bounds CPU use even during rapid two-hand sweeps.
    if (this.voices.length > 32) {
      const oldest = this.voices.shift(), now = ac.currentTime;
      oldest.env.gain.cancelScheduledValues(now);
      oldest.env.gain.setValueAtTime(.0001, now);
      for (const source of oldest.sources) { try { source.stop(now + .008); } catch {} }
    }
  }
  click(when, accent) {
    if (!this.context) return;
    const ac = this.context, osc = ac.createOscillator(), gain = ac.createGain();
    osc.frequency.value = accent ? 1500 : 1050;
    gain.gain.setValueAtTime(.035, when); gain.gain.exponentialRampToValueAtTime(.0001, when + .025);
    osc.connect(gain); gain.connect(this.master); osc.start(when); osc.stop(when + .03);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  dispose() {
    const context = this.context;
    this.context = null;
    for (const voice of this.voices) voice.clean();
    this.voices = [];
    if (context && context.state !== 'closed') context.close().catch(() => {});
  }
}
