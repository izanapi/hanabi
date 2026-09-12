import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as music from '../music.mjs';
import { VOICES } from '../voices.mjs';
import { InstrumentAudio, hallImpulse } from '../audio.mjs';

class Param {
  constructor() { this.value = 0; }
  setValueAtTime(value, time) { assert.ok(Number.isFinite(value) && time >= 0); this.value = value; }
  linearRampToValueAtTime(value, time) { assert.ok(Number.isFinite(value) && time >= 0); this.value = value; this.attackTime = time; }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0 && Number.isFinite(value) && time >= 0); this.value = value; }
  setTargetAtTime(value, time, constant) { assert.ok(Number.isFinite(value) && time >= 0 && constant > 0); this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  constructor(ac) { this.ac = ac; for (const key of ['gain','frequency','pan','threshold','knee','ratio','attack','release','delayTime']) this[key] = new Param(); }
  connect(target) { (this.connections ??= []).push(target); } disconnect() { this.disconnected = true; }
  start(time) { assert.ok(time >= 0); this.startTime = time; }
  stop(time) { assert.ok(time >= 0); this.stopTime = time; }
}
class FakeAudioContext {
  constructor(options) { assert.equal(options.latencyHint, 'interactive'); this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 1000; this.destination = new Node(this); this.nodes = []; }
  node() { const node = new Node(this); this.nodes.push(node); return node; }
  createGain() { return this.node(); } createBiquadFilter() { return this.node(); } createStereoPanner() { return this.node(); }
  createOscillator() { return this.node(); } createBufferSource() { return this.node(); } createDelay() { return this.node(); }
  createAnalyser() { const node = this.node(); node.frequencyBinCount = 512; node.getByteFrequencyData = array => array.fill(0); return node; }
  createDynamicsCompressor() { return this.node(); } createConvolver() { return this.node(); }
  createBuffer(channels, length) { const data = Array.from({length: channels}, () => new Float32Array(length)); return { length, numberOfChannels: channels, getChannelData: channel => data[channel] }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) { this.currentTime += seconds; for (const node of this.nodes) if (!node.ended && node.stopTime <= this.currentTime) { node.ended = true; node.onended?.(); } }
}
globalThis.AudioContext = FakeAudioContext;
class TracedAudio extends InstrumentAudio {
  constructor() { super(); this.calls = []; this.clicks = []; }
  click(when, accent) { this.clicks.push({when, accent}); super.click(when, accent); }
  play(midi, options) { this.calls.push({ midi, ...options }); super.play(midi, options); }
}
class Element {
  constructor(id = '') { this.id = id; this.listeners = {}; this.style = {}; this.dataset = {}; this.value = ''; this.classList = { toggle() {}, add() {}, remove() {} }; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  dispatch(type, data = {}) { const event = { target: this, preventDefault() {}, ...data }; for (const callback of this.listeners[type] || []) callback(event); }
  append(child) { (this.children ??= []).push(child); } setAttribute() {} setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 420 }; }
  showModal() { this.open = true; } close() { this.open = false; }
}
function harness() {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const drawing = new Proxy({}, { get: (_, name) => name === 'createRadialGradient' || name === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  elements.get('canvas').getContext = () => drawing;
  const modes = ['pluck', 'chord', 'arp'].map(mode => { const element = new Element(); element.dataset.mode = mode; return element; });
  const document = new Element(); document.hidden = false;
  document.getElementById = id => { assert.ok(elements.has(id), `Missing HTML id: ${id}`); return elements.get(id); };
  document.createElement = () => new Element(); document.querySelectorAll = () => modes;
  let now = 1000, frame;
  const globalEvents = new Element();
  const sandbox = { ...music, VOICES, InstrumentAudio: TracedAudio, document, console, performance: { now: () => now },
    devicePixelRatio: 2, matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} },
    setInterval: () => 1, clearInterval() {}, requestAnimationFrame: callback => { frame = callback; },
    addEventListener: (...args) => globalEvents.addEventListener(...args) };
  vm.createContext(sandbox);
  const source = fs.readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source + '\nglobalThis.testAPI = { audio, clock, loop, flow, config, fingers, geometry, schedule, pause, emit, setLoopState, changeTempo, draw };', sandbox);
  const api = sandbox.testAPI;
  return { ...api, elements, document, modes, globalEvents,
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    advance(seconds) { for (let time = 0; time < seconds; time += .025) { now += 25; api.audio.context?.advance(.025); api.schedule(); frame(now); } },
    pointer(type, id, string, fraction = .8) {
      const a = music.angleForString(string), r = api.geometry.radius * fraction;
      elements.get('canvas').dispatch(type, { pointerId: id, clientX: api.geometry.cx + Math.cos(a) * r, clientY: api.geometry.cy + Math.sin(a) * r, timeStamp: now, pointerType: 'touch' });
    },
  };
}
test('initial draw, two independent fingers, swipes, release, cancellation and keyboard', async () => {
  const h = harness(); h.draw(0); assert.equal(h.audio.context, null);
  h.pointer('pointerdown', 1, 3); h.pointer('pointerdown', 2, 18); await h.flush();
  assert.equal(h.fingers.size, 2); assert.equal(h.audio.calls.length, 2);
  h.advance(.1); h.pointer('pointermove', 1, 7); assert.ok(h.audio.calls.length >= 6);
  h.pointer('pointerup', 1, 7); assert.equal(h.fingers.size, 1);
  h.pointer('pointercancel', 2, 18); assert.equal(h.fingers.size, 0);
  h.elements.get('canvas').dispatch('keydown', { code: 'KeyA' });
  assert.equal(h.fingers.size, 1); h.document.dispatch('keyup', { code: 'KeyA' }); assert.equal(h.fingers.size, 0);
  h.pause();
});
test('chord mode adds left-hand harmony but keeps the right hand monophonic per string', async () => {
  const h = harness(); h.modes[1].dispatch('click');
  h.pointer('pointerdown', 1, 0); await h.flush(); assert.equal(h.audio.calls.length, 3);
  h.pointer('pointerdown', 2, 14); assert.equal(h.audio.calls.length, 4);
  h.pause();
});
test('arp is audio-clock scheduled and stops producing notes when the finger is released', async () => {
  const h = harness(); h.modes[2].dispatch('click'); h.pointer('pointerdown', 1, 4); await h.flush();
  h.advance(1); assert.ok(h.audio.calls.length > 2);
  h.pointer('pointerup', 1, 4); const count = h.audio.calls.length; h.advance(1); assert.equal(h.audio.calls.length, count);
  h.pause();
});
test('two-bar loop records, repeats, transposes, pauses, resumes and clears', async () => {
  const h = harness(); h.elements.get('loop').dispatch('click'); await h.flush();
  assert.equal(h.loop.state, 'armed'); h.pointer('pointerdown', 1, 2); h.pointer('pointerup', 1, 2);
  assert.equal(h.loop.state, 'recording'); h.advance(.5); h.pointer('pointerdown', 2, 17); h.pointer('pointerup', 2, 17);
  assert.equal(h.loop.events.length, 2);
  const bpm = h.config.bpm; h.changeTempo(180); assert.equal(h.config.bpm, bpm);
  h.advance(5.3); assert.equal(h.loop.state, 'playing'); assert.ok(h.audio.calls.length > 2);
  h.elements.get('root').value = '2'; h.elements.get('root').dispatch('change');
  const count = h.audio.calls.length; h.advance(5.4);
  assert.ok(h.audio.calls.slice(count).some(call => call.midi === music.midiForString(2, 2, 'insen')));
  h.elements.get('loop').dispatch('click'); assert.equal(h.loop.state, 'paused'); const stopped = h.audio.calls.length;
  h.advance(2); assert.equal(h.audio.calls.length, stopped);
  h.elements.get('loop').dispatch('click'); h.advance(.5); assert.equal(h.loop.state, 'playing');
  h.elements.get('clearLoop').dispatch('click'); assert.equal(h.loop.events.length, 0); assert.equal(h.loop.state, 'empty');
  h.pause();
});
test('backgrounding cancels recording, clears fingers, stops audio and can unlock again', async () => {
  const h = harness(); h.elements.get('loop').dispatch('click'); h.pointer('pointerdown', 1, 0); await h.flush();
  const oldContext = h.audio.context; h.document.hidden = true; h.document.dispatch('visibilitychange');
  assert.equal(oldContext.state, 'closed'); assert.equal(h.audio.context, null); assert.equal(h.fingers.size, 0); assert.equal(h.loop.state, 'empty');
  h.document.hidden = false; h.pointer('pointerdown', 2, 15); await h.flush();
  assert.equal(h.audio.context.state, 'running'); assert.notEqual(h.audio.context, oldContext); h.pause();
});
test('every timbre has valid envelopes and heavy strumming stays within 32 active voices', async () => {
  const audio = new InstrumentAudio(); await audio.unlock();
  for (const voice of Object.keys(VOICES)) for (let i = 0; i < 40; i++) {
    audio.play(48 + i, { voice, when: audio.time, velocity: .8 }); assert.ok(audio.voices.length <= 32);
  }
  audio.context.advance(8); assert.equal(audio.voices.length, 0);
  audio.configure({ muted: true }); assert.equal(audio.master.gain.value, 0); audio.dispose();
});
test('look-ahead scheduling does not cut off the final fraction of the recording bar', async () => {
  const h = harness(); h.elements.get('loop').dispatch('click'); await h.flush();
  h.pointer('pointerdown', 1, 1); h.pointer('pointerup', 1, 1);
  const end = h.loop.startTime + music.stepSeconds(h.config.bpm) * 32;
  h.audio.context.currentTime = end - .04; h.schedule();
  assert.equal(h.loop.state, 'recording');
  h.pointer('pointerdown', 2, 20); assert.ok(h.loop.events.some(event => event.id === 20 && event.step === 31));
  h.audio.context.currentTime = end + .01; h.schedule(); assert.equal(h.loop.state, 'playing'); h.pause();
});

