import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, pluckedWave } from '../voices.mjs';
import { randomPatch } from '../music.mjs';
const seeded = () => { let seed = 192; return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; };

test('plucked-string synthesis is bounded, decays, and stays tuned across registers', () => {
  const sampleRate = 44100;
  for (const frequency of [130.81, 220, 440, 880]) {
    const data = pluckedWave(sampleRate, frequency, 1.2, .65, seeded());
    assert.equal(data.length, Math.ceil(sampleRate * 1.2));
    assert.ok(data.every(n => Number.isFinite(n) && Math.abs(n) <= .801));
    const rms = values => Math.sqrt(values.reduce((sum,n)=>sum+n*n,0)/values.length);
    assert.ok(rms(data.slice(35000,40000)) < rms(data.slice(100,4000)));
    const expected = sampleRate/frequency;
    let bestLag=0,best=-Infinity;
    for (let lag = Math.floor(expected)-3;lag <= Math.ceil(expected)+3;lag++) {
      let correlation = 0;
      for (let i=6000;i<10000;i++) correlation += data[i]*data[i+lag];
      if(correlation>best){ best=correlation;bestLag=lag; }
    }
    assert.ok(Math.abs(sampleRate/bestLag/frequency-1)<.015, `pitch ${frequency}: ${sampleRate/bestLag}`);
  }
});
test('eight voices have contrasting articulation and all are reachable by dice', () => {
  assert.equal(Object.keys(VOICES).length, 8);
  assert.ok(VOICES.orbit.attack > VOICES.chip.attack * 100);
  assert.ok(VOICES.orbit.length > VOICES.chip.length * 5);
  assert.ok(VOICES.bamboo.attack > VOICES.koto.attack * 10);
  const reached = new Set();
  for (let i=0;i<100;i++) reached.add(randomPatch({root:0,scale:'insen',voice:'kalimba',palette:'aurora'},()=>i/100).voice);
  assert.equal(reached.size,7); for(const voice of reached) assert.ok(VOICES[voice]);
});
