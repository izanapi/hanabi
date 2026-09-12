// Pure musical rules shared by the instrument and its regression tests.
export const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const SCALES = {
  pentatonic: { name: 'Major pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPent: { name: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  hirajoshi: { name: '平調子', intervals: [0, 2, 3, 7, 8] },
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