test('Insen is the actual initial tuning and UI selection', () => {
  const h = harness(); assert.equal(h.config.scale, 'insen'); assert.equal(h.elements.get('scale').value, 'insen');
});
test('curling inward adds fifth then octave without retriggering the base note', async () => {
  const h = harness(); h.config.calm = true;
  h.pointer('pointerdown', 1, 3); await h.flush();
  const base = h.audio.calls[0].midi;
  h.pointer('pointermove', 1, 3, .55); assert.deepEqual(h.audio.calls.map(call => call.midi), [base, base + 7]);
  h.pointer('pointermove', 1, 3, .27); assert.deepEqual(h.audio.calls.map(call => call.midi), [base, base + 7, base + 12]);
  h.pointer('pointermove', 1, 3, .15); assert.equal(h.fingers.get(1).id, null); assert.equal(h.audio.calls.length, 3);
  h.pause();
});
test('inner harmonics are separately recorded and preserve intervals after transposition', async () => {
  const h = harness(); h.config.calm = true;
  h.elements.get('loop').dispatch('click'); await h.flush();
  h.pointer('pointerdown', 1, 4, .27); h.pointer('pointerup', 1, 4, .27);
  assert.deepEqual(Array.from(h.loop.events, event => event.interval), [0,7,12]);
  h.elements.get('root').value = '3'; h.elements.get('root').dispatch('change');
  const count = h.audio.calls.length; h.advance(5.5);
  const notes = h.audio.calls.slice(count).map(call => call.midi), base = music.midiForString(4, 3, 'insen');
  for (const offset of [0,7,12]) assert.ok(notes.includes(base + offset));
  h.pause();
});
test('dice updates all corresponding controls and preserves recorded loop and mix', async () => {
  const h = harness(); h.elements.get('loop').dispatch('click'); await h.flush(); h.pointer('pointerdown', 1, 2);
  const events = JSON.stringify(h.loop.events), bpm = h.config.bpm, volume = h.audio.settings.volume;
  h.elements.get('randomize').dispatch('click');
  assert.notEqual(h.config.scale, 'insen'); assert.notEqual(h.config.root, 0);
  for (const key of ['root','scale','voice','palette']) assert.equal(h.elements.get(key).value, String(h.config[key]));
  assert.equal(h.config.bpm, bpm); assert.equal(h.audio.settings.volume, volume); assert.equal(JSON.stringify(h.loop.events), events);
  for (const id of ['echo','hall','volume']) { h.elements.get(id).value = '42'; h.elements.get(id).dispatch('input'); assert.equal(h.audio.settings[id], 42); }
  h.pause();
});
test('interface is English-only and the three mix sliders live on the main surface', () => {
  for (const file of ['index.html','app.mjs','audio.mjs','music.mjs']) {
    const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'); assert.equal(/[ぁ-んァ-ン一-龯]/u.test(text), false, file);
  }
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = html.split('<dialog')[0];
  for (const id of ['echo','hall','volume','randomize']) assert.ok(main.includes(`id="${id}"`));
});
test('fixed harmonic boundaries do not generate notes under a resting finger', async () => {
  const h = harness(), id = 10;
  const radius = music.innerRadius(id, h.geometry) + 5;
  h.pointer('pointerdown', 1, id, radius / h.geometry.radius); await h.flush();
  const count = h.audio.calls.length;
  h.advance(8); assert.equal(h.audio.calls.length, count); h.pause();
});

