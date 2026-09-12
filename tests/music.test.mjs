import test from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, STRING_COUNT, midiForString, frequency, noteName, angleForString, stringAt, crossedStrings, chordStrings, loopStep, stepSeconds, bpmFromTaps, innerRadius, harmonicLayer, harmonicOffsets, randomPatch, accompanimentPhrase, recordingClick } from '../music.mjs';

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

test('harmonic boundaries stay stable when the spectrum animates', () => {
  for (let id = 0; id < 28; id++) {
    const radius = innerRadius(id, geometry, 0);
    assert.ok(radius > geometry.inner && radius < geometry.radius * .7);
    assert.equal(radius, innerRadius(id, geometry, 20));
    assert.equal(radius, innerRadius(id, geometry, 20, true));
  }
});
test('inner radius resolves to fifth and octave layers with a silent center', () => {
  const id = 4, tip = innerRadius(id, geometry, 0, true);
  const at = r => point(id, r);
  assert.equal(harmonicLayer(at(150), id, geometry, 0, true), 0);
  assert.equal(harmonicLayer(at(tip - 7), id, geometry, 0, true), 1);
  assert.equal(harmonicLayer(at(geometry.inner + 5), id, geometry, 0, true), 2);
  assert.equal(harmonicLayer(at(10), id, geometry, 0, true), 0);
  assert.equal(harmonicLayer(at(tip + 1), id, geometry, 0, true, 1), 1);
  assert.deepEqual(harmonicOffsets(2), [7, 12]);
});
test('random patches change musical settings without changing tempo, gain or loop state', () => {
  const current = {root:0, scale:'hirajoshi', voice:'kalimba', palette:'neon', bpm:92, volume:65};
  for (const seed of [0, .25, .5, .75, .999]) {
    const patch = randomPatch(current, () => seed);
    for (const key of ['root','scale','voice','palette']) assert.notEqual(patch[key], current[key]);
    assert.equal(patch.bpm, undefined); assert.equal(patch.volume, undefined);
    assert.ok(SCALES[patch.scale]);
  }
  assert.equal(Object.keys(SCALES).length, 14);
});

test('curated scales retain a tonic/fifth and omit the abrasive random choices', () => {
  for (const scale of Object.values(SCALES)) assert.ok(scale.intervals.includes(0) && scale.intervals.includes(7));
  for (const name of ['diminishedHW','diminishedWH','chromatic','locrian','wholeTone']) assert.equal(SCALES[name], undefined);
  for (const name of ['hirajoshi','dorian','insen','ritusen','kumoi','ryukyu']) assert.ok(SCALES[name]);
});
test('accompaniment is sparse, varies, and stays on valid strings in every scale', () => {
  for (const scale of Object.keys(SCALES)) {
    const phrase = accompanimentPhrase(scale, () => .2);
    assert.equal(phrase.length, 6); assert.equal(phrase[0].id, 0);
    assert.notDeepEqual(phrase, accompanimentPhrase(scale, () => .8));
    for (const note of phrase) {
      assert.ok(note.id >= 0 && note.id < 14); assert.ok(note.step >= 0 && note.step < 32);
      assert.ok(note.velocity < .5);
    }
  }
});
test('recording clicks align to the take and end after two bars', () => {
  const loop = {state:'recording',startStep:7};
  const clicks = Array.from({length:40}, (_, step) => ({step,click:recordingClick(step,loop)})).filter(x=>x.click);
  assert.deepEqual(clicks.map(x=>x.step), [7,11,15,19,23,27,31,35]);
  assert.deepEqual(clicks.filter(x=>x.click.accent).map(x=>x.step), [7,23]);
  assert.equal(recordingClick(40,loop), null);
  assert.ok(recordingClick(40,loop,true));
});
