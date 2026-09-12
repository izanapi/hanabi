import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as music from '../music.mjs';
import { InstrumentAudio } from '../audio.mjs';

class Param {
  constructor() { this.value = 0; }
  setValueAtTime(value, time) { assert.ok(Number.isFinite(value) && time >= 0); this.value = value; }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0 && Number.isFinite(value) && time >= 0); this.value = value; }
  setTargetAtTime(value, time, constant) { assert.ok(Number.isFinite(value) && time >= 0 && constant > 0); this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  constructor(ac) { this.ac = ac; for (const key of ['gain','frequency','pan','threshold','knee','ratio','attack','release','delayTime']) this[key] = new Param(); }
  connect() {} disconnect() { this.disconnected = true; }
  start(time) { assert.ok(time >= 0); this.startTime = time; }
  stop(time) { assert.ok(time >= 0); this.stopTime = time; }
}
class FakeAudioContext {
  constructor(options) { assert.equal(options.latencyHint, 'interactive'); this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 1000; this.destination = new Node(this); this.nodes = []; }
  node() { const node = new Node(this); this.nodes.push(node); return node; }
  createGain() { return this.node(); } createBiquadFilter() { return this.node(); } createStereoPanner() { return this.node(); }
  createOscillator() { return this.node(); } createBufferSource() { return this.node(); } createDelay() { return this.node(); }
  createDynamicsCompressor() { return this.node(); } createConvolver() { return this.node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) { this.currentTime += seconds; for (const node of this.nodes) if (!node.ended && node.stopTime <= this.currentTime) { node.ended = true; node.onended?.(); } }
}
globalThis.AudioContext = FakeAudioContext;
class TracedAudio extends InstrumentAudio {
  constructor() { super(); this.calls = []; }
  play(midi, options) { this.calls.push({ midi, ...options }); super.play(midi, options); }
}
class Element {
  constructor(id = '') { this.id = id; this.listeners = {}; this.style = {}; this.dataset = {}; this.value = ''; this.classList = { toggle() {}, add() {}, remove() {} }; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  dispatch(type, data = {}) { const event = { target: this, preventDefault() {}, ...data }; for (const callback of this.listeners[type] || []) callback(event); }
  append() {} setAttribute() {} setPointerCapture() {}
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
  const sandbox = { ...music, InstrumentAudio: TracedAudio, document, console, performance: { now: () => now },
    devicePixelRatio: 2, matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} },
    setInterval: () => 1, clearInterval() {}, requestAnimationFrame: callback => { frame = callback; },
    addEventListener: (...args) => globalEvents.addEventListener(...args) };
  vm.createContext(sandbox);
  const source = fs.readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source + '\nglobalThis.testAPI = { audio, clock, loop, config, fingers, geometry, schedule, pause, emit, setLoopState, changeTempo, draw };', sandbox);
  const api = sandbox.testAPI;
  return { ...api, elements, document, modes, globalEvents,
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    advance(seconds) { for (let time = 0; time < seconds; time += .025) { now += 25; api.audio.context?.advance(.025); api.schedule(); frame(now); } },
    pointer(type, id, string) {
      const a = music.angleForString(string), r = api.geometry.radius * .8;
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
  assert.ok(h.audio.calls.slice(count).some(call => call.midi === music.midiForString(2, 2, 'pentatonic')));
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
  for (const voice of ['kalimba', 'glass', 'neon', 'velvet']) for (let i = 0; i < 40; i++) {
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
