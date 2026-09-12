import { frequency, clamp } from './music.mjs';

// A diffuse, decorrelated stereo tail with early reflections and a 5.2 s RT60.
export function hallImpulse(ac) {
  const duration = 5.5, length = Math.floor(ac.sampleRate * duration);
  const impulse = ac.createBuffer(2, length, ac.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const seconds = i / ac.sampleRate;
      smooth = smooth * .65 + (Math.random() * 2 - 1) * .35;
      const onset = Math.min(1, seconds / .045);
      data[i] = smooth * onset * Math.exp(-6.9078 * seconds / 5.2);
    }
    for (const [time, level] of [[.018, .55], [.039, .35], [.067, .24], [.109, .15]]) {
      const index = Math.floor((time + channel * .007) * ac.sampleRate);
      data[index] += level;
    }
  }
  return impulse;
}

export class InstrumentAudio {
  constructor() {
    this.context = null;
    this.voices = [];
    this.settings = { volume: 65, echo: 30, hall: 45, decay: 55, bpm: 92, muted: false };
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
    if (!Constructor) throw new Error('Web Audio is not supported in this browser.');
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
    // Cross-feedback ping-pong: each repeat moves to the opposite side.
    this.delay = ac.createDelay(2); this.delayRight = ac.createDelay(2);
    this.feedback = ac.createGain(); this.feedbackRight = ac.createGain();
    const send = ac.createGain(); send.channelCount = 1; send.channelCountMode = 'explicit'; send.gain.value = .8;
    const dampLeft = ac.createBiquadFilter(), dampRight = ac.createBiquadFilter();
    dampLeft.frequency.value = 3400; dampRight.frequency.value = 3000;
    const left = ac.createStereoPanner(), right = ac.createStereoPanner();
    left.pan.value = -.85; right.pan.value = .85;
    this.echo = ac.createGain();
    this.input.connect(send); send.connect(this.delay);
    this.delay.connect(dampLeft); dampLeft.connect(left); left.connect(this.echo);
    dampLeft.connect(this.feedbackRight); this.feedbackRight.connect(this.delayRight);
    this.delayRight.connect(dampRight); dampRight.connect(right); right.connect(this.echo);
    dampRight.connect(this.feedback); this.feedback.connect(this.delay);
    this.echo.connect(compressor);
    const preDelay = ac.createDelay(.2); preDelay.delayTime.value = .028;
    const reverb = ac.createConvolver(); reverb.buffer = hallImpulse(ac);
    const hallLow = ac.createBiquadFilter(); hallLow.type = 'highpass'; hallLow.frequency.value = 180;
    const hallHigh = ac.createBiquadFilter(); hallHigh.frequency.value = 5200;
    this.hall = ac.createGain();
    this.input.connect(preDelay); preDelay.connect(reverb); reverb.connect(hallLow);
    hallLow.connect(hallHigh); hallHigh.connect(this.hall); this.hall.connect(compressor);
    // Repeats also leave a little of their own reverberant trail.
    const echoToHall = ac.createGain(); echoToHall.gain.value = .2;
    this.echo.connect(echoToHall); echoToHall.connect(preDelay);
    this.analyser = ac.createAnalyser(); this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = .78;
    compressor.connect(this.analyser);
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
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
    const echo = clamp(s.echo / 100, 0, 1), hall = clamp(s.hall / 100, 0, 1);
    this.echo.gain.setTargetAtTime(echo * .95, t, .04);
    this.hall.gain.setTargetAtTime(hall * 1.1, t, .04);
    this.feedback.gain.setTargetAtTime(.25 + echo * .42, t, .08);
    this.feedbackRight.gain.setTargetAtTime(.25 + echo * .42, t, .08);
    if (values.bpm !== undefined) {
      this.delay.delayTime.setTargetAtTime(60 / s.bpm * .75, t, .1);
      this.delayRight.delayTime.setTargetAtTime(60 / s.bpm * .75, t, .1);
    }
  }
  readSpectrum() {
    if (!this.context || !this.analyser) return null;
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
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
    this.context = null; this.analyser = null; this.spectrum = null;
    for (const voice of this.voices) voice.clean();
    this.voices = [];
    if (context && context.state !== 'closed') context.close().catch(() => {});
  }
}
