import { VOICES } from './voices.mjs';
// Pure musical rules shared by the instrument and its regression tests.
export const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const SCALES = {
  hirajoshi: { name: 'Hirajoshi', intervals: [0, 2, 3, 7, 8] },
  pentatonic: { name: 'Major pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPent: { name: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  major: { name: 'Ionian / Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  minor: { name: 'Aeolian / Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  ritusen: { name: 'Ritusen', intervals: [0, 2, 5, 7, 9] },
  insen: { name: 'Insen', intervals: [0, 1, 5, 7, 10] },
  kumoi: { name: 'Kumoi', intervals: [0, 2, 3, 7, 9] },
  kumoijoshi: { name: 'Kumoijoshi', intervals: [0, 1, 5, 7, 8] },
  ryukyu: { name: 'Ryukyu', intervals: [0, 4, 5, 7, 11] },
};
export const PER_HAND = 14;
export const STRING_COUNT = PER_HAND * 2;
export const LOOP_STEPS = 32;
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function midiForString(id, root, scale, octave = 0) {
  const intervals = SCALES[scale].intervals;
  const degree = id % PER_HAND;
  return 48 + Number(root) + (id >= PER_HAND ? 12 : 0) + octave * 12
    + Math.floor(degree / intervals.length) * 12 + intervals[degree % intervals.length];
}
export const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
export const noteName = midi => NOTES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
export function angleForString(id) {
  const fraction = ((id % PER_HAND) + .5) / PER_HAND;
  return Math.PI / 2 + (id < PER_HAND ? 1 : -1) * fraction * Math.PI;
}
export function stringAt(x, y, geometry) {
  const dx = x - geometry.cx, dy = y - geometry.cy;
  const radius = Math.hypot(dx, dy);
  if (radius < geometry.inner || radius > geometry.radius + 28) return null;
  const fraction = Math.acos(clamp(dy / radius, -1, 1)) / Math.PI;
  return (dx < 0 ? 0 : PER_HAND) + clamp(Math.floor(fraction * PER_HAND), 0, PER_HAND - 1);
}
// Sample a fast swipe so a low-frequency pointer stream does not skip strings.
export function crossedStrings(from, to, geometry) {
  const count = Math.min(160, Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4)));
  const result = [];
  let previous = stringAt(from.x, from.y, geometry);
  for (let i = 1; i <= count; i++) {
    const id = stringAt(from.x + (to.x - from.x) * i / count, from.y + (to.y - from.y) * i / count, geometry);
    if (id !== null && id !== previous) result.push(id);
    previous = id;
  }
  return result;
}
export function chordStrings(id) {
  const base = Math.floor(id / PER_HAND) * PER_HAND;
  // Fold at the top of a hand without introducing notes outside the chosen scale.
  return [0, 2, 4].map(offset => base + ((id % PER_HAND + offset) % PER_HAND));
}
export const stepSeconds = bpm => 60 / bpm / 4;
export function loopStep(time, start, bpm) {
  return clamp(Math.round((time - start) / stepSeconds(bpm)), 0, LOOP_STEPS - 1);
}
export function bpmFromTaps(taps) {
  if (taps.length < 2) return null;
  const gaps = taps.slice(1).map((time, i) => time - taps[i]).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  return clamp(Math.round(60000 / Math.max(gap, 1)), 40, 200);
}

// Fixed harmonic boundaries: visualizer motion must not retrigger held notes.
export function innerRadius(id, geometry) {
  return geometry.inner + (geometry.radius - geometry.inner) * .49;
}
export function harmonicLayer(point, id, geometry, time = 0, still = false, previous = 0) {
  if (id === null) return 0;
  const distance = Math.hypot(point.x - geometry.cx, point.y - geometry.cy);
  if (distance < geometry.inner || distance > geometry.radius + 28) return 0;
  const tip = innerRadius(id, geometry, time, still);
  const deep = geometry.inner + (tip - geometry.inner) * .46;
  // A small hysteresis band keeps a resting thumb from chattering at a boundary.
  if (previous === 2 && distance < deep + 3) return 2;
  if (distance < deep - (previous < 2 ? 2 : 0)) return 2;
  if (distance < tip + (previous > 0 ? 3 : -2)) return 1;
  return 0;
}
export const harmonicOffsets = layer => layer >= 2 ? [7, 12] : layer === 1 ? [7] : [];
export function randomPatch(current, random = Math.random) {
  const different = (values, old) => {
    const candidates = values.filter(value => value !== old);
    return candidates[Math.floor(clamp(random(), 0, .999999) * candidates.length)];
  };
  return {
    root: different(Array.from({length: 12}, (_, i) => i), current.root),
    scale: different(Object.keys(SCALES), current.scale),
    voice: different(Object.keys(VOICES), current.voice),
    palette: different(['neon', 'aurora', 'ember'], current.palette),
  };
}

// A sparse two-bar phrase with a stable tonic and a small melodic motif.
// Regenerate occasionally, rather than choosing unrelated notes on every beat.
export function accompanimentPhrase(scale, random = Math.random) {
  const intervals = SCALES[scale].intervals, n = intervals.length;
  const pick = values => values[Math.floor(clamp(random(), 0, .999999) * values.length)];
  const fifth = intervals.indexOf(7);
  const motif = [0, pick([1, 2]), Math.max(1, fifth), pick([1, n - 1])];
  return [
    { step: 0, id: 0, velocity: .46, bass: true },
    { step: 16, id: Math.max(0, fifth), velocity: .38, bass: true },
    ...[4, 10, 20, 26].map((step, i) => ({ step, id: n + motif[i], velocity: .27 + (i % 2) * .04, bass: false })),
  ];
}
export function recordingClick(step, loop, manual = false) {
  const relative = step - loop.startStep;
  const recording = loop.state === 'recording' && relative >= 0 && relative < LOOP_STEPS;
  const position = recording ? relative : step;
  if (!(recording || manual || loop.state === 'armed') || position % 4 !== 0) return null;
  return { accent: position % 16 === 0 };
}
