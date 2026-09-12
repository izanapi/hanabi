// One catalog feeds synthesis, the voice picker and dice randomization.
export const VOICES = {
  kalimba: { name: 'Kalimba', attack: .003, length: 1, gain: .18 },
  koto: { name: 'Koto', attack: .0015, length: .85, gain: .23 },
  bamboo: { name: 'Bamboo', attack: .07, length: 1.15, gain: .20 },
  glass: { name: 'Glass', attack: .002, length: 1.45, gain: .17 },
  neon: { name: 'Neon FM', attack: .004, length: .85, gain: .17 },
  velvet: { name: 'Velvet', attack: .012, length: 1, gain: .17 },
  orbit: { name: 'Orbit', attack: .32, length: 1.8, gain: .16 },
  chip: { name: 'Chip', attack: .001, length: .28, gain: .10 },
};

// Fractional-delay Karplus–Strong excitation, with a half-sample compensation
// for the averaging filter. This is a synthesized plucked-string voice.
export function pluckedWave(sampleRate, frequency, duration, brightness, random = Math.random) {
  const result = new Float32Array(Math.ceil(sampleRate * duration));
  if (frequency >= sampleRate * .48) return result;
  if (frequency > sampleRate / 5) {
    // At very high pitches the delay loop is too short: use a stable tuned tail.
    for (let i = 0; i < result.length; i++) result[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * Math.exp(-i / sampleRate * 4) * .7;
    return result;
  }
  const delay = sampleRate / frequency - .5;
  const size = Math.ceil(delay) + 2, ring = new Float32Array(size);
  let mean = 0;
  for (let i = 0; i < size; i++) { ring[i] = random() * 2 - 1; mean += ring[i] / size; }
  for (let i = 0; i < size; i++) ring[i] -= mean;
  const feedback = .992 + Math.max(0, Math.min(1, brightness)) * .006;
  const read = position => {
    const wrapped = ((position % size) + size) % size;
    const index = Math.floor(wrapped), fraction = wrapped - index;
    return ring[index] * (1 - fraction) + ring[(index + 1) % size] * fraction;
  };
  let peak = .001;
  for (let i = 0; i < result.length; i++) {
    const value = (read(i - delay) + read(i - delay - 1)) * .5 * feedback;
    ring[i % size] = value; result[i] = value; peak = Math.max(peak, Math.abs(value));
  }
  const gain = .8 / peak;
  for (let i = 0; i < result.length; i++) result[i] *= gain;
  return result;
}
