import test from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, STRING_COUNT, midiForString, frequency, noteName, angleForString, stringAt, crossedStrings, chordStrings, loopStep, stepSeconds, bpmFromTaps } from '../music.mjs';

test('all 28 strings stay in key across every root, scale and octave', () => {
  for (const [scale, { intervals }] of Object.entries(SCALES)) for (let root = 0; root < 12; root++) for (const octave of [-1, 0, 1]) {
    for (let id = 0; id < STRING_COUNT; id++) {
      const midi = midiForString(id, root, scale, octave);
      assert.ok(midi >= 0 && midi <= 127);
      assert.ok(intervals.includes((midi - root) % 12));
      if (id % 14) assert.ok(midi > midiForString(id - 1, root, scale, octave));
      if (id < 14) assert.equal(midiForString(id + 14, root, scale, octave) - midi, 12);
    }
  }
  assert.equal(frequency(69), 440); assert.equal(noteName(60), 'C4');
});
const geometry = { cx: 195, cy: 220, radius: 165, inner: 34 };
const point = (id, radius = 130) => ({ x: geometry.cx + Math.cos(angleForString(id)) * radius, y: geometry.cy + Math.sin(angleForString(id)) * radius });
test('every visible ray maps to its own note at inner and outer playing positions', () => {
  for (let id = 0; id < STRING_COUNT; id++) for (const radius of [45, 100, 165]) {
    const p = point(id, radius); assert.equal(stringAt(p.x, p.y, geometry), id);
  }
  assert.equal(stringAt(195, 220, geometry), null);
  assert.equal(stringAt(0, 0, geometry), null);
});
test('fast swipes hit intervening strings without inventing notes in the center dead zone', () => {
  const crossed = crossedStrings(point(2), point(10), geometry);
  assert.deepEqual(crossed, [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(crossedStrings(point(4), point(4, 160), geometry), []);
  assert.deepEqual(crossedStrings({ x: 190, y: 220 }, { x: 200, y: 220 }, geometry), []);
});
test('chords never cross hands or exceed the set of strings', () => {
  for (let id = 0; id < STRING_COUNT; id++) {
    const notes = chordStrings(id); assert.equal(new Set(notes).size, 3);
    for (const note of notes) assert.equal(Math.floor(note / 14), Math.floor(id / 14));
  }
});
test('loop quantization is bounded to 32 sixteenths / two bars', () => {
  for (const bpm of [40, 92, 120, 200]) {
    const step = stepSeconds(bpm);
    for (let i = 0; i < 32; i++) assert.equal(loopStep(3 + i * step, 3, bpm), i);
    assert.equal(loopStep(2, 3, bpm), 0); assert.equal(loopStep(100, 3, bpm), 31);
    assert.equal(step * 32, 60 / bpm * 8);
  }
});
test('tap tempo uses a median to tolerate an accidental short tap', () => {
  assert.equal(bpmFromTaps([0]), null);
  assert.equal(bpmFromTaps([0, 500, 1000, 1500]), 120);
  assert.equal(bpmFromTaps([0, 500, 1000, 1100, 1600]), 120);
  assert.equal(bpmFromTaps([0, 1]), 200);
});