test('Aurora is selected both in the config and settings control', () => {
  const h = harness(); assert.equal(h.config.palette, 'aurora'); assert.equal(h.elements.get('palette').value, 'aurora');
});
test('recording automatically clicks for eight beats and stops without changing manual preference', async () => {
  const h = harness(); h.elements.get('loop').dispatch('click'); h.pointer('pointerdown', 1, 2); h.pointer('pointerup', 1, 2); await h.flush();
  h.advance(5.5); assert.equal(h.loop.state, 'playing'); assert.equal(h.audio.clicks.length, 8);
  const count = h.audio.clicks.length; h.advance(1); assert.equal(h.audio.clicks.length, count); assert.equal(h.config.metronome, false);
  h.config.metronome = true; h.advance(1); assert.ok(h.audio.clicks.length > count); h.pause();
});
test('FLOW plays without fingers, follows key changes, avoids recording itself and stops', async () => {
  const h = harness(); h.elements.get('flow').dispatch('click'); await h.flush(); h.advance(1);
  assert.equal(h.flow.enabled, true); assert.ok(h.audio.calls.length > 1); assert.equal(h.fingers.size, 0);
  assert.ok(h.audio.calls.every(call => call.voice === 'velvet'));
  h.elements.get('loop').dispatch('click'); h.advance(1); assert.equal(h.loop.state, 'armed'); assert.equal(h.loop.events.length, 0);
  h.pointer('pointerdown', 1, 18); h.pointer('pointerup', 1, 18); h.advance(1); assert.equal(h.loop.events.length, 1);
  h.elements.get('root').value = '2'; h.elements.get('root').dispatch('change');
  h.elements.get('scale').value = 'ritusen'; h.elements.get('scale').dispatch('change');
  const count = h.audio.calls.length; h.advance(2);
  const calls = h.audio.calls.slice(count).filter(call => call.voice === 'velvet'); assert.ok(calls.length);
  for (const call of calls) assert.ok(music.SCALES.ritusen.intervals.includes((call.midi - 2) % 12));
  h.elements.get('flow').dispatch('click'); const stopped = h.audio.calls.length; h.advance(.5); assert.equal(h.audio.calls.length, stopped);
  h.elements.get('flow').dispatch('click'); h.pause(); assert.equal(h.flow.enabled, false);
});
test('space effects use cross-feedback below unity, matched beat delays and a stereo hall', async () => {
  const audio = new InstrumentAudio(); await audio.unlock(); audio.configure({echo:100,hall:100,bpm:120});
  assert.ok(audio.feedback.gain.value < .7); assert.equal(audio.feedback.gain.value, audio.feedbackRight.gain.value);
  assert.equal(audio.delay.delayTime.value, .375); assert.equal(audio.delayRight.delayTime.value, .375);
  assert.ok(audio.feedback.connections.includes(audio.delay)); assert.ok(audio.feedbackRight.connections.includes(audio.delayRight));
  assert.ok(audio.hall.gain.value >= 1); assert.equal(audio.readSpectrum().length, 512);
  const impulse = hallImpulse(audio.context); assert.equal(impulse.numberOfChannels, 2); assert.equal(impulse.length, 5500);
  const left = impulse.getChannelData(0), right = impulse.getChannelData(1);
  assert.notDeepEqual(left, right);
  const energy = data => data.reduce((sum, n) => sum + n*n,0)/data.length;
  assert.ok(energy(left.slice(3000,4000)) > 1e-6, 'audible long tail');
  assert.ok(energy(left.slice(4500)) < energy(left.slice(1000,2000))*.01, 'tail decays');
  audio.dispose(); assert.equal(audio.readSpectrum(),null);
});

test('voice picker uses the complete synthesis catalog', () => {
  const h = harness();
  assert.deepEqual(h.elements.get('voice').children.map(option=>option.value), Object.keys(VOICES));
});
test('new voices use different source families and the plucked-string cache stays bounded', async () => {
  const audio = new InstrumentAudio(); await audio.unlock();
  audio.context.sampleRate = 44100;
  const graphs = {};
  for (const voice of ['koto','bamboo','orbit','chip']) {
    const before = audio.context.nodes.length; audio.play(60,{voice});
    graphs[voice] = audio.context.nodes.slice(before);
  }
  assert.ok(graphs.koto.some(node=>node.buffer && !node.loop));
  assert.ok(graphs.bamboo.some(node=>node.loop));
  assert.ok(graphs.orbit.some(node=>node.type==='sawtooth'));
  assert.ok(graphs.chip.some(node=>node.type==='square'));
  for (let midi=48;midi<78;midi++) audio.play(midi,{voice:'koto'});
  assert.ok(audio.pluckCache.size <= 24);
  const size=audio.pluckCache.size;audio.play(77,{voice:'koto'});assert.equal(audio.pluckCache.size,size);
  audio.dispose();assert.equal(audio.pluckCache.size,0);
});
